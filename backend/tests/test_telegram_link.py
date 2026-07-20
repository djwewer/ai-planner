import datetime
from unittest.mock import MagicMock

from app.telegram import router as telegram_router

WEBHOOK_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}


def _signup(client, email="telegramuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_start_with_expired_code_does_not_link(client, monkeypatch, db_session):
    from app.models import TelegramLinkCode, User

    mock_send = MagicMock()
    monkeypatch.setattr(telegram_router.telegram_client, "send_message", mock_send)

    _signup(client)
    user = db_session.query(User).filter(User.email == "telegramuser@example.com").first()
    db_session.add(
        TelegramLinkCode(
            code="expired-code",
            user_id=user.id,
            expires_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=1),
            used=False,
        )
    )
    db_session.commit()

    response = client.post(
        "/telegram/webhook",
        json={"message": {"chat": {"id": 999}, "text": "/start expired-code"}},
        headers=WEBHOOK_HEADERS,
    )

    assert response.status_code == 200
    db_session.refresh(user)
    assert user.telegram_chat_id is None
    mock_send.assert_called_once_with(999, telegram_router.CODE_INVALID_MESSAGE)
