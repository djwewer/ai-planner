# Plan B: AI-Powered Replanning via Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every capture (web or Telegram, voice or text) automatically detects whether it's describing new work or asking to reschedule an existing task, and reschedules it directly when a confident match is found — with today's create-flow completely unchanged when it isn't a reschedule request.

**Architecture:** A new, separate AI classification step (`find_reschedule_target`) runs before the existing `extract_tasks` call, offered the user's own confirmed/done tasks as context and three tool choices (reschedule / no match / not a reschedule). `process_capture`'s return type becomes a three-way discriminated result; `POST /captures`'s response shape and the frontend's capture-flow state machine both grow a matching third and fourth outcome.

**Tech Stack:** FastAPI/SQLAlchemy/Alembic backend (OpenAI `gpt-4o-mini`, already a dependency, no new package), Next.js/React frontend (no new dependency).

## Global Constraints

- No new pip/npm dependency.
- `extract_tasks` (`backend/app/ai/triage.py`) is left completely untouched — the new classification step is a separate function and separate AI call, not a merge into `extract_tasks`'s own tool schema.
- Matching is scoped to tasks with `status IN ("confirmed", "done")` only — drafts and rejected tasks are never candidates.
- A reschedule only ever changes `deadline`/`scheduled_at` — never `title`, `priority`, or `status`.
- `POST /captures`'s response shape is an intentional, coordinated breaking change (documented in the design spec) — every consumer (web frontend, Telegram handler) is updated in this same plan.
- Ukrainian-only user-facing copy.
- Backend tests required for all new/changed logic, matching this project's existing `pytest` convention (mock all external calls — OpenAI, Telegram API — never hit real services in tests).
- Frontend has no unit test framework by established project convention — verification is `npm run build`/`npm run lint` clean plus a browser walkthrough.

---

### Task 1: Reschedule-matching AI step + capture-service branching

**Files:**
- Create: `backend/app/ai/replan.py`
- Create: `backend/tests/test_replan.py`
- Modify: `backend/app/captures/service.py` (full rewrite)
- Modify: `backend/app/schemas.py` (add `CaptureResponse`)
- Modify: `backend/app/captures/router.py` (full rewrite)
- Modify: `backend/tests/test_captures.py` (response-shape updates + new reschedule/not-found tests)

**Interfaces:**
- Produces: `CandidateTask` (dataclass: `id: int`, `title: str`, `deadline: Optional[date]`,
  `scheduled_at: Optional[datetime]`) and `find_reschedule_target(raw_text: str, today: date,
  candidate_tasks: list[CandidateTask]) -> ReplanResult` from `backend/app/ai/replan.py`, where
  `ReplanResult` is a dataclass with `kind: Literal["reschedule", "no_match", "not_a_reschedule"]`,
  `task_id: Optional[int]`, `new_deadline: Optional[date]`, `new_scheduled_at: Optional[datetime]`.
  Also produces `CaptureResult` (dataclass: `kind: Literal["created", "rescheduled", "not_found"]`,
  `tasks: list[Task]`, `task: Optional[Task]`) from `backend/app/captures/service.py` — Task 2
  (Telegram) consumes this exact shape.
- Consumes: existing `extract_tasks` (`app.ai.triage`, unchanged), existing
  `_upcoming_weekdays_reference`, `client`, `MODEL` (`app.ai.triage`, unchanged, reused directly),
  existing `_sync_task_google` (`app.tasks.router`), existing `notify_new_tasks_ready`
  (`app.telegram.notifications`).

- [ ] **Step 1: Create the reschedule-matching AI module**

Create `backend/app/ai/replan.py`:

```python
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
```

- [ ] **Step 2: Write tests for the AI module**

Create `backend/tests/test_replan.py`:

```python
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
```

Run: `cd backend && source venv/bin/activate && python -m pytest tests/test_replan.py -v`
Expected: 5 passed.

- [ ] **Step 3: Rewrite the capture service with reschedule branching**

Replace the full contents of `backend/app/captures/service.py`:

```python
import datetime
import logging
from dataclasses import dataclass, field
from typing import Literal, Optional

from sqlalchemy.orm import Session

from app.ai.replan import CandidateTask, find_reschedule_target
from app.ai.triage import extract_tasks
from app.models import Capture, Task, User
from app.tasks.router import _sync_task_google
from app.telegram.notifications import notify_new_tasks_ready

logger = logging.getLogger(__name__)

MAX_CANDIDATE_TASKS = 150


class CaptureProcessingError(Exception):
    """Raised when AI processing fails; the caller decides how to surface it."""


@dataclass
class CaptureResult:
    kind: Literal["created", "rescheduled", "not_found"]
    tasks: list[Task] = field(default_factory=list)
    task: Optional[Task] = None


def _fetch_candidate_tasks(user: User, db: Session) -> list[CandidateTask]:
    rows = (
        db.query(Task)
        .filter(Task.user_id == user.id, Task.status.in_(["confirmed", "done"]))
        .order_by(Task.updated_at.desc())
        .limit(MAX_CANDIDATE_TASKS)
        .all()
    )
    return [
        CandidateTask(id=t.id, title=t.title, deadline=t.deadline, scheduled_at=t.scheduled_at)
        for t in rows
    ]


def process_capture(user: User, raw_text: str, source: str, db: Session) -> CaptureResult:
    capture = Capture(user_id=user.id, raw_text=raw_text, status="processing", source=source)
    db.add(capture)
    db.commit()
    db.refresh(capture)

    candidate_tasks = _fetch_candidate_tasks(user, db)

    try:
        replan = find_reschedule_target(raw_text, datetime.date.today(), candidate_tasks)
    except Exception:
        logger.exception("replan classification failed for capture_id=%s", capture.id)
        capture.status = "failed"
        db.commit()
        raise CaptureProcessingError("replan classification failed") from None

    if replan.kind == "reschedule":
        task = db.query(Task).filter(Task.id == replan.task_id, Task.user_id == user.id).first()
        if task is None:
            logger.warning(
                "replan matched task_id=%s not found/owned for capture_id=%s",
                replan.task_id,
                capture.id,
            )
            capture.status = "no_match"
            db.commit()
            return CaptureResult(kind="not_found")

        task.deadline = replan.new_deadline
        task.scheduled_at = replan.new_scheduled_at
        db.commit()
        db.refresh(task)
        _sync_task_google(user, task, db)

        capture.status = "rescheduled"
        db.commit()

        return CaptureResult(kind="rescheduled", task=task)

    if replan.kind == "no_match":
        capture.status = "no_match"
        db.commit()
        return CaptureResult(kind="not_found")

    # replan.kind == "not_a_reschedule" -- fall through to the existing create-flow.
    try:
        extracted = extract_tasks(raw_text, datetime.date.today())
    except Exception:
        logger.exception("triage failed for capture_id=%s", capture.id)
        capture.status = "failed"
        db.commit()
        raise CaptureProcessingError("triage failed") from None

    capture.status = "complete"
    db.commit()

    tasks = []
    for item in extracted:
        task = Task(
            user_id=user.id,
            capture_id=capture.id,
            title=item.title,
            priority=item.priority,
            deadline=item.deadline,
            scheduled_at=item.scheduled_at,
            status="draft",
        )
        db.add(task)
        tasks.append(task)
    db.commit()
    for task in tasks:
        db.refresh(task)

    if source == "telegram":
        try:
            notify_new_tasks_ready(user, tasks)
        except Exception:
            logger.exception(
                "failed to send new-tasks-ready notification for capture_id=%s", capture.id
            )

    return CaptureResult(kind="created", tasks=tasks)
```

- [ ] **Step 4: Add the new response schema**

In `backend/app/schemas.py`, add this class after the existing `TaskOut` class (at the end of the file):

```python
class CaptureResponse(BaseModel):
    kind: str
    tasks: list[TaskOut] = []
    task: Optional[TaskOut] = None
```

- [ ] **Step 5: Rewrite the capture router**

Replace the full contents of `backend/app/captures/router.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.captures.service import CaptureProcessingError, process_capture
from app.database import get_db
from app.models import User
from app.schemas import CaptureResponse
from app.security import get_current_user

router = APIRouter(prefix="/captures", tags=["captures"])


class CaptureCreate(BaseModel):
    raw_text: str = Field(min_length=1)


@router.post("", response_model=CaptureResponse, status_code=status.HTTP_201_CREATED)
def create_capture(
    payload: CaptureCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        result = process_capture(current_user, payload.raw_text, source="web", db=db)
    except CaptureProcessingError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося обробити, спробуйте ще раз",
        )
    return {"kind": result.kind, "tasks": result.tasks, "task": result.task}
```

- [ ] **Step 6: Update the existing capture tests for the new response shape**

Replace the full contents of `backend/tests/test_captures.py`:

```python
from unittest.mock import MagicMock

from app.ai.triage import ExtractedTask
from app.captures import service as captures_service


def _signup_and_get_token(client, email="captureuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_create_capture_creates_draft_tasks(client, monkeypatch):
    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Buy milk", priority=2, deadline=None, scheduled_at=None),
                ExtractedTask(title="Call John", priority=4, deadline=None, scheduled_at=None),
            ]
        ),
    )
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "buy milk and call john"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "created"
    tasks = body["tasks"]
    assert len(tasks) == 2
    assert all(t["status"] == "draft" for t in tasks)
    assert {t["title"] for t in tasks} == {"Buy milk", "Call John"}


def test_create_capture_with_no_tasks_found(client, monkeypatch):
    monkeypatch.setattr(captures_service, "extract_tasks", MagicMock(return_value=[]))
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "hmm just thinking"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    assert response.json() == {"kind": "created", "tasks": [], "task": None}


def test_create_capture_handles_claude_failure(client, monkeypatch):
    def _raise(raw_text, today):
        raise RuntimeError("API error")

    monkeypatch.setattr(captures_service, "extract_tasks", _raise)
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "test"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 502


def test_create_capture_requires_auth(client):
    response = client.post("/captures", json={"raw_text": "test"})
    assert response.status_code == 401


def test_web_capture_does_not_notify_telegram_even_if_linked(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Buy milk", priority=2, deadline=None, scheduled_at=None)
            ]
        ),
    )
    mock_notify = MagicMock()
    monkeypatch.setattr(captures_service, "notify_new_tasks_ready", mock_notify)

    token = _signup_and_get_token(client, email="webnotify@example.com")
    user = db_session.query(User).filter(User.email == "webnotify@example.com").first()
    user.telegram_chat_id = 999
    db_session.commit()

    response = client.post(
        "/captures",
        json={"raw_text": "buy milk"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    mock_notify.assert_not_called()


def test_telegram_source_capture_notifies(monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Купити молоко", priority=2, deadline=None, scheduled_at=None)
            ]
        ),
    )
    mock_notify = MagicMock()
    monkeypatch.setattr(captures_service, "notify_new_tasks_ready", mock_notify)

    user = User(email="tgnotify@example.com", password_hash="x", telegram_chat_id=888)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    result = captures_service.process_capture(user, "купити молоко", "telegram", db_session)

    assert result.kind == "created"
    assert len(result.tasks) == 1
    assert result.tasks[0].status == "draft"
    mock_notify.assert_called_once()
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"


def test_capture_reschedules_matching_task(client, monkeypatch, db_session):
    import datetime

    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module
    from app.models import Task, User

    token = _signup_and_get_token(client, email="reschedule@example.com")
    user = db_session.query(User).filter(User.email == "reschedule@example.com").first()
    task = Task(
        user_id=user.id,
        title="Стоматолог",
        status="confirmed",
        deadline=datetime.date(2026, 7, 22),
        scheduled_at=datetime.datetime(2026, 7, 22, 10, 0),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(
            return_value=ReplanResult(
                kind="reschedule",
                task_id=task.id,
                new_deadline=datetime.date(2026, 7, 23),
                new_scheduled_at=datetime.datetime(2026, 7, 23, 15, 0),
            )
        ),
    )

    response = client.post(
        "/captures",
        json={"raw_text": "перенеси стоматолога на завтра о 15:00"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "rescheduled"
    assert body["task"]["id"] == task.id
    assert body["task"]["deadline"] == "2026-07-23"

    db_session.refresh(task)
    assert task.deadline == datetime.date(2026, 7, 23)
    assert task.scheduled_at == datetime.datetime(2026, 7, 23, 15, 0)


def test_capture_no_matching_task_returns_not_found(client, monkeypatch, db_session):
    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(return_value=ReplanResult(kind="no_match")),
    )

    token = _signup_and_get_token(client, email="nomatch@example.com")
    response = client.post(
        "/captures",
        json={"raw_text": "перенеси зустріч з інопланетянами на четвер"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    assert response.json() == {"kind": "not_found", "tasks": [], "task": None}
```

- [ ] **Step 7: Run the tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_captures.py tests/test_replan.py -v
```

Expected: all tests pass (7 in `test_captures.py` + 5 in `test_replan.py` = 12 total).

- [ ] **Step 8: Run the full backend suite to check for regressions**

```bash
cd backend && source venv/bin/activate && python -m pytest -q
```

Expected: all tests pass, no regressions in unrelated files (in particular
`test_telegram_capture.py` from Plan A — its tests call `process_capture` only indirectly via
`handle_update`, and none of them create any confirmed/done tasks for their test users
beforehand, so `_fetch_candidate_tasks` returns an empty list for every one of them and
`find_reschedule_target` short-circuits to `not_a_reschedule` without an AI call — the existing
create-flow behavior those tests assert on is untouched by this task).

- [ ] **Step 9: Commit**

```bash
git add backend/app/ai/replan.py backend/tests/test_replan.py backend/app/captures/service.py backend/app/schemas.py backend/app/captures/router.py backend/tests/test_captures.py
git commit -m "feat(backend): detect and apply reschedule requests before task creation"
```

---

### Task 2: Telegram reply wiring for reschedule/not-found outcomes

**Files:**
- Modify: `backend/app/telegram/notifications.py` (add `format_reschedule_confirmation`)
- Modify: `backend/app/telegram/handlers.py` (rewrite `handle_capture_message`)
- Modify: `backend/tests/test_telegram_capture.py` (add 2 new tests)

**Interfaces:**
- Consumes: `CaptureResult`, `process_capture` (Task 1, `backend/app/captures/service.py`) —
  `handle_capture_message` now branches on `result.kind` (`"created"` | `"rescheduled"` |
  `"not_found"`) instead of treating the return value as a plain task list.
- Produces: nothing new consumed by later tasks — Task 3 (frontend) is independent of this task.

- [ ] **Step 1: Add the reschedule-confirmation message formatter**

In `backend/app/telegram/notifications.py`, add this function after the existing
`_format_deadline_line` function (before `render_batch_message`):

```python
def format_reschedule_confirmation(task: Task) -> str:
    return f"✅ Перенесено: «{task.title}»\n{_format_deadline_line(task)}"
```

- [ ] **Step 2: Rewrite `handle_capture_message` to branch on the result kind**

In `backend/app/telegram/handlers.py`, update the import line:

```python
from app.telegram.notifications import format_reschedule_confirmation, render_batch_message
```

(This replaces the existing `from app.telegram.notifications import render_batch_message` line —
add `format_reschedule_confirmation` to the same import, do not add a second import line.)

Add this constant next to the existing `NOT_LINKED_MESSAGE` constant:

```python
NOT_FOUND_MESSAGE = "Не вдалося знайти задачу для перенесення. Спробуйте сформулювати інакше."
```

Replace the full contents of `handle_capture_message`:

```python
def handle_capture_message(chat_id: int, raw_text: str, db: Session) -> None:
    user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
    if user is None:
        telegram_client.send_message(chat_id, NOT_LINKED_MESSAGE)
        return

    try:
        result = process_capture(user, raw_text, source="telegram", db=db)
    except CaptureProcessingError:
        telegram_client.send_message(chat_id, "Не вдалося обробити, спробуйте ще раз")
        return

    if result.kind == "rescheduled":
        telegram_client.send_message(chat_id, format_reschedule_confirmation(result.task))
    elif result.kind == "not_found":
        telegram_client.send_message(chat_id, NOT_FOUND_MESSAGE)
    elif not result.tasks:
        telegram_client.send_message(
            chat_id,
            "Taska не змогла визначити задачі в цьому повідомленні. Спробуйте сформулювати інакше.",
        )
```

(`handle_voice_message` is unchanged — it still calls `handle_capture_message(chat_id, text, db)`
as its last line, which now handles all three outcomes.)

- [ ] **Step 3: Add tests for the two new Telegram reply paths**

In `backend/tests/test_telegram_capture.py`, add these two tests at the end of the file:

```python
def test_text_message_reschedules_matching_task(client, monkeypatch, db_session):
    import datetime

    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module
    from app.models import Task, User

    _signup(client, email="tgreschedule@example.com")
    user = db_session.query(User).filter(User.email == "tgreschedule@example.com").first()
    user.telegram_chat_id = 777
    task = Task(
        user_id=user.id,
        title="Стоматолог",
        status="confirmed",
        deadline=datetime.date(2026, 7, 22),
        scheduled_at=datetime.datetime(2026, 7, 22, 10, 0),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(
            return_value=ReplanResult(
                kind="reschedule",
                task_id=task.id,
                new_deadline=datetime.date(2026, 7, 23),
                new_scheduled_at=datetime.datetime(2026, 7, 23, 15, 0),
            )
        ),
    )
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 777}, "text": "перенеси стоматолога на завтра о 15:00"}},
        db_session,
    )

    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == 777
    assert "Перенесено" in mock_send.call_args.args[1]
    assert "Стоматолог" in mock_send.call_args.args[1]
    db_session.refresh(task)
    assert task.deadline == datetime.date(2026, 7, 23)


def test_text_message_reschedule_no_match_replies_not_found(client, monkeypatch, db_session):
    from app.ai.replan import ReplanResult
    from app.captures import service as captures_service_module
    from app.models import User

    monkeypatch.setattr(
        captures_service_module,
        "find_reschedule_target",
        MagicMock(return_value=ReplanResult(kind="no_match")),
    )
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    _signup(client, email="tgnomatch@example.com")
    user = db_session.query(User).filter(User.email == "tgnomatch@example.com").first()
    user.telegram_chat_id = 778
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 778}, "text": "перенеси зустріч з інопланетянами на четвер"}},
        db_session,
    )

    mock_send.assert_called_once_with(778, telegram_handlers.NOT_FOUND_MESSAGE)
```

- [ ] **Step 4: Run the tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_telegram_capture.py -v
```

Expected: all 9 tests pass (the 7 pre-existing from Plan A, unmodified and still passing, plus
these 2 new ones).

- [ ] **Step 5: Run the full backend suite to check for regressions**

```bash
cd backend && source venv/bin/activate && python -m pytest -q
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/app/telegram/notifications.py backend/app/telegram/handlers.py backend/tests/test_telegram_capture.py
git commit -m "feat(backend): reply to Telegram reschedule and not-found capture outcomes"
```

---

### Task 3: Frontend capture-flow states for rescheduled/not-found

**Files:**
- Modify: `frontend/lib/capture-flow-context.tsx` (full rewrite)
- Create: `frontend/components/capture-flow/RescheduledView.tsx`
- Create: `frontend/components/capture-flow/NotFoundView.tsx`
- Modify: `frontend/components/capture-flow/CaptureFlow.tsx` (add two stage branches)

**Interfaces:**
- Consumes: existing `Task` type (`frontend/lib/types.ts`, unchanged); existing `.success-stage`/
  `.empty-block`/`.primary-btn`/`.secondary-btn` CSS classes (all already defined in
  `frontend/app/globals.css`, no new CSS needed).
- Produces: `CaptureStage` gains `"rescheduled"` and `"not_found"`; `useCaptureFlow()`'s context
  value gains `rescheduledTask: Task | null`, consumed by `RescheduledView`.

- [ ] **Step 1: Rewrite the capture-flow context**

Replace the full contents of `frontend/lib/capture-flow-context.tsx`:

```tsx
"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Task } from "@/lib/types";

export type CaptureStage =
  | "closed"
  | "choice"
  | "voice"
  | "text"
  | "processing"
  | "success"
  | "empty"
  | "error"
  | "rescheduled"
  | "not_found";

type CaptureResponse = {
  kind: "created" | "rescheduled" | "not_found";
  tasks: Task[];
  task: Task | null;
};

type CaptureFlowContextValue = {
  stage: CaptureStage;
  createdCount: number;
  rescheduledTask: Task | null;
  submitError: string | null;
  open: () => void;
  openVoice: () => void;
  openText: () => void;
  close: () => void;
  submitCapture: (rawText: string) => Promise<void>;
};

const CaptureFlowContext = createContext<CaptureFlowContextValue | undefined>(undefined);

export function CaptureFlowProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<CaptureStage>("closed");
  const [createdCount, setCreatedCount] = useState(0);
  const [rescheduledTask, setRescheduledTask] = useState<Task | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submitCapture(rawText: string) {
    setStage("processing");
    try {
      const result = await api.post<CaptureResponse>("/captures", { raw_text: rawText });
      if (result.kind === "rescheduled") {
        setRescheduledTask(result.task);
        setStage("rescheduled");
      } else if (result.kind === "not_found") {
        setStage("not_found");
      } else {
        setCreatedCount(result.tasks.length);
        setStage(result.tasks.length === 0 ? "empty" : "success");
      }
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Перевірте з'єднання з інтернетом і спробуйте ще раз"
      );
      setStage("error");
    }
  }

  return (
    <CaptureFlowContext.Provider
      value={{
        stage,
        createdCount,
        rescheduledTask,
        submitError,
        open: () => setStage("choice"),
        openVoice: () => setStage("voice"),
        openText: () => setStage("text"),
        close: () => setStage("closed"),
        submitCapture,
      }}
    >
      {children}
    </CaptureFlowContext.Provider>
  );
}

export function useCaptureFlow() {
  const ctx = useContext(CaptureFlowContext);
  if (!ctx) throw new Error("useCaptureFlow must be used within CaptureFlowProvider");
  return ctx;
}
```

- [ ] **Step 2: Create the rescheduled-result view**

Create `frontend/components/capture-flow/RescheduledView.tsx`:

```tsx
"use client";

import { CalendarCheck2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCaptureFlow } from "@/lib/capture-flow-context";

function formatTaskWhen(task: { scheduled_at: string | null; deadline: string | null }): string {
  if (task.scheduled_at) {
    const d = new Date(task.scheduled_at);
    const date = d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
    const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    return `${date}, ${time}`;
  }
  if (task.deadline) {
    const d = new Date(task.deadline);
    return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });
  }
  return "";
}

export function RescheduledView() {
  const { rescheduledTask, close } = useCaptureFlow();
  const router = useRouter();

  function handleReview() {
    close();
    router.push("/tasks");
  }

  if (!rescheduledTask) return null;

  return (
    <div className="success-stage">
      <div className="success-icon"><CalendarCheck2 size={30} /></div>
      <h3 className="flow-heading" style={{ margin: 0 }}>Перенесено</h3>
      <p className="flow-sub" style={{ marginBottom: 8 }}>
        «{rescheduledTask.title}» тепер {formatTaskWhen(rescheduledTask)}
      </p>
      <button className="primary-btn" onClick={handleReview}>Переглянути задачі</button>
    </div>
  );
}
```

- [ ] **Step 3: Create the not-found view**

Create `frontend/components/capture-flow/NotFoundView.tsx`:

```tsx
"use client";

import { AlertTriangle } from "lucide-react";
import { useCaptureFlow } from "@/lib/capture-flow-context";

export function NotFoundView() {
  const { close, open } = useCaptureFlow();

  function handleRetry() {
    close();
    open();
  }

  return (
    <div className="success-stage">
      <div className="empty-block">
        <div className="empty-icon warn"><AlertTriangle /></div>
        <p>Taska не знайшла задачу, яку потрібно перенести. Спробуйте сформулювати інакше.</p>
      </div>
      <button className="secondary-btn" onClick={handleRetry}>Спробувати ще раз</button>
    </div>
  );
}
```

- [ ] **Step 4: Wire the two new stages into `CaptureFlow`**

Replace the full contents of `frontend/components/capture-flow/CaptureFlow.tsx`:

```tsx
"use client";

import { useCaptureFlow } from "@/lib/capture-flow-context";
import { CreateSheet } from "@/components/create-sheet/CreateSheet";
import { VoiceFlow } from "@/components/capture-flow/VoiceFlow";
import { TextFlow } from "@/components/capture-flow/TextFlow";
import { ProcessingView } from "@/components/capture-flow/ProcessingView";
import { SuccessView } from "@/components/capture-flow/SuccessView";
import { EmptyResultView } from "@/components/capture-flow/EmptyResultView";
import { ErrorResultView } from "@/components/capture-flow/ErrorResultView";
import { RescheduledView } from "@/components/capture-flow/RescheduledView";
import { NotFoundView } from "@/components/capture-flow/NotFoundView";

export function CaptureFlow() {
  const { stage, close } = useCaptureFlow();

  return (
    <>
      <div className={`backdrop${stage === "choice" ? " open" : ""}`} onClick={close} aria-hidden={stage !== "choice"}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <CreateSheet />
        </div>
      </div>
      {stage === "voice" && <VoiceFlow />}
      {stage === "text" && <TextFlow />}
      {stage === "processing" && (
        <div className="flow"><div className="flow-body"><ProcessingView /></div></div>
      )}
      {stage === "success" && (
        <div className="flow"><div className="flow-body"><SuccessView /></div></div>
      )}
      {stage === "empty" && (
        <div className="flow"><div className="flow-body"><EmptyResultView /></div></div>
      )}
      {stage === "error" && (
        <div className="flow"><div className="flow-body"><ErrorResultView /></div></div>
      )}
      {stage === "rescheduled" && (
        <div className="flow"><div className="flow-body"><RescheduledView /></div></div>
      )}
      {stage === "not_found" && (
        <div className="flow"><div className="flow-body"><NotFoundView /></div></div>
      )}
    </>
  );
}
```

- [ ] **Step 5: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 6: Verify in the browser**

Start the backend (with a real or test OpenAI key) and frontend dev servers, sign in, create a
confirmed task with a real title (e.g. "Стоматолог" scheduled for some date), then use the "+"
capture flow (voice or text) to say something like "перенеси стоматолога на четвер о 15:00" —
confirm the flow shows the new `RescheduledView` with the task's new date/time, and that
navigating to Tasks shows it actually moved. Then try a capture referring to something that
doesn't exist (e.g. "перенеси зустріч з інопланетянами на четвер") — confirm `NotFoundView`
appears. Finally confirm an ordinary capture ("купити молоко") still goes through the unchanged
create-flow to `SuccessView`/Inbox.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/capture-flow-context.tsx frontend/components/capture-flow/RescheduledView.tsx frontend/components/capture-flow/NotFoundView.tsx frontend/components/capture-flow/CaptureFlow.tsx
git commit -m "feat(frontend): show reschedule and not-found outcomes in the capture flow"
```

---

## Self-Review

**Spec coverage:** separate AI classification step reusing the existing weekday-reference/date
rules, offered as 3 forced tool choices (Task 1 Step 1); candidate tasks scoped to
confirmed/done only, capped at 150, ordered by recency (Task 1 Step 3's `_fetch_candidate_tasks`);
reschedule only touches `deadline`/`scheduled_at`, reuses `_sync_task_google` automatically (Task 1
Step 3); `extract_tasks` and its existing tests completely untouched (confirmed via the
empty-candidate-list short-circuit meaning no existing test needs new mocking); `POST /captures`'s
coordinated breaking response-shape change (Task 1 Steps 4-6, Task 3 Step 1); Telegram replies for
both new outcomes plus regression-safety for the three pre-existing Plan A outcomes (Task 2);
frontend `"rescheduled"`/`"not_found"` stages with matching views reusing established CSS/patterns
(Task 3) — all covered.

**Placeholder scan:** caught and fixed a drafting artifact in Task 1 Step 6's
`test_capture_reschedules_matching_task` (a leftover `if False ... else` branch from iterating on
the mock's `return_value` expression) before finalizing — the step now shows only the single,
correct assertion to write.

**Type consistency:** `CandidateTask`/`ReplanResult` (Task 1 Step 1) are consumed with matching
field names by `_fetch_candidate_tasks`/`process_capture` (Task 1 Step 3) and by every test that
constructs a `ReplanResult` directly (Task 1 Step 6, Task 2 Step 3). `CaptureResult` (Task 1 Step
3) is consumed identically by the router (Task 1 Step 5) and by `handle_capture_message` (Task 2
Step 2) via its `.kind`/`.tasks`/`.task` fields. The frontend's `CaptureResponse` type (Task 3 Step
1) matches the exact wire shape `CaptureResponse` (Pydantic, Task 1 Step 4) serializes.
