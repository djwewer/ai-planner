import datetime
from unittest.mock import MagicMock

import pydantic
import pytest

from app.ai import triage


def _mock_tool_response(tasks_payload):
    block = MagicMock()
    block.type = "tool_use"
    block.name = "extract_tasks"
    block.input = {"tasks": tasks_payload}
    response = MagicMock()
    response.content = [block]
    return response


def test_extract_tasks_returns_parsed_tasks(monkeypatch):
    mock_create = MagicMock(
        return_value=_mock_tool_response(
            [
                {"title": "Buy milk", "priority": 2, "deadline": "2026-07-20"},
                {"title": "Call John", "priority": 4, "deadline": None},
            ]
        )
    )
    monkeypatch.setattr(triage.client.messages, "create", mock_create)

    result = triage.extract_tasks("buy milk and call john", datetime.date(2026, 7, 19))

    assert len(result) == 2
    assert result[0].title == "Buy milk"
    assert result[0].priority == 2
    assert result[0].deadline == datetime.date(2026, 7, 20)
    assert result[1].title == "Call John"
    assert result[1].deadline is None

    call_kwargs = mock_create.call_args.kwargs
    assert "2026-07-19" in call_kwargs["system"]
    assert call_kwargs["model"] == triage.MODEL


def test_extract_tasks_empty_result(monkeypatch):
    mock_create = MagicMock(return_value=_mock_tool_response([]))
    monkeypatch.setattr(triage.client.messages, "create", mock_create)

    result = triage.extract_tasks("just thinking out loud", datetime.date(2026, 7, 19))

    assert result == []


def test_extract_tasks_raises_on_missing_tool_use(monkeypatch):
    response = MagicMock()
    response.content = []
    mock_create = MagicMock(return_value=response)
    monkeypatch.setattr(triage.client.messages, "create", mock_create)

    with pytest.raises(ValueError):
        triage.extract_tasks("test", datetime.date(2026, 7, 19))


def test_extract_tasks_raises_on_out_of_range_priority(monkeypatch):
    mock_create = MagicMock(
        return_value=_mock_tool_response(
            [{"title": "Buy milk", "priority": 7, "deadline": None}]
        )
    )
    monkeypatch.setattr(triage.client.messages, "create", mock_create)

    with pytest.raises(pydantic.ValidationError):
        triage.extract_tasks("buy milk", datetime.date(2026, 7, 19))
