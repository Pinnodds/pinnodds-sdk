# pinnodds

Python client for the [pinnodds](https://pinnodds.com) Pinnacle odds API.

Pinnacle retired its public API in July 2025. pinnodds is an independent service
that carries the same market data — live and prematch — as REST snapshots and as
Server-Sent Event streams of odds drops.

```bash
pip install pinnodds
```

Python 3.8+. One dependency (`requests`).

## Usage

```python
from pinnodds import Client, SPORTS

api = Client("YOUR_KEY")

board = api.markets(sport_id=SPORTS["soccer"])
print(len(board["events"]), "live events")
```

Drop alerts arrive as an ordinary iterator, so a monitoring loop is three lines:

```python
for d in api.stream_drops(min_drop=5):
    print(f'{d["home"]} v {d["away"]}  {d["sect"]} {d["outcome"]}  '
          f'{d["from_price"]} -> {d["to_price"]}')
```

The generator reconnects by itself when the network blips and re-raises anything
that reconnecting cannot fix — a bad key, or a plan without SSE. The opening
`{"type": "connected"}` handshake is filtered out, so every item you get is a
real alert. Get a key at [pinnodds.com](https://pinnodds.com); no card and no
Pinnacle account needed.

### The stream and the buffer return different shapes

An SSE alert names the market in `sect` (`"Moneyline"`), the moving selection in
`outcome` (`"Home"`), the prices in `from_price`/`to_price`, and the event in
`id`. A `drops()` row is the enriched form: `market` (`"moneyline"`),
`designation` (`"home"`), `from`/`to`, `event_id`, and a precomputed `drop_pct`.

SSE alerts carry no `drop_pct`, so derive it when you need one:

```python
pct = (1 - d["to_price"] / d["from_price"]) * 100
```

What they carry instead is `limit` (Pinnacle's max stake on that selection),
`nvp` (the no-vig fair price) and `price_x`/`price_y`/`price_z` for the rest of
the market at alert time.

## Endpoints

```python
api.markets(sport_id=1)                        # live board
api.markets(sport_id=1, event_type="prematch") # prematch board
api.markets(sport_id=1, since=last_version)    # only what changed
api.markets(sport_id=1, include_specials=True) # + props, futures, outrights
api.details(event_id)
api.prematch_fixtures(sport_id=1)
api.prematch_markets(event_id)
api.prematch_lines(event_id, market_type="total")
api.drops(sport_id=1, min_drop_pct=5)          # recent buffer, no open connection
api.health()
api.ping()                                     # no auth
```

Feed `since` the `last` value from the previous response to pull a delta instead
of the whole board. Prematch versions churn quickly, so a cursor more than a few
minutes old will return most of the board anyway.

## Errors

```python
from pinnodds import AuthError, RateLimitError, PinnoddsError

try:
    api.markets(sport_id=1)
except AuthError:
    ...                       # bad key, or the plan lacks this surface
except RateLimitError as e:
    time.sleep(e.retry_after or 1)
except PinnoddsError as e:
    print(e.status, e.payload)
```

`AuthError` and `RateLimitError` both subclass `PinnoddsError`, so catching the
base class catches everything this library raises.

## Details worth knowing

Every line Pinnacle prices comes through, **quarter lines** included — soccer
totals at 1.75 / 2.25 / 2.75 / 3.25 and quarter-ball handicaps at -0.75 / -1.25 /
-1.75 / -2.25, not just the halves. Depth is the same on every plan; plans differ
in rate limit and push access, not in what you can see.

**Specials** are opt-in. Pass `include_specials=True` and props, handicap
variants, futures and outrights arrive as their own event rows, each carrying a
`special` that describes it (`"3-Way Handicap Gornik Zabrze +1"`), a
`special_category` (`"Team Props"`, `"Futures"`, `"Relegation"`), its odds under
`special_markets`, and a `parent_id` pointing at the fixture — so correlating
them needs no name matching. They're off by default because they dominate the
payload: soccer prematch is ~1,500 events without the flag and ~12,400 with it.

`drops()` sends `max_age_sec=3600` unless you override it. Omitting the parameter
makes the endpoint return an empty list no matter what else you filter on, so the
client supplies it rather than handing you a silent zero-row result.

## Links

- [Documentation](https://pinnodds.com/docs)
- [API reference for LLMs](https://pinnodds.com/llms-full.txt)
- Node.js client: [`npm install pinnodds`](https://www.npmjs.com/package/pinnodds)

Not affiliated with, endorsed by, or connected to Pinnacle.

MIT
