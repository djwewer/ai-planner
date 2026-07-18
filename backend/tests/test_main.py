def test_validation_error_returns_ukrainian_message(client):
    response = client.post(
        "/auth/signup", json={"email": "not-an-email", "password": "password123"}
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Перевірте введені дані"
