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
    body = response.json()
    assert body["kind"] == "created"
    tasks = body["tasks"]
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
    assert response.json() == {"kind": "created", "tasks": [], "task": None}


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

    result = captures_service.process_capture(user, "купити молоко", "telegram", db_session)

    assert result.kind == "created"
    assert len(result.tasks) == 1
    assert result.tasks[0].status == "draft"
    mock_notify.assert_called_once()
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"


def test_capture_reschedules_matching_task(client, monkeypatch, db_session):
    import datetime

    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module
    from app.models import Task, User

    token = _signup_and_get_token(client, email="reschedule@example.com")
    user = db_session.query(User).filter(User.email == "reschedule@example.com").first()
    task = Task(
        user_id=user.id,
        title="Стоматолог",
        status="confirmed",
        deadline=datetime.date(2026, 7, 22),
        scheduled_at=datetime.datetime(2026, 7, 22, 10, 0),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(
            return_value=ReplanResult(
                kind="reschedule",
                task_id=task.id,
                new_deadline=datetime.date(2026, 7, 23),
                new_scheduled_at=datetime.datetime(2026, 7, 23, 15, 0),
            )
        ),
    )

    response = client.post(
        "/captures",
        json={"raw_text": "перенеси стоматолога на завтра о 15:00"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "rescheduled"
    assert body["task"]["id"] == task.id
    assert body["task"]["deadline"] == "2026-07-23"

    db_session.refresh(task)
    assert task.deadline == datetime.date(2026, 7, 23)
    assert task.scheduled_at == datetime.datetime(2026, 7, 23, 15, 0)


def test_capture_no_matching_task_returns_not_found(client, monkeypatch, db_session):
    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(return_value=ReplanResult(kind="no_match")),
    )

    token = _signup_and_get_token(client, email="nomatch@example.com")
    response = client.post(
        "/captures",
        json={"raw_text": "перенеси зустріч з інопланетянами на четвер"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    assert response.json() == {"kind": "not_found", "tasks": [], "task": None}


def test_capture_reschedule_rejects_task_owned_by_another_user(client, monkeypatch, db_session):
    import datetime

    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module
    from app.models import Task, User

    _signup_and_get_token(client, email="victim@example.com")
    victim = db_session.query(User).filter(User.email == "victim@example.com").first()
    victim_task = Task(
        user_id=victim.id,
        title="Приватна задача жертви",
        status="confirmed",
        deadline=datetime.date(2026, 7, 22),
        scheduled_at=datetime.datetime(2026, 7, 22, 10, 0),
    )
    db_session.add(victim_task)
    db_session.commit()
    db_session.refresh(victim_task)

    attacker_token = _signup_and_get_token(client, email="attacker@example.com")

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(
            return_value=ReplanResult(
                kind="reschedule",
                task_id=victim_task.id,
                new_deadline=datetime.date(2026, 7, 23),
                new_scheduled_at=datetime.datetime(2026, 7, 23, 15, 0),
            )
        ),
    )

    response = client.post(
        "/captures",
        json={"raw_text": "перенеси приватну задачу на завтра о 15:00"},
        headers={"Authorization": f"Bearer {attacker_token}"},
    )

    assert response.status_code == 201
    assert response.json() == {"kind": "not_found", "tasks": [], "task": None}

    db_session.refresh(victim_task)
    assert victim_task.deadline == datetime.date(2026, 7, 22)
    assert victim_task.scheduled_at == datetime.datetime(2026, 7, 22, 10, 0)


def test_capture_reschedule_with_no_new_date_does_not_clear_schedule(client, monkeypatch, db_session):
    import datetime

    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module
    from app.models import Task, User

    token = _signup_and_get_token(client, email="nulldate@example.com")
    user = db_session.query(User).filter(User.email == "nulldate@example.com").first()
    task = Task(
        user_id=user.id,
        title="Стоматолог",
        status="confirmed",
        deadline=datetime.date(2026, 7, 22),
        scheduled_at=datetime.datetime(2026, 7, 22, 10, 0),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(
            return_value=ReplanResult(
                kind="reschedule", task_id=task.id, new_deadline=None, new_scheduled_at=None
            )
        ),
    )

    response = client.post(
        "/captures",
        json={"raw_text": "перенеси стоматолога"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    assert response.json() == {"kind": "not_found", "tasks": [], "task": None}

    db_session.refresh(task)
    assert task.deadline == datetime.date(2026, 7, 22)
    assert task.scheduled_at == datetime.datetime(2026, 7, 22, 10, 0)
