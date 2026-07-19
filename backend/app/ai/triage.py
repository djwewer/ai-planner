import datetime
import json
from typing import Optional

import openai
from pydantic import BaseModel, Field

from app.config import settings

client = openai.OpenAI(api_key=settings.openai_api_key)

MODEL = "gpt-4o-mini"

TRIAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "extract_tasks",
        "description": "Extract a list of actionable tasks from the user's free-form capture text.",
        "parameters": {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": "The task title, in the same language as the input text.",
                            },
                            "priority": {
                                "type": "integer",
                                "enum": [1, 2, 3, 4],
                                "description": "1=urgent, 2=high, 3=medium, 4=low",
                            },
                            "deadline": {
                                "type": ["string", "null"],
                                "description": "ISO 8601 date (YYYY-MM-DD) if a deadline was mentioned or can be inferred, otherwise null.",
                            },
                        },
                        "required": ["title", "priority", "deadline"],
                    },
                }
            },
            "required": ["tasks"],
        },
    },
}


class ExtractedTask(BaseModel):
    title: str
    priority: int = Field(ge=1, le=4)
    deadline: Optional[datetime.date]


def _upcoming_dates_reference(today: datetime.date) -> str:
    """Return today plus the next 7 days as 'YYYY-MM-DD (Weekday)' entries.

    Precomputing this in Python avoids relying on the model to correctly
    perform day-of-week arithmetic itself.
    """
    days = [today + datetime.timedelta(days=offset) for offset in range(8)]
    entries = [f"{day.isoformat()} ({day.strftime('%A')})" for day in days]
    return f"today={entries[0]}, " + ", ".join(entries[1:])


def extract_tasks(raw_text: str, today: datetime.date) -> list[ExtractedTask]:
    dates_reference = _upcoming_dates_reference(today)
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract actionable tasks from a user's free-form capture text. "
                    f"Today's date is {today.isoformat()}. Resolve relative dates "
                    '(e.g. "tomorrow", "next Friday") to absolute ISO 8601 dates using '
                    "today's date as the reference point. For your reference, here are "
                    "the next 7 days with their weekday names — use this table to "
                    'resolve weekday names (e.g. "Friday") to exact dates, rather than '
                    f"calculating weekdays yourself: {dates_reference}. Keep each task's "
                    "title in the same language as the input text — do not translate it. "
                    "Assign a priority from 1 (urgent) to 4 (low) based on urgency cues in "
                    "the text. If no deadline is mentioned or inferrable, use null. If the "
                    "text contains no actionable tasks, return an empty list."
                ),
            },
            {"role": "user", "content": raw_text},
        ],
        tools=[TRIAGE_TOOL],
        tool_choice={"type": "function", "function": {"name": "extract_tasks"}},
    )

    tool_calls = response.choices[0].message.tool_calls
    if tool_calls:
        for tool_call in tool_calls:
            if tool_call.function.name == "extract_tasks":
                raw_tasks = json.loads(tool_call.function.arguments).get("tasks", [])
                return [ExtractedTask(**task) for task in raw_tasks]

    raise ValueError("OpenAI response did not include the expected tool call")
