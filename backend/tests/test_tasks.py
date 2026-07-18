import datetime

from app.models import Task, User


def _signup_and_get_token(client, email="taskuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_tasks(client):
    token = _signup_and_get_token(client)
    create = client.post(
        "/tasks",
        json={"title": "Write plan", "priority": 1, "deadline": "2026-07-20"},
        headers=_auth_headers(token),
    )
    assert create.status_code == 201
    task = create.json()
    assert task["title"] == "Write plan"
    assert task["priority"] == 1
    assert task["status"] == "confirmed"

    listing = client.get("/tasks", headers=_auth_headers(token))
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_update_task_marks_done(client):
    token = _signup_and_get_token(client)
    create = client.post("/tasks", json={"title": "Finish MVP"}, headers=_auth_headers(token))
    task_id = create.json()["id"]

    update = client.patch(
        f"/tasks/{task_id}", json={"status": "done"}, headers=_auth_headers(token)
    )
    assert update.status_code == 200
    assert update.json()["status"] == "done"


def test_delete_task(client):
    token = _signup_and_get_token(client)
    create = client.post("/tasks", json={"title": "Temporary"}, headers=_auth_headers(token))
    task_id = create.json()["id"]

    delete = client.delete(f"/tasks/{task_id}", headers=_auth_headers(token))
    assert delete.status_code == 204

    listing = client.get("/tasks", headers=_auth_headers(token))
    assert listing.json() == []


def test_cannot_access_another_users_task(client):
    token_a = _signup_and_get_token(client, email="usera@example.com")
    token_b = _signup_and_get_token(client, email="userb@example.com")

    create = client.post("/tasks", json={"title": "Private"}, headers=_auth_headers(token_a))
    task_id = create.json()["id"]

    response = client.patch(
        f"/tasks/{task_id}", json={"status": "done"}, headers=_auth_headers(token_b)
    )
    assert response.status_code == 404


def test_list_tasks_excludes_drafts_and_rejected_by_default(client, db_session):
    token = _signup_and_get_token(client, email="draftowner@example.com")
    user = db_session.query(User).filter(User.email == "draftowner@example.com").first()

    draft = Task(user_id=user.id, title="Draft task", status="draft")
    rejected = Task(user_id=user.id, title="Rejected task", status="rejected")
    db_session.add_all([draft, rejected])
    db_session.commit()

    client.post("/tasks", json={"title": "Confirmed task"}, headers=_auth_headers(token))

    listing = client.get("/tasks", headers=_auth_headers(token))
    titles = [t["title"] for t in listing.json()]
    assert titles == ["Confirmed task"]


def test_list_tasks_with_status_filter_returns_only_that_status(client, db_session):
    token = _signup_and_get_token(client, email="filterowner@example.com")
    user = db_session.query(User).filter(User.email == "filterowner@example.com").first()

    draft = Task(user_id=user.id, title="Draft task", status="draft")
    db_session.add(draft)
    db_session.commit()

    client.post("/tasks", json={"title": "Confirmed task"}, headers=_auth_headers(token))

    listing = client.get("/tasks?status=draft", headers=_auth_headers(token))
    titles = [t["title"] for t in listing.json()]
    assert titles == ["Draft task"]


def test_today_returns_overdue_and_today_sorted_by_priority(client, db_session):
    token = _signup_and_get_token(client, email="todayowner@example.com")
    user = db_session.query(User).filter(User.email == "todayowner@example.com").first()

    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    tomorrow = today + datetime.timedelta(days=1)

    overdue_low = Task(
        user_id=user.id, title="Overdue low", status="confirmed", priority=4, deadline=yesterday
    )
    today_urgent = Task(
        user_id=user.id, title="Today urgent", status="confirmed", priority=1, deadline=today
    )
    future_task = Task(
        user_id=user.id, title="Future task", status="confirmed", priority=1, deadline=tomorrow
    )
    no_deadline_task = Task(user_id=user.id, title="No deadline", status="confirmed")
    draft_task = Task(
        user_id=user.id, title="Draft due today", status="draft", priority=1, deadline=today
    )
    db_session.add_all([overdue_low, today_urgent, future_task, no_deadline_task, draft_task])
    db_session.commit()

    response = client.get("/tasks/today", headers=_auth_headers(token))
    assert response.status_code == 200
    titles = [t["title"] for t in response.json()]
    assert titles == ["Today urgent", "Overdue low"]
