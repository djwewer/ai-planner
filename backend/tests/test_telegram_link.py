import datetime
from unittest.mock import MagicMock

from app.telegram import handlers as telegram_handlers


def _signup(client, email="telegramuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_start_with_expired_code_does_not_link(client, monkeypatch, db_session):
    from app.models import TelegramLinkCode, User

    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

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

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 999}, "text": "/start expired-code"}}, db_session
    )

    db_session.refresh(user)
    assert user.telegram_chat_id is None
    mock_send.assert_called_once_with(999, telegram_handlers.CODE_INVALID_MESSAGE)
