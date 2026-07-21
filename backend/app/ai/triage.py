import datetime
import json
import logging
from typing import Optional

import openai
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)

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
                                "description": (
                                    "A short, clean summary of the task -- not a verbatim "
                                    'restatement of the user\'s phrasing. E.g. for "I need to '
                                    'go get a haircut at 1pm" the title should be "Haircut", '
                                    'not "Go to do a haircut". Keep it as brief as possible '
                                    "while staying clear, in the same language as the input "
                                    "text, and always start it with a capital letter."
                                ),
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
                            "scheduled_at": {
                                "type": ["string", "null"],
                                "description": "ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS) ONLY if the text states a specific time of day for the task (e.g. \"at 3pm\", \"о 15:00\"). Otherwise null -- never guess or infer a time just because a task sounds time-sensitive.",
                            },
                        },
                        "required": ["title", "priority", "deadline", "scheduled_at"],
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
    scheduled_at: Optional[datetime.datetime]


def _capitalize_first(text: str) -> str:
    """Uppercase only the first character, leaving the rest untouched.

    A deterministic fallback in case the model doesn't follow the prompt's
    capitalization instruction -- str.capitalize() would also lowercase the
    rest of the string (mangling acronyms like "IKEA"), which we don't want.
    """
    return text[:1].upper() + text[1:] if text else text


def _upcoming_weekdays_reference(today: datetime.date) -> str:
    """Return the next two occurrences of each weekday, labeled (this)/(next).

    Precomputing this in Python avoids relying on the model to correctly
    perform day-of-week arithmetic itself. Each weekday name appears twice:
    "(this)" for the occurrence within the next 7 days, "(next)" for the
    occurrence exactly one week after that — so the model resolves "Friday"
    vs. "next Friday" by matching a label, not by counting or reasoning
    about weeks itself. Today is deliberately excluded so a weekday name
    never collides with today's own weekday — "today"/"сьогодні" is handled
    separately via the explicit today's-date sentence in the prompt, never
    via this table.
    """
    this_week = [today + datetime.timedelta(days=offset) for offset in range(1, 8)]
    next_week = [today + datetime.timedelta(days=offset) for offset in range(8, 15)]
    entries = [f"{day.strftime('%A')}(this)={day.isoformat()}" for day in this_week]
    entries += [f"{day.strftime('%A')}(next)={day.isoformat()}" for day in next_week]
    return ", ".join(entries)


def extract_tasks(raw_text: str, today: datetime.date) -> list[ExtractedTask]:
    weekdays_reference = _upcoming_weekdays_reference(today)
    logger.info(
        "triage request: today=%s weekdays_reference=%s raw_text=%r",
        today.isoformat(),
        weekdays_reference,
        raw_text,
    )
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
                    "For weekday names, use this table rather than calculating dates "
                    "yourself — each weekday appears twice, labeled (this) for the "
                    "nearer date and (next) for exactly one week later: "
                    f"{weekdays_reference}. Follow this rule STRICTLY: if the user "
                    'names a weekday WITHOUT the word "next"/"наступного"/"наступної"/'
                    '"наступний" (e.g. "Friday"/"п\'ятниця"), you MUST use the (this) '
                    "date for that weekday. If the user explicitly says "
                    '"next"/"наступного"/"наступної"/"наступний" before the weekday '
                    'name (e.g. "next Friday"/"наступної п\'ятниці"), you MUST use the '
                    "(next) date instead — do not use the (this) date in that case, "
                    "even if it seems like the more natural nearest date. Never use "
                    "today's date for a weekday name, even if today happens to fall "
                    "on that weekday, and never substitute a different weekday's date "
                    'than the one named. Only the words "today"/"сьогодні" map to '
                    "today's own date. If the text states a SPECIFIC time of day for a "
                    'task (e.g. "at 3pm", "о 15:00", "о 9 ранку"), set scheduled_at to '
                    "the combined date and time as an ISO 8601 date-time "
                    "(YYYY-MM-DDTHH:MM:SS), using the resolved deadline date (or "
                    "today's date if no date was otherwise mentioned) as the date "
                    "part. If no specific time is stated, leave scheduled_at null — "
                    "do not guess or infer a time just because a task sounds "
                    "time-sensitive. Keep each "
                    "task's title in the same language as the input text — do not "
                    "translate it. Each title must be a short, clean summary of the "
                    'action, not a verbatim restatement of the user\'s sentence — e.g. '
                    'for "I need to go get a haircut at 1pm" the title should be '
                    '"Haircut", not "Go to do a haircut". Always capitalize the first '
                    "letter of every title. Assign a priority from 1 (urgent) to 4 (low) based "
                    "on urgency cues in the text (e.g. \"urgent\"/\"терміново\" is "
                    "priority 1). If no deadline is mentioned or inferrable: for "
                    f"priority 1 (urgent) tasks, use today's date ({today.isoformat()}) "
                    "as the deadline, since an urgent task with no stated deadline "
                    "still needs to happen today; for priority 2-4 tasks, use null. "
                    "If the text contains no actionable tasks, return an empty list."
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
                logger.info("triage raw response: %s", tool_call.function.arguments)
                raw_tasks = json.loads(tool_call.function.arguments).get("tasks", [])
                return [
                    ExtractedTask(**{**task, "title": _capitalize_first(task["title"])})
                    for task in raw_tasks
                ]

    logger.warning("triage response had no matching tool call: %r", response)
    raise ValueError("OpenAI response did not include the expected tool call")
