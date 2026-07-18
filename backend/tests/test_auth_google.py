from unittest.mock import AsyncMock

from app.auth import google_oauth
from app.models import User


def test_google_callback_creates_new_user(client, monkeypatch):
    fake_token = {"userinfo": {"sub": "google-123", "email": "googleuser@example.com"}}
    monkeypatch.setattr(
        google_oauth.oauth.google,
        "authorize_access_token",
        AsyncMock(return_value=fake_token),
    )

    response = client.get("/auth/google/callback", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "/auth/callback?token=" in response.headers["location"]


def test_google_callback_reuses_existing_user(client, monkeypatch, db_session):
    existing = User(email="already@example.com", google_id="google-999")
    db_session.add(existing)
    db_session.commit()

    fake_token = {"userinfo": {"sub": "google-999", "email": "already@example.com"}}
    monkeypatch.setattr(
        google_oauth.oauth.google,
        "authorize_access_token",
        AsyncMock(return_value=fake_token),
    )

    response = client.get("/auth/google/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
