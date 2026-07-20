from unittest.mock import MagicMock

from app.tasks import router as tasks_router


def _signup_and_get_token(client, email="calendaruser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_task_still_saves_when_calendar_sync_fails(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        tasks_router.google_calendar_client,
        "create_event",
        MagicMock(side_effect=RuntimeError("calendar API error")),
    )
    token = _signup_and_get_token(client)
    user = db_session.query(User).filter(User.email == "calendaruser@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    response = client.post(
        "/tasks",
        json={
            "title": "Задача з поганим календарем",
            "scheduled_at": "2026-07-20T14:00:00",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    task = response.json()
    assert task["title"] == "Задача з поганим календарем"
    assert task["google_event_id"] is None
