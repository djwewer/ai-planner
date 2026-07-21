import datetime
import json
import logging
from dataclasses import dataclass
from typing import Literal, Optional

from app.ai.triage import MODEL, _upcoming_weekdays_reference, client

logger = logging.getLogger(__name__)

REPLAN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "reschedule_task",
            "description": (
                "Reschedule an existing task to a new date and/or time, when the "
                "user's message confidently refers to one specific task from the "
                "provided list."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "integer",
                        "description": "The id of the matched task from the provided list.",
                    },
                    "new_deadline": {
                        "type": ["string", "null"],
                        "description": "ISO 8601 date (YYYY-MM-DD) for the task's new deadline.",
                    },
                    "new_scheduled_at": {
                        "type": ["string", "null"],
                        "description": (
                            "ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS) if a specific "
                            "new time of day was stated, otherwise null."
                        ),
                    },
                },
                "required": ["task_id", "new_deadline", "new_scheduled_at"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "no_matching_task",
            "description": (
                "The message is clearly asking to move/reschedule an existing "
                "task, but none of the provided tasks confidently match."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "not_a_reschedule",
            "description": (
                "The message is not referring to an existing task to reschedule "
                "-- e.g. it describes new work instead."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


@dataclass
class CandidateTask:
    id: int
    title: str
    deadline: Optional[datetime.date]
    scheduled_at: Optional[datetime.datetime]


@dataclass
class ReplanResult:
    kind: Literal["reschedule", "no_match", "not_a_reschedule"]
    task_id: Optional[int] = None
    new_deadline: Optional[datetime.date] = None
    new_scheduled_at: Optional[datetime.datetime] = None


def _format_candidate(task: CandidateTask) -> str:
    if task.scheduled_at is not None:
        when = f"scheduled {task.scheduled_at.isoformat()}"
    elif task.deadline is not None:
        when = f"due {task.deadline.isoformat()}"
    else:
        when = "no date"
    return f'id={task.id}: "{task.title}" ({when})'


def find_reschedule_target(
    raw_text: str, today: datetime.date, candidate_tasks: list[CandidateTask]
) -> ReplanResult:
    if not candidate_tasks:
        return ReplanResult(kind="not_a_reschedule")

    weekdays_reference = _upcoming_weekdays_reference(today)
    candidates_block = "\n".join(_format_candidate(t) for t in candidate_tasks)
    logger.info(
        "replan request: today=%s raw_text=%r candidates=%d",
        today.isoformat(),
        raw_text,
        len(candidate_tasks),
    )

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You determine whether the user's message is asking to "
                    "reschedule an EXISTING task to a new date/time, as opposed "
                    "to describing new work. Here is the user's current list of "
                    "tasks, one per line, each with its id:\n"
                    f"{candidates_block}\n\n"
                    "If the message clearly refers to one of these tasks by name "
                    "or close paraphrase AND states a new date/time for it, call "
                    "reschedule_task with that task's id and the new date/time. "
                    "If the message is clearly asking to move/reschedule "
                    "something but you cannot confidently match it to one "
                    "specific task in the list, call no_matching_task. If the "
                    "message does not refer to any existing task at all (e.g. it "
                    "describes brand-new work), call not_a_reschedule. "
                    f"Today's date is {today.isoformat()}. For weekday names, use "
                    "this table rather than calculating dates yourself -- each "
                    "weekday appears twice, labeled (this) for the nearer date "
                    "and (next) for exactly one week later: "
                    f"{weekdays_reference}. Follow this rule STRICTLY: a weekday "
                    'name WITHOUT "next"/"наступного"/"наступної"/"наступний" '
                    'uses the (this) date; WITH that word, use the (next) date. '
                    'Only "today"/"сьогодні" maps to today\'s own date. If a '
                    'specific time of day is stated (e.g. "at 3pm", "о 15:00"), '
                    "set new_scheduled_at to the combined date and time as an "
                    "ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS), using the "
                    "resolved date as the date part, and set new_deadline to "
                    "that same date. If only a date is stated with no specific "
                    "time, set new_deadline to that date and leave "
                    "new_scheduled_at null."
                ),
            },
            {"role": "user", "content": raw_text},
        ],
        tools=REPLAN_TOOLS,
        tool_choice="required",
    )

    tool_calls = response.choices[0].message.tool_calls
    if not tool_calls:
        logger.warning("replan response had no tool call: %r", response)
        raise ValueError("OpenAI response did not include the expected tool call")

    call = tool_calls[0]
    name = call.function.name
    args = json.loads(call.function.arguments) if call.function.arguments else {}
    logger.info("replan raw response: name=%s args=%s", name, call.function.arguments)

    if name == "reschedule_task":
        new_deadline_str = args.get("new_deadline")
        new_scheduled_at_str = args.get("new_scheduled_at")
        new_scheduled_at = (
            datetime.datetime.fromisoformat(new_scheduled_at_str) if new_scheduled_at_str else None
        )
        if new_deadline_str:
            new_deadline = datetime.date.fromisoformat(new_deadline_str)
        elif new_scheduled_at is not None:
            new_deadline = new_scheduled_at.date()
        else:
            new_deadline = None
        return ReplanResult(
            kind="reschedule",
            task_id=args["task_id"],
            new_deadline=new_deadline,
            new_scheduled_at=new_scheduled_at,
        )

    if name == "no_matching_task":
        return ReplanResult(kind="no_match")

    return ReplanResult(kind="not_a_reschedule")
