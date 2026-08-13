# pinnodds SDKs

Official client libraries for the [pinnodds](https://pinnodds.com) real-time
Pinnacle odds API — live and prematch REST snapshots, SSE odds-drop streams,
and a raw WebSocket passthrough.

| Language | Install | Docs |
|---|---|---|
| Python 3.8+ | `pip install pinnodds` | [python/](python/) · [PyPI](https://pypi.org/project/pinnodds/) |
| Node 18+ | `npm install pinnodds` | [node/](node/) · [npm](https://www.npmjs.com/package/pinnodds) |

```python
from pinnodds import Client
api = Client("YOUR_KEY")
for drop in api.stream_drops(min_drop=5):
    print(drop["home"], "v", drop["away"], drop["from_price"], "->", drop["to_price"])
```

Get a free trial key at [pinnodds.com](https://pinnodds.com) — no card, no
Pinnacle account. Full API reference: [pinnodds.com/docs](https://pinnodds.com/docs)
(or [llms-full.txt](https://pinnodds.com/llms-full.txt) for AI assistants).

Issues and PRs welcome. Not affiliated with, endorsed by, or connected to Pinnacle.

MIT
