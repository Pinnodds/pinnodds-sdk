"""pinnodds — Python client for the pinnodds.com real-time Pinnacle odds API.

REST snapshots (live + prematch markets, recent drops) and Server-Sent-Events
streams of odds drops. Auth is a single API key — get a free trial key in
seconds at https://pinnodds.com/ (no card, no Pinnacle account).

Quickstart::

    from pinnodds import Client

    api = Client("YOUR_KEY")
    events = api.markets(sport_id=1)              # live soccer markets
    for drop in api.stream_drops(min_drop=5):     # real-time drop alerts (SSE)
        print(drop["market"], drop["from"], "->", drop["to"], drop["drop_pct"])
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Iterator, List, Optional, Sequence

import requests

__all__ = [
    "Client",
    "PinnoddsError",
    "AuthError",
    "RateLimitError",
    "SPORTS",
]

DEFAULT_BASE_URL = "https://pinnodds.com"

#: Dropping-odds sport ids accepted by every endpoint's ``sport_id`` param.
SPORTS: Dict[str, int] = {
    "soccer": 1,
    "tennis": 2,
    "basketball": 3,
    "hockey": 4,
    "football": 5,
    "baseball": 6,
    "rugby": 7,
    "mma": 8,
    "boxing": 9,
    "other": 10,  # volleyball / handball
    "esports": 11,
    "golf": 12,   # moneyline-only
}


class PinnoddsError(Exception):
    """Base error. Carries the HTTP ``status`` and decoded ``payload`` if any."""

    def __init__(self, message: str, status: Optional[int] = None, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class AuthError(PinnoddsError):
    """Missing/invalid API key, or the plan doesn't include this surface."""


class RateLimitError(PinnoddsError):
    """Plan rate limit hit. ``retry_after`` is seconds until the window resets."""

    def __init__(self, message: str, status: Optional[int] = None, payload: Any = None,
                 retry_after: Optional[float] = None):
        super().__init__(message, status, payload)
        self.retry_after = retry_after


def _clean(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in params.items() if v is not None}


def _is_control_frame(obj: Any) -> bool:
    """True for the non-drop frames the SSE endpoints interleave with alerts.

    The opening ``{"type": "connected", "id": ...}`` handshake is the one you
    always get. Real alerts carry prices and never carry a ``type``, so this
    test is unambiguous.
    """
    return (isinstance(obj, dict) and isinstance(obj.get("type"), str)
            and "from_price" not in obj and "to_price" not in obj)


class Client:
    """HTTP client for the pinnodds REST endpoints and SSE drop streams.

    :param api_key:  Your pinnodds API key (it's also your login).
    :param base_url: Override for self-hosted/proxy setups. Default ``https://pinnodds.com``.
    :param timeout:  Per-request timeout in seconds for REST calls.
    :param session:  Optional pre-configured ``requests.Session`` (e.g. for proxies).
    """

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL,
                 timeout: float = 15.0, session: Optional[requests.Session] = None):
        if not api_key or not isinstance(api_key, str):
            raise ValueError("api_key is required — grab a free one at https://pinnodds.com/")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._session = session or requests.Session()

    # ── internals ──────────────────────────────────────────────────────────

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        resp = self._session.get(
            self.base_url + path,
            params=_clean(params or {}),
            headers={"x-api-key": self.api_key},
            timeout=self.timeout,
        )
        return self._handle(resp)

    @staticmethod
    def _handle(resp: "requests.Response") -> Any:
        try:
            payload: Any = resp.json()
        except ValueError:
            payload = None
        if resp.status_code in (401, 403):
            msg = (payload or {}).get("error", "unauthorized") if isinstance(payload, dict) else "unauthorized"
            raise AuthError(f"auth failed ({resp.status_code}): {msg}", resp.status_code, payload)
        if resp.status_code == 429:
            retry_ms = (payload or {}).get("retry_after_ms") if isinstance(payload, dict) else None
            retry = (retry_ms / 1000.0) if isinstance(retry_ms, (int, float)) else None
            raise RateLimitError("rate limited", resp.status_code, payload, retry_after=retry)
        if resp.status_code >= 400:
            raise PinnoddsError(f"HTTP {resp.status_code}", resp.status_code, payload)
        return payload

    # ── REST: markets & events ─────────────────────────────────────────────

    def markets(self, sport_id: int, event_type: str = "live", since: Optional[int] = None,
                include_specials: bool = False) -> Any:
        """Live (default) or prematch markets for one sport.

        ``GET /kit/v1/markets`` — pass ``event_type="prematch"`` to switch feeds.

        ``include_specials`` adds player/team props, exact scores and futures as
        extra event rows. Off by default because they dominate the payload:
        soccer prematch goes from ~1.5k events to ~12.4k with the flag on.
        """
        return self._get("/kit/v1/markets", {
            "sport_id": sport_id,
            "event_type": event_type,
            "since": since,
            "include_specials": 1 if include_specials else None,
        })

    def details(self, event_id: int) -> Any:
        """Single live event by id. ``GET /kit/v1/details``."""
        return self._get("/kit/v1/details", {"event_id": event_id})

    def prematch_fixtures(self, sport_id: int, since: Optional[int] = None) -> Any:
        """All prematch fixtures for a sport. ``GET /kit/v1/prematch/fixtures``."""
        return self._get("/kit/v1/prematch/fixtures", {"sport_id": sport_id, "since": since})

    def prematch_markets(self, event_id: int) -> Any:
        """Full markets for one prematch event. ``GET /kit/v1/prematch/markets``."""
        return self._get("/kit/v1/prematch/markets", {"event_id": event_id})

    def prematch_lines(self, event_id: int, market_type: Optional[str] = None) -> Any:
        """Compact line view for one prematch event. ``GET /kit/v1/prematch/lines``."""
        return self._get("/kit/v1/prematch/lines",
                         {"event_id": event_id, "market_type": market_type})

    # ── REST: drops buffer ─────────────────────────────────────────────────

    def drops(self, mode: str = "live", sport_id: Optional[int] = None,
              min_drop_pct: Optional[float] = None, max_drop_pct: Optional[float] = None,
              max_age_sec: Optional[int] = 3600, live_only: bool = False,
              markets: Optional[Sequence[str]] = None, periods: Optional[Sequence[int]] = None,
              limit: Optional[int] = None) -> Any:
        """Recent dropping-odds events (queryable buffer). ``GET /api/drops``.

        Use this for "what just dropped" without holding a connection open;
        use :meth:`stream_drops` for real-time push.

        ``max_age_sec`` defaults to 3600 on purpose. Server-side, omitting the
        parameter returns ZERO rows regardless of every other filter — the age
        test degenerates and short-circuits on the first record. Measured: no
        param -> total 0 with 2192 drops buffered; with max_age_sec=3600 -> 307.
        Passing it by default means callers get results, not a silent empty list.
        """
        return self._get("/api/drops", {
            "mode": mode,
            "sport_id": sport_id,
            "min_drop_pct": min_drop_pct,
            "max_drop_pct": max_drop_pct,
            "max_age_sec": max_age_sec,
            "live": "1" if live_only else None,
            "markets": ",".join(markets) if markets else None,
            "periods": ",".join(str(p) for p in periods) if periods else None,
            "limit": limit,
        })

    # ── REST: service ──────────────────────────────────────────────────────

    def health(self) -> Any:
        """Service status: event counts, SSE client counts. ``GET /health``."""
        return self._get("/health")

    def ping(self) -> str:
        """Public liveness probe (no auth required). ``GET /ping`` → ``"ok"``."""
        resp = self._session.get(self.base_url + "/ping", timeout=self.timeout)
        if resp.status_code >= 400:
            self._handle(resp)
        return (resp.text or "").strip()

    # ── SSE: real-time drop streams ────────────────────────────────────────

    def stream_drops(self, mode: str = "live", min_drop: Optional[float] = None,
                     recheck: Optional[int] = None, reconnect: bool = True,
                     backoff: float = 3.0) -> Iterator[Dict[str, Any]]:
        """Yield odds-drop alerts as they happen (Server-Sent Events).

        ``mode="live"`` connects to ``/odds-drop``; ``mode="prematch"`` to
        ``/odds-drop-prematch``. ``min_drop`` is the drop threshold in percent
        (server default 5, floor 1). ``recheck`` (prematch only) holds an alert
        N seconds and re-verifies before sending. Requires a plan with SSE.

        With ``reconnect=True`` (default) transient network errors trigger an
        automatic reconnect after ``backoff`` seconds; auth/plan errors always
        raise immediately. Note: 1 concurrent connection per account per stream.
        """
        path = "/odds-drop-prematch" if mode == "prematch" else "/odds-drop"
        params = _clean({"key": self.api_key, "min_drop": min_drop, "recheck": recheck})
        while True:
            try:
                with self._session.get(self.base_url + path, params=params,
                                       stream=True, timeout=(self.timeout, None)) as resp:
                    if resp.status_code >= 400:
                        self._handle(resp)
                    for payload in _iter_sse(resp):
                        if isinstance(payload, dict) and payload.get("type") == "error":
                            raise AuthError(payload.get("message") or "stream rejected",
                                            None, payload)
                        if isinstance(payload, list):
                            for item in payload:
                                if isinstance(item, dict) and not _is_control_frame(item):
                                    yield item
                        elif isinstance(payload, dict) and not _is_control_frame(payload):
                            yield payload
            except (AuthError, RateLimitError):
                raise
            except (requests.ConnectionError, requests.Timeout,
                    requests.exceptions.ChunkedEncodingError):
                if not reconnect:
                    raise
                time.sleep(backoff)
                continue
            if not reconnect:
                return
            time.sleep(backoff)


def _iter_sse(resp: "requests.Response") -> Iterator[Any]:
    """Minimal SSE parser: accumulate ``data:`` lines per event, JSON-decode."""
    buf: List[str] = []
    for raw in resp.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        line = raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
        if line == "":
            if buf:
                data = "\n".join(buf)
                buf = []
                try:
                    yield json.loads(data)
                except ValueError:
                    pass  # keepalive / non-JSON frame
            continue
        if line.startswith(":"):
            continue  # SSE comment / heartbeat
        if line.startswith("data:"):
            buf.append(line[5:].lstrip())
    if buf:
        try:
            yield json.loads("\n".join(buf))
        except ValueError:
            pass
