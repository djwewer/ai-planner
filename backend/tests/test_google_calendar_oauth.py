import asyncio
from urllib.parse import parse_qs, urlparse

from app.google_calendar.oauth import calendar_oauth


def test_connect_authorization_url_requests_offline_access():
    """Regression test for a bug where Google never returned a refresh_token.

    ``access_type`` is not one of Authlib's EXTRA_AUTHORIZE_PARAMS, so
    setting it in ``client_kwargs`` at registration time (oauth.py) has no
    effect -- it must be passed explicitly to create_authorization_url()
    (as the connect() route in router.py does). Without it, Google issues
    only an access_token and the Calendar connect flow always fails on
    the missing-refresh_token check in the callback.
    """
    rv = asyncio.run(
        calendar_oauth.google_calendar.create_authorization_url(
            "https://example.com/callback", access_type="offline"
        )
    )
    query = parse_qs(urlparse(rv["url"]).query)

    assert query.get("access_type") == ["offline"]
    assert query.get("prompt") == ["consent"]
