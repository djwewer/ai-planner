from unittest.mock import MagicMock

from app.ai.triage import ExtractedTask
from app.captures import service as captures_service
from app.telegram import handlers as telegram_handlers


def _signup(client, email="tgcapture@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_text_message_creates_draft_tasks_and_notifies(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Купити молоко", priority=2, deadline=None, scheduled_at=None)
            ]
        ),
    )
    mock_notify = MagicMock()
    monkeypatch.setattr(captures_service, "notify_new_tasks_ready", mock_notify)

    _signup(client, email="textcapture@example.com")
    user = db_session.query(User).filter(User.email == "textcapture@example.com").first()
    user.telegram_chat_id = 111
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 111}, "text": "купити молоко"}}, db_session
    )

    mock_notify.assert_called_once()
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"


def test_text_message_from_unlinked_chat_replies_not_linked(client, monkeypatch, db_session):
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 999999}, "text": "hello"}}, db_session
    )

    mock_send.assert_called_once_with(999999, telegram_handlers.NOT_LINKED_MESSAGE)


def test_text_message_with_no_tasks_found_replies(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(captures_service, "extract_tasks", MagicMock(return_value=[]))
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    _signup(client, email="emptycapture@example.com")
    user = db_session.query(User).filter(User.email == "emptycapture@example.com").first()
    user.telegram_chat_id = 222
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 222}, "text": "hmm just thinking"}}, db_session
    )

    mock_send.assert_called_once()
    assert "не змогла визначити" in mock_send.call_args.args[1]


def test_voice_message_downloads_transcribes_and_captures(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(telegram_handlers.telegram_client, "send_chat_action", MagicMock())
    monkeypatch.setattr(
        telegram_handlers.telegram_client, "get_file", MagicMock(return_value="voice/file123.oga")
    )
    monkeypatch.setattr(
        telegram_handlers.telegram_client, "download_file", MagicMock(return_value=b"fake-audio-bytes")
    )
    mock_transcribe = MagicMock(return_value="купити молоко")
    monkeypatch.setattr(telegram_handlers, "transcribe_audio", mock_transcribe)
    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Купити молоко", priority=2, deadline=None, scheduled_at=None)
            ]
        ),
    )
    monkeypatch.setattr(captures_service, "notify_new_tasks_ready", MagicMock())

    _signup(client, email="voicecapture@example.com")
    user = db_session.query(User).filter(User.email == "voicecapture@example.com").first()
    user.telegram_chat_id = 333
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 333}, "voice": {"file_id": "voice-file-id-1"}}}, db_session
    )

    mock_transcribe.assert_called_once_with(b"fake-audio-bytes", "voice.ogg")
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"
    assert capture.raw_text == "купити молоко"


def test_voice_message_transcription_failure_replies_error(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(telegram_handlers.telegram_client, "send_chat_action", MagicMock())
    monkeypatch.setattr(
        telegram_handlers.telegram_client, "get_file", MagicMock(side_effect=RuntimeError("boom"))
    )
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    _signup(client, email="voicefail@example.com")
    user = db_session.query(User).filter(User.email == "voicefail@example.com").first()
    user.telegram_chat_id = 444
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 444}, "voice": {"file_id": "voice-file-id-2"}}}, db_session
    )

    mock_send.assert_called_once_with(444, "Не вдалося розпізнати мову, спробуйте ще раз")


def test_voice_message_from_unlinked_chat_replies_not_linked_without_transcribing(
    client, monkeypatch, db_session
):
    mock_get_file = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "get_file", mock_get_file)
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 555555}, "voice": {"file_id": "voice-file-id-3"}}}, db_session
    )

    mock_get_file.assert_not_called()
    mock_send.assert_called_once_with(555555, telegram_handlers.NOT_LINKED_MESSAGE)
