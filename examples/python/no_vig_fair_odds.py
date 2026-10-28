"""Pinnacle no-vig fair odds for every upcoming game in a sport.

Pinnacle runs the lowest margin in the market, so removing its vig gives the
closest thing to a "true" price. This script pulls the prematch board, strips
the margin from each full-game moneyline (multiplicative method) and prints
the fair odds next to Pinnacle's.

    pip install pinnodds
    PINNODDS_KEY=... python no_vig_fair_odds.py basketball

Works on the free key: one REST request per run.
"""
import os
import sys

from pinnodds import SPORTS, Client


def no_vig(prices):
    """Multiplicative de-vig: implied probabilities scaled to sum to 1."""
    implied = [1 / p for p in prices]
    book = sum(implied)
    return [round(book / q, 3) for q in implied], book - 1


def main():
    sport = sys.argv[1] if len(sys.argv) > 1 else "soccer"
    api = Client(os.environ["PINNODDS_KEY"])
    board = api.markets(sport_id=SPORTS[sport], event_type="prematch")

    rows = []
    for ev in board["events"]:
        game = (ev.get("periods") or {}).get("num_0") or {}
        ml = game.get("money_line") or {}
        sides = [k for k in ("home", "draw", "away") if ml.get(k)]
        if len(sides) < 2:
            continue
        prices = [ml[k] for k in sides]
        fair, margin = no_vig(prices)
        rows.append((ev["starts"], f'{ev["home"]} v {ev["away"]}', sides, prices, fair, margin))

    rows.sort(key=lambda r: r[0])
    for starts, match, sides, prices, fair, margin in rows[:40]:
        cells = "  ".join(f"{s[0].upper()} {p:>6} -> {f:>6}" for s, p, f in zip(sides, prices, fair))
        print(f"{starts[:16]}  {match[:44]:<44}  {cells}  margin {margin:.1%}")
    print(f"\n{len(rows)} games with a moneyline; showing the first {min(len(rows), 40)}.")


if __name__ == "__main__":
    main()
