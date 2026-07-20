import datetime
import json
from unittest.mock import MagicMock

import pydantic
import pytest

from app.ai import triage


def _mock_tool_response(tasks_payload):
    tool_call = MagicMock()
    tool_call.function.name = "extract_tasks"
    tool_call.function.arguments = json.dumps({"tasks": tasks_payload})
    message = MagicMock()
    message.tool_calls = [tool_call]
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    return response


def test_extract_tasks_returns_parsed_tasks(monkeypatch):
    mock_create = MagicMock(
        return_value=_mock_tool_response(
            [
                {"title": "Buy milk", "priority": 2, "deadline": "2026-07-20", "scheduled_at": None},
                {"title": "Call John", "priority": 4, "deadline": None, "scheduled_at": None},
            ]
        )
    )
    monkeypatch.setattr(triage.client.chat.completions, "create", mock_create)

    result = triage.extract_tasks("buy milk and call john", datetime.date(2026, 7, 19))

    assert len(result) == 2
    assert result[0].title == "Buy milk"
    assert result[0].priority == 2
    assert result[0].deadline == datetime.date(2026, 7, 20)
    assert result[1].title == "Call John"
    assert result[1].deadline is None

    call_kwargs = mock_create.call_args.kwargs
    assert "2026-07-19" in call_kwargs["messages"][0]["content"]
    assert call_kwargs["model"] == triage.MODEL


def test_extract_tasks_empty_result(monkeypatch):
    mock_create = MagicMock(return_value=_mock_tool_response([]))
    monkeypatch.setattr(triage.client.chat.completions, "create", mock_create)

    result = triage.extract_tasks("just thinking out loud", datetime.date(2026, 7, 19))

    assert result == []


def test_extract_tasks_raises_on_missing_tool_use(monkeypatch):
    message = MagicMock()
    message.tool_calls = None
    choice = MagicMock()
    choice.message = message
    response = MagicMock()
    response.choices = [choice]
    mock_create = MagicMock(return_value=response)
    monkeypatch.setattr(triage.client.chat.completions, "create", mock_create)

    with pytest.raises(ValueError):
        triage.extract_tasks("test", datetime.date(2026, 7, 19))


def test_extract_tasks_raises_on_out_of_range_priority(monkeypatch):
    mock_create = MagicMock(
        return_value=_mock_tool_response(
            [{"title": "Buy milk", "priority": 7, "deadline": None, "scheduled_at": None}]
        )
    )
    monkeypatch.setattr(triage.client.chat.completions, "create", mock_create)

    with pytest.raises(pydantic.ValidationError):
        triage.extract_tasks("buy milk", datetime.date(2026, 7, 19))


def test_extract_tasks_prompt_includes_weekday_reference_table(monkeypatch):
    mock_create = MagicMock(return_value=_mock_tool_response([]))
    monkeypatch.setattr(triage.client.chat.completions, "create", mock_create)

    triage.extract_tasks("finish report by Friday", datetime.date(2026, 7, 19))

    call_kwargs = mock_create.call_args.kwargs
    system_content = call_kwargs["messages"][0]["content"]
    assert "Friday(this)=2026-07-24" in system_content
    assert "Friday(next)=2026-07-31" in system_content


def test_extract_tasks_prompt_next_wednesday_is_one_week_later(monkeypatch):
    # Regression test for a reported bug: today=Monday 2026-07-20, "next
    # Wednesday" must resolve to 2026-07-29 (one week out), not 2026-07-22
    # (this week's Wednesday).
    mock_create = MagicMock(return_value=_mock_tool_response([]))
    monkeypatch.setattr(triage.client.chat.completions, "create", mock_create)

    triage.extract_tasks("prepare presentation by next Wednesday", datetime.date(2026, 7, 20))

    call_kwargs = mock_create.call_args.kwargs
    system_content = call_kwargs["messages"][0]["content"]
    assert "Wednesday(this)=2026-07-22" in system_content
    assert "Wednesday(next)=2026-07-29" in system_content
