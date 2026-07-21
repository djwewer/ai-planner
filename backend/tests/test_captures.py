from unittest.mock import MagicMock

from app.ai.triage import ExtractedTask
from app.captures import service as captures_service


def _signup_and_get_token(client, email="captureuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_create_capture_creates_draft_tasks(client, monkeypatch):
    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Buy milk", priority=2, deadline=None, scheduled_at=None),
                ExtractedTask(title="Call John", priority=4, deadline=None, scheduled_at=None),
            ]
        ),
    )
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "buy milk and call john"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    tasks = response.json()
    assert len(tasks) == 2
    assert all(t["status"] == "draft" for t in tasks)
    assert {t["title"] for t in tasks} == {"Buy milk", "Call John"}


def test_create_capture_with_no_tasks_found(client, monkeypatch):
    monkeypatch.setattr(captures_service, "extract_tasks", MagicMock(return_value=[]))
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "hmm just thinking"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    assert response.json() == []


def test_create_capture_handles_claude_failure(client, monkeypatch):
    def _raise(raw_text, today):
        raise RuntimeError("API error")

    monkeypatch.setattr(captures_service, "extract_tasks", _raise)
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "test"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 502


def test_create_capture_requires_auth(client):
    response = client.post("/captures", json={"raw_text": "test"})
    assert response.status_code == 401


def test_web_capture_does_not_notify_telegram_even_if_linked(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Buy milk", priority=2, deadline=None, scheduled_at=None)
            ]
        ),
    )
    mock_notify = MagicMock()
    monkeypatch.setattr(captures_service, "notify_new_tasks_ready", mock_notify)

    token = _signup_and_get_token(client, email="webnotify@example.com")
    user = db_session.query(User).filter(User.email == "webnotify@example.com").first()
    user.telegram_chat_id = 999
    db_session.commit()

    response = client.post(
        "/captures",
        json={"raw_text": "buy milk"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    mock_notify.assert_not_called()


def test_telegram_source_capture_notifies(monkeypatch, db_session):
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

    user = User(email="tgnotify@example.com", password_hash="x", telegram_chat_id=888)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    tasks = captures_service.process_capture(user, "купити молоко", "telegram", db_session)

    assert len(tasks) == 1
    assert tasks[0].status == "draft"
    mock_notify.assert_called_once()
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"
