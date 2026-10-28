"""Send Pinnacle odds drops to a Telegram chat.

A drop is a price that just fell against its own recent history: the sharp
side of the market moving. On a plan with SSE the alerts are pushed the moment
they happen; on the free key the script polls the REST drops buffer instead.

    pip install pinnodds
    export PINNODDS_KEY=...          # your pinnodds key
    export TG_TOKEN=...              # from @BotFather
    export TG_CHAT=...               # your chat id (message @userinfobot)
    python drops_to_telegram.py      # optional: MIN_DROP=8 for bigger moves only
"""
import os
import time

import requests
from pinnodds import AuthError, Client

MIN_DROP = float(os.environ.get("MIN_DROP", "5"))
api = Client(os.environ["PINNODDS_KEY"])


def send(text):
    requests.post(
        f"https://api.telegram.org/bot{os.environ['TG_TOKEN']}/sendMessage",
        json={"chat_id": os.environ["TG_CHAT"], "text": text},
        timeout=10,
    )


def pushed():
    """SSE stream: alerts arrive as they happen. Needs a plan with SSE."""
    for d in api.stream_drops(min_drop=MIN_DROP):
        send(f'{d["home"]} v {d["away"]}\n'
             f'{d["sect"]} {d["outcome"]}: {d["from_price"]} -> {d["to_price"]}')


def polled(every=900):
    """REST buffer, for the free key (100 requests/day: one poll every 15 min)."""
    seen = set()
    while True:
        for d in api.drops(min_drop_pct=MIN_DROP, max_age_sec=every + 60).get("drops", []):
            key = (d["event_id"], d["market_key"], d["designation"], d["ts"])
            if key in seen:
                continue
            seen.add(key)
            send(f'{d["home"]} v {d["away"]} ({d["sport_name"]})\n'
                 f'{d["market"]} {d["designation"]} {d.get("points") or ""}: '
                 f'{d["from"]} -> {d["to"]}  (-{d["drop_pct"]}%)')
        time.sleep(every)


if __name__ == "__main__":
    try:
        pushed()
    except AuthError:
        print("No SSE on this key, polling the REST buffer instead.")
        polled()
