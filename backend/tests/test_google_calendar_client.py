import datetime
from unittest.mock import MagicMock

from app.google_calendar import client as google_calendar_client


class _FakeUser:
    def __init__(self, refresh_token="fake-refresh-token"):
        self.google_calendar_refresh_token = refresh_token


def _mock_response(json_data, status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data
    response.raise_for_status = MagicMock()
    return response


def test_get_free_busy_parses_busy_intervals(monkeypatch):
    monkeypatch.setattr(
        google_calendar_client.httpx,
        "post",
        MagicMock(
            side_effect=[
                _mock_response({"access_token": "fake-access-token"}),
                _mock_response(
                    {
                        "calendars": {
                            "primary": {
                                "busy": [
                                    {"start": "2026-07-20T10:00:00Z", "end": "2026-07-20T11:00:00Z"}
                                ]
                            }
                        }
                    }
                ),
            ]
        ),
    )

    busy = google_calendar_client.get_free_busy(_FakeUser(), datetime.date(2026, 7, 20))

    assert len(busy) == 1
    assert busy[0][0].hour == 10
    assert busy[0][1].hour == 11


def test_suggest_free_slots_skips_busy_time():
    busy = [
        (
            datetime.datetime(2026, 7, 20, 9, 0),
            datetime.datetime(2026, 7, 20, 10, 0),
        )
    ]
    slots = google_calendar_client.suggest_free_slots(busy, datetime.date(2026, 7, 20))

    assert len(slots) > 0
    assert all(slot.hour != 9 for slot in slots)


def test_create_event_returns_event_id(monkeypatch):
    mock_post = MagicMock(
        side_effect=[
            _mock_response({"access_token": "fake-access-token"}),
            _mock_response({"id": "fake-event-id"}),
        ]
    )
    monkeypatch.setattr(google_calendar_client.httpx, "post", mock_post)

    event_id = google_calendar_client.create_event(
        _FakeUser(), "Купити молоко", datetime.datetime(2026, 7, 20, 14, 0)
    )

    assert event_id == "fake-event-id"


def test_create_event_includes_time_zone(monkeypatch):
    """Regression test: Google Calendar's API rejects a dateTime with no UTC
    offset and no explicit timeZone field (400 Bad Request) -- both start
    and end must carry a timeZone since scheduled_at is a naive datetime."""
    mock_post = MagicMock(
        side_effect=[
            _mock_response({"access_token": "fake-access-token"}),
            _mock_response({"id": "fake-event-id"}),
        ]
    )
    monkeypatch.setattr(google_calendar_client.httpx, "post", mock_post)

    google_calendar_client.create_event(
        _FakeUser(), "Купити молоко", datetime.datetime(2026, 7, 20, 14, 0)
    )

    event_call = mock_post.call_args_list[1]
    payload = event_call.kwargs["json"]
    assert payload["start"]["timeZone"] == google_calendar_client.EVENT_TIME_ZONE
    assert payload["end"]["timeZone"] == google_calendar_client.EVENT_TIME_ZONE


def test_create_event_is_transparent(monkeypatch):
    """A Taska task's timed calendar entry shouldn't block time the way a real
    meeting does -- it must be marked free/transparent, not busy."""
    mock_post = MagicMock(
        side_effect=[
            _mock_response({"access_token": "fake-access-token"}),
            _mock_response({"id": "fake-event-id"}),
        ]
    )
    monkeypatch.setattr(google_calendar_client.httpx, "post", mock_post)

    google_calendar_client.create_event(
        _FakeUser(), "Купити молоко", datetime.datetime(2026, 7, 20, 14, 0)
    )

    event_call = mock_post.call_args_list[1]
    assert event_call.kwargs["json"]["transparency"] == "transparent"
