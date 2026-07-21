from unittest.mock import MagicMock

from app.auth import service as auth_service


def _signup_and_get_token(client, email="deleteme@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_delete_account_requires_auth(client):
    response = client.request("DELETE", "/auth/me", json={"remove_google_events": False})
    assert response.status_code == 401


def test_delete_account_removes_user_and_owned_rows(client, db_session):
    from app.models import Capture, Task, User

    token = _signup_and_get_token(client)
    user = db_session.query(User).filter(User.email == "deleteme@example.com").first()
    user_id = user.id
    capture = Capture(user_id=user_id, raw_text="test", status="complete", source="web")
    db_session.add(capture)
    db_session.commit()
    db_session.refresh(capture)
    task = Task(user_id=user_id, capture_id=capture.id, title="Задача", status="confirmed")
    db_session.add(task)
    db_session.commit()

    response = client.request(
        "DELETE",
        "/auth/me",
        json={"remove_google_events": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert db_session.query(User).filter(User.email == "deleteme@example.com").first() is None
    assert db_session.query(Task).filter(Task.user_id == user_id).first() is None
    assert db_session.query(Capture).filter(Capture.user_id == user_id).first() is None


def test_delete_account_with_google_cleanup_calls_google_clients(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_delete_event = MagicMock()
    mock_delete_task = MagicMock()
    monkeypatch.setattr(auth_service.google_calendar_client, "delete_event", mock_delete_event)
    monkeypatch.setattr(auth_service.google_tasks_client, "delete_task", mock_delete_task)

    token = _signup_and_get_token(client, email="googlecleanup@example.com")
    user = db_session.query(User).filter(User.email == "googlecleanup@example.com").first()
    task_with_event = Task(
        user_id=user.id, title="Зустріч", status="confirmed", google_event_id="evt-1"
    )
    task_with_gtask = Task(
        user_id=user.id, title="Купити молоко", status="confirmed", google_task_id="gt-1"
    )
    db_session.add_all([task_with_event, task_with_gtask])
    db_session.commit()

    response = client.request(
        "DELETE",
        "/auth/me",
        json={"remove_google_events": True},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    mock_delete_event.assert_called_once()
    assert mock_delete_event.call_args.args[1] == "evt-1"
    mock_delete_task.assert_called_once()
    assert mock_delete_task.call_args.args[1] == "gt-1"


def test_delete_account_without_google_cleanup_skips_google_clients(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_delete_event = MagicMock()
    monkeypatch.setattr(auth_service.google_calendar_client, "delete_event", mock_delete_event)

    token = _signup_and_get_token(client, email="nocleanup@example.com")
    user = db_session.query(User).filter(User.email == "nocleanup@example.com").first()
    task = Task(user_id=user.id, title="Зустріч", status="confirmed", google_event_id="evt-2")
    db_session.add(task)
    db_session.commit()

    response = client.request(
        "DELETE",
        "/auth/me",
        json={"remove_google_events": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    mock_delete_event.assert_not_called()


def test_delete_account_notifies_linked_telegram_chat(client, monkeypatch, db_session):
    from app.models import User

    mock_send = MagicMock()
    monkeypatch.setattr(auth_service.telegram_client, "send_message", mock_send)

    token = _signup_and_get_token(client, email="tglinked@example.com")
    user = db_session.query(User).filter(User.email == "tglinked@example.com").first()
    user.telegram_chat_id = 4242
    db_session.commit()

    response = client.request(
        "DELETE",
        "/auth/me",
        json={"remove_google_events": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == 4242


def test_delete_account_survives_google_cleanup_failure(client, monkeypatch, db_session):
    from app.models import Task, User

    monkeypatch.setattr(
        auth_service.google_calendar_client,
        "delete_event",
        MagicMock(side_effect=RuntimeError("Google API down")),
    )

    token = _signup_and_get_token(client, email="cleanupfails@example.com")
    user = db_session.query(User).filter(User.email == "cleanupfails@example.com").first()
    task = Task(user_id=user.id, title="Зустріч", status="confirmed", google_event_id="evt-3")
    db_session.add(task)
    db_session.commit()

    response = client.request(
        "DELETE",
        "/auth/me",
        json={"remove_google_events": True},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert db_session.query(User).filter(User.email == "cleanupfails@example.com").first() is None
