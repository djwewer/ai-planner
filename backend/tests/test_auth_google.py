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


def test_google_callback_links_verified_email_to_password_user(client, monkeypatch, db_session):
    existing = User(email="pwuser@example.com", password_hash="hashed", google_id=None)
    db_session.add(existing)
    db_session.commit()
    existing_id = existing.id

    fake_token = {
        "userinfo": {
            "sub": "google-555",
            "email": "pwuser@example.com",
            "email_verified": True,
        }
    }
    monkeypatch.setattr(
        google_oauth.oauth.google,
        "authorize_access_token",
        AsyncMock(return_value=fake_token),
    )

    response = client.get("/auth/google/callback", follow_redirects=False)
    assert response.status_code in (302, 307)

    db_session.expire_all()
    linked = db_session.query(User).filter(User.id == existing_id).first()
    assert linked.google_id == "google-555"


def test_google_callback_does_not_link_unverified_email(client, monkeypatch, db_session):
    existing = User(email="pwuser2@example.com", password_hash="hashed", google_id=None)
    db_session.add(existing)
    db_session.commit()
    existing_id = existing.id

    fake_token = {
        "userinfo": {
            "sub": "google-666",
            "email": "pwuser2@example.com",
            "email_verified": False,
        }
    }
    monkeypatch.setattr(
        google_oauth.oauth.google,
        "authorize_access_token",
        AsyncMock(return_value=fake_token),
    )

    response = client.get("/auth/google/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
    assert "/login?error=email_not_verified" in response.headers["location"]

    db_session.expire_all()
    unlinked = db_session.query(User).filter(User.id == existing_id).first()
    assert unlinked.google_id is None
