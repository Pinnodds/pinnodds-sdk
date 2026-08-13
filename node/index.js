"use strict";
/**
 * pinnodds — JavaScript/TypeScript client for the pinnodds.com real-time
 * Pinnacle odds API. Zero dependencies (Node 18+ global fetch).
 *
 *   const { Client, SPORTS } = require("pinnodds");          // CJS
 *   import { Client, SPORTS } from "pinnodds";                // ESM
 *
 *   const api = new Client("YOUR_KEY");
 *   const events = await api.markets({ sportId: SPORTS.soccer });
 *   for await (const drop of api.streamDrops({ minDrop: 5 })) {
 *     console.log(drop.market, drop.from, "->", drop.to, drop.drop_pct);
 *   }
 *
 * Free trial key in seconds at https://pinnodds.com/ — no card, no Pinnacle
 * account. Docs: https://pinnodds.com/docs
 */

const DEFAULT_BASE_URL = "https://pinnodds.com";

/** Dropping-odds sport ids accepted by every endpoint's sportId param. */
const SPORTS = Object.freeze({
  soccer: 1,
  tennis: 2,
  basketball: 3,
  hockey: 4,
  football: 5,
  baseball: 6,
  rugby: 7,
  mma: 8,
  boxing: 9,
  other: 10, // volleyball / handball
  esports: 11,
  golf: 12,  // moneyline-only
});

class PinnoddsError extends Error {
  constructor(message, status = null, payload = null) {
    super(message);
    this.name = "PinnoddsError";
    this.status = status;
    this.payload = payload;
  }
}
class AuthError extends PinnoddsError {
  constructor(message, status = null, payload = null) {
    super(message, status, payload);
    this.name = "AuthError";
  }
}
class RateLimitError extends PinnoddsError {
  constructor(message, status = null, payload = null, retryAfter = null) {
    super(message, status, payload);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter; // seconds
  }
}

function buildUrl(base, path, params) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function decodeBody(res) {
  try { return await res.json(); } catch { return null; }
}

async function raiseForStatus(res) {
  const payload = await decodeBody(res);
  if (res.status === 401 || res.status === 403) {
    const msg = (payload && payload.error) || "unauthorized";
    throw new AuthError(`auth failed (${res.status}): ${msg}`, res.status, payload);
  }
  if (res.status === 429) {
    const ms = payload && typeof payload.retry_after_ms === "number" ? payload.retry_after_ms : null;
    throw new RateLimitError("rate limited", res.status, payload, ms != null ? ms / 1000 : null);
  }
  throw new PinnoddsError(`HTTP ${res.status}`, res.status, payload);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * True for the non-drop frames the SSE endpoints interleave with alerts — the
 * opening `{type:"connected", id}` handshake being the one you always get.
 * Real alerts carry prices and never carry a `type`, so this is unambiguous.
 */
function isControlFrame(o) {
  return !!o && typeof o.type === "string" &&
         o.from_price === undefined && o.to_price === undefined;
}

class Client {
  /**
   * @param {string} apiKey  Your pinnodds API key (it's also your login).
   * @param {object} [opts]
   * @param {string} [opts.baseUrl]   Default https://pinnodds.com
   * @param {number} [opts.timeoutMs] REST request timeout (default 15000).
   * @param {typeof fetch} [opts.fetch] Custom fetch (testing / proxies).
   */
  constructor(apiKey, opts = {}) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("apiKey is required — grab a free one at https://pinnodds.com/");
    }
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs || 15000;
    this._fetch = opts.fetch || globalThis.fetch;
    if (!this._fetch) throw new Error("global fetch not found — Node 18+ required (or pass opts.fetch)");
  }

  async _get(path, params) {
    const res = await this._fetch(buildUrl(this.baseUrl, path, params), {
      headers: { "x-api-key": this.apiKey },
      signal: AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined,
    });
    if (!res.ok) await raiseForStatus(res);
    return decodeBody(res);
  }

  // ── REST: markets & events ───────────────────────────────────────────────

  /**
   * Live (default) or prematch markets for one sport. GET /kit/v1/markets
   *
   * includeSpecials adds player/team props, exact scores and futures as extra
   * event rows. They are OFF by default because they dominate the payload —
   * soccer prematch goes from ~1.5k events to ~12.4k with the flag on.
   */
  markets({ sportId, eventType = "live", since, includeSpecials = false } = {}) {
    return this._get("/kit/v1/markets", {
      sport_id: sportId,
      event_type: eventType,
      since,
      include_specials: includeSpecials ? 1 : undefined,
    });
  }

  /** Single live event by id. GET /kit/v1/details */
  details(eventId) {
    return this._get("/kit/v1/details", { event_id: eventId });
  }

  /** All prematch fixtures for a sport. GET /kit/v1/prematch/fixtures */
  prematchFixtures({ sportId, since } = {}) {
    return this._get("/kit/v1/prematch/fixtures", { sport_id: sportId, since });
  }

  /** Full markets for one prematch event. GET /kit/v1/prematch/markets */
  prematchMarkets(eventId) {
    return this._get("/kit/v1/prematch/markets", { event_id: eventId });
  }

  /** Compact line view for one prematch event. GET /kit/v1/prematch/lines */
  prematchLines(eventId, { marketType } = {}) {
    return this._get("/kit/v1/prematch/lines", { event_id: eventId, market_type: marketType });
  }

  // ── REST: drops buffer ───────────────────────────────────────────────────

  /**
   * Recent dropping-odds events (queryable buffer). GET /api/drops
   * Use streamDrops() for real-time push instead.
   */
  drops({ mode = "live", sportId, minDropPct, maxDropPct, maxAgeSec = 3600,
          liveOnly = false, markets, periods, limit } = {}) {
    // maxAgeSec defaults to 3600 here on purpose. Server-side, omitting
    // max_age_sec returns ZERO rows regardless of every other filter — the
    // handler passes null and the receiving default only fires on `undefined`,
    // so the age test degenerates to `age > 0` and short-circuits on the first
    // record. Measured: no param -> total 0 with 2192 drops buffered; with
    // max_age_sec=3600 -> 307. Defaulting it means callers of this client get
    // results instead of a silent empty array.
    return this._get("/api/drops", {
      mode,
      sport_id: sportId,
      min_drop_pct: minDropPct,
      max_drop_pct: maxDropPct,
      max_age_sec: maxAgeSec,
      live: liveOnly ? "1" : undefined,
      markets: Array.isArray(markets) ? markets.join(",") : markets,
      periods: Array.isArray(periods) ? periods.join(",") : periods,
      limit,
    });
  }

  // ── REST: service ────────────────────────────────────────────────────────

  /** Service status: event counts, SSE client counts. GET /health */
  health() {
    return this._get("/health");
  }

  /** Public liveness probe (no auth). GET /ping → "ok" */
  async ping() {
    const res = await this._fetch(this.baseUrl + "/ping", {
      signal: AbortSignal.timeout ? AbortSignal.timeout(this.timeoutMs) : undefined,
    });
    if (!res.ok) await raiseForStatus(res);
    return (await res.text()).trim();
  }

  // ── SSE: real-time drop streams ──────────────────────────────────────────

  /**
   * Async generator of odds-drop alerts (Server-Sent Events).
   *
   * mode "live" → /odds-drop; "prematch" → /odds-drop-prematch.
   * minDrop = drop threshold in percent (server default 5, floor 1).
   * recheck (prematch only) = hold an alert N seconds and re-verify.
   * Requires a plan with SSE. 1 concurrent connection per account per stream.
   *
   * Reconnects automatically on transient network errors (reconnect=true);
   * auth/plan errors always throw. Pass an AbortSignal to stop cleanly.
   */
  async *streamDrops({ mode = "live", minDrop, recheck,
                       reconnect = true, backoffMs = 3000, signal } = {}) {
    const path = mode === "prematch" ? "/odds-drop-prematch" : "/odds-drop";
    const url = buildUrl(this.baseUrl, path, { key: this.apiKey, min_drop: minDrop, recheck });
    for (;;) {
      try {
        const res = await this._fetch(url, { signal });
        if (!res.ok) await raiseForStatus(res);
        for await (const payload of sseEvents(res)) {
          if (payload && payload.type === "error") {
            throw new AuthError(payload.message || "stream rejected", null, payload);
          }
          if (Array.isArray(payload)) {
            for (const item of payload) {
              if (item && typeof item === "object" && !isControlFrame(item)) yield item;
            }
          } else if (payload && typeof payload === "object" && !isControlFrame(payload)) {
            yield payload;
          }
        }
      } catch (err) {
        if (err instanceof AuthError || err instanceof RateLimitError) throw err;
        if (signal && signal.aborted) return;
        if (!reconnect) throw err;
        await sleep(backoffMs);
        continue;
      }
      if (signal && signal.aborted) return;
      if (!reconnect) return;
      await sleep(backoffMs);
    }
  }
}

/** Minimal SSE parser over a fetch Response body. Yields JSON-decoded events. */
async function* sseEvents(res) {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buf = "";
  let dataLines = [];
  const flush = function* () {
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    dataLines = [];
    try { yield JSON.parse(data); } catch { /* keepalive / non-JSON frame */ }
  };
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") { yield* flush(); continue; }
      if (line.startsWith(":")) continue; // comment / heartbeat
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  yield* flush();
}

module.exports = { Client, PinnoddsError, AuthError, RateLimitError, SPORTS, DEFAULT_BASE_URL };
