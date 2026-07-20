from unittest.mock import MagicMock

from app.google_calendar import router as google_calendar_router


def _signup_and_get_token(client, email="calendarevents@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_all_day_event_is_flagged(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        google_calendar_router.google_calendar_client,
        "list_events",
        MagicMock(
            return_value=[
                {
                    "id": "birthday-1",
                    "summary": "День народження Андрія",
                    "start": {"date": "2026-07-21"},
                    "end": {"date": "2026-07-22"},
                },
                {
                    "id": "meeting-1",
                    "summary": "Зустріч з командою",
                    "start": {"dateTime": "2026-07-21T14:00:00+03:00"},
                    "end": {"dateTime": "2026-07-21T15:00:00+03:00"},
                },
            ]
        ),
    )
    token = _signup_and_get_token(client)
    user = db_session.query(User).filter(User.email == "calendarevents@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    response = client.get(
        "/calendar/events?start=2026-07-21T00:00:00&end=2026-07-21T23:59:59",
        headers=_auth_headers(token),
    )

    assert response.status_code == 200
    events = {e["id"]: e for e in response.json()["events"]}
    assert events["birthday-1"]["all_day"] is True
    assert events["meeting-1"]["all_day"] is False
