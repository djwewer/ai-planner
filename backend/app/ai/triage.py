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


def _upcoming_weekdays_reference(today: datetime.date) -> str:
    """Return the next 7 days (NOT including today) as 'Weekday=YYYY-MM-DD' entries.

    Precomputing this in Python avoids relying on the model to correctly
    perform day-of-week arithmetic itself. Today is deliberately excluded so
    a weekday name (e.g. "Friday") never collides with today's own weekday —
    "today"/"сьогодні" is handled separately via the explicit today's-date
    sentence in the prompt, never via this table.
    """
    days = [today + datetime.timedelta(days=offset) for offset in range(1, 8)]
    return ", ".join(f"{day.strftime('%A')}={day.isoformat()}" for day in days)


def extract_tasks(raw_text: str, today: datetime.date) -> list[ExtractedTask]:
    weekdays_reference = _upcoming_weekdays_reference(today)
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You extract actionable tasks from a user's free-form capture text. "
                    f"Today's date is {today.isoformat()}. Resolve relative dates "
                    '(e.g. "tomorrow", "next Friday") to absolute ISO 8601 dates using '
                    "today's date as the reference point. Do not guess or infer a "
                    "deadline that isn't stated or clearly implied by the text. "
                    "For weekday names, use this table of the next 7 days rather than "
                    f"calculating dates yourself: {weekdays_reference}. If the user "
                    'names a weekday (e.g. "Friday" or "next Friday"), always use the '
                    "date from this table for that weekday — never use today's date "
                    "for a weekday name, even if today happens to fall on that "
                    "weekday, and never substitute a different weekday's date. Only "
                    'the words "today"/"сьогодні" map to today\'s own date. Keep each '
                    "task's title in the same language as the input text — do not "
                    "translate it. Assign a priority from 1 (urgent) to 4 (low) based "
                    "on urgency cues in the text. If no deadline is mentioned or "
                    "inferrable, use null. If the text contains no actionable tasks, "
                    "return an empty list."
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
