import datetime
from unittest.mock import MagicMock

from app.google_calendar import tasks_client as google_tasks_client


class _FakeUser:
    def __init__(self, refresh_token="fake-refresh-token"):
        self.google_calendar_refresh_token = refresh_token


def _mock_response(json_data=None, status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data or {}
    response.raise_for_status = MagicMock()
    return response


def test_create_task_returns_task_id(monkeypatch):
    mock_post = MagicMock(
        side_effect=[
            _mock_response({"access_token": "fake-access-token"}),
            _mock_response({"id": "fake-task-id"}),
        ]
    )
    monkeypatch.setattr(google_tasks_client.httpx, "post", mock_post)

    task_id = google_tasks_client.create_task(
        _FakeUser(), "Купити молоко", datetime.date(2026, 7, 21)
    )

    assert task_id == "fake-task-id"
    task_call = mock_post.call_args_list[1]
    assert task_call.kwargs["json"]["due"] == "2026-07-21T00:00:00.000Z"
    assert task_call.kwargs["json"]["status"] == "needsAction"
    assert "@default" in task_call.args[0]


def test_create_task_marks_completed_status(monkeypatch):
    mock_post = MagicMock(
        side_effect=[
            _mock_response({"access_token": "fake-access-token"}),
            _mock_response({"id": "fake-task-id"}),
        ]
    )
    monkeypatch.setattr(google_tasks_client.httpx, "post", mock_post)

    google_tasks_client.create_task(
        _FakeUser(), "Купити молоко", datetime.date(2026, 7, 21), completed=True
    )

    task_call = mock_post.call_args_list[1]
    assert task_call.kwargs["json"]["status"] == "completed"


def test_delete_task_tolerates_404(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"access_token": "fake-access-token"}))
    mock_delete = MagicMock(return_value=_mock_response(status_code=404))
    monkeypatch.setattr(google_tasks_client.httpx, "post", mock_post)
    monkeypatch.setattr(google_tasks_client.httpx, "delete", mock_delete)

    google_tasks_client.delete_task(_FakeUser(), "fake-task-id")
