"use strict";
// Offline test suite — every request is served by a stub fetch, so this runs
// with no network and no API key. Run: node --test test/
const test = require("node:test");
const assert = require("node:assert");
const { Client, PinnoddsError, AuthError, RateLimitError, SPORTS } = require("../index.js");

/** Records the calls it receives and replies with a canned JSON response. */
function stubJson(body, { status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: new URL(url), init: init || {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetch, calls };
}

/** Replies with an SSE body assembled from the given raw chunks. */
function stubSse(chunks) {
  const fetch = async () => ({
    ok: true,
    status: 200,
    body: (async function* () {
      const enc = new TextEncoder();
      for (const c of chunks) yield enc.encode(c);
    })(),
  });
  return { fetch };
}

// ── construction ────────────────────────────────────────────────────────────

test("apiKey is required", () => {
  assert.throws(() => new Client(), /apiKey is required/);
  assert.throws(() => new Client(""), /apiKey is required/);
});

test("baseUrl trailing slashes are stripped", () => {
  const c = new Client("k", { baseUrl: "https://example.com///" });
  assert.strictEqual(c.baseUrl, "https://example.com");
});

// ── auth + url building ─────────────────────────────────────────────────────

test("sends the key as the x-api-key header", async () => {
  const s = stubJson({ events: [] });
  await new Client("SECRET", { fetch: s.fetch }).markets({ sportId: 1 });
  assert.strictEqual(s.calls[0].init.headers["x-api-key"], "SECRET");
});

test("markets maps camelCase opts to the wire's snake_case params", async () => {
  const s = stubJson({ events: [] });
  await new Client("k", { fetch: s.fetch }).markets({ sportId: SPORTS.tennis, eventType: "prematch", since: 42 });
  const q = s.calls[0].url.searchParams;
  assert.strictEqual(s.calls[0].url.pathname, "/kit/v1/markets");
  assert.strictEqual(q.get("sport_id"), "2");
  assert.strictEqual(q.get("event_type"), "prematch");
  assert.strictEqual(q.get("since"), "42");
});

test("includeSpecials sends include_specials=1, and is off by default", async () => {
  const s = stubJson({ events: [] });
  const api = new Client("k", { fetch: s.fetch });
  await api.markets({ sportId: 1 });
  assert.strictEqual(s.calls[0].url.searchParams.has("include_specials"), false);
  await api.markets({ sportId: 1, includeSpecials: true });
  assert.strictEqual(s.calls[1].url.searchParams.get("include_specials"), "1");
});

test("undefined params are omitted, not sent as the string 'undefined'", async () => {
  const s = stubJson({ events: [] });
  await new Client("k", { fetch: s.fetch }).markets({ sportId: 1 });
  assert.strictEqual(s.calls[0].url.searchParams.has("since"), false);
  assert.strictEqual(s.calls[0].url.toString().includes("undefined"), false);
});

// ── the drops max_age_sec default (guards a real server-side bug) ────────────

test("drops() always sends max_age_sec — omitting it returns zero rows server-side", async () => {
  const s = stubJson({ total: 0, drops: [] });
  await new Client("k", { fetch: s.fetch }).drops({ sportId: 1 });
  assert.strictEqual(s.calls[0].url.searchParams.get("max_age_sec"), "3600");
});

test("an explicit maxAgeSec still wins over the default", async () => {
  const s = stubJson({ total: 0, drops: [] });
  await new Client("k", { fetch: s.fetch }).drops({ maxAgeSec: 60 });
  assert.strictEqual(s.calls[0].url.searchParams.get("max_age_sec"), "60");
});

test("array filters are joined into comma lists", async () => {
  const s = stubJson({ total: 0, drops: [] });
  await new Client("k", { fetch: s.fetch }).drops({ markets: ["moneyline", "total"], periods: [0, 1] });
  const q = s.calls[0].url.searchParams;
  assert.strictEqual(q.get("markets"), "moneyline,total");
  assert.strictEqual(q.get("periods"), "0,1");
});

test("liveOnly false does not send live=0", async () => {
  const s = stubJson({ total: 0, drops: [] });
  await new Client("k", { fetch: s.fetch }).drops({});
  assert.strictEqual(s.calls[0].url.searchParams.has("live"), false);
});

// ── error mapping ───────────────────────────────────────────────────────────

test("401 and 403 become AuthError", async () => {
  for (const status of [401, 403]) {
    const s = stubJson({ error: "missing_key" }, { status });
    await assert.rejects(
      () => new Client("k", { fetch: s.fetch }).health(),
      (e) => e instanceof AuthError && e.status === status && /missing_key/.test(e.message),
    );
  }
});

test("429 becomes RateLimitError with retryAfter in seconds", async () => {
  const s = stubJson({ retry_after_ms: 2500 }, { status: 429 });
  await assert.rejects(
    () => new Client("k", { fetch: s.fetch }).health(),
    (e) => e instanceof RateLimitError && e.retryAfter === 2.5,
  );
});

test("other failures become PinnoddsError carrying status and payload", async () => {
  const s = stubJson({ error: "boom" }, { status: 500 });
  await assert.rejects(
    () => new Client("k", { fetch: s.fetch }).health(),
    (e) => e instanceof PinnoddsError && e.status === 500 && e.payload.error === "boom",
  );
});

test("AuthError and RateLimitError are both PinnoddsError", () => {
  assert.ok(new AuthError("x") instanceof PinnoddsError);
  assert.ok(new RateLimitError("x") instanceof PinnoddsError);
});

// ── SSE parsing ─────────────────────────────────────────────────────────────

async function collect(gen, n) {
  const out = [];
  for await (const v of gen) { out.push(v); if (out.length >= n) break; }
  return out;
}

test("streamDrops yields parsed drop objects", async () => {
  const s = stubSse(['data: {"event_id":1,"drop_pct":7}\n\n', 'data: {"event_id":2,"drop_pct":9}\n\n']);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 2);
  assert.deepStrictEqual(got.map((d) => d.event_id), [1, 2]);
});

test("an event split across chunk boundaries is reassembled", async () => {
  const s = stubSse(['data: {"event_', 'id":7,"drop_pct":', "5}\n\n"]);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1);
  assert.strictEqual(got[0].event_id, 7);
});

test("comment heartbeats and CRLF line endings are handled", async () => {
  const s = stubSse([": keepalive\r\n\r\n", 'data: {"event_id":3}\r\n\r\n']);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1);
  assert.strictEqual(got[0].event_id, 3);
});

test("an array payload is flattened into individual drops", async () => {
  const s = stubSse(['data: [{"event_id":1},{"event_id":2}]\n\n']);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 2);
  assert.deepStrictEqual(got.map((d) => d.event_id), [1, 2]);
});

test("a non-JSON frame is skipped rather than throwing", async () => {
  const s = stubSse(["data: not json\n\n", 'data: {"event_id":4}\n\n']);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1);
  assert.strictEqual(got[0].event_id, 4);
});

test("the {type:'connected'} handshake is not yielded as a drop", async () => {
  // The live server always opens with this frame; yielding it hands callers an
  // object whose every drop field is undefined.
  const s = stubSse([
    'data: {"type":"connected","id":"701978d8"}\n\n',
    'data: {"id":1633870104,"from_price":1.357,"to_price":1.315,"sect":"Moneyline"}\n\n',
  ]);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].id, 1633870104);
  assert.strictEqual(got[0].from_price, 1.357);
});

test("control frames inside an array payload are filtered too", async () => {
  const s = stubSse(['data: [{"type":"connected"},{"id":7,"from_price":2,"to_price":1.9}]\n\n']);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].id, 7);
});

test("an alert that happens to carry a type is still yielded if it has prices", async () => {
  const s = stubSse(['data: {"type":"drop","id":9,"from_price":2,"to_price":1.8}\n\n']);
  const got = await collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1);
  assert.strictEqual(got[0].id, 9);
});

test("a server error frame raises AuthError instead of being yielded", async () => {
  const s = stubSse(['data: {"type":"error","message":"plan does not include SSE"}\n\n']);
  await assert.rejects(
    () => collect(new Client("k", { fetch: s.fetch }).streamDrops({ reconnect: false }), 1),
    (e) => e instanceof AuthError && /plan does not include SSE/.test(e.message),
  );
});

test("streamDrops puts the key in the query string, not the header", async () => {
  // SSE via EventSource-style URLs can't set headers, so the server accepts ?key=
  let seen;
  const fetch = async (url) => { seen = new URL(url); return { ok: true, status: 200, body: (async function* () {})() }; };
  await collect(new Client("KEY123", { fetch }).streamDrops({ mode: "prematch", minDrop: 3, recheck: 20, reconnect: false }), 0);
  assert.strictEqual(seen.pathname, "/odds-drop-prematch");
  assert.strictEqual(seen.searchParams.get("key"), "KEY123");
  assert.strictEqual(seen.searchParams.get("min_drop"), "3");
  assert.strictEqual(seen.searchParams.get("recheck"), "20");
});

test("live mode targets /odds-drop", async () => {
  let seen;
  const fetch = async (url) => { seen = new URL(url); return { ok: true, status: 200, body: (async function* () {})() }; };
  await collect(new Client("k", { fetch }).streamDrops({ reconnect: false }), 0);
  assert.strictEqual(seen.pathname, "/odds-drop");
});

test("an aborted signal ends the stream instead of reconnecting forever", async () => {
  const ctrl = new AbortController();
  const fetch = async () => { ctrl.abort(); throw new Error("network reset"); };
  const got = await collect(
    new Client("k", { fetch }).streamDrops({ signal: ctrl.signal, backoffMs: 1 }), 1);
  assert.deepStrictEqual(got, []);
});

// ── misc ────────────────────────────────────────────────────────────────────

test("SPORTS is frozen and covers the documented ids", () => {
  assert.strictEqual(SPORTS.soccer, 1);
  assert.strictEqual(SPORTS.esports, 11);
  assert.ok(Object.isFrozen(SPORTS));
});

test("ping returns trimmed text and needs no key header", async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => "ok\n" }; };
  const out = await new Client("k", { fetch }).ping();
  assert.strictEqual(out, "ok");
  assert.strictEqual(seen.url, "https://pinnodds.com/ping");
});
