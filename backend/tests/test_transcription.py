from unittest.mock import MagicMock

from app.transcription import router as transcription_router


def _signup_and_get_token(client, email="voiceuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_transcribe_requires_auth(client):
    response = client.post(
        "/transcribe",
        files={"file": ("recording.webm", b"fake-audio", "audio/webm")},
    )
    assert response.status_code == 401


def test_transcribe_returns_text(client, monkeypatch):
    monkeypatch.setattr(
        transcription_router, "transcribe_audio", MagicMock(return_value="Купити молоко")
    )
    token = _signup_and_get_token(client)
    response = client.post(
        "/transcribe",
        files={"file": ("recording.webm", b"fake-audio", "audio/webm")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json() == {"text": "Купити молоко"}


def test_transcribe_handles_whisper_failure(client, monkeypatch):
    def _raise(audio_bytes, filename):
        raise RuntimeError("model error")

    monkeypatch.setattr(transcription_router, "transcribe_audio", _raise)
    token = _signup_and_get_token(client)
    response = client.post(
        "/transcribe",
        files={"file": ("recording.webm", b"fake-audio", "audio/webm")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Не вдалося розпізнати мову, спробуйте ще раз"
