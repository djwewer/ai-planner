import datetime
from unittest.mock import MagicMock

from app.tasks import router as tasks_router
from app.telegram import router as telegram_router

WEBHOOK_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}


def _signup(client, email="approveuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_approve_callback_confirms_task_and_syncs_calendar(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_create_event = MagicMock(return_value="fake-event-id")
    monkeypatch.setattr(tasks_router.google_calendar_client, "create_event", mock_create_event)
    monkeypatch.setattr(telegram_router.telegram_client, "edit_message", MagicMock())
    monkeypatch.setattr(telegram_router.telegram_client, "answer_callback_query", MagicMock())

    _signup(client)
    user = db_session.query(User).filter(User.email == "approveuser@example.com").first()
    user.telegram_chat_id = 555
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    task = Task(
        user_id=user.id,
        title="Купити молоко",
        status="draft",
        scheduled_at=datetime.datetime(2026, 7, 25, 10, 0),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    response = client.post(
        "/telegram/webhook",
        json={
            "callback_query": {
                "id": "cbq-1",
                "data": f"approve:{task.id}",
                "message": {"message_id": 42, "chat": {"id": 555}},
            }
        },
        headers=WEBHOOK_HEADERS,
    )

    assert response.status_code == 200
    mock_create_event.assert_called_once()
    db_session.refresh(task)
    assert task.status == "confirmed"
    assert task.google_event_id == "fake-event-id"
