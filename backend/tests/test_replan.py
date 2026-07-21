import datetime
import json
from unittest.mock import MagicMock

from app.ai import replan


def _mock_tool_response(name: str, arguments: dict):
    tool_call = MagicMock()
    tool_call.function.name = name
    tool_call.function.arguments = json.dumps(arguments)
    message = MagicMock()
    message.tool_calls = [tool_call]
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def test_returns_not_a_reschedule_with_no_candidates_without_calling_openai(monkeypatch):
    mock_create = MagicMock()
    monkeypatch.setattr(replan.client.chat.completions, "create", mock_create)

    result = replan.find_reschedule_target("buy milk", datetime.date(2026, 7, 21), [])

    assert result.kind == "not_a_reschedule"
    mock_create.assert_not_called()


def test_reschedule_task_tool_call_parses_dates(monkeypatch):
    mock_create = MagicMock(
        return_value=_mock_tool_response(
            "reschedule_task",
            {"task_id": 5, "new_deadline": "2026-07-23", "new_scheduled_at": "2026-07-23T15:00:00"},
        )
    )
    monkeypatch.setattr(replan.client.chat.completions, "create", mock_create)

    candidates = [replan.CandidateTask(id=5, title="Стоматолог", deadline=None, scheduled_at=None)]
    result = replan.find_reschedule_target(
        "перенеси стоматолога на четвер", datetime.date(2026, 7, 21), candidates
    )

    assert result.kind == "reschedule"
    assert result.task_id == 5
    assert result.new_deadline == datetime.date(2026, 7, 23)
    assert result.new_scheduled_at == datetime.datetime(2026, 7, 23, 15, 0, 0)


def test_reschedule_task_derives_deadline_from_scheduled_at_when_missing(monkeypatch):
    mock_create = MagicMock(
        return_value=_mock_tool_response(
            "reschedule_task",
            {"task_id": 5, "new_deadline": None, "new_scheduled_at": "2026-07-23T15:00:00"},
        )
    )
    monkeypatch.setattr(replan.client.chat.completions, "create", mock_create)

    candidates = [replan.CandidateTask(id=5, title="Стоматолог", deadline=None, scheduled_at=None)]
    result = replan.find_reschedule_target(
        "перенеси стоматолога на 15:00 у четвер", datetime.date(2026, 7, 21), candidates
    )

    assert result.new_deadline == datetime.date(2026, 7, 23)


def test_no_matching_task_tool_call(monkeypatch):
    mock_create = MagicMock(return_value=_mock_tool_response("no_matching_task", {}))
    monkeypatch.setattr(replan.client.chat.completions, "create", mock_create)

    candidates = [replan.CandidateTask(id=5, title="Стоматолог", deadline=None, scheduled_at=None)]
    result = replan.find_reschedule_target(
        "перенеси зустріч з інопланетянами на четвер", datetime.date(2026, 7, 21), candidates
    )

    assert result.kind == "no_match"


def test_not_a_reschedule_tool_call(monkeypatch):
    mock_create = MagicMock(return_value=_mock_tool_response("not_a_reschedule", {}))
    monkeypatch.setattr(replan.client.chat.completions, "create", mock_create)

    candidates = [replan.CandidateTask(id=5, title="Стоматолог", deadline=None, scheduled_at=None)]
    result = replan.find_reschedule_target("купити молоко", datetime.date(2026, 7, 21), candidates)

    assert result.kind == "not_a_reschedule"
