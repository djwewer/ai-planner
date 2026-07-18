# AI Planner — Plan 2: AI Capture & Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user type a free-form capture, have Claude split it into draft tasks (title/priority/deadline), review and edit them in an Inbox before approving, and see today's + overdue confirmed tasks on a new Today view — with the whole app (including Plan 1's existing pages) now in Ukrainian.

**Architecture:** A new `app/ai/triage.py` module wraps the Claude API (Haiku 4.5, tool-use for structured output). A new `app/captures/router.py` exposes `POST /captures`, which calls triage synchronously and creates draft `Task` rows. `app/tasks/router.py` gains a status filter and a `/today` endpoint. Four new Next.js pages (`/capture`, `/inbox`, `/today`, plus a shared nav component) sit alongside Plan 1's retranslated pages.

**Tech Stack:** Same as Plan 1 (FastAPI, SQLAlchemy, Alembic, PostgreSQL, Next.js/TypeScript), plus the `anthropic` Python SDK for Claude API access.

## Global Constraints

- Product language is Ukrainian — every UI string and backend error message, no translation layer, no language switcher (single-language product).
- No time-of-day scheduling or Google Calendar sync in this plan — deferred to Plan 4.
- No voice capture in this plan — deferred to Plan 3.
- No Telegram bot in this plan — deferred to Plan 5.
- AI triage uses Claude Haiku 4.5 and preserves the capture's input language in task titles (no translation to English).
- Capture processing is synchronous: `POST /captures` waits for Claude's response and returns the created draft tasks directly — no polling.
- Backend is FastAPI on the existing Hostinger VPS behind Traefik; frontend is Next.js on Vercel (inherited infra from Plan 1, already live).

---

## File Structure

```
backend/
  app/
    ai/
      triage.py               # Claude client + extract_tasks()
    captures/
      router.py                 # POST /captures
    tasks/
      router.py                  # + status filter, + GET /tasks/today
    auth/
      router.py                   # error messages translated
    security.py                    # error messages translated
    models.py                       # + Capture model, + Task.capture_id
    config.py                        # + anthropic_api_key
  alembic/versions/0002_captures.py
  tests/
    test_triage.py
    test_captures.py
    test_tasks.py                     # + status filter / today tests
    test_auth.py                       # + translated-message assertions
    test_security.py                    # + translated-message assertions
    test_models.py                       # + Capture tests
frontend/
  components/
    nav.tsx                              # shared nav bar
  app/
    capture/page.tsx
    inbox/page.tsx
    today/page.tsx
    login/page.tsx                        # retranslated
    signup/page.tsx                        # retranslated
    tasks/page.tsx                          # retranslated + Nav
    auth/callback/page.tsx                   # retranslated
    page.tsx                                  # retranslated
    layout.tsx                                 # lang="uk"
```

---

### Task 1: Database — Capture model, `capture_id` column, migration

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/0002_captures.py`
- Modify: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: `app.database.Base` (existing)
- Produces: `app.models.Capture` (`id`, `user_id`, `raw_text`, `status` default `"processing"`, `created_at`); `app.models.Task.capture_id` (nullable FK to `captures.id`)

- [ ] **Step 1: Write the failing tests — append to `backend/tests/test_models.py`**

Full new file content:

```python
import datetime

from app.models import Capture, Task, User


def test_user_defaults(db_session):
    user = User(email="model@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    assert user.id is not None
    assert isinstance(user.created_at, datetime.datetime)


def test_task_defaults(db_session):
    user = User(email="taskowner@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    task = Task(user_id=user.id, title="Write the plan")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    assert task.priority == 3
    assert task.status == "confirmed"
    assert task.deadline is None


def test_capture_defaults(db_session):
    user = User(email="captureowner@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    capture = Capture(user_id=user.id, raw_text="buy milk and call john")
    db_session.add(capture)
    db_session.commit()
    db_session.refresh(capture)

    assert capture.status == "processing"
    assert capture.id is not None


def test_task_capture_id_nullable(db_session):
    user = User(email="taskcaptureowner@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    task = Task(user_id=user.id, title="Manually added task")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    assert task.capture_id is None
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
cd backend
source venv/bin/activate
pytest tests/test_models.py -v
```

Expected: `test_capture_defaults` and `test_task_capture_id_nullable` FAIL with `ImportError: cannot import name 'Capture' from 'app.models'`. The two pre-existing tests still pass.

- [ ] **Step 3: Modify `backend/app/models.py`**

Full new file content:

```python
import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=True)
    google_id = Column(String, unique=True, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")


class Capture(Base):
    __tablename__ = "captures"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    raw_text = Column(String, nullable=False)
    status = Column(String, nullable=False, default="processing")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    capture_id = Column(Integer, ForeignKey("captures.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    priority = Column(Integer, nullable=False, default=3)
    deadline = Column(Date, nullable=True)
    status = Column(String, nullable=False, default="confirmed")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    user = relationship("User", back_populates="tasks")
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_models.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Write the Alembic migration by hand at `backend/alembic/versions/0002_captures.py`**

```python
"""add captures table and tasks.capture_id

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-19
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "captures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("raw_text", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="processing"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_captures_user_id", "captures", ["user_id"])

    op.add_column(
        "tasks",
        sa.Column("capture_id", sa.Integer(), sa.ForeignKey("captures.id"), nullable=True),
    )
    op.create_index("ix_tasks_capture_id", "tasks", ["capture_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_capture_id", table_name="tasks")
    op.drop_column("tasks", "capture_id")
    op.drop_index("ix_captures_user_id", table_name="captures")
    op.drop_table("captures")
```

- [ ] **Step 6: Structurally verify the migration against a throwaway SQLite file**

(If Docker/Postgres is available in your environment, prefer running this against real Postgres instead — see Task 10. This SQLite check is a structural substitute that doesn't validate Postgres-specific FK/server_default behavior.)

```bash
cd backend
source venv/bin/activate
DATABASE_URL=sqlite:////tmp/plan2_migration_check.db JWT_SECRET=x alembic upgrade head
DATABASE_URL=sqlite:////tmp/plan2_migration_check.db JWT_SECRET=x alembic downgrade base
rm -f /tmp/plan2_migration_check.db
```

Expected: both commands complete with no errors (upgrade creates `captures` and adds `tasks.capture_id`; downgrade cleanly reverses both).

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0002_captures.py backend/tests/test_models.py
git commit -m "feat: add Capture model and tasks.capture_id column"
```

---

### Task 2: AI Triage module (Claude integration)

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`
- Create: `backend/app/ai/__init__.py`
- Create: `backend/app/ai/triage.py`
- Create: `backend/tests/test_triage.py`

**Interfaces:**
- Consumes: `app.config.settings`
- Produces: `app.ai.triage.extract_tasks(raw_text: str, today: datetime.date) -> list[ExtractedTask]`; `app.ai.triage.ExtractedTask(title: str, priority: int, deadline: Optional[datetime.date])`; `app.ai.triage.client` (module-level `anthropic.Anthropic` instance — monkeypatch `client.messages.create` in tests); `app.ai.triage.MODEL` (string constant)

- [ ] **Step 1: Add the `anthropic` dependency to `backend/requirements.txt`**

Append this line to the end of the file:

```
anthropic==0.40.0
```

If this exact version is unavailable when installing, run `pip install anthropic` to get the latest and update this line in `requirements.txt` to match what actually installed.

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

Expected: install completes with no errors.

- [ ] **Step 2: Add `anthropic_api_key` to `backend/app/config.py`**

Full new file content:

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    frontend_url: str = "http://localhost:3000"
    anthropic_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
```

- [ ] **Step 3: Add `ANTHROPIC_API_KEY` to `backend/.env.example`**

Full new file content:

```
DATABASE_URL=postgresql://planner:planner@localhost:5432/planner
JWT_SECRET=change-me-to-a-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
FRONTEND_URL=http://localhost:3000
ANTHROPIC_API_KEY=
```

- [ ] **Step 4: Write the failing tests**

`backend/tests/test_triage.py`:

```python
import datetime
from unittest.mock import MagicMock

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
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_triage.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.ai'`.

- [ ] **Step 6: Create `backend/app/ai/__init__.py`** (empty file)

- [ ] **Step 7: Create `backend/app/ai/triage.py`**

```python
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
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd backend
pytest tests/test_triage.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/.env.example \
  backend/app/ai/__init__.py backend/app/ai/triage.py backend/tests/test_triage.py
git commit -m "feat: add Claude-based AI triage module"
```

---

### Task 3: Captures endpoint (`POST /captures`)

**Files:**
- Create: `backend/app/captures/__init__.py`
- Create: `backend/app/captures/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_captures.py`

**Interfaces:**
- Consumes: `app.ai.triage.extract_tasks`, `app.ai.triage.ExtractedTask` (Task 2); `app.models.Capture`, `app.models.Task` (Task 1); `app.security.get_current_user`; `app.schemas.TaskOut`
- Produces: `POST /captures -> List[TaskOut]` (201); router object `app.captures.router.router`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_captures.py`:

```python
from unittest.mock import MagicMock

from app.ai.triage import ExtractedTask
from app.captures import router as captures_router


def _signup_and_get_token(client, email="captureuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_create_capture_creates_draft_tasks(client, monkeypatch):
    monkeypatch.setattr(
        captures_router,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Buy milk", priority=2, deadline=None),
                ExtractedTask(title="Call John", priority=4, deadline=None),
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
    tasks = response.json()
    assert len(tasks) == 2
    assert all(t["status"] == "draft" for t in tasks)
    assert {t["title"] for t in tasks} == {"Buy milk", "Call John"}


def test_create_capture_with_no_tasks_found(client, monkeypatch):
    monkeypatch.setattr(captures_router, "extract_tasks", MagicMock(return_value=[]))
    token = _signup_and_get_token(client)
    response = client.post(
        "/captures",
        json={"raw_text": "hmm just thinking"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    assert response.json() == []


def test_create_capture_handles_claude_failure(client, monkeypatch):
    def _raise(raw_text, today):
        raise RuntimeError("API error")

    monkeypatch.setattr(captures_router, "extract_tasks", _raise)
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_captures.py -v
```

Expected: FAIL — `404 Not Found` for `POST /captures`.

- [ ] **Step 3: Create `backend/app/captures/__init__.py`** (empty file)

- [ ] **Step 4: Create `backend/app/captures/router.py`**

```python
import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.triage import extract_tasks
from app.database import get_db
from app.models import Capture, Task, User
from app.schemas import TaskOut
from app.security import get_current_user

router = APIRouter(prefix="/captures", tags=["captures"])


class CaptureCreate(BaseModel):
    raw_text: str = Field(min_length=1)


@router.post("", response_model=list[TaskOut], status_code=status.HTTP_201_CREATED)
def create_capture(
    payload: CaptureCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    capture = Capture(user_id=current_user.id, raw_text=payload.raw_text, status="processing")
    db.add(capture)
    db.commit()
    db.refresh(capture)

    try:
        extracted = extract_tasks(payload.raw_text, datetime.date.today())
    except Exception:
        capture.status = "failed"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося обробити, спробуйте ще раз",
        )

    capture.status = "complete"
    db.commit()

    tasks = []
    for item in extracted:
        task = Task(
            user_id=current_user.id,
            capture_id=capture.id,
            title=item.title,
            priority=item.priority,
            deadline=item.deadline,
            status="draft",
        )
        db.add(task)
        tasks.append(task)
    db.commit()
    for task in tasks:
        db.refresh(task)
    return tasks
```

- [ ] **Step 5: Register the router in `backend/app/main.py`**

Full new file content:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.auth.router import router as auth_router
from app.captures.router import router as captures_router
from app.config import settings
from app.tasks.router import router as tasks_router

app = FastAPI(title="AI Planner API")

app.add_middleware(SessionMiddleware, secret_key=settings.jwt_secret)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tasks_router)
app.include_router(captures_router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS, including the 4 new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/app/captures/__init__.py backend/app/captures/router.py backend/app/main.py \
  backend/tests/test_captures.py
git commit -m "feat: add POST /captures endpoint for AI triage"
```

---

### Task 4: Tasks endpoints — status filter and `/today`

**Files:**
- Modify: `backend/app/tasks/router.py`
- Modify: `backend/tests/test_tasks.py`

**Interfaces:**
- Consumes: `app.models.Task` (`status` values `draft`/`confirmed`/`done`/`rejected`)
- Produces: `GET /tasks` (now defaults to `confirmed`+`done` only; `?status=X` returns only that status); `GET /tasks/today` (confirmed+done tasks with `deadline <= today`, sorted by priority ascending then deadline ascending)

- [ ] **Step 1: Write the failing tests — append to `backend/tests/test_tasks.py`**

Full new file content:

```python
import datetime

from app.models import Task, User


def _signup_and_get_token(client, email="taskuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_tasks(client):
    token = _signup_and_get_token(client)
    create = client.post(
        "/tasks",
        json={"title": "Write plan", "priority": 1, "deadline": "2026-07-20"},
        headers=_auth_headers(token),
    )
    assert create.status_code == 201
    task = create.json()
    assert task["title"] == "Write plan"
    assert task["priority"] == 1
    assert task["status"] == "confirmed"

    listing = client.get("/tasks", headers=_auth_headers(token))
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_update_task_marks_done(client):
    token = _signup_and_get_token(client)
    create = client.post("/tasks", json={"title": "Finish MVP"}, headers=_auth_headers(token))
    task_id = create.json()["id"]

    update = client.patch(
        f"/tasks/{task_id}", json={"status": "done"}, headers=_auth_headers(token)
    )
    assert update.status_code == 200
    assert update.json()["status"] == "done"


def test_delete_task(client):
    token = _signup_and_get_token(client)
    create = client.post("/tasks", json={"title": "Temporary"}, headers=_auth_headers(token))
    task_id = create.json()["id"]

    delete = client.delete(f"/tasks/{task_id}", headers=_auth_headers(token))
    assert delete.status_code == 204

    listing = client.get("/tasks", headers=_auth_headers(token))
    assert listing.json() == []


def test_cannot_access_another_users_task(client):
    token_a = _signup_and_get_token(client, email="usera@example.com")
    token_b = _signup_and_get_token(client, email="userb@example.com")

    create = client.post("/tasks", json={"title": "Private"}, headers=_auth_headers(token_a))
    task_id = create.json()["id"]

    response = client.patch(
        f"/tasks/{task_id}", json={"status": "done"}, headers=_auth_headers(token_b)
    )
    assert response.status_code == 404


def test_list_tasks_excludes_drafts_and_rejected_by_default(client, db_session):
    token = _signup_and_get_token(client, email="draftowner@example.com")
    user = db_session.query(User).filter(User.email == "draftowner@example.com").first()

    draft = Task(user_id=user.id, title="Draft task", status="draft")
    rejected = Task(user_id=user.id, title="Rejected task", status="rejected")
    db_session.add_all([draft, rejected])
    db_session.commit()

    client.post("/tasks", json={"title": "Confirmed task"}, headers=_auth_headers(token))

    listing = client.get("/tasks", headers=_auth_headers(token))
    titles = [t["title"] for t in listing.json()]
    assert titles == ["Confirmed task"]


def test_list_tasks_with_status_filter_returns_only_that_status(client, db_session):
    token = _signup_and_get_token(client, email="filterowner@example.com")
    user = db_session.query(User).filter(User.email == "filterowner@example.com").first()

    draft = Task(user_id=user.id, title="Draft task", status="draft")
    db_session.add(draft)
    db_session.commit()

    client.post("/tasks", json={"title": "Confirmed task"}, headers=_auth_headers(token))

    listing = client.get("/tasks?status=draft", headers=_auth_headers(token))
    titles = [t["title"] for t in listing.json()]
    assert titles == ["Draft task"]


def test_today_returns_overdue_and_today_sorted_by_priority(client, db_session):
    token = _signup_and_get_token(client, email="todayowner@example.com")
    user = db_session.query(User).filter(User.email == "todayowner@example.com").first()

    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    tomorrow = today + datetime.timedelta(days=1)

    overdue_low = Task(
        user_id=user.id, title="Overdue low", status="confirmed", priority=4, deadline=yesterday
    )
    today_urgent = Task(
        user_id=user.id, title="Today urgent", status="confirmed", priority=1, deadline=today
    )
    future_task = Task(
        user_id=user.id, title="Future task", status="confirmed", priority=1, deadline=tomorrow
    )
    no_deadline_task = Task(user_id=user.id, title="No deadline", status="confirmed")
    draft_task = Task(
        user_id=user.id, title="Draft due today", status="draft", priority=1, deadline=today
    )
    db_session.add_all([overdue_low, today_urgent, future_task, no_deadline_task, draft_task])
    db_session.commit()

    response = client.get("/tasks/today", headers=_auth_headers(token))
    assert response.status_code == 200
    titles = [t["title"] for t in response.json()]
    assert titles == ["Today urgent", "Overdue low"]
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
cd backend
pytest tests/test_tasks.py -v
```

Expected: the 4 pre-existing tests PASS; `test_list_tasks_excludes_drafts_and_rejected_by_default` and `test_list_tasks_with_status_filter_returns_only_that_status` FAIL (currently `GET /tasks` returns every status, un-filtered); `test_today_returns_overdue_and_today_sorted_by_priority` FAILS with 404 (`/tasks/today` doesn't exist yet).

- [ ] **Step 3: Modify `backend/app/tasks/router.py`**

Full new file content:

```python
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, User
from app.schemas import TaskCreate, TaskOut, TaskUpdate
from app.security import get_current_user

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = Task(user_id=current_user.id, **payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=List[TaskOut])
def list_tasks(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Task).filter(Task.user_id == current_user.id)
    if status_filter is not None:
        query = query.filter(Task.status == status_filter)
    else:
        query = query.filter(Task.status.in_(["confirmed", "done"]))
    return query.order_by(Task.created_at.desc()).all()


@router.get("/today", response_model=List[TaskOut])
def list_today_tasks(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    today = datetime.date.today()
    return (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.status.in_(["confirmed", "done"]),
            Task.deadline.isnot(None),
            Task.deadline <= today,
        )
        .order_by(Task.priority.asc(), Task.deadline.asc())
        .all()
    )


def _get_owned_task(task_id: int, current_user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Задачу не знайдено")
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    db.delete(task)
    db.commit()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tasks/router.py backend/tests/test_tasks.py
git commit -m "feat: add status filter and /tasks/today endpoint"
```

---

### Task 5: Translate auth/security error messages to Ukrainian

**Files:**
- Modify: `backend/app/auth/router.py`
- Modify: `backend/app/security.py`
- Modify: `backend/tests/test_auth.py`
- Modify: `backend/tests/test_security.py`

**Interfaces:** no new interfaces — only the `detail` text of existing `HTTPException`s changes.

- [ ] **Step 1: Write the failing assertions — full new `backend/tests/test_auth.py`**

```python
def test_signup_returns_token(client):
    response = client.post(
        "/auth/signup", json={"email": "test@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_signup_duplicate_email_rejected(client):
    client.post(
        "/auth/signup", json={"email": "dup@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/signup", json={"email": "dup@example.com", "password": "password123"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Ця електронна пошта вже зареєстрована"


def test_login_with_correct_password(client):
    client.post(
        "/auth/signup", json={"email": "login@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/login", json={"email": "login@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_with_wrong_password_rejected(client):
    client.post(
        "/auth/signup", json={"email": "wrong@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/login", json={"email": "wrong@example.com", "password": "wrongpass"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Невірний email або пароль"


def test_me_requires_valid_token(client):
    response = client.get("/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Необхідна автентифікація"

    signup = client.post(
        "/auth/signup", json={"email": "me@example.com", "password": "password123"}
    )
    token = signup.json()["access_token"]
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "me@example.com"


def test_me_with_malformed_token_rejected(client):
    response = client.get(
        "/auth/me", headers={"Authorization": "Bearer not-a-real-jwt"}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Недійсний токен"


def test_me_with_token_for_deleted_user_rejected(client, db_session):
    from app.models import User

    signup = client.post(
        "/auth/signup", json={"email": "deleted@example.com", "password": "password123"}
    )
    token = signup.json()["access_token"]

    user = db_session.query(User).filter(User.email == "deleted@example.com").first()
    db_session.delete(user)
    db_session.commit()

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Користувача не знайдено"
```

- [ ] **Step 2: Write the failing assertion — full new `backend/tests/test_security.py`**

```python
import pytest

from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_password():
    hashed = hash_password("password123")
    assert hashed != "password123"
    assert verify_password("password123", hashed) is True
    assert verify_password("wrongpassword", hashed) is False


def test_create_and_decode_access_token():
    token = create_access_token(user_id=42)
    assert decode_access_token(token) == 42


def test_decode_invalid_token_raises():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        decode_access_token("not-a-real-token")
    assert exc_info.value.detail == "Недійсний токен"
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_auth.py tests/test_security.py -v
```

Expected: the new `assert ... == "..."` lines FAIL (current detail text is still English); everything else PASSES.

- [ ] **Step 4: Modify `backend/app/security.py`**

Full new file content:

```python
import datetime

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user_id: int) -> str:
    expire = datetime.datetime.utcnow() + datetime.timedelta(
        minutes=settings.jwt_expire_minutes
    )
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Недійсний токен"
        )
    return int(payload["sub"])


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Необхідна автентифікація"
        )
    user_id = decode_access_token(token)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Користувача не знайдено"
        )
    return user
```

- [ ] **Step 5: Modify `backend/app/auth/router.py`**

Full new file content:

```python
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.google_oauth import oauth
from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import Token, UserCreate, UserLogin, UserOut
from app.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=Token)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ця електронна пошта вже зареєстрована",
        )
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Невірний email або пароль"
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Невірний email або пароль"
        )
    return Token(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/google/login")
async def google_login(request: Request):
    return await oauth.google.authorize_redirect(request, settings.google_redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if userinfo is None:
        userinfo = await oauth.google.parse_id_token(request, token)
    google_id = userinfo["sub"]
    email = userinfo["email"]
    email_verified = userinfo.get("email_verified", False)

    user = db.query(User).filter(User.google_id == google_id).first()
    if user is None:
        email_match = db.query(User).filter(User.email == email).first()
        if email_match is not None and not email_verified:
            return RedirectResponse(
                url=f"{settings.frontend_url}/login?error=email_not_verified"
            )
        user = email_match
    if user is None:
        user = User(email=email, google_id=google_id)
        db.add(user)
    elif user.google_id is None:
        user.google_id = google_id
    db.commit()
    db.refresh(user)

    access_token = create_access_token(user.id)
    return RedirectResponse(url=f"{settings.frontend_url}/auth/callback?token={access_token}")
```

(Only the `detail` strings in `signup` and `login` changed from the previous version — the Google OAuth logic is untouched.)

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/security.py backend/app/auth/router.py backend/tests/test_auth.py \
  backend/tests/test_security.py
git commit -m "feat: translate backend error messages to Ukrainian"
```

---

### Task 6: Frontend — shared nav bar and Ukrainian retranslation of Plan 1 pages

**Files:**
- Create: `frontend/components/nav.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/login/page.tsx`
- Modify: `frontend/app/signup/page.tsx`
- Modify: `frontend/app/tasks/page.tsx`
- Modify: `frontend/app/auth/callback/page.tsx`
- Modify: `frontend/app/page.tsx`

**Interfaces:**
- Consumes: `useAuth()` (existing, from `frontend/lib/auth-context.tsx`)
- Produces: `Nav` component at `frontend/components/nav.tsx`, imported as `import { Nav } from "@/components/nav"` by Tasks (this task) and Capture/Inbox/Today (Tasks 7–9)

- [ ] **Step 1: Create `frontend/components/nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export function Nav() {
  const { logout } = useAuth();

  return (
    <nav>
      <Link href="/today">Сьогодні</Link>
      {" · "}
      <Link href="/tasks">Задачі</Link>
      {" · "}
      <Link href="/capture">Занотувати</Link>
      {" · "}
      <Link href="/inbox">Вхідні</Link>
      {" · "}
      <button onClick={logout}>Вийти</button>
    </nav>
  );
}
```

- [ ] **Step 2: Modify `frontend/app/layout.tsx`** (only the `lang` attribute changes)

Full new file content:

```tsx
import { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";

export const metadata = {
  title: "AI Planner",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Modify `frontend/app/login/page.tsx`**

Full new file content:

```tsx
"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function LoginPageInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося увійти");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Увійти</h1>
      {oauthError === "email_not_verified" && (
        <p>
          Електронна пошта вашого облікового запису Google не підтверджена, тому
          автоматичне прив&apos;язування неможливе. Увійдіть за допомогою email та
          пароля.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p>{error}</p>}
        <button type="submit">Увійти</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Увійти через Google</a>
      <p>
        Немає акаунта? <a href="/signup">Зареєструватися</a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <LoginPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Modify `frontend/app/signup/page.tsx`**

Full new file content:

```tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ access_token: string }>("/auth/signup", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося зареєструватися");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Зареєструватися</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Пароль (мінімум 8 символів)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p>{error}</p>}
        <button type="submit">Зареєструватися</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Зареєструватися через Google</a>
      <p>
        Вже є акаунт? <a href="/login">Увійти</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Modify `frontend/app/tasks/page.tsx`** (translate copy, replace the standalone logout button with `<Nav />`)

Full new file content:

```tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  status: string;
};

export default function TasksPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks").then(setTasks);
    }
  }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const task = await api.post<Task>("/tasks", {
        title,
        priority,
        deadline: deadline || null,
      });
      setTasks([task, ...tasks]);
      setTitle("");
      setDeadline("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося створити задачу");
    }
  }

  async function toggleDone(task: Task) {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        status: task.status === "done" ? "confirmed" : "done",
      });
      setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося оновити задачу");
    }
  }

  async function handleDelete(task: Task) {
    setError(null);
    try {
      await api.delete(`/tasks/${task.id}`);
      setTasks(tasks.filter((t) => t.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося видалити задачу");
    }
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Задачі</h1>
      {error && <p>{error}</p>}
      <form onSubmit={handleCreate}>
        <input
          placeholder="Назва задачі"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={1}>P1 - Терміново</option>
          <option value={2}>P2 - Високий</option>
          <option value={3}>P3 - Середній</option>
          <option value={4}>P4 - Низький</option>
        </select>
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <button type="submit">Додати задачу</button>
      </form>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={() => toggleDone(task)}
            />
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> термін: {task.deadline}</span>}
            <button onClick={() => handleDelete(task)}>Видалити</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 6: Modify `frontend/app/auth/callback/page.tsx`**

Full new file content:

```tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function AuthCallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setToken } = useAuth();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      router.push("/tasks");
    } else {
      router.push("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return <p>Виконується вхід…</p>;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <AuthCallbackInner />
    </Suspense>
  );
}
```

- [ ] **Step 7: Modify `frontend/app/page.tsx`**

Full new file content:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.push(user ? "/tasks" : "/login");
    }
  }, [loading, user, router]);

  return <p>Завантаження…</p>;
}
```

- [ ] **Step 8: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 9: Manually verify in the browser** (requires a running backend — local Docker, or the live VPS deployment via `NEXT_PUBLIC_API_URL`)

1. Visit `/login` → all text is Ukrainian, including the placeholder text and button labels.
2. Log in → land on `/tasks`, see the nav bar with all 4 Ukrainian links plus "Вийти".
3. Click each nav link (`/today`, `/capture`, `/inbox` will 404 until Tasks 7–9 exist — that's expected right now).
4. Click "Вийти" → redirected to `/login`.

- [ ] **Step 10: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/components/nav.tsx frontend/app/layout.tsx frontend/app/login/page.tsx \
  frontend/app/signup/page.tsx frontend/app/tasks/page.tsx frontend/app/auth/callback/page.tsx \
  frontend/app/page.tsx
git commit -m "feat: add shared nav bar and translate Plan 1 pages to Ukrainian"
```

---

### Task 7: Frontend — Capture page

**Files:**
- Create: `frontend/app/capture/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `api.post` (from `frontend/lib/api.ts`), `Nav` (Task 6); backend `POST /captures`
- Produces: `/capture` page

- [ ] **Step 1: Create `frontend/app/capture/page.tsx`**

```tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  status: string;
};

export default function CapturePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const tasks = await api.post<Task[]>("/captures", { raw_text: text });
      if (tasks.length === 0) {
        setResult("Задач не знайдено.");
      } else {
        setResult(`Знайдено ${tasks.length} задач(і) — перевірте їх у Вхідних.`);
      }
      setText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося обробити, спробуйте ще раз");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Занотувати</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          placeholder="Що потрібно зробити?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Обробка…" : "Надіслати"}
        </button>
      </form>
      {error && <p>{error}</p>}
      {result && (
        <p>
          {result} <a href="/inbox">Перейти до Вхідних</a>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, `/capture` listed as a route.

- [ ] **Step 3: Manually verify in the browser** (requires a live backend)

1. Log in, navigate to `/capture`.
2. Type a Ukrainian capture with 2 distinct tasks (e.g. "купити молоко і зателефонувати Івану завтра"), submit.
3. Confirm the "Знайдено N задач(і)" message appears with a link to `/inbox`.
4. Try an empty-of-tasks capture (e.g. just "хм") and confirm "Задач не знайдено." appears instead.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/capture/page.tsx
git commit -m "feat: add capture page"
```

---

### Task 8: Frontend — Inbox page

**Files:**
- Create: `frontend/app/inbox/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `api.get`/`api.patch`, `Nav` (Task 6); backend `GET /tasks?status=draft`, `PATCH /tasks/{id}`
- Produces: `/inbox` page

- [ ] **Step 1: Create `frontend/app/inbox/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  status: string;
};

export default function InboxPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks?status=draft").then(setDrafts);
    }
  }, [user]);

  function updateDraftField(id: number, field: keyof Task, value: string | number) {
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  async function handleApprove(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, {
        title: task.title,
        priority: task.priority,
        deadline: task.deadline || null,
        status: "confirmed",
      });
      setDrafts(drafts.filter((d) => d.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підтвердити задачу");
    }
  }

  async function handleReject(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, { status: "rejected" });
      setDrafts(drafts.filter((d) => d.id !== task.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося відхилити задачу");
    }
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Вхідні</h1>
      {error && <p>{error}</p>}
      {drafts.length === 0 && <p>Немає задач на розгляді.</p>}
      <ul>
        {drafts.map((task) => (
          <li key={task.id}>
            <input
              value={task.title}
              onChange={(e) => updateDraftField(task.id, "title", e.target.value)}
            />
            <select
              value={task.priority}
              onChange={(e) => updateDraftField(task.id, "priority", Number(e.target.value))}
            >
              <option value={1}>P1 - Терміново</option>
              <option value={2}>P2 - Високий</option>
              <option value={3}>P3 - Середній</option>
              <option value={4}>P4 - Низький</option>
            </select>
            <input
              type="date"
              value={task.deadline ?? ""}
              onChange={(e) => updateDraftField(task.id, "deadline", e.target.value)}
            />
            <button onClick={() => handleApprove(task)}>Підтвердити</button>
            <button onClick={() => handleReject(task)}>Відхилити</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, `/inbox` listed as a route.

- [ ] **Step 3: Manually verify in the browser** (requires a live backend)

1. Submit a capture on `/capture` that produces 2+ draft tasks, then go to `/inbox`.
2. Confirm both drafts appear with editable title/priority/deadline.
3. Edit one draft's title and priority, click "Підтвердити" — confirm it disappears from the Inbox.
4. Click "Відхилити" on the other — confirm it also disappears.
5. Go to `/tasks` and confirm the approved one now appears there with your edits; confirm the rejected one does NOT appear anywhere.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/inbox/page.tsx
git commit -m "feat: add inbox page"
```

---

### Task 9: Frontend — Today page

**Files:**
- Create: `frontend/app/today/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `api.get`/`api.patch`, `Nav` (Task 6); backend `GET /tasks/today`, `PATCH /tasks/{id}`
- Produces: `/today` page

- [ ] **Step 1: Create `frontend/app/today/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  status: string;
};

export default function TodayPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks/today").then(setTasks);
    }
  }, [user]);

  async function toggleDone(task: Task) {
    setError(null);
    try {
      const updated = await api.patch<Task>(`/tasks/${task.id}`, {
        status: task.status === "done" ? "confirmed" : "done",
      });
      setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося оновити задачу");
    }
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Сьогодні</h1>
      {error && <p>{error}</p>}
      {tasks.length === 0 && <p>На сьогодні задач немає.</p>}
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={() => toggleDone(task)}
            />
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> термін: {task.deadline}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, `/today` listed as a route.

- [ ] **Step 3: Manually verify in the browser** (requires a live backend)

1. Approve a draft task in the Inbox with today's date as its deadline.
2. Go to `/today` — confirm it appears, sorted correctly relative to any other confirmed tasks with different priorities/deadlines.
3. Check it off — confirm it stays visible (checked) rather than disappearing.
4. Confirm a confirmed task with a future deadline does NOT appear on `/today`, but does appear on `/tasks`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/today/page.tsx
git commit -m "feat: add today page"
```

---

### Task 10: Deploy to the VPS and Vercel

**Files:** none (deployment/config only)

**Interfaces:** none new — this makes Tasks 1–9 live

- [ ] **Step 1: Get an Anthropic API key**

Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key. Copy it.

- [ ] **Step 2: On the VPS, pull the latest code and add the new env var**

```bash
cd ai-planner
git pull
```

Edit `backend/.env` and add:

```
ANTHROPIC_API_KEY=<paste your key>
```

- [ ] **Step 3: Rebuild and restart the backend**

```bash
docker compose up -d --build backend
docker compose logs backend | tail -20
```

Expected: logs show the `0002` Alembic migration running (`Running upgrade 0001 -> 0002, add captures table and tasks.capture_id`) before Uvicorn starts, with no errors.

- [ ] **Step 4: Verify the new endpoints are live**

```bash
curl -s -X POST https://<your-api-domain>/captures -H "Content-Type: application/json" -d '{"raw_text":"test"}'
```

Expected: `{"detail":"Необхідна автентифікація"}` (401 — proves the route exists and is auth-protected; it's expected to reject an unauthenticated request).

- [ ] **Step 5: Confirm Vercel auto-deployed the frontend**

Vercel is already connected to this repo's `main` branch (from Plan 1) and redeploys automatically on every push — no action needed. In the Vercel dashboard, confirm the latest deployment corresponds to this plan's final commit and shows "Ready".

- [ ] **Step 6: End-to-end manual QA on the live site**

1. Visit the live frontend URL — confirm every page (`/login`, `/signup`, `/tasks`, `/today`, `/capture`, `/inbox`) is in Ukrainian.
2. On `/capture`, submit a Ukrainian capture describing 2–3 distinct tasks with different urgency/deadlines (e.g. "терміново подзвонити клієнту сьогодні, і десь наступного тижня прибрати в офісі").
3. Go to `/inbox`, confirm the drafts look reasonable, edit one, approve it and reject another.
4. Go to `/today` — confirm any approved task due today/overdue shows up, sorted with the more urgent one first.
5. Go to `/tasks` — confirm it still shows the full backlog (including future-dated confirmed tasks), and that no draft/rejected tasks leak into either view.
6. Try a capture that clearly contains no task (e.g. "просто нотатка для себе") — confirm "Задач не знайдено." appears and nothing shows up in the Inbox.

Expected: all steps succeed with no errors, entirely in Ukrainian.

---

## Self-Review Notes

- **Spec coverage:** Ukrainian retranslation of Plan 1 pages → Task 6. Capture → Task 7 (+ backend Tasks 2–3). AI Triage (Claude Haiku 4.5, tool-use, language-preserving, date-resolving) → Task 2. Inbox with full inline editing → Task 8 (+ backend filter in Task 4). Today view (deadline ≤ today, sorted by priority) → Task 9 (+ backend in Task 4). Synchronous capture processing → Task 3's `create_capture` has no polling/background job. Backend error messages in Ukrainian → Task 5. Deployment → Task 10. Voice/Calendar/Telegram are explicitly out of scope per the Global Constraints and no task touches them.
- **Type/signature consistency:** `ExtractedTask(title, priority, deadline)` (Task 2) matches exactly what `create_capture` (Task 3) reads off each item. `TaskOut` (unchanged from Plan 1) is what both `POST /captures` and the modified `GET /tasks`/`GET /tasks/today` return, and matches the frontend's local `Task` type (`id, title, priority, deadline, status`) used identically across `tasks/page.tsx`, `capture/page.tsx`, `inbox/page.tsx`, and `today/page.tsx`. The Inbox's approve/reject payloads match `TaskUpdate`'s existing optional fields exactly.
- **No placeholders:** every step has complete file contents or an exact command with expected output; the one inherently environment-specific step (Anthropic API key) is called out with clear instructions, not left as a TBD.
