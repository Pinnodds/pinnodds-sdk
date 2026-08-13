"""pinnodds — real-time Pinnacle odds & drop alerts for Python.

>>> from pinnodds import Client
>>> api = Client("YOUR_KEY")
>>> events = api.markets(sport_id=1)        # live soccer
>>> for drop in api.stream_drops():         # real-time SSE drop alerts
...     print(drop)

Free trial key in seconds at https://pinnodds.com/ — docs: https://pinnodds.com/docs
"""

from .client import (
    DEFAULT_BASE_URL,
    SPORTS,
    AuthError,
    Client,
    PinnoddsError,
    RateLimitError,
)

__version__ = "0.1.0"
__all__ = [
    "Client",
    "PinnoddsError",
    "AuthError",
    "RateLimitError",
    "SPORTS",
    "DEFAULT_BASE_URL",
    "__version__",
]
