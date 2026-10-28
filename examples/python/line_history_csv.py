"""Record Pinnacle line history to CSV, for closing-line-value (CLV) checks.

Every INTERVAL seconds the script stores the full-game moneyline, main spread
and main total of every prematch game in one sport. The last row before kick-off
is the closing line: compare the price you bet against it to measure CLV.

    pip install pinnodds
    PINNODDS_KEY=... python line_history_csv.py soccer lines.csv

On the free key (100 requests/day) keep INTERVAL at 900 s or more.
ONCE=1 takes a single snapshot and exits.
"""
import csv
import os
import sys
import time
from datetime import datetime, timezone

from pinnodds import SPORTS, Client

INTERVAL = int(os.environ.get("INTERVAL", "900"))
FIELDS = ["at", "event_id", "starts", "home", "away", "ml_home", "ml_draw", "ml_away",
          "spread", "spread_home", "spread_away", "total", "over", "under"]


def main_line(lines, a, b):
    """The main line is the one whose two prices are closest to each other."""
    return min(lines.values(), key=lambda l: abs(l[a] - l[b]), default={})


def snapshot(api, sport_id):
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for ev in api.markets(sport_id=sport_id, event_type="prematch")["events"]:
        game = (ev.get("periods") or {}).get("num_0")
        if not game:
            continue
        ml = game.get("money_line") or {}
        sp = main_line(game.get("spreads") or {}, "home", "away")
        to = main_line(game.get("totals") or {}, "over", "under")
        yield {"at": at, "event_id": ev["event_id"], "starts": ev["starts"],
               "home": ev["home"], "away": ev["away"],
               "ml_home": ml.get("home"), "ml_draw": ml.get("draw"), "ml_away": ml.get("away"),
               "spread": sp.get("hdp"), "spread_home": sp.get("home"), "spread_away": sp.get("away"),
               "total": to.get("points"), "over": to.get("over"), "under": to.get("under")}


def main():
    sport = sys.argv[1] if len(sys.argv) > 1 else "soccer"
    path = sys.argv[2] if len(sys.argv) > 2 else f"{sport}_lines.csv"
    api = Client(os.environ["PINNODDS_KEY"])
    new = not os.path.exists(path)
    with open(path, "a", newline="", encoding="utf-8") as f:
        out = csv.DictWriter(f, fieldnames=FIELDS)
        if new:
            out.writeheader()
        while True:
            n = 0
            for row in snapshot(api, SPORTS[sport]):
                out.writerow(row)
                n += 1
            f.flush()
            print(f"{datetime.now():%H:%M:%S} wrote {n} games to {path}")
            if os.environ.get("ONCE"):
                return
            time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
