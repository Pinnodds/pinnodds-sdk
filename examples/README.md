# Examples

Small, complete programs built on the pinnodds clients. Each one runs as-is
with your key in `PINNODDS_KEY`. Get a free key at [pinnodds.com](https://pinnodds.com).

| Example | What it does | Free key? |
|---|---|---|
| [python/no_vig_fair_odds.py](python/no_vig_fair_odds.py) | Pinnacle moneylines with the vig removed: fair odds and margin for every upcoming game | Yes |
| [python/line_history_csv.py](python/line_history_csv.py) | Records moneyline, main spread and main total over time to CSV, so you can measure closing line value | Yes |
| [python/drops_to_telegram.py](python/drops_to_telegram.py) | Sends odds drops to a Telegram chat: pushed over SSE, or polled from the REST buffer on the free key | Yes (polled) |
| [node/drops-to-discord.mjs](node/drops-to-discord.mjs) | Posts odds drops to a Discord webhook the moment they happen | Needs SSE |

The 3-day full demo (SSE drop streams, raw WebSocket, 10 requests/second) is
available on request: ask on [Telegram](https://t.me/ArbitrageXpro) with the
email on your key.
