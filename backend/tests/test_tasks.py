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
