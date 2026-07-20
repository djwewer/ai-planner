# AI Planner — Plan 6: Telegram Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Telegram bot that links to a user's account, notifies them (new-tasks-ready, scheduled-time reminders, morning digest, overdue nudges), and lets them Approve/Reject draft tasks with an inline button tap.

**Architecture:** A new `app/telegram/` backend package: a thin `client.py` HTTP wrapper around Telegram's Bot API, a webhook `router.py` handling both the `/start <code>` linking handshake and inline-button callback queries, a `notifications.py` module for composing/sending the new-tasks-ready message (shared by both the initial send and the post-tap message edit), and an in-process APScheduler in `scheduler.py` for the periodic reminder/digest/nudge jobs. The frontend gets a second "Підключити Telegram бота" section on the existing Settings page, following the same connect-button-plus-poll pattern already used for Google Calendar.

**Tech Stack:** Same as Plans 1–4 (FastAPI, SQLAlchemy, Alembic, PostgreSQL, Next.js/TypeScript), plus `httpx` (already a dependency) for Telegram API calls, and `APScheduler` (new dependency) for the in-process periodic jobs.

## Global Constraints

- Product language is Ukrainian — every bot message and UI string.
- No task creation via Telegram messages — only `/start <code>` (linking) and inline-button taps are handled; any other message/update shape is ignored (webhook still returns 200 OK).
- No full task editing inside Telegram — only Approve/Reject.
- A failed Telegram API call (send/edit message, answer callback) must never block task creation, AI triage, or calendar sync — caught and logged, never raised into the caller.
- **Time semantics: use `datetime.datetime.now()` (container-local, pinned to `Europe/Kyiv` per the existing Dockerfile `ENV TZ=Europe/Kyiv`), never `.utcnow()`, for any comparison against `Task.scheduled_at` or `Task.deadline`.** These columns store naive datetimes that represent Kyiv local time (the same convention `app/tasks/router.py` and `app/ai/triage.py` already use via `datetime.date.today()`). Using `.utcnow()` here would silently shift reminder/digest timing by the Kyiv UTC offset (+2/+3 hours) — this exact class of bug was hit and fixed twice already in Plan 3/4 (timezone pin, then a UTC-vs-local date-shift bug in the calendar page). `created_at`/`updated_at` bookkeeping columns are a separate, unrelated concern and keep using `.utcnow()` as they already do — do not change them.
- Reminders more than 15 minutes late (e.g. after the scheduler process was down) are marked sent without notifying, never fired late — matches the master spec's "missed reminders during VPS downtime → accepted risk, no catch-up" stance.
- Reduced testing approach (per the project owner's standing preference, confirmed across Plans 3 and 4): no dedicated test-writing inside individual implementation tasks — verify via the existing suite plus manual/smoke checks. A small, consolidated set of real tests is written in Task 9, covering only what the design spec calls out: the Telegram client's happy path, link-code expiry rejection, and that an Approve callback triggers the same calendar-sync path as web approval.
- Backend is FastAPI on the Hostinger VPS behind Traefik; frontend is Next.js on Vercel (both already live).

---

## File Structure

```
backend/
  alembic/versions/0004_telegram.py
  app/
    models.py                        # + User.telegram_chat_id, Task.reminder_sent_at/last_overdue_nudge_at, TelegramLinkCode
    config.py                         # + telegram_bot_token, telegram_webhook_secret, telegram_bot_username
    schemas.py                         # + telegram_connected on UserOut
    auth/router.py                      # me() adds telegram_connected
    captures/router.py                   # + notify_new_tasks_ready call after triage
    tasks/router.py                       # unchanged (already exposes _sync_task_calendar, reused here)
    telegram/
      __init__.py
      client.py                             # send_message, edit_message, answer_callback_query
      notifications.py                       # render_batch_message, notify_new_tasks_ready
      router.py                               # /telegram/connect, /telegram/webhook
      scheduler.py                             # reminder + digest/overdue jobs
    main.py                                    # register telegram router, wire scheduler via lifespan
  requirements.txt                              # + apscheduler
  .env.example                                   # + TELEGRAM_BOT_TOKEN/WEBHOOK_SECRET/BOT_USERNAME
  tests/
    conftest.py                                  # + TELEGRAM_WEBHOOK_SECRET/BOT_USERNAME test defaults
    test_telegram_client.py
    test_telegram_link.py
    test_telegram_approve.py
frontend/
  app/settings/page.tsx              # + Telegram section, poll-based connected state
```

---

### Task 1: Data model, migration, and schema changes

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/alembic/versions/0004_telegram.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/auth/router.py`

**Interfaces:**
- Produces: `User.telegram_chat_id` (nullable, unique `BigInteger`); `TelegramLinkCode` model (`code` PK, `user_id`, `expires_at`, `used`); `Task.reminder_sent_at`, `Task.last_overdue_nudge_at` (nullable `DateTime`); `UserOut.telegram_connected: bool`

- [ ] **Step 1: Modify `backend/app/models.py`**

Full new file content:

```python
import datetime

from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=True)
    google_id = Column(String, unique=True, nullable=True, index=True)
    google_calendar_refresh_token = Column(String, nullable=True)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=True, index=True)
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
    reminder_sent_at = Column(DateTime, nullable=True)
    last_overdue_nudge_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, default="confirmed")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    user = relationship("User", back_populates="tasks")


class TelegramLinkCode(Base):
    __tablename__ = "telegram_link_codes"

    code = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, nullable=False, default=False)
```

- [ ] **Step 2: Write the migration by hand at `backend/alembic/versions/0004_telegram.py`**

```python
"""add telegram bot columns and link codes table

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("telegram_chat_id", sa.BigInteger(), nullable=True))
        batch_op.create_unique_constraint("uq_users_telegram_chat_id", ["telegram_chat_id"])

    op.add_column("tasks", sa.Column("reminder_sent_at", sa.DateTime(), nullable=True))
    op.add_column("tasks", sa.Column("last_overdue_nudge_at", sa.DateTime(), nullable=True))

    op.create_table(
        "telegram_link_codes",
        sa.Column("code", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "ix_telegram_link_codes_user_id", "telegram_link_codes", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_telegram_link_codes_user_id", table_name="telegram_link_codes")
    op.drop_table("telegram_link_codes")
    op.drop_column("tasks", "last_overdue_nudge_at")
    op.drop_column("tasks", "reminder_sent_at")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("uq_users_telegram_chat_id", type_="unique")
        batch_op.drop_column("telegram_chat_id")
```

`batch_alter_table` is used for the `users` column-add-plus-unique-constraint because SQLite (used for structural verification below and in the test suite) can't add a unique constraint to an existing table via a plain `ALTER TABLE` — this is the same pattern Plan 2's captures migration used for a similar reason (verified there as necessary for SQLite, inert/pass-through on Postgres). The `tasks` columns and the new `telegram_link_codes` table don't need batch mode — plain nullable `ADD COLUMN`s and a brand-new `CREATE TABLE` both work directly on SQLite.

- [ ] **Step 3: Modify `backend/app/schemas.py`**

Find this block:

```python
class UserOut(BaseModel):
    id: int
    email: EmailStr
    google_calendar_connected: bool = False

    class Config:
        from_attributes = True
```

Replace it with:

```python
class UserOut(BaseModel):
    id: int
    email: EmailStr
    google_calendar_connected: bool = False
    telegram_connected: bool = False

    class Config:
        from_attributes = True
```

- [ ] **Step 4: Modify `backend/app/auth/router.py`'s `me` endpoint**

Find this function:

```python
@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        google_calendar_connected=current_user.google_calendar_refresh_token is not None,
    )
```

Replace it with:

```python
@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return UserOut(
        id=current_user.id,
        email=current_user.email,
        google_calendar_connected=current_user.google_calendar_refresh_token is not None,
        telegram_connected=current_user.telegram_chat_id is not None,
    )
```

- [ ] **Step 5: Verify nothing broke**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: all pre-existing tests still PASS.

- [ ] **Step 6: Structurally verify the migration against a throwaway SQLite file**

```bash
cd backend
DATABASE_URL=sqlite:////tmp/plan6_migration_check.db JWT_SECRET=x alembic upgrade head
DATABASE_URL=sqlite:////tmp/plan6_migration_check.db JWT_SECRET=x alembic downgrade base
rm -f /tmp/plan6_migration_check.db
```

Expected: both commands complete with no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/alembic/versions/0004_telegram.py \
  backend/app/schemas.py backend/app/auth/router.py
git commit -m "feat: add Telegram linking data model"
```

---

### Task 2: Telegram Bot API client

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/tests/conftest.py`
- Create: `backend/app/telegram/__init__.py`
- Create: `backend/app/telegram/client.py`

**Interfaces:**
- Produces: `app.telegram.client.send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> dict`, `edit_message(chat_id: int, message_id: int, text: str, reply_markup: dict | None = None) -> None`, `answer_callback_query(callback_query_id: str, text: str | None = None) -> None`

- [ ] **Step 1: Add Telegram settings to `backend/app/config.py`**

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
    telegram_bot_token: str = ""
    telegram_webhook_secret: str = ""
    telegram_bot_username: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
```

- [ ] **Step 2: Add Telegram vars to `backend/.env.example`**

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
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_BOT_USERNAME=
```

- [ ] **Step 3: Add test defaults to `backend/tests/conftest.py`**

Find these lines near the top:

```python
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")
```

Replace with:

```python
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("TELEGRAM_BOT_USERNAME", "test_bot")
```

These must be set before `app.main` is imported later in the same file (env vars are read once into the `Settings()` singleton at import time), which is why they're added right next to the existing `DATABASE_URL`/`JWT_SECRET` defaults at the top of the file, not somewhere else.

- [ ] **Step 4: Create `backend/app/telegram/__init__.py`** (empty file)

- [ ] **Step 5: Create `backend/app/telegram/client.py`**

```python
import httpx

from app.config import settings


def _api_url(method: str) -> str:
    return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"


def send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> dict:
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    response = httpx.post(_api_url("sendMessage"), json=payload)
    response.raise_for_status()
    return response.json()["result"]


def edit_message(
    chat_id: int, message_id: int, text: str, reply_markup: dict | None = None
) -> None:
    payload: dict = {"chat_id": chat_id, "message_id": message_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    response = httpx.post(_api_url("editMessageText"), json=payload)
    response.raise_for_status()


def answer_callback_query(callback_query_id: str, text: str | None = None) -> None:
    payload: dict = {"callback_query_id": callback_query_id}
    if text is not None:
        payload["text"] = text
    response = httpx.post(_api_url("answerCallbackQuery"), json=payload)
    response.raise_for_status()
```

The bot token is read fresh from `settings` on every call (via `_api_url`) rather than baked into a module-level constant at import time — Telegram's Bot API embeds the token directly in the URL path (there's no header-based auth option like Google's), so this keeps the client honest about where the token is used and avoids any staleness if settings were reloaded.

- [ ] **Step 6: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
DATABASE_URL=sqlite:///:memory: JWT_SECRET=x python3 -c "from app.telegram import client; print('ok')"
pytest tests/ -v
```

Expected: `ok` printed; full pre-existing test suite still passes.

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/.env.example backend/tests/conftest.py backend/app/telegram/
git commit -m "feat: add Telegram Bot API client"
```

---

### Task 3: Telegram linking flow (connect + webhook /start handling)

**Files:**
- Create: `backend/app/telegram/router.py`

**Interfaces:**
- Consumes: `app.telegram.client.send_message`
- Produces: `GET /telegram/connect` (auth-required, returns `{"deep_link": str}`); `POST /telegram/webhook` (verifies `X-Telegram-Bot-Api-Secret-Token` header, handles `/start <code>` messages; any other update shape is a no-op returning `{"ok": true}`)

- [ ] **Step 1: Create `backend/app/telegram/router.py`**

```python
import datetime
import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import TelegramLinkCode, User
from app.security import get_current_user
from app.telegram import client as telegram_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["telegram"])

LINK_CODE_EXPIRY_MINUTES = 10
CODE_INVALID_MESSAGE = "Код недійсний або застарів, спробуйте ще раз у Налаштуваннях."


@router.get("/telegram/connect")
def connect(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    code = secrets.token_urlsafe(16)
    db.add(
        TelegramLinkCode(
            code=code,
            user_id=current_user.id,
            expires_at=datetime.datetime.utcnow()
            + datetime.timedelta(minutes=LINK_CODE_EXPIRY_MINUTES),
            used=False,
        )
    )
    db.commit()
    return {"deep_link": f"https://t.me/{settings.telegram_bot_username}?start={code}"}


def _handle_start(chat_id: int, code: str, db: Session) -> None:
    link_code = (
        db.query(TelegramLinkCode)
        .filter(TelegramLinkCode.code == code, TelegramLinkCode.used.is_(False))
        .first()
    )
    if link_code is None or link_code.expires_at < datetime.datetime.utcnow():
        telegram_client.send_message(chat_id, CODE_INVALID_MESSAGE)
        return

    user = db.query(User).filter(User.id == link_code.user_id).first()
    if user is None:
        telegram_client.send_message(chat_id, CODE_INVALID_MESSAGE)
        return

    user.telegram_chat_id = chat_id
    link_code.used = True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        telegram_client.send_message(
            chat_id, "Цей Telegram акаунт вже підключено до іншого користувача."
        )
        return

    telegram_client.send_message(chat_id, "✅ Підключено!")


@router.post("/telegram/webhook")
def webhook(
    body: dict,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid secret token"
        )

    message = body.get("message")
    if message is not None:
        text = message.get("text", "")
        chat_id = message["chat"]["id"]
        if text.startswith("/start "):
            code = text[len("/start ") :].strip()
            try:
                _handle_start(chat_id, code, db)
            except Exception:
                logger.exception("failed to handle /start for chat_id=%s", chat_id)
        return {"ok": True}

    return {"ok": True}
```

`webhook` is a plain `def`, not `async def` — `_handle_start` calls `telegram_client.send_message`, a blocking `httpx` call, and FastAPI only threadpools plain `def` routes automatically. This matches the established pattern from every other route in this codebase that transitively makes a blocking HTTP call (the Calendar sync routes in `tasks/router.py`, `list_calendar_events` in `google_calendar/router.py`), and is exactly the fix class from the Plan 3 Whisper-transcription bug applied consistently.

- [ ] **Step 2: Register the router in `backend/app/main.py`**

Find:

```python
from app.google_calendar.router import router as google_calendar_router
from app.tasks.router import router as tasks_router
from app.transcription.router import router as transcription_router
```

Replace with:

```python
from app.google_calendar.router import router as google_calendar_router
from app.tasks.router import router as tasks_router
from app.telegram.router import router as telegram_router
from app.transcription.router import router as transcription_router
```

Find:

```python
app.include_router(google_calendar_router)
```

Replace with:

```python
app.include_router(google_calendar_router)
app.include_router(telegram_router)
```

- [ ] **Step 3: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
DATABASE_URL=sqlite:///:memory: JWT_SECRET=x python3 -c "from app.main import app; print('ok')"
pytest tests/ -v
```

Expected: `ok` printed, no import errors; full pre-existing test suite still passes.

- [ ] **Step 4: Commit**

```bash
git add backend/app/telegram/router.py backend/app/main.py
git commit -m "feat: add Telegram linking flow (connect endpoint + /start webhook handling)"
```

---

### Task 4: New-tasks-ready notification

**Files:**
- Create: `backend/app/telegram/notifications.py`
- Modify: `backend/app/captures/router.py`

**Interfaces:**
- Consumes: `app.telegram.client.send_message`
- Produces: `app.telegram.notifications.render_batch_message(tasks: list[Task]) -> tuple[str, dict | None]`, `notify_new_tasks_ready(user: User, tasks: list[Task]) -> None`. `render_batch_message` is reused unchanged by Task 5's Approve/Reject callback handler to re-render the same message after a button tap — its output format must not change between tasks.

- [ ] **Step 1: Create `backend/app/telegram/notifications.py`**

```python
from app.models import Task, User
from app.telegram import client as telegram_client

MAX_INLINE_TASKS = 5

STATUS_LABELS = {
    "confirmed": "✅ Підтверджено",
    "rejected": "❌ Відхилено",
}


def render_batch_message(tasks: list[Task]) -> tuple[str, dict | None]:
    shown = tasks[:MAX_INLINE_TASKS]
    lines = [f"🆕 {len(tasks)} нових задач готові до перегляду"]
    keyboard_rows = []

    for task in shown:
        label = STATUS_LABELS.get(task.status)
        if label is not None:
            lines.append(f"— {task.title}: {label}")
        else:
            lines.append(f"— {task.title}")
            keyboard_rows.append(
                [
                    {"text": "✅", "callback_data": f"approve:{task.id}"},
                    {"text": "❌", "callback_data": f"reject:{task.id}"},
                ]
            )

    remaining = len(tasks) - len(shown)
    if remaining > 0:
        lines.append(f"...і ще {remaining} — переглянути в Inbox")

    text = "\n".join(lines)
    reply_markup = {"inline_keyboard": keyboard_rows} if keyboard_rows else None
    return text, reply_markup


def notify_new_tasks_ready(user: User, tasks: list[Task]) -> None:
    if user.telegram_chat_id is None or not tasks:
        return
    text, reply_markup = render_batch_message(tasks)
    telegram_client.send_message(user.telegram_chat_id, text, reply_markup=reply_markup)
```

`render_batch_message` takes a plain list of tasks and derives the message purely from each task's current `status` — it doesn't care whether it's being called right after triage (all `draft`) or after a button tap re-render (a mix of `draft`/`confirmed`/`rejected`). This is what lets Task 5 reuse it unchanged: re-querying all tasks from the same capture and calling this same function produces a message reflecting everyone's current state, so approving one task in a batch of five never causes the other four to disappear from the message.

- [ ] **Step 2: Modify `backend/app/captures/router.py`**

Find:

```python
from app.ai.triage import extract_tasks
from app.database import get_db
from app.models import Capture, Task, User
from app.schemas import TaskOut
from app.security import get_current_user
```

Replace with:

```python
from app.ai.triage import extract_tasks
from app.database import get_db
from app.models import Capture, Task, User
from app.schemas import TaskOut
from app.security import get_current_user
from app.telegram.notifications import notify_new_tasks_ready
```

Find:

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
    db.commit()
    for task in tasks:
        db.refresh(task)
    return tasks
```

Replace with:

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
    db.commit()
    for task in tasks:
        db.refresh(task)

    try:
        notify_new_tasks_ready(current_user, tasks)
    except Exception:
        logger.exception(
            "failed to send new-tasks-ready notification for capture_id=%s", capture.id
        )

    return tasks
```

`create_capture` is already a plain `def` (not `async def`), so this new blocking Telegram call is automatically threadpooled like everything else in this route — no change needed there.

- [ ] **Step 3: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: all pre-existing tests still PASS. (Existing capture tests create users with no `telegram_chat_id`, so `notify_new_tasks_ready` no-ops immediately — no behavior change for any existing test.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/telegram/notifications.py backend/app/captures/router.py
git commit -m "feat: send Telegram notification when new tasks are ready for review"
```

---

### Task 5: Approve/Reject inline callback handling

**Files:**
- Modify: `backend/app/telegram/router.py`

**Interfaces:**
- Consumes: `app.telegram.notifications.render_batch_message`, `app.tasks.router._sync_task_calendar(current_user: User, task: Task, db: Session) -> None`
- Produces: `POST /telegram/webhook` now also handles `callback_query` updates with `callback_data` of `approve:<task_id>` / `reject:<task_id>`

- [ ] **Step 1: Modify `backend/app/telegram/router.py`**

Find:

```python
from app.config import settings
from app.database import get_db
from app.models import TelegramLinkCode, User
from app.security import get_current_user
from app.telegram import client as telegram_client
```

Replace with:

```python
from app.config import settings
from app.database import get_db
from app.models import Task, TelegramLinkCode, User
from app.security import get_current_user
from app.tasks.router import _sync_task_calendar
from app.telegram import client as telegram_client
from app.telegram.notifications import render_batch_message
```

Find:

```python
@router.post("/telegram/webhook")
def webhook(
    body: dict,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid secret token"
        )

    message = body.get("message")
    if message is not None:
        text = message.get("text", "")
        chat_id = message["chat"]["id"]
        if text.startswith("/start "):
            code = text[len("/start ") :].strip()
            try:
                _handle_start(chat_id, code, db)
            except Exception:
                logger.exception("failed to handle /start for chat_id=%s", chat_id)
        return {"ok": True}

    return {"ok": True}
```

Replace with:

```python
def _handle_callback_query(callback_query: dict, db: Session) -> None:
    callback_query_id = callback_query["id"]
    data = callback_query.get("data", "")
    chat_id = callback_query["message"]["chat"]["id"]
    message_id = callback_query["message"]["message_id"]

    try:
        action, task_id_str = data.split(":", 1)
        task_id = int(task_id_str)
    except ValueError:
        telegram_client.answer_callback_query(callback_query_id)
        return

    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user.telegram_chat_id != chat_id:
        telegram_client.answer_callback_query(callback_query_id, "Задачу не знайдено")
        return

    if task.status == "draft" and action == "approve":
        task.status = "confirmed"
        db.commit()
        _sync_task_calendar(task.user, task, db)
    elif task.status == "draft" and action == "reject":
        task.status = "rejected"
        db.commit()

    batch_tasks = (
        db.query(Task)
        .filter(Task.capture_id == task.capture_id, Task.user_id == task.user_id)
        .order_by(Task.id.asc())
        .all()
    )
    text, reply_markup = render_batch_message(batch_tasks)
    telegram_client.edit_message(chat_id, message_id, text, reply_markup=reply_markup)
    telegram_client.answer_callback_query(callback_query_id)


@router.post("/telegram/webhook")
def webhook(
    body: dict,
    db: Session = Depends(get_db),
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid secret token"
        )

    message = body.get("message")
    if message is not None:
        text = message.get("text", "")
        chat_id = message["chat"]["id"]
        if text.startswith("/start "):
            code = text[len("/start ") :].strip()
            try:
                _handle_start(chat_id, code, db)
            except Exception:
                logger.exception("failed to handle /start for chat_id=%s", chat_id)
        return {"ok": True}

    callback_query = body.get("callback_query")
    if callback_query is not None:
        try:
            _handle_callback_query(callback_query, db)
        except Exception:
            logger.exception("failed to handle callback_query")
        return {"ok": True}

    return {"ok": True}
```

Two things worth noting about `_handle_callback_query`:

- It looks up `task.user.telegram_chat_id != chat_id` before acting on anything — `callback_data` round-trips through Telegram's own servers, so a task ID alone is never trusted; the callback must also come from the chat belonging to that task's owner.
- If the task is already resolved (not `draft` — either a duplicate tap, or resolved via the web Inbox in the meantime), the `if`/`elif` block is skipped entirely and execution falls straight through to re-rendering the batch message with the task's current state — this is what makes a duplicate tap idempotent, per the design spec's error-handling requirement.

- [ ] **Step 2: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
pytest tests/ -v
```

Expected: all pre-existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/telegram/router.py
git commit -m "feat: handle Approve/Reject inline button taps on Telegram notifications"
```

---

### Task 6: Reminder, digest, and overdue-nudge scheduler

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/telegram/scheduler.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `app.telegram.client.send_message`, `app.database.SessionLocal`
- Produces: `app.telegram.scheduler.send_scheduled_reminders() -> None`, `send_daily_digest_and_overdue_nudges() -> None`, both registered as APScheduler jobs at FastAPI startup

- [ ] **Step 1: Add APScheduler to `backend/requirements.txt`**

Find the end of the file (after `faster-whisper==1.2.1`) and add:

```
apscheduler==3.10.4
```

- [ ] **Step 2: Install it**

```bash
cd backend
source venv/bin/activate
pip install apscheduler==3.10.4
```

- [ ] **Step 3: Create `backend/app/telegram/scheduler.py`**

```python
import datetime
import logging

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Task, User
from app.telegram import client as telegram_client

logger = logging.getLogger(__name__)

REMINDER_LOOKBACK_MINUTES = 15


def send_scheduled_reminders() -> None:
    db = SessionLocal()
    try:
        now = datetime.datetime.now()
        lower_bound = now - datetime.timedelta(minutes=REMINDER_LOOKBACK_MINUTES)
        tasks = (
            db.query(Task)
            .join(User, Task.user_id == User.id)
            .filter(
                Task.status == "confirmed",
                Task.scheduled_at.isnot(None),
                Task.scheduled_at >= lower_bound,
                Task.scheduled_at <= now,
                Task.reminder_sent_at.is_(None),
                User.telegram_chat_id.isnot(None),
            )
            .all()
        )
        for task in tasks:
            try:
                time_label = task.scheduled_at.strftime("%H:%M")
                telegram_client.send_message(
                    task.user.telegram_chat_id, f"⏰ {time_label} — {task.title}"
                )
                task.reminder_sent_at = now
                db.commit()
            except Exception:
                logger.exception("failed to send scheduled reminder for task_id=%s", task.id)
    finally:
        db.close()


def _send_digest_for_user(user: User, today: datetime.date, db: Session) -> None:
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status.in_(["confirmed", "done"]),
            Task.deadline.isnot(None),
            Task.deadline <= today,
        )
        .order_by(Task.scheduled_at.asc().nullslast(), Task.priority.asc(), Task.deadline.asc())
        .all()
    )
    if not tasks:
        return
    lines = ["☀️ На сьогодні:"]
    for task in tasks:
        prefix = f"{task.scheduled_at.strftime('%H:%M')} " if task.scheduled_at else ""
        lines.append(f"- {prefix}{task.title} (P{task.priority})")
    try:
        telegram_client.send_message(user.telegram_chat_id, "\n".join(lines))
    except Exception:
        logger.exception("failed to send morning digest for user_id=%s", user.id)


def _send_overdue_nudges_for_user(
    user: User, now: datetime.datetime, today: datetime.date, db: Session
) -> None:
    confirmed_tasks = db.query(Task).filter(Task.user_id == user.id, Task.status == "confirmed").all()
    overdue = [
        task
        for task in confirmed_tasks
        if (
            (task.deadline is not None and task.deadline < today)
            or (task.scheduled_at is not None and task.scheduled_at < now)
        )
        and (task.last_overdue_nudge_at is None or task.last_overdue_nudge_at.date() < today)
    ]
    if not overdue:
        return
    lines = ["⚠️ Просрочено:"]
    for task in overdue:
        when = (
            task.deadline.strftime("%d.%m")
            if task.deadline is not None
            else task.scheduled_at.strftime("%d.%m")
        )
        lines.append(f"- {task.title} (термін був {when})")
    try:
        telegram_client.send_message(user.telegram_chat_id, "\n".join(lines))
    except Exception:
        logger.exception("failed to send overdue nudges for user_id=%s", user.id)
        return
    for task in overdue:
        task.last_overdue_nudge_at = now
    db.commit()


def send_daily_digest_and_overdue_nudges() -> None:
    db = SessionLocal()
    try:
        now = datetime.datetime.now()
        today = now.date()
        users = db.query(User).filter(User.telegram_chat_id.isnot(None)).all()
        for user in users:
            _send_digest_for_user(user, today, db)
            _send_overdue_nudges_for_user(user, now, today, db)
    finally:
        db.close()
```

Both job functions open and close their own `SessionLocal()` session — APScheduler's default `BackgroundScheduler` runs jobs in worker threads, and SQLAlchemy sessions aren't safe to share across threads, so each job gets a fresh one rather than using the request-scoped `Depends(get_db)` pattern the rest of the app uses (that pattern only exists inside an actual HTTP request, which these jobs aren't).

- [ ] **Step 4: Wire the scheduler into `backend/app/main.py`**

Find:

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
from app.telegram.router import router as telegram_router
from app.transcription.router import router as transcription_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="AI Planner API")
```

Replace with:

```python
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
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
from app.telegram.router import router as telegram_router
from app.telegram.scheduler import send_daily_digest_and_overdue_nudges, send_scheduled_reminders
from app.transcription.router import router as transcription_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(
        send_scheduled_reminders, "interval", minutes=1, id="telegram_reminders"
    )
    scheduler.add_job(
        send_daily_digest_and_overdue_nudges,
        CronTrigger(hour=9, minute=0, timezone="Europe/Kyiv"),
        id="telegram_daily_digest",
    )
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(title="AI Planner API", lifespan=lifespan)
```

The `CronTrigger` is given `timezone="Europe/Kyiv"` explicitly rather than relying on the container's `TZ` environment variable — this makes the 09:00 firing time correct regardless of how the process's local timezone is configured, rather than silently depending on the Dockerfile's `ENV TZ=Europe/Kyiv` staying in place.

- [ ] **Step 5: Verify with a smoke check**

```bash
cd backend
source venv/bin/activate
DATABASE_URL=sqlite:///:memory: JWT_SECRET=x python3 -c "from app.main import app; print('ok')"
pytest tests/ -v
```

Expected: `ok` printed, no import errors; full pre-existing test suite still passes. The existing `client` fixture in `tests/conftest.py` builds `TestClient(app)` without entering it as a context manager (`with TestClient(app) as client:`), so the `lifespan` function's `scheduler.start()`/`scheduler.shutdown()` never actually runs during the test suite — this is expected and fine; this step's `pytest tests/ -v` run is what confirms it in practice rather than assuming it.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/telegram/scheduler.py backend/app/main.py
git commit -m "feat: add scheduled-reminder, morning-digest, and overdue-nudge jobs"
```

---

### Task 7: Frontend — Settings page Telegram section

**Files:**
- Modify: `frontend/app/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /auth/me` (now returns `telegram_connected`), `GET /telegram/connect` (Task 3, returns `{"deep_link": string}`)

- [ ] **Step 1: Modify `frontend/app/settings/page.tsx`**

Full new file content:

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
  telegram_connected: boolean;
};

function SettingsPageInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Me>("/auth/me").then((me) => {
        setCalendarConnected(me.google_calendar_connected);
        setTelegramConnected(me.telegram_connected);
      });
    }
  }, [user]);

  useEffect(() => {
    if (searchParams.get("error") === "calendar_connect_failed") {
      setError("Не вдалося підключити Google Calendar, спробуйте ще раз");
    }
    if (searchParams.get("connected") === "1") {
      setCalendarConnected(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (telegramConnected) return;
    const interval = setInterval(() => {
      api.get<Me>("/auth/me").then((me) => {
        if (me.telegram_connected) setTelegramConnected(true);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [telegramConnected]);

  async function handleConnectCalendar() {
    setError(null);
    setConnectingCalendar(true);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        "/auth/google/calendar/connect"
      );
      window.location.href = authorize_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підключити Google Calendar");
      setConnectingCalendar(false);
    }
  }

  async function handleConnectTelegram() {
    setError(null);
    setConnectingTelegram(true);
    try {
      const { deep_link } = await api.get<{ deep_link: string }>("/telegram/connect");
      window.location.href = deep_link;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підключити Telegram");
    } finally {
      setConnectingTelegram(false);
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
        {calendarConnected ? (
          <p>✅ Підключено</p>
        ) : (
          <button onClick={handleConnectCalendar} disabled={connectingCalendar}>
            {connectingCalendar ? "Підключення…" : "Підключити Google Calendar"}
          </button>
        )}
      </section>
      <section>
        <h2>Telegram</h2>
        {telegramConnected ? (
          <p>✅ Підключено</p>
        ) : (
          <button onClick={handleConnectTelegram} disabled={connectingTelegram}>
            {connectingTelegram ? "Підключення…" : "Підключити Telegram бота"}
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

The existing `connected`/`setConnected` state (for Calendar) is renamed to `calendarConnected`/`setCalendarConnected` here, to disambiguate from the new `telegramConnected`/`setTelegramConnected` pair — a direct, necessary rename within this same file for this task, not a broader refactor.

The polling `useEffect` starts a 3-second interval whenever the page is showing "not connected," and stops itself (via the cleanup function and the `if (telegramConnected) return` guard) the moment `/auth/me` reports `telegram_connected: true` — this covers the case where the user taps "Підключити Telegram бота," leaves the browser tab entirely to open the Telegram app, taps Start there, and never manually returns to or refreshes the Settings page; the poll picks up the change on its own.

- [ ] **Step 2: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/settings/page.tsx
git commit -m "feat: add Telegram connection section to Settings page"
```

---

### Task 8: Deploy to the VPS

**Files:** none (deployment only)

- [ ] **Step 1: Create the Telegram bot via BotFather**

In Telegram, message [@BotFather](https://t.me/BotFather): `/newbot`, follow the prompts to choose a name and a `_bot`-suffixed username. BotFather replies with the bot token — save it.

- [ ] **Step 2: On the VPS, pull and add the new env vars**

```bash
cd ai-planner
git pull
```

Edit `backend/.env` and add:

```
TELEGRAM_BOT_TOKEN=<the token from BotFather>
TELEGRAM_WEBHOOK_SECRET=<a random string you generate, e.g. openssl rand -hex 32>
TELEGRAM_BOT_USERNAME=<the bot's username, without the leading @>
```

- [ ] **Step 3: Rebuild and restart**

```bash
docker compose up -d --build backend
docker compose logs backend --tail 30
```

Expected: the `0004` migration runs cleanly (`Running upgrade 0003 -> 0004, add telegram bot columns and link codes table`), clean startup, no errors.

- [ ] **Step 4: Register the webhook with Telegram**

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://bcknd.srv1440057.hstgr.cloud/telegram/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`. This is a one-time registration call against Telegram's servers — it doesn't need to be repeated on future deploys unless the webhook URL or secret changes.

- [ ] **Step 5: Confirm Vercel auto-deployed the frontend**

Confirm the latest deployment in the Vercel dashboard shows "Ready" and matches this plan's final commit.

- [ ] **Step 6: End-to-end manual QA**

1. `/settings` — tap "Підключити Telegram бота," confirm your Telegram app opens to the bot's chat, tap **Start**, confirm the bot replies "✅ Підключено!" and the Settings page flips to "✅ Підключено" on its own within a few seconds (no manual refresh).
2. `/capture` — submit a capture that produces 1-2 draft tasks, confirm a "🆕 N нових задач готові до перегляду" message arrives in Telegram with inline buttons.
3. Tap ✅ on one task in Telegram — confirm the message updates in place to show that task as "✅ Підтверджено" while any other tasks in the same batch keep their own buttons; confirm the task now shows as `confirmed` in the web Inbox/Tasks page, and if it had a `scheduled_at` and Google Calendar is connected, confirm the event appears in your real calendar.
4. Tap ❌ on another task — confirm it updates to "❌ Відхилено" and the task disappears from the web Inbox.
5. Schedule a task for a couple of minutes from now (via the web app's Schedule button), wait for it to pass — confirm a "⏰" reminder arrives in Telegram.
6. Temporarily edit a task's `scheduled_at`/`deadline` to be overdue (or wait for the next real 09:00 Kyiv firing) and confirm the "⚠️ Просрочено" nudge and/or "☀️ На сьогодні" digest arrive with reasonable content.

---

### Task 9: Backend tests (consolidated)

**Files:**
- Create: `backend/tests/test_telegram_client.py`
- Create: `backend/tests/test_telegram_link.py`
- Create: `backend/tests/test_telegram_approve.py`

**Interfaces:** none new — this task only adds tests for what Tasks 2-5 already built

Per the project owner's request, this is the one task in this plan where automated tests are written — kept to the real happy path plus the two behaviors most worth locking in (link-code expiry rejection, and Approve triggering the same calendar sync as web approval).

- [ ] **Step 1: Write `backend/tests/test_telegram_client.py`**

```python
from unittest.mock import MagicMock

from app.telegram import client as telegram_client


def _mock_response(json_data, status_code=200):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_data
    response.raise_for_status = MagicMock()
    return response


def test_send_message_returns_result(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"ok": True, "result": {"message_id": 1}}))
    monkeypatch.setattr(telegram_client.httpx, "post", mock_post)

    result = telegram_client.send_message(123, "hello")

    assert result == {"message_id": 1}
    assert mock_post.call_args.args[0].endswith("/sendMessage")


def test_edit_message_sends_expected_payload(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"ok": True, "result": {}}))
    monkeypatch.setattr(telegram_client.httpx, "post", mock_post)

    telegram_client.edit_message(123, 456, "updated", reply_markup={"inline_keyboard": []})

    payload = mock_post.call_args.kwargs["json"]
    assert payload == {
        "chat_id": 123,
        "message_id": 456,
        "text": "updated",
        "reply_markup": {"inline_keyboard": []},
    }


def test_answer_callback_query_sends_id_and_text(monkeypatch):
    mock_post = MagicMock(return_value=_mock_response({"ok": True, "result": True}))
    monkeypatch.setattr(telegram_client.httpx, "post", mock_post)

    telegram_client.answer_callback_query("cbq-1", text="done")

    payload = mock_post.call_args.kwargs["json"]
    assert payload == {"callback_query_id": "cbq-1", "text": "done"}
```

- [ ] **Step 2: Run to verify**

```bash
cd backend
source venv/bin/activate
pytest tests/test_telegram_client.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 3: Write `backend/tests/test_telegram_link.py`**

```python
import datetime
from unittest.mock import MagicMock

from app.telegram import router as telegram_router

WEBHOOK_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}


def _signup(client, email="telegramuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_start_with_expired_code_does_not_link(client, monkeypatch, db_session):
    from app.models import TelegramLinkCode, User

    mock_send = MagicMock()
    monkeypatch.setattr(telegram_router.telegram_client, "send_message", mock_send)

    _signup(client)
    user = db_session.query(User).filter(User.email == "telegramuser@example.com").first()
    db_session.add(
        TelegramLinkCode(
            code="expired-code",
            user_id=user.id,
            expires_at=datetime.datetime.utcnow() - datetime.timedelta(minutes=1),
            used=False,
        )
    )
    db_session.commit()

    response = client.post(
        "/telegram/webhook",
        json={"message": {"chat": {"id": 999}, "text": "/start expired-code"}},
        headers=WEBHOOK_HEADERS,
    )

    assert response.status_code == 200
    db_session.refresh(user)
    assert user.telegram_chat_id is None
    mock_send.assert_called_once_with(999, telegram_router.CODE_INVALID_MESSAGE)
```

- [ ] **Step 4: Run to verify**

```bash
cd backend
pytest tests/test_telegram_link.py -v
```

Expected: the test PASSES.

- [ ] **Step 5: Write `backend/tests/test_telegram_approve.py`**

```python
import datetime
from unittest.mock import MagicMock

from app.tasks import router as tasks_router
from app.telegram import router as telegram_router

WEBHOOK_HEADERS = {"X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"}


def _signup(client, email="approveuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_approve_callback_confirms_task_and_syncs_calendar(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_create_event = MagicMock(return_value="fake-event-id")
    monkeypatch.setattr(tasks_router.google_calendar_client, "create_event", mock_create_event)
    monkeypatch.setattr(telegram_router.telegram_client, "edit_message", MagicMock())
    monkeypatch.setattr(telegram_router.telegram_client, "answer_callback_query", MagicMock())

    _signup(client)
    user = db_session.query(User).filter(User.email == "approveuser@example.com").first()
    user.telegram_chat_id = 555
    user.google_calendar_refresh_token = "fake-refresh-token"
    db_session.commit()

    task = Task(
        user_id=user.id,
        title="Купити молоко",
        status="draft",
        scheduled_at=datetime.datetime(2026, 7, 25, 10, 0),
    )
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    response = client.post(
        "/telegram/webhook",
        json={
            "callback_query": {
                "id": "cbq-1",
                "data": f"approve:{task.id}",
                "message": {"message_id": 42, "chat": {"id": 555}},
            }
        },
        headers=WEBHOOK_HEADERS,
    )

    assert response.status_code == 200
    mock_create_event.assert_called_once()
    db_session.refresh(task)
    assert task.status == "confirmed"
    assert task.google_event_id == "fake-event-id"
```

The mock is patched on `tasks_router.google_calendar_client` (i.e. `app.tasks.router`'s own module-level import), not on anything in `app.telegram.router` — `_sync_task_calendar` is defined in `app/tasks/router.py`, so it looks up `google_calendar_client` in that module's namespace at call time regardless of which other module imported and called the function by name. Patching the wrong module here would make the mock silently never apply, which is exactly the kind of vacuous-pass bug Plan 4's Task 9 caught and fixed in its own graceful-degradation test — don't repeat it here.

- [ ] **Step 6: Run to verify**

```bash
cd backend
pytest tests/test_telegram_approve.py -v
pytest tests/ -v
```

Expected: the new test PASSES; the full suite passes with no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/tests/test_telegram_client.py backend/tests/test_telegram_link.py \
  backend/tests/test_telegram_approve.py
git commit -m "test: add tests for Telegram client, link-code expiry, and Approve calendar sync"
```

---

## Self-Review Notes

- **Spec coverage:** Settings "Підключити Telegram бота" button + linking flow → Task 3, 7. All four notification types → Task 4 (new-tasks-ready), Task 6 (reminders, digest, overdue nudges). Approve/Reject inline buttons, idempotent on duplicate taps → Task 5. Webhook (not long-polling), `secret_token` verification, in-process APScheduler (no separate queue) → Task 3, 6, matching the Architecture section. Data model (`telegram_chat_id`, `telegram_link_codes`, reminder/nudge bookkeeping columns) → Task 1. Error handling (failed Telegram calls never block task/triage/calendar operations, invalid/expired codes, unknown-task callbacks, missed-reminder accepted-risk stance) → covered inline across Tasks 3-6 and called out in Global Constraints. Testing section's three specific tests → Task 9. No task creation via Telegram, no full editing in Telegram — confirmed absent from every task.
- **Type/signature consistency:** `notify_new_tasks_ready(user, tasks)` and `render_batch_message(tasks)` (Task 4) are called with the same signatures from both `captures/router.py` (Task 4) and `telegram/router.py`'s `_handle_callback_query` (Task 5). `_sync_task_calendar(current_user, task, db)` (already existing, from Plan 4) is imported and called with the exact same argument order in Task 5 as it's used in `tasks/router.py` itself. `UserOut.telegram_connected` (Task 1) matches the frontend `Me` type's `telegram_connected` field (Task 7). `TelegramLinkCode`'s columns (Task 1) match exactly what `connect()`/`_handle_start()` read and write (Task 3).
- **No placeholders:** every step has complete file contents, a complete find/replace pair, or an exact command with expected output. The two environment-specific values in Task 8 (bot token, webhook secret) are called out explicitly as values the operator must obtain/generate, not left vague.
