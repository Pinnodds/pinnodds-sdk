# pinnodds

Official Node.js client for the [pinnodds](https://pinnodds.com) Pinnacle odds API.

Pinnacle closed its public API in July 2025. pinnodds is an independent service that
carries the same market data — live and prematch — over REST snapshots, Server-Sent
Event drop alerts, and a raw WebSocket passthrough.

Zero dependencies. TypeScript types included. Node 18+.

```bash
npm install pinnodds
```

## Quick start

```js
import { Client, SPORTS } from "pinnodds";

const api = new Client(process.env.PINNODDS_KEY);

// Live soccer board
const board = await api.markets({ sportId: SPORTS.soccer });
console.log(board.events.length, "live events");

// Real-time drop alerts — pushed the instant a price falls
for await (const d of api.streamDrops({ minDrop: 5 })) {
  console.log(`${d.home} v ${d.away}  ${d.sect} ${d.outcome}  ${d.from_price} -> ${d.to_price}`);
}
```

Get a key at [pinnodds.com](https://pinnodds.com) — no card, no Pinnacle account.
The trial covers REST; the drop streams need a plan that includes SSE.

## What you get

**Full line depth.** Every line Pinnacle prices comes through, quarter lines
included — soccer totals at 1.75 / 2.25 / 2.75 / 3.25 and quarter-ball handicaps
at -0.75 / -1.25 / -1.75 / -2.25, not just the halves. Depth is the same on every
plan; plans differ in rate limit and push access, not in what you can see.

**Specials, when you ask for them.** Pass `includeSpecials: true` and props,
handicap variants, futures and outright markets arrive as their own event rows —
each with a `special` describing it ("3-Way Handicap Gornik Zabrze +1"), a
`special_category` ("Team Props", "Futures", "Relegation"), its odds under
`special_markets`, and a `parent_id` pointing at the fixture, so correlating them
takes no name matching. They are off by default because they dominate the
payload: soccer prematch is ~1,500 events without the flag and ~12,400 with it.

**Both pipelines.** Live and prematch run side by side across soccer, tennis,
basketball, hockey, football, baseball, rugby, esports and more.

## API

### Markets and events

```js
await api.markets({ sportId: 1 });                        // live board
await api.markets({ sportId: 1, eventType: "prematch" }); // prematch board
await api.markets({ sportId: 1, since: lastVersion });    // delta since a cursor
await api.markets({ sportId: 1, includeSpecials: true }); // + props & futures
await api.details(eventId);                               // one live event
await api.prematchFixtures({ sportId: 1 });
await api.prematchMarkets(eventId);
await api.prematchLines(eventId, { marketType: "total" });
```

Pass `since` with the `last` value from the previous response to fetch only what
changed. Note that prematch versions churn quickly, so a cursor more than a few
minutes old will return most of the board again.

### Drop alerts

Two ways to get the same events — pick by latency tolerance.

```js
// Push (recommended): the alert arrives as the price moves
for await (const d of api.streamDrops({ minDrop: 5 })) { /* ... */ }

// Prematch stream, with a re-check window to filter transient blips
for await (const d of api.streamDrops({ mode: "prematch", minDrop: 3, recheck: 20 })) { }

// Pull: the recent buffer, for backfill or a cold start
const { drops } = await api.drops({ sportId: 1, minDropPct: 5 });
```

**The two surfaces return different shapes**, and the types (`DropAlert` vs
`Drop`) say so. An SSE alert names the market in `sect` ("Moneyline"), the moving
selection in `outcome` ("Home"), the prices in `from_price`/`to_price`, and the
event in `id`. A REST row is the enriched form: `market` ("moneyline"),
`designation` ("home"), `from`/`to`, `event_id`, plus a precomputed `drop_pct`
and `market_key`. SSE alerts carry no `drop_pct` — derive it if you need one:

```js
const pct = (1 - d.to_price / d.from_price) * 100;
```

In exchange, an alert carries things the REST row doesn't: `limit` (Pinnacle's
max stake on that selection), `nvp` (the no-vig fair price), and `price_x/y/z`
for the rest of the market at alert time.

`streamDrops()` reconnects on transient network errors and rethrows auth/plan
errors. The opening `{type:"connected"}` handshake is filtered out, so every
value you receive is a real alert. Pass an `AbortSignal` to stop it cleanly:

```js
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 60_000);
for await (const d of api.streamDrops({ signal: ctrl.signal })) { /* ... */ }
```

One concurrent stream per account, per stream type.

### Errors

```js
import { AuthError, RateLimitError, PinnoddsError } from "pinnodds";

try {
  await api.markets({ sportId: 1 });
} catch (err) {
  if (err instanceof AuthError) { /* bad key, or plan lacks this surface */ }
  else if (err instanceof RateLimitError) { console.log(err.retryAfter); }
  else if (err instanceof PinnoddsError) { console.log(err.status, err.payload); }
}
```

## Notes

`drops()` defaults `maxAgeSec` to 3600. The underlying endpoint returns an empty
array when that parameter is omitted, so the client sets it rather than letting a
caller get a silent zero-row response.

Sport ids are exported as `SPORTS` (`SPORTS.soccer === 1`, and so on) so you don't
have to memorise them.

## Links

- [Documentation](https://pinnodds.com/docs)
- [API reference for LLMs](https://pinnodds.com/llms-full.txt)

Not affiliated with, endorsed by, or connected to Pinnacle.

MIT
