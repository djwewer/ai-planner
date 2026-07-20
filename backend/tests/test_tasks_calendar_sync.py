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


def test_date_only_task_syncs_as_google_task_not_event(client, monkeypatch, db_session):
    from app.models import User

    create_event = MagicMock()
    create_task = MagicMock(return_value="fake-task-id")
    monkeypatch.setattr(tasks_router.google_calendar_client, "create_event", create_event)
    monkeypatch.setattr(tasks_router.google_tasks_client, "create_task", create_task)

    token = _signup_and_get_token(client, email="dateonly@example.com")
    user = db_session.query(User).filter(User.email == "dateonly@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    response = client.post(
        "/tasks",
        json={"title": "Задача без часу", "deadline": "2026-07-21"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    task = response.json()
    assert task["google_task_id"] == "fake-task-id"
    assert task["google_event_id"] is None
    create_event.assert_not_called()
    create_task.assert_called_once()


def test_timed_task_syncs_as_event_not_google_task(client, monkeypatch, db_session):
    from app.models import User

    create_event = MagicMock(return_value="fake-event-id")
    create_task = MagicMock()
    monkeypatch.setattr(tasks_router.google_calendar_client, "create_event", create_event)
    monkeypatch.setattr(tasks_router.google_tasks_client, "create_task", create_task)

    token = _signup_and_get_token(client, email="timed@example.com")
    user = db_session.query(User).filter(User.email == "timed@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    response = client.post(
        "/tasks",
        json={
            "title": "Задача з часом",
            "deadline": "2026-07-21",
            "scheduled_at": "2026-07-21T14:00:00",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    task = response.json()
    assert task["google_event_id"] == "fake-event-id"
    assert task["google_task_id"] is None
    create_task.assert_not_called()
    create_event.assert_called_once()


def test_switching_task_from_timed_to_date_only_migrates_representation(
    client, monkeypatch, db_session
):
    from app.models import User

    monkeypatch.setattr(
        tasks_router.google_calendar_client, "create_event", MagicMock(return_value="fake-event-id")
    )
    delete_event = MagicMock()
    monkeypatch.setattr(tasks_router.google_calendar_client, "delete_event", delete_event)
    create_task = MagicMock(return_value="fake-task-id")
    monkeypatch.setattr(tasks_router.google_tasks_client, "create_task", create_task)

    token = _signup_and_get_token(client, email="migrate@example.com")
    user = db_session.query(User).filter(User.email == "migrate@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    created = client.post(
        "/tasks",
        json={
            "title": "Мігруюча задача",
            "deadline": "2026-07-21",
            "scheduled_at": "2026-07-21T14:00:00",
        },
        headers=_auth_headers(token),
    ).json()
    assert created["google_event_id"] == "fake-event-id"

    updated = client.patch(
        f"/tasks/{created['id']}",
        json={"scheduled_at": None},
        headers=_auth_headers(token),
    ).json()

    assert updated["google_event_id"] is None
    assert updated["google_task_id"] == "fake-task-id"
    delete_event.assert_called_once()
    assert delete_event.call_args.args[1] == "fake-event-id"
    create_task.assert_called_once()


def test_deleting_task_deletes_linked_google_task(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        tasks_router.google_tasks_client, "create_task", MagicMock(return_value="fake-task-id")
    )
    delete_task = MagicMock()
    monkeypatch.setattr(tasks_router.google_tasks_client, "delete_task", delete_task)

    token = _signup_and_get_token(client, email="deletetask@example.com")
    user = db_session.query(User).filter(User.email == "deletetask@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    created = client.post(
        "/tasks",
        json={"title": "Задача на видалення", "deadline": "2026-07-21"},
        headers=_auth_headers(token),
    ).json()
    assert created["google_task_id"] == "fake-task-id"

    response = client.delete(f"/tasks/{created['id']}", headers=_auth_headers(token))

    assert response.status_code == 204
    delete_task.assert_called_once()
    assert delete_task.call_args.args[1] == "fake-task-id"
