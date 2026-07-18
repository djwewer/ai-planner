def test_signup_returns_token(client):
    response = client.post(
        "/auth/signup", json={"email": "test@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_signup_duplicate_email_rejected(client):
    client.post(
        "/auth/signup", json={"email": "dup@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/signup", json={"email": "dup@example.com", "password": "password123"}
    )
    assert response.status_code == 400


def test_login_with_correct_password(client):
    client.post(
        "/auth/signup", json={"email": "login@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/login", json={"email": "login@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_with_wrong_password_rejected(client):
    client.post(
        "/auth/signup", json={"email": "wrong@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/login", json={"email": "wrong@example.com", "password": "wrongpass"}
    )
    assert response.status_code == 401


def test_me_requires_valid_token(client):
    response = client.get("/auth/me")
    assert response.status_code == 401

    signup = client.post(
        "/auth/signup", json={"email": "me@example.com", "password": "password123"}
    )
    token = signup.json()["access_token"]
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "me@example.com"
