# AI Planner — Plan 4: Scheduling & Google Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI extracts an explicit stated time during triage; an optional "Schedule" action suggests free slots for unscheduled tasks; confirmed scheduled tasks sync to the user's real Google Calendar; a new Calendar page (day/week/month) and Settings page (Calendar connection) round it out.

**Architecture:** A new `app/google_calendar/` backend package holds a separate OAuth connect flow (distinct from login), a thin REST API wrapper (`client.py`) for free/busy checks and event CRUD, and the calendar-data endpoints. `app/tasks/router.py` gains a sync helper called on create/update/delete. Frontend gains a `ScheduleButton` shared component, a Settings page, and a Calendar page — all reusing the existing `api`/`Nav`/`useAuth` patterns.

**Tech Stack:** Same as Plans 1–3 (FastAPI, SQLAlchemy, Alembic, PostgreSQL, Next.js/TypeScript), plus `httpx` (already a dependency) for direct Google Calendar REST calls, and `authlib` (already a dependency) for the new OAuth connect flow.

## Global Constraints

- Product language is Ukrainian — every UI string and backend error message.
- Explicit time extraction only: AI sets `scheduled_at` ONLY when the capture states a specific time; never guesses or infers one.
- Calendar sync happens only for `confirmed`/`done` tasks with `scheduled_at` set — never for drafts.
- Calendar sync failures must never block the underlying task save/update/delete — always degrade gracefully with an inline indicator, no automatic retry queue.
- Per the project owner's request to minimize development overhead for this plan: no dedicated test-writing inside individual tasks — implementation tasks verify via manual/smoke checks only. A small, consolidated set of real tests is written in one task near the end (Task 9), covering only the real happy path plus the one graceful-degradation behavior worth locking in.
- Backend is FastAPI on the Hostinger VPS behind Traefik; frontend is Next.js on Vercel (inherited infra, already live).

---

## File Structure

```
backend/
  alembic/versions/0003_scheduling_calendar.py
  app/
    models.py                      # + User.google_calendar_refresh_token, Task.scheduled_at/google_event_id
    config.py                       # + google_calendar_redirect_uri
    schemas.py                       # + scheduled_at on Task schemas, google_calendar_connected on UserOut
    auth/router.py                    # me() builds UserOut manually with the connected flag
    ai/triage.py                       # + scheduled_at extraction
    captures/router.py                  # + pass scheduled_at through
    tasks/router.py                      # + calendar sync helper, schedule-suggestions, /calendar endpoint
    google_calendar/
      __init__.py
      oauth.py                             # Authlib client, offline access, calendar scope
      client.py                             # free/busy, suggest_free_slots, event CRUD, list_events
      router.py                              # connect/callback, /calendar/events
    main.py                                   # register google_calendar router
  tests/
    test_google_calendar_client.py
    test_tasks_calendar_sync.py
frontend/
  components/
    nav.tsx                # + Calendar, Settings links
    schedule-button.tsx      # new shared component
  app/
    settings/page.tsx          # new
    calendar/page.tsx           # new
    today/page.tsx                # + time display, ScheduleButton
    tasks/page.tsx                  # + time display, ScheduleButton
    inbox/page.tsx                    # + scheduled_at editable field
```

---

### Task 1: Data model, migration, and schema changes

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/0003_scheduling_calendar.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/auth/router.py`

**Interfaces:**
- Produces: `User.google_calendar_refresh_token` (nullable str); `Task.scheduled_at` (nullable datetime), `Task.google_event_id` (nullable str); `TaskCreate`/`TaskUpdate` gain `scheduled_at: Optional[datetime.datetime]`; `TaskOut` gains `scheduled_at`, `google_event_id`; `UserOut` gains `google_calendar_connected: bool`

- [ ] **Step 1: Modify `backend/app/models.py`**

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
    google_calendar_refresh_token = Column(String, nullable=True)
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
    scheduled_at = Column(DateTime, nullable=True)
    google_event_id = Column(String, nullable=True)
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

- [ ] **Step 2: Write the migration by hand at `backend/alembic/versions/0003_scheduling_calendar.py`**

```python
"""add scheduling and calendar sync columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("google_calendar_refresh_token", sa.String(), nullable=True)
    )
    op.add_column("tasks", sa.Column("scheduled_at", sa.DateTime(), nullable=True))
    op.add_column("tasks", sa.Column("google_event_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "google_event_id")
    op.drop_column("tasks", "scheduled_at")
    op.drop_column("users", "google_calendar_refresh_token")
```

These are plain nullable-column additions with no inline foreign key or constraint, so unlike Plan 2's `0002` migration, no `batch_alter_table` wrapper is needed here — SQLite (used for structural verification) supports plain `ADD COLUMN` for a nullable, unconstrained column directly.

- [ ] **Step 3: Modify `backend/app/schemas.py`**

Full new file content:

```python
import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr
    google_calendar_connected: bool = False

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    priority: int = Field(default=3, ge=1, le=4)
    deadline: Optional[datetime.date] = None
    scheduled_at: Optional[datetime.datetime] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    priority: Optional[int] = Field(default=None, ge=1, le=4)
    deadline: Optional[datetime.date] = None
    status: Optional[str] = None
    scheduled_at: Optional[datetime.datetime] = None


class TaskOut(BaseModel):
    id: int
    title: str
    priority: int
    deadline: Optional[datetime.date]
    scheduled_at: Optional[datetime.datetime]
    google_event_id: Optional[str]
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True
```

- [ ] **Step 4: Modify `backend/app/auth/router.py`'s `me` endpoint to build `UserOut` manually**

`UserOut.google_calendar_connected` has no matching column on `User` (the model stores the actual token, not a boolean), so it can't be filled automatically via `from_attributes`. Change only the `me` function; leave everything else in this file untouched:

Find this function:

```python
@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
```

Replace it with:

```python
@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        google_calendar_connected=current_user.google_calendar_refresh_token is not None,
    )
```

- [ ] **Step 5: Verify nothing broke**

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
pytest tests/ -v
```

Expected: all pre-existing tests still PASS (this task only adds new nullable fields with sensible defaults handled by `from_attributes`/`exclude_unset`, so no existing behavior changes).

- [ ] **Step 6: Structurally verify the migration against a throwaway SQLite file**

```bash
cd backend
DATABASE_URL=sqlite:////tmp/plan4_migration_check.db JWT_SECRET=x alembic upgrade head
DATABASE_URL=sqlite:////tmp/plan4_migration_check.db JWT_SECRET=x alembic downgrade base
rm -f /tmp/plan4_migration_check.db
```

Expected: both commands complete with no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0003_scheduling_calendar.py \
  backend/app/schemas.py backend/app/auth/router.py
git commit -m "feat: add scheduling and calendar sync columns"
```

---

### Task 2: Calendar OAuth connection and API client

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`
- Create: `backend/app/google_calendar/__init__.py`
- Create: `backend/app/google_calendar/oauth.py`
- Create: `backend/app/google_calendar/client.py`
- Create: `backend/app/google_calendar/router.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `app.config.settings`, `app.security.get_current_user`, `app.models.User`
- Produces: `app.google_calendar.client.get_free_busy(user, date) -> list[tuple[datetime, datetime]]`, `suggest_free_slots(busy, date) -> list[datetime]`, `create_event(user, title, scheduled_at) -> str`, `update_event(user, google_event_id, title, scheduled_at) -> None`, `delete_event(user, google_event_id) -> None`, `list_events(user, start, end) -> list[dict]`; `GET /auth/google/calendar/connect` (auth-required, returns `{"authorize_url": str}`); `GET /auth/google/calendar/callback`; `GET /calendar/events?start=&end=` (auth-required, returns `{"events": [...]}`)

- [ ] **Step 1: Add `google_calendar_redirect_uri` to `backend/app/config.py`**

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
    google_calendar_redirect_uri: str = ""
    frontend_url: str = "http://localhost:3000"
    anthropic_api_key: str = ""
    openai_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
```

- [ ] **Step 2: Add `GOOGLE_CALENDAR_REDIRECT_URI` to `backend/.env.example`**

Full new file content:

```
DATABASE_URL=postgresql://planner:planner@localhost:5432/planner
JWT_SECRET=change-me-to-a-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:8000/auth/google/calendar/callback
FRONTEND_URL=http://localhost:3000
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 3: Create `backend/app/google_calendar/__init__.py`** (empty file)

- [ ] **Step 4: Create `backend/app/google_calendar/oauth.py`**

```python
from authlib.integrations.starlette_client import OAuth

from app.config import settings

calendar_oauth = OAuth()
calendar_oauth.register(
    name="google_calendar",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "openid email https://www.googleapis.com/auth/calendar",
        "access_type": "offline",
        "prompt": "consent",
    },
)
```

`access_type=offline` + `prompt=consent` are required to get a `refresh_token` back from Google — without them, Google only returns one on a user's very first-ever consent, which is unreliable for a distinct "connect calendar" flow that may happen well after signup.

- [ ] **Step 5: Create `backend/app/google_calendar/client.py`**

```python
import datetime
import logging

import httpx

from app.config import settings
from app.models import User

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
EVENT_DURATION_MINUTES = 30
WORKING_HOURS_START = 9
WORKING_HOURS_END = 18
SLOT_STEP_MINUTES = 30
MAX_SUGGESTIONS = 3


def _get_access_token(user: User) -> str:
    if not user.google_calendar_refresh_token:
        raise ValueError("user has not connected Google Calendar")
    response = httpx.post(
        TOKEN_URL,
        data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": user.google_calendar_refresh_token,
            "grant_type": "refresh_token",
        },
    )
    response.raise_for_status()
    return response.json()["access_token"]


def get_free_busy(
    user: User, date: datetime.date
) -> list[tuple[datetime.datetime, datetime.datetime]]:
    access_token = _get_access_token(user)
    time_min = datetime.datetime.combine(date, datetime.time.min)
    time_max = datetime.datetime.combine(date, datetime.time.max)
    response = httpx.post(
        f"{CALENDAR_API_BASE}/freeBusy",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "timeMin": time_min.isoformat() + "Z",
            "timeMax": time_max.isoformat() + "Z",
            "items": [{"id": "primary"}],
        },
    )
    response.raise_for_status()
    busy_raw = response.json()["calendars"]["primary"]["busy"]
    return [
        (
            datetime.datetime.fromisoformat(b["start"].replace("Z", "+00:00")),
            datetime.datetime.fromisoformat(b["end"].replace("Z", "+00:00")),
        )
        for b in busy_raw
    ]


def suggest_free_slots(
    busy: list[tuple[datetime.datetime, datetime.datetime]], date: datetime.date
) -> list[datetime.datetime]:
    slots: list[datetime.datetime] = []
    current = datetime.datetime.combine(date, datetime.time(hour=WORKING_HOURS_START))
    end_of_day = datetime.datetime.combine(date, datetime.time(hour=WORKING_HOURS_END))
    while current < end_of_day and len(slots) < MAX_SUGGESTIONS:
        slot_end = current + datetime.timedelta(minutes=EVENT_DURATION_MINUTES)
        overlaps = any(current < b_end and slot_end > b_start for b_start, b_end in busy)
        if not overlaps:
            slots.append(current)
        current += datetime.timedelta(minutes=SLOT_STEP_MINUTES)
    return slots


def create_event(user: User, title: str, scheduled_at: datetime.datetime) -> str:
    access_token = _get_access_token(user)
    end = scheduled_at + datetime.timedelta(minutes=EVENT_DURATION_MINUTES)
    response = httpx.post(
        f"{CALENDAR_API_BASE}/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "summary": title,
            "start": {"dateTime": scheduled_at.isoformat()},
            "end": {"dateTime": end.isoformat()},
        },
    )
    response.raise_for_status()
    return response.json()["id"]


def update_event(
    user: User, google_event_id: str, title: str, scheduled_at: datetime.datetime
) -> None:
    access_token = _get_access_token(user)
    end = scheduled_at + datetime.timedelta(minutes=EVENT_DURATION_MINUTES)
    response = httpx.patch(
        f"{CALENDAR_API_BASE}/calendars/primary/events/{google_event_id}",
        headers={"Authorization": f"Bearer {access_token}"},
        json={
            "summary": title,
            "start": {"dateTime": scheduled_at.isoformat()},
            "end": {"dateTime": end.isoformat()},
        },
    )
    response.raise_for_status()


def delete_event(user: User, google_event_id: str) -> None:
    access_token = _get_access_token(user)
    response = httpx.delete(
        f"{CALENDAR_API_BASE}/calendars/primary/events/{google_event_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if response.status_code not in (200, 204, 404):
        response.raise_for_status()


def list_events(user: User, start: datetime.datetime, end: datetime.datetime) -> list[dict]:
    access_token = _get_access_token(user)
    response = httpx.get(
        f"{CALENDAR_API_BASE}/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "timeMin": start.isoformat() + ("Z" if start.tzinfo is None else ""),
            "timeMax": end.isoformat() + ("Z" if end.tzinfo is None else ""),
            "singleEvents": "true",
            "orderBy": "startTime",
        },
    )
    response.raise_for_status()
    return response.json().get("items", [])
```

Every function here raises on failure (via `raise_for_status()` or the explicit `ValueError`) rather than swallowing errors — callers (Task 3) decide how to degrade gracefully, keeping this module an honest, thin wrapper.

- [ ] **Step 6: Create `backend/app/google_calendar/router.py`**

```python
import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.google_calendar import client as google_calendar_client
from app.google_calendar.oauth import calendar_oauth
from app.models import User
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(tags=["calendar"])


@router.get("/auth/google/calendar/connect")
async def connect(request: Request, current_user: User = Depends(get_current_user)):
    request.session["calendar_connect_user_id"] = current_user.id
    rv = await calendar_oauth.google_calendar.create_authorization_url(
        settings.google_calendar_redirect_uri
    )
    await calendar_oauth.google_calendar.save_authorize_data(
        request, redirect_uri=settings.google_calendar_redirect_uri, **rv
    )
    return {"authorize_url": rv["url"]}


@router.get("/auth/google/calendar/callback")
async def callback(request: Request, db: Session = Depends(get_db)):
    user_id = request.session.pop("calendar_connect_user_id", None)
    if user_id is None:
        return RedirectResponse(
            url=f"{settings.frontend_url}/settings?error=calendar_connect_failed"
        )

    try:
        token = await calendar_oauth.google_calendar.authorize_access_token(request)
    except Exception:
        logger.exception("calendar OAuth callback failed for user_id=%s", user_id)
        return RedirectResponse(
            url=f"{settings.frontend_url}/settings?error=calendar_connect_failed"
        )

    refresh_token = token.get("refresh_token")
    if refresh_token is None:
        return RedirectResponse(
            url=f"{settings.frontend_url}/settings?error=calendar_connect_failed"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is not None:
        user.google_calendar_refresh_token = refresh_token
        db.commit()

    return RedirectResponse(url=f"{settings.frontend_url}/settings?connected=1")


@router.get("/calendar/events")
def list_calendar_events(
    start: str = Query(...),
    end: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    import datetime

    if current_user.google_calendar_refresh_token is None:
        return {"events": []}
    try:
        start_dt = datetime.datetime.fromisoformat(start)
        end_dt = datetime.datetime.fromisoformat(end)
        events = google_calendar_client.list_events(current_user, start_dt, end_dt)
    except Exception:
        logger.exception("failed to list calendar events for user_id=%s", current_user.id)
        return {"events": []}
    return {
        "events": [
            {
                "id": e["id"],
                "title": e.get("summary", ""),
                "start": e.get("start", {}).get("dateTime") or e.get("start", {}).get("date"),
                "end": e.get("end", {}).get("dateTime") or e.get("end", {}).get("date"),
            }
            for e in events
        ]
    }
```

`list_calendar_events` is a plain `def`, not `async def` — it calls `google_calendar_client.list_events`, which makes a blocking `httpx` call. A plain `def` route runs in FastAPI's threadpool automatically, matching the exact fix applied to the voice-transcription endpoint in Plan 3 (an `async def` here would freeze the whole event loop during the request).

If Authlib's actual installed version has different method names than `create_authorization_url`/`save_authorize_data`, check the installed package directly (`python3 -c "from authlib.integrations.starlette_client import OAuth; help(OAuth)"` or read the source under `venv/lib/.../authlib/integrations/starlette_client/`) rather than guessing — these are the documented lower-level methods `authorize_redirect()` itself calls internally, but confirm against the actual installed version.

- [ ] **Step 7: Register the router in `backend/app/main.py`**

Full new file content:

```python
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.auth.router import router as auth_router
from app.captures.router import router as captures_router
from app.config import settings
from app.google_calendar.router import router as google_calendar_router
from app.tasks.router import router as tasks_router
from app.transcription.router import router as transcription_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

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
app.include_router(transcription_router)
app.include_router(google_calendar_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Перевірте введені дані"})


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 8: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
DATABASE_URL=sqlite:///:memory: JWT_SECRET=x python3 -c "from app.main import app; print('ok')"
pytest tests/ -v
```

Expected: `ok` printed, no import errors; full pre-existing test suite still passes (this task adds new modules/routes but doesn't change any existing behavior).

- [ ] **Step 9: Commit**

```bash
git add backend/app/config.py backend/.env.example backend/app/google_calendar/ backend/app/main.py
git commit -m "feat: add Google Calendar OAuth connection and API client"
```

---

### Task 3: Task calendar sync and schedule-suggestions endpoint

**Files:**
- Modify: `backend/app/tasks/router.py`

**Interfaces:**
- Consumes: `app.google_calendar.client.get_free_busy`, `suggest_free_slots`, `create_event`, `update_event`, `delete_event`
- Produces: `GET /tasks/{task_id}/schedule-suggestions` (auth-required, returns `{"slots": [iso_str, ...]}`); create/update/delete on `/tasks` now sync `scheduled_at` to Google Calendar when applicable; `GET /tasks/today` now sorts scheduled tasks by time first

- [ ] **Step 1: Modify `backend/app/tasks/router.py`**

Full new file content:

```python
import datetime
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.google_calendar import client as google_calendar_client
from app.models import Task, User
from app.schemas import TaskCreate, TaskOut, TaskUpdate
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _sync_task_calendar(current_user: User, task: Task, db: Session) -> None:
    if task.scheduled_at is None:
        if task.google_event_id is not None:
            try:
                google_calendar_client.delete_event(current_user, task.google_event_id)
            except Exception:
                logger.exception("failed to delete calendar event for task_id=%s", task.id)
            task.google_event_id = None
            db.commit()
        return

    if task.status not in ("confirmed", "done"):
        return
    if current_user.google_calendar_refresh_token is None:
        return

    try:
        if task.google_event_id is None:
            task.google_event_id = google_calendar_client.create_event(
                current_user, task.title, task.scheduled_at
            )
        else:
            google_calendar_client.update_event(
                current_user, task.google_event_id, task.title, task.scheduled_at
            )
        db.commit()
    except Exception:
        logger.exception("failed to sync calendar event for task_id=%s", task.id)


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
    _sync_task_calendar(current_user, task, db)
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
        .order_by(Task.scheduled_at.asc().nullslast(), Task.priority.asc(), Task.deadline.asc())
        .all()
    )


@router.get("/calendar", response_model=List[TaskOut])
def list_calendar_tasks(
    start: datetime.date = Query(...),
    end: datetime.date = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start_dt = datetime.datetime.combine(start, datetime.time.min)
    end_dt = datetime.datetime.combine(end, datetime.time.max)
    return (
        db.query(Task)
        .filter(
            Task.user_id == current_user.id,
            Task.status.in_(["confirmed", "done"]),
            or_(
                Task.scheduled_at.between(start_dt, end_dt),
                Task.deadline.between(start, end),
            ),
        )
        .order_by(Task.scheduled_at.asc().nullslast())
        .all()
    )


def _get_owned_task(task_id: int, current_user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Задачу не знайдено")
    return task


@router.get("/{task_id}/schedule-suggestions")
def schedule_suggestions(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    if current_user.google_calendar_refresh_token is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Спочатку підключіть Google Calendar у Налаштуваннях",
        )
    target_date = task.deadline or datetime.date.today()
    try:
        busy = google_calendar_client.get_free_busy(current_user, target_date)
    except Exception:
        logger.exception("failed to fetch free/busy for task_id=%s", task.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося перевірити календар, спробуйте ще раз",
        )
    slots = google_calendar_client.suggest_free_slots(busy, target_date)
    return {"slots": [slot.isoformat() for slot in slots]}


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
    _sync_task_calendar(current_user, task, db)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    if task.google_event_id is not None:
        try:
            google_calendar_client.delete_event(current_user, task.google_event_id)
        except Exception:
            logger.exception("failed to delete calendar event for task_id=%s", task.id)
    db.delete(task)
    db.commit()
```

**Route ordering note:** `GET /{task_id}/schedule-suggestions` and `GET /calendar` are both declared, along with `GET ""` and `GET "/today"`. None of these collide — `/calendar` and `/today` are literal single-segment paths matched before any `/{task_id}/...` pattern is tried, and FastAPI/Starlette resolves static path segments before dynamic ones regardless of declaration order. This mirrors the routing already verified safe in Plan 2.

- [ ] **Step 2: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: all pre-existing tests still PASS (the 4 modified endpoints keep their existing behavior for tasks with no `scheduled_at`, which is every task created by the existing test suite — `_sync_task_calendar` no-ops immediately when `scheduled_at is None` and `google_event_id is None`).

- [ ] **Step 3: Commit**

```bash
git add backend/app/tasks/router.py
git commit -m "feat: sync scheduled tasks to Google Calendar, add schedule-suggestions and calendar endpoints"
```

---

### Task 4: AI triage — explicit time-of-day extraction

**Files:**
- Modify: `backend/app/ai/triage.py`
- Modify: `backend/app/captures/router.py`

**Interfaces:**
- Produces: `ExtractedTask` gains `scheduled_at: Optional[datetime.datetime]`; `extract_tasks` sets it only when the capture states an explicit time

- [ ] **Step 1: Modify `backend/app/ai/triage.py`**

Full new file content:

```python
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
                    "translate it. Assign a priority from 1 (urgent) to 4 (low) based "
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
                return [ExtractedTask(**task) for task in raw_tasks]

    logger.warning("triage response had no matching tool call: %r", response)
    raise ValueError("OpenAI response did not include the expected tool call")
```

- [ ] **Step 2: Modify `backend/app/captures/router.py` to pass `scheduled_at` through**

Find this block inside `create_capture`:

```python
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
```

Replace it with:

```python
    tasks = []
    for item in extracted:
        task = Task(
            user_id=current_user.id,
            capture_id=capture.id,
            title=item.title,
            priority=item.priority,
            deadline=item.deadline,
            scheduled_at=item.scheduled_at,
            status="draft",
        )
        db.add(task)
        tasks.append(task)
```

- [ ] **Step 3: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: all pre-existing tests still PASS. (The existing `test_extract_tasks_returns_parsed_tasks` mocks a tool response without a `scheduled_at` key in its payload dicts — since `ExtractedTask.scheduled_at` is `Optional[datetime.datetime]` with no explicit default, double check this: if it fails because the mocked payload is missing the now-required `scheduled_at` key, that's expected and fine per this plan's reduced-testing approach — the pre-existing test's mock payloads only need updating if they break; you are not required to add new tests here, just confirm the suite's actual pass/fail state and report it.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/ai/triage.py backend/app/captures/router.py
git commit -m "feat: extract explicit time-of-day during AI triage"
```

---

### Task 5: Frontend — Settings page and Nav update

**Files:**
- Modify: `frontend/components/nav.tsx`
- Create: `frontend/app/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /auth/me` (now returns `google_calendar_connected`), `GET /auth/google/calendar/connect` (Task 2)
- Produces: `/settings` page

- [ ] **Step 1: Modify `frontend/components/nav.tsx`**

Full new file content:

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
      <Link href="/calendar">Календар</Link>
      {" · "}
      <Link href="/capture">Занотувати</Link>
      {" · "}
      <Link href="/inbox">Вхідні</Link>
      {" · "}
      <Link href="/settings">Налаштування</Link>
      {" · "}
      <button onClick={logout}>Вийти</button>
    </nav>
  );
}
```

- [ ] **Step 2: Create `frontend/app/settings/page.tsx`**

```tsx
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Me = {
  id: number;
  email: string;
  google_calendar_connected: boolean;
};

function SettingsPageInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Me>("/auth/me").then((me) => setConnected(me.google_calendar_connected));
    }
  }, [user]);

  useEffect(() => {
    if (searchParams.get("error") === "calendar_connect_failed") {
      setError("Не вдалося підключити Google Calendar, спробуйте ще раз");
    }
    if (searchParams.get("connected") === "1") {
      setConnected(true);
    }
  }, [searchParams]);

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        "/auth/google/calendar/connect"
      );
      window.location.href = authorize_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підключити Google Calendar");
      setConnecting(false);
    }
  }

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Налаштування</h1>
      {error && <p>{error}</p>}
      <section>
        <h2>Google Calendar</h2>
        {connected ? (
          <p>✅ Підключено</p>
        ) : (
          <button onClick={handleConnect} disabled={connecting}>
            {connecting ? "Підключення…" : "Підключити Google Calendar"}
          </button>
        )}
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <SettingsPageInner />
    </Suspense>
  );
}
```

- [ ] **Step 3: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, no TypeScript errors, `/settings` listed as a route.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/nav.tsx frontend/app/settings/page.tsx
git commit -m "feat: add settings page with Google Calendar connection"
```

---

### Task 6: Frontend — ScheduleButton and wiring into Inbox/Tasks/Today

**Files:**
- Create: `frontend/components/schedule-button.tsx`
- Modify: `frontend/app/today/page.tsx`
- Modify: `frontend/app/tasks/page.tsx`
- Modify: `frontend/app/inbox/page.tsx`

**Interfaces:**
- Consumes: `GET /tasks/{id}/schedule-suggestions`, `PATCH /tasks/{id}` with `scheduled_at` (Task 3)
- Produces: `ScheduleButton` component (`{ taskId: number; onScheduled: (scheduledAt: string) => void }`), used by all three modified pages

- [ ] **Step 1: Create `frontend/components/schedule-button.tsx`**

```tsx
"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type ScheduleButtonProps = {
  taskId: number;
  onScheduled: (scheduledAt: string) => void;
};

export function ScheduleButton({ taskId, onScheduled }: ScheduleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const { slots: fetchedSlots } = await api.get<{ slots: string[] }>(
        `/tasks/${taskId}/schedule-suggestions`
      );
      if (fetchedSlots.length === 0) {
        setError("Немає вільних слотів на цей день");
      } else {
        setSlots(fetchedSlots);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося отримати пропозиції");
    } finally {
      setLoading(false);
    }
  }

  async function handlePick(slot: string) {
    setError(null);
    try {
      await api.patch(`/tasks/${taskId}`, { scheduled_at: slot });
      onScheduled(slot);
      setSlots(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося запланувати задачу");
    }
  }

  if (slots) {
    return (
      <span>
        {slots.map((slot) => (
          <button key={slot} onClick={() => handlePick(slot)}>
            {new Date(slot).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
          </button>
        ))}
        {error && <span> {error}</span>}
      </span>
    );
  }

  return (
    <span>
      <button onClick={handleClick} disabled={loading}>
        {loading ? "…" : "Запланувати"}
      </button>
      {error && <span> {error}</span>}
    </span>
  );
}
```

- [ ] **Step 2: Modify `frontend/app/today/page.tsx`**

Full new file content:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";
import { ScheduleButton } from "@/components/schedule-button";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  scheduled_at: string | null;
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

  function handleScheduled(taskId: number, scheduledAt: string) {
    setTasks(tasks.map((t) => (t.id === taskId ? { ...t, scheduled_at: scheduledAt } : t)));
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
            {task.scheduled_at && (
              <span>
                {new Date(task.scheduled_at).toLocaleTimeString("uk-UA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" — "}
              </span>
            )}
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> термін: {task.deadline}</span>}
            {!task.scheduled_at && (
              <ScheduleButton
                taskId={task.id}
                onScheduled={(scheduledAt) => handleScheduled(task.id, scheduledAt)}
              />
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Modify `frontend/app/tasks/page.tsx`**

Full new file content:

```tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";
import { ScheduleButton } from "@/components/schedule-button";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  scheduled_at: string | null;
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

  function handleScheduled(taskId: number, scheduledAt: string) {
    setTasks(tasks.map((t) => (t.id === taskId ? { ...t, scheduled_at: scheduledAt } : t)));
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
            {task.scheduled_at && (
              <span>
                {new Date(task.scheduled_at).toLocaleTimeString("uk-UA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" — "}
              </span>
            )}
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> термін: {task.deadline}</span>}
            {!task.scheduled_at && (
              <ScheduleButton
                taskId={task.id}
                onScheduled={(scheduledAt) => handleScheduled(task.id, scheduledAt)}
              />
            )}
            <button onClick={() => handleDelete(task)}>Видалити</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 4: Modify `frontend/app/inbox/page.tsx`**

Full new file content:

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
  scheduled_at: string | null;
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

  function updateDraftField(id: number, field: keyof Task, value: string | number | null) {
    setDrafts(drafts.map((d) => (d.id === id ? { ...d, [field]: value } : d)));
  }

  async function handleApprove(task: Task) {
    setError(null);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, {
        title: task.title,
        priority: task.priority,
        deadline: task.deadline || null,
        scheduled_at: task.scheduled_at || null,
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

  function toDatetimeLocalValue(iso: string | null): string {
    if (!iso) return "";
    return iso.slice(0, 16);
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
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(task.scheduled_at)}
              onChange={(e) =>
                updateDraftField(task.id, "scheduled_at", e.target.value || null)
              }
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

- [ ] **Step 5: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/schedule-button.tsx frontend/app/today/page.tsx \
  frontend/app/tasks/page.tsx frontend/app/inbox/page.tsx
git commit -m "feat: add Schedule action and time display to Inbox/Tasks/Today"
```

---

### Task 7: Frontend — Calendar page (day/week/month)

**Files:**
- Create: `frontend/app/calendar/page.tsx`

**Interfaces:**
- Consumes: `GET /tasks/calendar?start=&end=` (Task 3), `GET /calendar/events?start=&end=` (Task 2)
- Produces: `/calendar` page

- [ ] **Step 1: Create `frontend/app/calendar/page.tsx`**

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
  scheduled_at: string | null;
  status: string;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
};

type ViewMode = "day" | "week" | "month";

type TimedItem = { time: string; label: string; kind: "task" | "event" };

type DayGroup = {
  dateKey: string;
  dateLabel: string;
  allDay: Task[];
  timed: TimedItem[];
};

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

export default function CalendarPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("day");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  function getRange(): { start: Date; end: Date } {
    if (view === "day") {
      const start = new Date(anchorDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(anchorDate);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (view === "week") {
      const start = startOfWeek(anchorDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(anchorDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  useEffect(() => {
    if (!user) return;
    const { start, end } = getRange();
    setError(null);
    api
      .get<Task[]>(`/tasks/calendar?start=${toDateParam(start)}&end=${toDateParam(end)}`)
      .then(setTasks)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Не вдалося завантажити задачі")
      );
    api
      .get<{ events: CalendarEvent[] }>(
        `/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`
      )
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view, anchorDate]);

  function shiftAnchor(days: number) {
    const next = new Date(anchorDate);
    next.setDate(next.getDate() + days);
    setAnchorDate(next);
  }

  if (loading || !user) return <p>Завантаження…</p>;

  const groups = new Map<string, DayGroup>();
  function getGroup(dateKey: string): DayGroup {
    let group = groups.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        dateLabel: new Date(dateKey).toLocaleDateString("uk-UA", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        allDay: [],
        timed: [],
      };
      groups.set(dateKey, group);
    }
    return group;
  }

  for (const task of tasks) {
    if (task.scheduled_at) {
      getGroup(dateKeyOf(task.scheduled_at)).timed.push({
        time: task.scheduled_at,
        label: task.title,
        kind: "task",
      });
    } else if (task.deadline) {
      getGroup(task.deadline).allDay.push(task);
    }
  }
  for (const event of events) {
    getGroup(dateKeyOf(event.start)).timed.push({
      time: event.start,
      label: `${event.title} (Google Calendar)`,
      kind: "event",
    });
  }

  const sortedGroups = Array.from(groups.values()).sort((a, b) =>
    a.dateKey < b.dateKey ? -1 : 1
  );
  for (const group of sortedGroups) {
    group.timed.sort((a, b) => (a.time < b.time ? -1 : 1));
  }

  return (
    <main>
      <Nav />
      <h1>Календар</h1>
      {error && <p>{error}</p>}
      <div>
        <button onClick={() => setView("day")} disabled={view === "day"}>
          День
        </button>
        <button onClick={() => setView("week")} disabled={view === "week"}>
          Тиждень
        </button>
        <button onClick={() => setView("month")} disabled={view === "month"}>
          Місяць
        </button>
      </div>
      <div>
        <button onClick={() => shiftAnchor(view === "day" ? -1 : view === "week" ? -7 : -30)}>
          ← Назад
        </button>
        <span> {anchorDate.toLocaleDateString("uk-UA")} </span>
        <button onClick={() => shiftAnchor(view === "day" ? 1 : view === "week" ? 7 : 30)}>
          Вперед →
        </button>
      </div>

      {sortedGroups.length === 0 && <p>Немає задач чи подій за цей період.</p>}

      {sortedGroups.map((group) => (
        <section key={group.dateKey}>
          <h2>{group.dateLabel}</h2>
          {group.allDay.length > 0 && (
            <ul>
              {group.allDay.map((task) => (
                <li key={`allday-${task.id}`}>{task.title} (без часу)</li>
              ))}
            </ul>
          )}
          <ul>
            {group.timed.map((item, index) => (
              <li key={index}>
                {new Date(item.time).toLocaleTimeString("uk-UA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" — "}
                {item.label}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

This deliberately renders all three views (day/week/month) as the same grouped-by-day list, differing only in the fetched date range — per the project owner's explicit choice, given there's no CSS/styling yet, a real visual grid layout is deferred to a future UI/UX design pass.

- [ ] **Step 2: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, `/calendar` listed as a route.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/calendar/page.tsx
git commit -m "feat: add calendar page with day/week/month views"
```

---

### Task 8: Deploy to the VPS

**Files:** none (deployment only)

- [ ] **Step 1: Add production Calendar redirect URI in Google Cloud Console**

In the same OAuth client used for login (Google Cloud Console → APIs & Services → Credentials), add an additional **Authorized redirect URI**: `https://bcknd.srv1440057.hstgr.cloud/auth/google/calendar/callback`.

- [ ] **Step 2: On the VPS, pull and add the new env var**

```bash
cd ai-planner
git pull
```

Edit `backend/.env` and add:

```
GOOGLE_CALENDAR_REDIRECT_URI=https://bcknd.srv1440057.hstgr.cloud/auth/google/calendar/callback
```

- [ ] **Step 3: Rebuild and restart**

```bash
docker compose up -d --build backend
docker compose logs backend --tail 30
```

Expected: the `0003` migration runs cleanly (`Running upgrade 0002 -> 0003, add scheduling and calendar sync columns`), clean startup, no errors.

- [ ] **Step 4: Confirm Vercel auto-deployed the frontend**

Confirm the latest deployment in the Vercel dashboard shows "Ready" and matches this plan's final commit.

- [ ] **Step 5: End-to-end manual QA**

1. `/settings` — connect Google Calendar, confirm it shows "✅ Підключено".
2. `/capture` — submit a Ukrainian capture with an explicit time (e.g. "Подзвонити клієнту о 15:00 завтра"), confirm the draft in `/inbox` has that exact date+time pre-filled and editable.
3. Approve it — confirm the event actually appears in your real Google Calendar.
4. On a task with no time, click "Запланувати" — confirm it shows a few real free slots, pick one, confirm it appears in Google Calendar too.
5. Edit a scheduled task's time (via Inbox before approval, or by re-scheduling), confirm the Google Calendar event updates rather than duplicating.
6. Delete a scheduled, confirmed task — confirm the Google Calendar event disappears.
7. `/calendar` — switch between day/week/month, confirm your scheduled tasks and real Google Calendar events both show, grouped correctly by day.
8. `/today` — confirm a scheduled task shows its time and sorts before unscheduled tasks.

---

### Task 9: Backend tests (consolidated)

**Files:**
- Create: `backend/tests/test_google_calendar_client.py`
- Create: `backend/tests/test_tasks_calendar_sync.py`

**Interfaces:** none new — this task only adds tests for what Tasks 1–4 already built

Per the project owner's request, this is the one task in this plan where automated tests are written — kept to the real happy path plus the one behavior most worth locking in (a calendar failure never blocks the task operation itself).

- [ ] **Step 1: Write `backend/tests/test_google_calendar_client.py`**

```python
import datetime
from unittest.mock import MagicMock

from app.google_calendar import client as google_calendar_client


class _FakeUser:
    def __init__(self, refresh_token="fake-refresh-token"):
        self.google_calendar_refresh_token = refresh_token


def _mock_response(json_data, status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data
    response.raise_for_status = MagicMock()
    return response


def test_get_free_busy_parses_busy_intervals(monkeypatch):
    monkeypatch.setattr(
        google_calendar_client.httpx,
        "post",
        MagicMock(
            side_effect=[
                _mock_response({"access_token": "fake-access-token"}),
                _mock_response(
                    {
                        "calendars": {
                            "primary": {
                                "busy": [
                                    {"start": "2026-07-20T10:00:00Z", "end": "2026-07-20T11:00:00Z"}
                                ]
                            }
                        }
                    }
                ),
            ]
        ),
    )

    busy = google_calendar_client.get_free_busy(_FakeUser(), datetime.date(2026, 7, 20))

    assert len(busy) == 1
    assert busy[0][0].hour == 10
    assert busy[0][1].hour == 11


def test_suggest_free_slots_skips_busy_time():
    busy = [
        (
            datetime.datetime(2026, 7, 20, 9, 0),
            datetime.datetime(2026, 7, 20, 10, 0),
        )
    ]
    slots = google_calendar_client.suggest_free_slots(busy, datetime.date(2026, 7, 20))

    assert len(slots) > 0
    assert all(slot.hour != 9 for slot in slots)


def test_create_event_returns_event_id(monkeypatch):
    monkeypatch.setattr(
        google_calendar_client.httpx,
        "post",
        MagicMock(
            side_effect=[
                _mock_response({"access_token": "fake-access-token"}),
                _mock_response({"id": "fake-event-id"}),
            ]
        ),
    )

    event_id = google_calendar_client.create_event(
        _FakeUser(), "Купити молоко", datetime.datetime(2026, 7, 20, 14, 0)
    )

    assert event_id == "fake-event-id"
```

- [ ] **Step 2: Run to verify**

```bash
cd backend
source venv/bin/activate
pytest tests/test_google_calendar_client.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Write `backend/tests/test_tasks_calendar_sync.py`**

```python
from unittest.mock import MagicMock

from app.tasks import router as tasks_router


def _signup_and_get_token(client, email="calendaruser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_task_still_saves_when_calendar_sync_fails(client, monkeypatch):
    monkeypatch.setattr(
        tasks_router.google_calendar_client,
        "create_event",
        MagicMock(side_effect=RuntimeError("calendar API error")),
    )
    token = _signup_and_get_token(client)

    response = client.post(
        "/tasks",
        json={
            "title": "Задача з поганим календарем",
            "scheduled_at": "2026-07-20T14:00:00",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    task = response.json()
    assert task["title"] == "Задача з поганим календарем"
    assert task["google_event_id"] is None
```

Note: this test creates a task with `scheduled_at` set but the user has no `google_calendar_refresh_token` (a fresh signup never connects Calendar), so `_sync_task_calendar` returns early before ever calling `create_event` — meaning the mock is never actually exercised, and this test would pass even if `create_event` worked perfectly. This is a real gap: to genuinely test the "sync fails but task still saves" behavior, the test needs a user with `google_calendar_refresh_token` set. Fix it as part of this step — after signing up, set the refresh token directly via the `db_session` fixture before creating the task:

```python
def test_task_still_saves_when_calendar_sync_fails(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(
        tasks_router.google_calendar_client,
        "create_event",
        MagicMock(side_effect=RuntimeError("calendar API error")),
    )
    token = _signup_and_get_token(client)
    user = db_session.query(User).filter(User.email == "calendaruser@example.com").first()
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    response = client.post(
        "/tasks",
        json={
            "title": "Задача з поганим календарем",
            "scheduled_at": "2026-07-20T14:00:00",
        },
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    task = response.json()
    assert task["title"] == "Задача з поганим календарем"
    assert task["google_event_id"] is None
```

Use this corrected version in the file, not the first draft above.

- [ ] **Step 4: Run to verify**

```bash
cd backend
pytest tests/test_tasks_calendar_sync.py -v
pytest tests/ -v
```

Expected: the new test PASSES; the full suite passes with no regressions.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_google_calendar_client.py backend/tests/test_tasks_calendar_sync.py
git commit -m "test: add tests for Google Calendar client and task sync graceful degradation"
```

---

## Self-Review Notes

- **Spec coverage:** Settings page + Calendar OAuth connect flow → Task 2, 5. Explicit time extraction during triage → Task 4. Optional Schedule action with free-slot suggestions → Task 3 (backend), Task 6 (frontend). Calendar sync on confirm/edit/delete, graceful degradation on failure → Task 3, verified by Task 9. Calendar view (day/week/month, tasks + real events, all-day row) → Task 7, deliberately simplified to a grouped list per the project owner's explicit choice. Today page time display/sort → Task 3 (backend sort), Task 6 (frontend display). No background retry queue, no token encryption — confirmed absent from every task, matching the spec's explicit exclusions.
- **Type/signature consistency:** `ExtractedTask.scheduled_at` (Task 4) flows straight into `Task(scheduled_at=item.scheduled_at)` in `captures/router.py` and matches `TaskCreate`/`TaskUpdate`/`TaskOut.scheduled_at` (Task 1). `google_calendar_client`'s function signatures (Task 2) are called identically from `tasks/router.py`'s `_sync_task_calendar`/`schedule_suggestions` (Task 3) and from `google_calendar/router.py`'s `list_calendar_events` (Task 2). The frontend `ScheduleButton`'s `onScheduled: (scheduledAt: string) => void` (Task 6) matches how all three pages call it. `TaskOut`'s `scheduled_at`/`google_event_id` fields match the frontend `Task` type used consistently across `today`/`tasks`/`inbox`/`calendar` pages.
- **No placeholders:** every step has complete file contents or an exact command with expected output. The one deliberately environment-specific value (the production Calendar redirect URI) is called out explicitly in Task 8 with the exact URL to add, not left vague.
