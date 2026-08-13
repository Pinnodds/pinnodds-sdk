# pinnodds SDKs

[![PyPI](https://img.shields.io/pypi/v/pinnodds?label=PyPI&color=4ade80)](https://pypi.org/project/pinnodds/)
[![npm](https://img.shields.io/npm/v/pinnodds?label=npm&color=4ade80)](https://www.npmjs.com/package/pinnodds)
[![Python](https://img.shields.io/badge/python-3.8%2B-blue)](python/)
[![Node](https://img.shields.io/badge/node-18%2B-blue)](node/)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](#license)

Official client libraries for **[pinnodds](https://pinnodds.com)** — a real-time
odds API serving Pinnacle live and prematch market data. Pinnacle retired its
public API in July 2025; pinnodds is an independent service that carries the
same market data over REST, Server-Sent Events and WebSocket.

Both clients cover the full REST surface and the real-time drop streams, with
automatic reconnection and sane defaults. No Pinnacle account is involved —
your pinnodds API key is the only credential.

---

## Install

| Language | Requirement | Install | Package |
|---|---|---|---|
| **Python** | 3.8+ | `pip install pinnodds` | [pypi.org/project/pinnodds](https://pypi.org/project/pinnodds/) |
| **Node.js** | 18+ | `npm install pinnodds` | [npmjs.com/package/pinnodds](https://www.npmjs.com/package/pinnodds) |

The Node client has **zero dependencies** and ships TypeScript types. The
Python client depends only on `requests` and ships type hints (`py.typed`).

Get a free trial key in seconds at [pinnodds.com](https://pinnodds.com) — no
card required. The trial covers REST; the drop streams need a plan with SSE.

## Quick start

### Python

```python
from pinnodds import Client, SPORTS

api = Client("YOUR_KEY")

# Live board for a sport
board = api.markets(sport_id=SPORTS["soccer"])
print(len(board["events"]), "live events")

# Real-time odds-drop alerts — pushed the moment a price falls
for d in api.stream_drops(min_drop=5):
    print(f'{d["home"]} v {d["away"]}  {d["sect"]} {d["outcome"]}  '
          f'{d["from_price"]} -> {d["to_price"]}')
```

### Node.js

```js
import { Client, SPORTS } from "pinnodds";

const api = new Client(process.env.PINNODDS_KEY);

// Live board for a sport
const board = await api.markets({ sportId: SPORTS.soccer });
console.log(board.events.length, "live events");

// Real-time odds-drop alerts as an async iterator
for await (const d of api.streamDrops({ minDrop: 5 })) {
  console.log(`${d.home} v ${d.away}  ${d.sect} ${d.outcome}  ${d.from_price} -> ${d.to_price}`);
}
```

## What the API provides

- **Live odds** — pushed from Pinnacle's own feed; money lines, spreads,
  totals and team totals across every period, for 12 sports.
- **Prematch odds** — full boards with delta cursors (`since`), refreshed on
  a 5-second cycle.
- **Full line depth on every plan** — quarter lines included (soccer totals at
  1.75 / 2.25 / 2.75 / 3.25, quarter-ball handicaps). Plans differ in rate
  limits and push access, never in data depth.
- **Odds-drop detection** — server-side alerts the instant a price falls
  against its own recent history, over SSE (`stream_drops` / `streamDrops`)
  or as a queryable REST buffer (`drops`).
- **Specials** — player props, exact scores, futures and outrights via
  `include_specials`, each row linked to its fixture by `parent_id`.
- **Raw WebSocket passthrough** *(add-on)* — every upstream frame forwarded
  verbatim for consumers who rebuild full market state client-side.

## Surface covered by both clients

| Method (Python / Node) | Endpoint | Purpose |
|---|---|---|
| `markets` | `GET /kit/v1/markets` | Live or prematch board for a sport |
| `details` | `GET /kit/v1/details` | One live event by id |
| `prematch_fixtures` / `prematchFixtures` | `GET /kit/v1/prematch/fixtures` | All prematch fixtures for a sport |
| `prematch_markets` / `prematchMarkets` | `GET /kit/v1/prematch/markets` | Full markets for one prematch event |
| `prematch_lines` / `prematchLines` | `GET /kit/v1/prematch/lines` | Compact line view |
| `drops` | `GET /api/drops` | Recent drops buffer (pull) |
| `stream_drops` / `streamDrops` | `SSE /odds-drop`, `/odds-drop-prematch` | Real-time drop alerts (push) |
| `health` / `ping` | `GET /health`, `GET /ping` | Service status / liveness |

Authentication is a single header: `x-api-key: YOUR_KEY` (the streams accept
`?key=` because `EventSource` cannot set headers).

## Good to know

- **The stream and the buffer return different shapes, on purpose.** An SSE
  alert names the market in `sect`, the moving selection in `outcome`, prices
  in `from_price` / `to_price`, and carries `limit` (Pinnacle's max stake) and
  `nvp` (no-vig fair price) — but no drop percentage. A REST `drops()` row is
  the enriched form: `market`, `designation`, `from` / `to` and a precomputed
  `drop_pct`. Both READMEs document the mapping.
- **Reconnection is built in.** The stream iterators reconnect on transient
  network errors and re-raise anything reconnecting can't fix (bad key, plan
  without SSE). Pass an abort signal (Node) or break the loop (Python) to
  stop cleanly.
- **`drops()` always sends `max_age_sec`** (default 3600) — the endpoint
  returns an empty list without it, so the clients protect you from a silent
  zero-row response.
- **One concurrent stream per account per stream type** (live + prematch can
  run in parallel).

## Documentation

- [Full API reference](https://pinnodds.com/docs) — every endpoint, parameter and response shape
- [LLM-optimised reference](https://pinnodds.com/llms-full.txt) — the whole API as one markdown file
- [Postman collection](https://pinnodds.com/pinnodds.postman_collection.json) — import by URL
- Per-client docs: [python/](python/) · [node/](node/)

## Support

- Bugs and feature requests: [GitHub issues](https://github.com/Pinnodds/pinnodds-sdk/issues)
- API / account questions: [Telegram](https://t.me/ArbitrageXpro) or info@pinnodds.com

Pull requests are welcome — both clients are deliberately small and
dependency-light, and we'd like to keep them that way.

## License

MIT. Not affiliated with, endorsed by, or connected to Pinnacle.
