# Plan A: Telegram Voice Capture + Notification Source-Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop sending redundant Telegram notifications for web-originated captures, and add a real Telegram inbound capture path (voice + text) that reuses the existing AI-triage and transcription pipeline.

**Architecture:** `Capture` gets a `source` field; the capture-processing logic currently inline in the `POST /captures` handler is extracted into a shared, HTTP-independent service function that both the web endpoint and a new Telegram message handler call, with the existing Telegram notification now gated on `source == "telegram"` instead of firing unconditionally.

**Tech Stack:** FastAPI/SQLAlchemy/Alembic backend, existing `httpx`-based Telegram Bot API client, existing local `faster-whisper` transcription — no new dependencies.

## Global Constraints

- No frontend changes — this plan is entirely backend.
- No new npm/pip dependency.
- `POST /captures`'s existing request/response contract is unchanged (still returns `201` with the created tasks, still `502` with the same Ukrainian error message on triage failure) — the refactor must be behavior-preserving for the web app.
- Ukrainian-only user-facing copy (Telegram reply messages).
- Backend tests are required for all new/changed logic, matching this project's existing `pytest` convention (mock external calls — `extract_tasks`, `telegram_client.*`, `transcribe_audio` — never hit real APIs in tests).

---

### Task 1: `Capture.source` + shared capture-processing service

**Files:**
- Create: `backend/alembic/versions/0006_capture_source.py`
- Create: `backend/app/captures/service.py`
- Modify: `backend/app/models.py` (add `source` column to `Capture`)
- Modify: `backend/app/captures/router.py` (full rewrite, becomes a thin wrapper)
- Modify: `backend/tests/test_captures.py` (update monkeypatch targets — see Step 5)

**Interfaces:**
- Produces: `process_capture(user: User, raw_text: str, source: str, db: Session) -> list[Task]` and `CaptureProcessingError` (exception class), both from `backend/app/captures/service.py`. Task 2's Telegram handlers import and call this directly.
- Consumes: existing `extract_tasks` (`app.ai.triage`), existing `notify_new_tasks_ready` (`app.telegram.notifications`), existing `Capture`/`Task`/`User` models.

- [ ] **Step 1: Add the migration**

Create `backend/alembic/versions/0006_capture_source.py`:

```python
"""add source column to captures

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-21

"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("captures", sa.Column("source", sa.String(), nullable=False, server_default="web"))


def downgrade() -> None:
    op.drop_column("captures", "source")
```

- [ ] **Step 2: Add the column to the model**

In `backend/app/models.py`, find the `Capture` class:

```python
class Capture(Base):
    __tablename__ = "captures"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    raw_text = Column(String, nullable=False)
    status = Column(String, nullable=False, default="processing")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
```

Add a `source` column right after `raw_text`:

```python
class Capture(Base):
    __tablename__ = "captures"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    raw_text = Column(String, nullable=False)
    source = Column(String, nullable=False, default="web")
    status = Column(String, nullable=False, default="processing")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
```

- [ ] **Step 3: Create the shared service**

Create `backend/app/captures/service.py`:

```python
import datetime
import logging

from sqlalchemy.orm import Session

from app.ai.triage import extract_tasks
from app.models import Capture, Task, User
from app.telegram.notifications import notify_new_tasks_ready

logger = logging.getLogger(__name__)


class CaptureProcessingError(Exception):
    """Raised when AI triage fails; the caller decides how to surface it."""


def process_capture(user: User, raw_text: str, source: str, db: Session) -> list[Task]:
    capture = Capture(user_id=user.id, raw_text=raw_text, status="processing", source=source)
    db.add(capture)
    db.commit()
    db.refresh(capture)

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

    return tasks
```

- [ ] **Step 4: Rewrite the router as a thin wrapper**

Replace the full contents of `backend/app/captures/router.py`:

```python
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.captures.service import CaptureProcessingError, process_capture
from app.database import get_db
from app.models import User
from app.schemas import TaskOut
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/captures", tags=["captures"])


class CaptureCreate(BaseModel):
    raw_text: str = Field(min_length=1)


@router.post("", response_model=list[TaskOut], status_code=status.HTTP_201_CREATED)
def create_capture(
    payload: CaptureCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return process_capture(current_user, payload.raw_text, source="web", db=db)
    except CaptureProcessingError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося обробити, спробуйте ще раз",
        )
```

- [ ] **Step 5: Update the existing capture tests for the new import location**

`backend/tests/test_captures.py` currently monkeypatches `extract_tasks` on
`app.captures.router` — that import no longer exists there after Step 4 (the router no
longer imports `extract_tasks` at all). Replace the full contents of
`backend/tests/test_captures.py`:

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
    tasks = response.json()
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
    assert response.json() == []


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

    tasks = captures_service.process_capture(user, "купити молоко", "telegram", db_session)

    assert len(tasks) == 1
    assert tasks[0].status == "draft"
    mock_notify.assert_called_once()
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"
```

- [ ] **Step 6: Run the tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_captures.py -v
```

Expected: all tests pass (7 total: the 4 pre-existing behavior tests plus 2 new
source-gating tests plus the auth test).

- [ ] **Step 7: Run the full backend suite to check for regressions**

```bash
cd backend && source venv/bin/activate && python -m pytest -q
```

Expected: all tests pass, no regressions in unrelated files.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/0006_capture_source.py backend/app/captures/service.py backend/app/models.py backend/app/captures/router.py backend/tests/test_captures.py
git commit -m "feat(backend): add Capture.source, gate Telegram notify to telegram-sourced captures"
```

---

### Task 2: Telegram voice + text capture handling

**Files:**
- Modify: `backend/app/telegram/client.py` (add `get_file`, `download_file`, `send_chat_action`)
- Modify: `backend/app/telegram/handlers.py` (add `handle_capture_message`, `handle_voice_message`, wire into `handle_update`)
- Test: `backend/tests/test_telegram_capture.py` (new)

**Interfaces:**
- Consumes: `process_capture`, `CaptureProcessingError` from Task 1's `backend/app/captures/service.py`; existing `transcribe_audio(audio_bytes: bytes, filename: str) -> str` from `backend/app/ai/whisper.py`; existing `telegram_client.send_message`.
- Produces: nothing new consumed by later tasks — this is the last task in this plan.

- [ ] **Step 1: Add Telegram client helpers**

In `backend/app/telegram/client.py`, add these three functions after the existing `get_updates` function (keep the existing `_api_url` helper and all existing functions unchanged):

```python
def get_file(file_id: str) -> str:
    response = httpx.get(_api_url("getFile"), params={"file_id": file_id})
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None
    return response.json()["result"]["file_path"]


def download_file(file_path: str) -> bytes:
    url = f"https://api.telegram.org/file/bot{settings.telegram_bot_token}/{file_path}"
    response = httpx.get(url)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None
    return response.content


def send_chat_action(chat_id: int, action: str) -> None:
    try:
        httpx.post(_api_url("sendChatAction"), json={"chat_id": chat_id, "action": action})
    except Exception:
        pass
```

- [ ] **Step 2: Add the capture-message handlers**

In `backend/app/telegram/handlers.py`, add these imports at the top (alongside the
existing ones — do not remove any existing import):

```python
from app.ai.whisper import transcribe_audio
from app.captures.service import CaptureProcessingError, process_capture
```

Add this constant near the existing `CODE_INVALID_MESSAGE` constant:

```python
NOT_LINKED_MESSAGE = "Спочатку підключіть акаунт: Налаштування → Telegram-бот у застосунку Taska."
```

Add these two functions after `handle_start` (before `handle_callback_query`):

```python
def handle_capture_message(chat_id: int, raw_text: str, db: Session) -> None:
    user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
    if user is None:
        telegram_client.send_message(chat_id, NOT_LINKED_MESSAGE)
        return

    try:
        tasks = process_capture(user, raw_text, source="telegram", db=db)
    except CaptureProcessingError:
        telegram_client.send_message(chat_id, "Не вдалося обробити, спробуйте ще раз")
        return

    if not tasks:
        telegram_client.send_message(
            chat_id,
            "Taska не змогла визначити задачі в цьому повідомленні. Спробуйте сформулювати інакше.",
        )


def handle_voice_message(chat_id: int, file_id: str, db: Session) -> None:
    user = db.query(User).filter(User.telegram_chat_id == chat_id).first()
    if user is None:
        telegram_client.send_message(chat_id, NOT_LINKED_MESSAGE)
        return

    telegram_client.send_chat_action(chat_id, "typing")

    try:
        file_path = telegram_client.get_file(file_id)
        audio_bytes = telegram_client.download_file(file_path)
        text = transcribe_audio(audio_bytes, "voice.ogg")
    except Exception:
        logger.exception("failed to transcribe Telegram voice message for chat_id=%s", chat_id)
        telegram_client.send_message(chat_id, "Не вдалося розпізнати мову, спробуйте ще раз")
        return

    handle_capture_message(chat_id, text, db)
```

- [ ] **Step 3: Wire the new handlers into `handle_update`**

In `backend/app/telegram/handlers.py`, find the existing `handle_update` function:

```python
def handle_update(update: dict, db: Session) -> None:
    message = update.get("message")
    if message is not None:
        try:
            text = message.get("text", "")
            chat_id = message["chat"]["id"]
            if text.startswith("/start "):
                code = text[len("/start ") :].strip()
                handle_start(chat_id, code, db)
        except Exception:
            logger.exception("failed to handle message update")
        return

    callback_query = update.get("callback_query")
    if callback_query is not None:
        try:
            handle_callback_query(callback_query, db)
        except Exception:
            logger.exception("failed to handle callback_query")
        return
```

Replace the `message is not None` block's body with:

```python
def handle_update(update: dict, db: Session) -> None:
    message = update.get("message")
    if message is not None:
        try:
            text = message.get("text", "")
            chat_id = message["chat"]["id"]
            voice = message.get("voice")
            if text.startswith("/start "):
                code = text[len("/start ") :].strip()
                handle_start(chat_id, code, db)
            elif voice is not None:
                handle_voice_message(chat_id, voice["file_id"], db)
            elif text:
                handle_capture_message(chat_id, text, db)
        except Exception:
            logger.exception("failed to handle message update")
        return

    callback_query = update.get("callback_query")
    if callback_query is not None:
        try:
            handle_callback_query(callback_query, db)
        except Exception:
            logger.exception("failed to handle callback_query")
        return
```

(Only the `message is not None` block's body changes — the `callback_query` block below
it is untouched.)

- [ ] **Step 4: Write tests**

Create `backend/tests/test_telegram_capture.py`:

```python
from unittest.mock import MagicMock

from app.ai.triage import ExtractedTask
from app.captures import service as captures_service
from app.telegram import handlers as telegram_handlers


def _signup(client, email="tgcapture@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_text_message_creates_draft_tasks_and_notifies(client, monkeypatch, db_session):
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

    _signup(client, email="textcapture@example.com")
    user = db_session.query(User).filter(User.email == "textcapture@example.com").first()
    user.telegram_chat_id = 111
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 111}, "text": "купити молоко"}}, db_session
    )

    mock_notify.assert_called_once()
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"


def test_text_message_from_unlinked_chat_replies_not_linked(client, monkeypatch, db_session):
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 999999}, "text": "hello"}}, db_session
    )

    mock_send.assert_called_once_with(999999, telegram_handlers.NOT_LINKED_MESSAGE)


def test_text_message_with_no_tasks_found_replies(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(captures_service, "extract_tasks", MagicMock(return_value=[]))
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    _signup(client, email="emptycapture@example.com")
    user = db_session.query(User).filter(User.email == "emptycapture@example.com").first()
    user.telegram_chat_id = 222
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 222}, "text": "hmm just thinking"}}, db_session
    )

    mock_send.assert_called_once()
    assert "не змогла визначити" in mock_send.call_args.args[1]


def test_voice_message_downloads_transcribes_and_captures(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(telegram_handlers.telegram_client, "send_chat_action", MagicMock())
    monkeypatch.setattr(
        telegram_handlers.telegram_client, "get_file", MagicMock(return_value="voice/file123.oga")
    )
    monkeypatch.setattr(
        telegram_handlers.telegram_client, "download_file", MagicMock(return_value=b"fake-audio-bytes")
    )
    mock_transcribe = MagicMock(return_value="купити молоко")
    monkeypatch.setattr(telegram_handlers, "transcribe_audio", mock_transcribe)
    monkeypatch.setattr(
        captures_service,
        "extract_tasks",
        MagicMock(
            return_value=[
                ExtractedTask(title="Купити молоко", priority=2, deadline=None, scheduled_at=None)
            ]
        ),
    )
    monkeypatch.setattr(captures_service, "notify_new_tasks_ready", MagicMock())

    _signup(client, email="voicecapture@example.com")
    user = db_session.query(User).filter(User.email == "voicecapture@example.com").first()
    user.telegram_chat_id = 333
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 333}, "voice": {"file_id": "voice-file-id-1"}}}, db_session
    )

    mock_transcribe.assert_called_once_with(b"fake-audio-bytes", "voice.ogg")
    capture = db_session.query(captures_service.Capture).filter(
        captures_service.Capture.user_id == user.id
    ).first()
    assert capture.source == "telegram"
    assert capture.raw_text == "купити молоко"


def test_voice_message_transcription_failure_replies_error(client, monkeypatch, db_session):
    from app.models import User

    monkeypatch.setattr(telegram_handlers.telegram_client, "send_chat_action", MagicMock())
    monkeypatch.setattr(
        telegram_handlers.telegram_client, "get_file", MagicMock(side_effect=RuntimeError("boom"))
    )
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    _signup(client, email="voicefail@example.com")
    user = db_session.query(User).filter(User.email == "voicefail@example.com").first()
    user.telegram_chat_id = 444
    db_session.commit()

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 444}, "voice": {"file_id": "voice-file-id-2"}}}, db_session
    )

    mock_send.assert_called_once_with(444, "Не вдалося розпізнати мову, спробуйте ще раз")


def test_voice_message_from_unlinked_chat_replies_not_linked_without_transcribing(
    client, monkeypatch, db_session
):
    mock_get_file = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "get_file", mock_get_file)
    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 555555}, "voice": {"file_id": "voice-file-id-3"}}}, db_session
    )

    mock_get_file.assert_not_called()
    mock_send.assert_called_once_with(555555, telegram_handlers.NOT_LINKED_MESSAGE)
```

- [ ] **Step 5: Run the new tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_telegram_capture.py -v
```

Expected: all 6 tests pass.

- [ ] **Step 6: Run the full backend suite to check for regressions**

```bash
cd backend && source venv/bin/activate && python -m pytest -q
```

Expected: all tests pass (Task 1's tests plus these plus every pre-existing test file),
no regressions — in particular confirm `test_telegram_link.py` and
`test_telegram_approve.py` (the pre-existing `/start` and callback-query paths) still
pass unchanged, since `handle_update`'s `message` branch was modified.

- [ ] **Step 7: Commit**

```bash
git add backend/app/telegram/client.py backend/app/telegram/handlers.py backend/tests/test_telegram_capture.py
git commit -m "feat(backend): handle Telegram voice and text messages as captures"
```

---

## Self-Review

**Spec coverage:** `Capture.source` field + migration (Task 1 Steps 1-2); shared
`process_capture` service raising `CaptureProcessingError` instead of `HTTPException`,
notification gated on `source == "telegram"` (Task 1 Step 3); `POST /captures` refactored
as a thin wrapper with unchanged external contract (Task 1 Step 4); Telegram client
`get_file`/`download_file`/`send_chat_action` (Task 2 Step 1); `handle_capture_message`
(shared tail for text and post-transcription voice, unlinked-chat / empty-result /
triage-failure replies) and `handle_voice_message` (chat-action hint, download,
transcribe, delegates to `handle_capture_message`) (Task 2 Step 2); `handle_update`
wired to dispatch voice and plain-text messages, `/start` and callback_query paths
untouched (Task 2 Step 3) — all covered. Backend-only, no frontend changes anywhere in
this plan, matching the spec's scope boundary.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code including full
test files.

**Type consistency:** `process_capture(user: User, raw_text: str, source: str, db:
Session) -> list[Task]` and `CaptureProcessingError` are defined once in Task 1 Step 3
and consumed with matching names/signature by Task 1 Step 4 (`captures/router.py`) and
Task 2 Step 2 (`telegram/handlers.py`). `transcribe_audio(audio_bytes: bytes, filename:
str) -> str` (pre-existing, unchanged) is called with the same two-positional-argument
shape in Task 2 Step 2 as it already is in `transcription/router.py`.
