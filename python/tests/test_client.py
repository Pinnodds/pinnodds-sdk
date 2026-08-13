"""Offline tests — a fake session serves every request, so no network, no key."""

import json

import pytest

from pinnodds import SPORTS, AuthError, Client, PinnoddsError, RateLimitError
from pinnodds.client import _iter_sse


class FakeResponse:
    def __init__(self, payload=None, status=200, text="", lines=None):
        self._payload = payload
        self.status_code = status
        self.text = text
        self._lines = lines or []

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload

    def iter_lines(self, decode_unicode=False):
        return iter(self._lines)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeSession:
    """Captures calls and replays a queue of canned responses."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None, stream=False):
        self.calls.append({"url": url, "params": params or {}, "headers": headers or {}})
        return self.responses.pop(0) if self.responses else FakeResponse({})


def client(*responses):
    s = FakeSession(*responses)
    return Client("KEY", session=s), s


# ── construction ────────────────────────────────────────────────────────────

def test_api_key_is_required():
    with pytest.raises(ValueError, match="api_key is required"):
        Client("")
    with pytest.raises(ValueError):
        Client(None)


def test_base_url_trailing_slash_is_stripped():
    assert Client("k", base_url="https://example.com///").base_url == "https://example.com"


# ── auth + params ───────────────────────────────────────────────────────────

def test_sends_x_api_key_header():
    api, s = client(FakeResponse({"events": []}))
    api.markets(sport_id=1)
    assert s.calls[0]["headers"]["x-api-key"] == "KEY"


def test_markets_builds_the_documented_params():
    api, s = client(FakeResponse({"events": []}))
    api.markets(sport_id=SPORTS["tennis"], event_type="prematch", since=42)
    call = s.calls[0]
    assert call["url"].endswith("/kit/v1/markets")
    assert call["params"] == {"sport_id": 2, "event_type": "prematch", "since": 42}


def test_include_specials_is_opt_in():
    api, s = client(FakeResponse({"events": []}), FakeResponse({"events": []}))
    api.markets(sport_id=1)
    assert "include_specials" not in s.calls[0]["params"]
    api.markets(sport_id=1, include_specials=True)
    assert s.calls[1]["params"]["include_specials"] == 1


def test_none_params_are_dropped_not_sent():
    api, s = client(FakeResponse({"events": []}))
    api.markets(sport_id=1)
    assert "since" not in s.calls[0]["params"]


# ── the drops max_age_sec default (guards a real server-side bug) ───────────

def test_drops_always_sends_max_age_sec():
    api, s = client(FakeResponse({"total": 0, "drops": []}))
    api.drops(sport_id=1)
    assert s.calls[0]["params"]["max_age_sec"] == 3600


def test_explicit_max_age_sec_wins():
    api, s = client(FakeResponse({"total": 0, "drops": []}))
    api.drops(max_age_sec=60)
    assert s.calls[0]["params"]["max_age_sec"] == 60


def test_sequence_filters_become_comma_lists():
    api, s = client(FakeResponse({"total": 0, "drops": []}))
    api.drops(markets=["moneyline", "total"], periods=[0, 1])
    assert s.calls[0]["params"]["markets"] == "moneyline,total"
    assert s.calls[0]["params"]["periods"] == "0,1"


def test_live_only_false_sends_nothing():
    api, s = client(FakeResponse({"total": 0, "drops": []}))
    api.drops()
    assert "live" not in s.calls[0]["params"]


# ── error mapping ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("status", [401, 403])
def test_auth_statuses_raise_auth_error(status):
    api, _ = client(FakeResponse({"error": "missing_key"}, status=status))
    with pytest.raises(AuthError) as e:
        api.health()
    assert e.value.status == status
    assert "missing_key" in str(e.value)


def test_429_carries_retry_after_in_seconds():
    api, _ = client(FakeResponse({"retry_after_ms": 2500}, status=429))
    with pytest.raises(RateLimitError) as e:
        api.health()
    assert e.value.retry_after == 2.5


def test_other_errors_carry_status_and_payload():
    api, _ = client(FakeResponse({"error": "boom"}, status=500))
    with pytest.raises(PinnoddsError) as e:
        api.health()
    assert e.value.status == 500
    assert e.value.payload == {"error": "boom"}


def test_non_json_error_body_still_raises():
    api, _ = client(FakeResponse(None, status=502))
    with pytest.raises(PinnoddsError) as e:
        api.health()
    assert e.value.status == 502


def test_error_hierarchy():
    assert issubclass(AuthError, PinnoddsError)
    assert issubclass(RateLimitError, PinnoddsError)


# ── SSE parsing ─────────────────────────────────────────────────────────────

def test_sse_parses_events():
    resp = FakeResponse(lines=['data: {"event_id":1}', "", 'data: {"event_id":2}', ""])
    assert [e["event_id"] for e in _iter_sse(resp)] == [1, 2]


def test_sse_skips_comments_and_bad_json():
    resp = FakeResponse(lines=[": keepalive", "", "data: not json", "", 'data: {"event_id":3}', ""])
    assert [e["event_id"] for e in _iter_sse(resp)] == [3]


def test_sse_joins_multiline_data_fields():
    payload = {"event_id": 9, "league": "x"}
    blob = json.dumps(payload)
    half = len(blob) // 2
    resp = FakeResponse(lines=["data: " + blob[:half], "data: " + blob[half:], ""])
    # Two data: lines are joined with \n, which JSON tolerates inside a document.
    out = list(_iter_sse(resp))
    assert out == [payload]


def test_sse_flushes_a_trailing_event_without_blank_line():
    resp = FakeResponse(lines=['data: {"event_id":5}'])
    assert [e["event_id"] for e in _iter_sse(resp)] == [5]


def test_stream_drops_targets_the_right_path_and_query():
    api, s = client(FakeResponse(lines=['data: {"event_id":1}', ""]))
    gen = api.stream_drops(mode="prematch", min_drop=3, recheck=20, reconnect=False)
    assert next(gen)["event_id"] == 1
    call = s.calls[0]
    assert call["url"].endswith("/odds-drop-prematch")
    assert call["params"] == {"key": "KEY", "min_drop": 3, "recheck": 20}


def test_stream_drops_live_path():
    api, s = client(FakeResponse(lines=['data: {"event_id":1}', ""]))
    next(api.stream_drops(reconnect=False))
    assert s.calls[0]["url"].endswith("/odds-drop")


def test_stream_drops_flattens_array_frames():
    api, _ = client(FakeResponse(lines=['data: [{"event_id":1},{"event_id":2}]', ""]))
    gen = api.stream_drops(reconnect=False)
    assert [next(gen)["event_id"], next(gen)["event_id"]] == [1, 2]


def test_connected_handshake_is_not_yielded_as_a_drop():
    # The live server always opens with this frame; yielding it hands callers an
    # object whose every drop field is missing.
    api, _ = client(FakeResponse(lines=[
        'data: {"type":"connected","id":"701978d8"}', "",
        'data: {"id":1633870104,"from_price":1.357,"to_price":1.315,"sect":"Moneyline"}', "",
    ]))
    first = next(api.stream_drops(reconnect=False))
    assert first["id"] == 1633870104
    assert first["from_price"] == 1.357


def test_control_frames_inside_array_payloads_are_filtered():
    api, _ = client(FakeResponse(lines=[
        'data: [{"type":"connected"},{"id":7,"from_price":2,"to_price":1.9}]', "",
    ]))
    assert next(api.stream_drops(reconnect=False))["id"] == 7


def test_a_typed_frame_with_prices_is_still_a_drop():
    api, _ = client(FakeResponse(lines=['data: {"type":"drop","id":9,"from_price":2,"to_price":1.8}', ""]))
    assert next(api.stream_drops(reconnect=False))["id"] == 9


def test_stream_drops_raises_on_a_server_error_frame():
    api, _ = client(FakeResponse(lines=['data: {"type":"error","message":"plan has no SSE"}', ""]))
    with pytest.raises(AuthError, match="plan has no SSE"):
        next(api.stream_drops(reconnect=False))


def test_stream_drops_raises_auth_before_streaming():
    api, _ = client(FakeResponse({"error": "missing_key"}, status=401))
    with pytest.raises(AuthError):
        next(api.stream_drops(reconnect=False))


# ── misc ────────────────────────────────────────────────────────────────────

def test_sports_ids():
    assert SPORTS["soccer"] == 1
    assert SPORTS["esports"] == 11


def test_ping_trims_and_skips_auth():
    api, s = client(FakeResponse(text="ok\n"))
    assert api.ping() == "ok"
    assert s.calls[0]["url"].endswith("/ping")
    assert s.calls[0]["headers"] == {}
