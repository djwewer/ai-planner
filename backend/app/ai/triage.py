import datetime
from typing import Optional

import anthropic
from pydantic import BaseModel

from app.config import settings

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

MODEL = "claude-haiku-4-5-20251001"

TRIAGE_TOOL = {
    "name": "extract_tasks",
    "description": "Extract a list of actionable tasks from the user's free-form capture text.",
    "input_schema": {
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
}


class ExtractedTask(BaseModel):
    title: str
    priority: int
    deadline: Optional[datetime.date]


def extract_tasks(raw_text: str, today: datetime.date) -> list[ExtractedTask]:
    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=(
            "You extract actionable tasks from a user's free-form capture text. "
            f"Today's date is {today.isoformat()}. Resolve relative dates "
            '(e.g. "tomorrow", "next Friday") to absolute ISO 8601 dates using '
            "today's date as the reference point. Keep each task's title in the "
            "same language as the input text — do not translate it. Assign a "
            "priority from 1 (urgent) to 4 (low) based on urgency cues in the "
            "text. If no deadline is mentioned or inferrable, use null. If the "
            "text contains no actionable tasks, return an empty list."
        ),
        tools=[TRIAGE_TOOL],
        tool_choice={"type": "tool", "name": "extract_tasks"},
        messages=[{"role": "user", "content": raw_text}],
    )

    for block in message.content:
        if block.type == "tool_use" and block.name == "extract_tasks":
            raw_tasks = block.input.get("tasks", [])
            return [ExtractedTask(**task) for task in raw_tasks]

    raise ValueError("Claude response did not include the expected tool_use block")
