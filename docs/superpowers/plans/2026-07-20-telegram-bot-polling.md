# AI Planner — Plan 6.1: Telegram Bot — Switch to Polling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plan 6's webhook-based Telegram update delivery (which Telegram's servers cannot reach due to an unresolved inbound-connectivity block on the production VPS) with long-polling, an outbound-only mechanism already proven to work.

**Architecture:** Move the existing `/start`-linking and Approve/Reject handling logic out of the webhook route into a shared `app/telegram/handlers.py`, add a `get_updates` wrapper to `app/telegram/client.py`, and add a background daemon thread (`app/telegram/polling.py`) that loops calling `getUpdates` and dispatches each update through the same handler logic. The webhook route and its secret-token verification are removed entirely.

**Tech Stack:** Same as Plan 6 (FastAPI, SQLAlchemy, `httpx`, `APScheduler` already in place) — no new dependencies.

## Global Constraints

- No change to user-facing behavior, notification content, or the Approve/Reject UX — this is purely a delivery-mechanism swap.
- The polling `offset` is tracked only in-memory in the background thread, never persisted to the database — this is safe because every handler is already idempotent (an already-used link code is rejected again harmlessly; an already-resolved task callback just re-renders its current state), so redelivery of a handful of already-processed updates after a rare process restart causes no incorrect behavior.
- Telegram's `getUpdates` and webhook delivery are mutually exclusive — `deleteWebhook` must be called once during deployment before polling will receive anything.
- Product language is Ukrainian — unchanged from Plan 6, no new user-facing strings are introduced by this plan.
- Reduced testing approach (same standing preference as every other plan in this project): no new dedicated test-writing task. The two existing tests that posted to the now-removed webhook route are updated in place to call the relocated handler logic directly — this is required to keep the refactor correct, not additional test-writing.

---

## File Structure

```
backend/
  app/
    config.py                     # - telegram_webhook_secret
    telegram/
      client.py                    # + get_updates
      handlers.py                   # NEW — handle_start, handle_callback_query, handle_update (moved from router.py)
      router.py                      # shrinks to just GET /telegram/connect
      polling.py                      # NEW — background thread: start(), stop()
    main.py                            # lifespan wires polling start()/stop() alongside the scheduler
  .env.example                          # - TELEGRAM_WEBHOOK_SECRET
  tests/
    conftest.py                          # - TELEGRAM_WEBHOOK_SECRET default
    test_telegram_link.py                 # updated to call handlers.handle_update directly
    test_telegram_approve.py               # updated to call handlers.handle_update directly
```

---

### Task 1: Replace webhook delivery with long-polling

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/app/telegram/client.py`
- Create: `backend/app/telegram/handlers.py`
- Modify: `backend/app/telegram/router.py`
- Create: `backend/app/telegram/polling.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_telegram_link.py`
- Modify: `backend/tests/test_telegram_approve.py`

**Interfaces:**
- Consumes: `app.tasks.router._sync_task_calendar` (unchanged from Plan 6), `app.telegram.notifications.render_batch_message` (unchanged)
- Produces: `app.telegram.client.get_updates(offset: int | None, timeout: int = 30, allowed_updates: list[str] | None = None) -> list[dict]`; `app.telegram.handlers.handle_start(chat_id: int, code: str, db: Session) -> None`, `handle_callback_query(callback_query: dict, db: Session) -> None`, `handle_update(update: dict, db: Session) -> None`, `CODE_INVALID_MESSAGE: str`; `app.telegram.polling.start() -> None`, `stop() -> None`

This is a single cohesive refactor — there's no sensible point to split it into smaller reviewable pieces, since every file change exists to serve the same one deliverable (updates flow correctly through polling instead of a webhook).

- [ ] **Step 1: Remove `telegram_webhook_secret` from `backend/app/config.py`**

Find:

```python
    telegram_bot_token: str = ""
    telegram_webhook_secret: str = ""
    telegram_bot_username: str = ""
```

Replace with:

```python
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
```

- [ ] **Step 2: Remove `TELEGRAM_WEBHOOK_SECRET` from `backend/.env.example`**

Find:

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_BOT_USERNAME=
```

Replace with:

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
```

- [ ] **Step 3: Remove the `TELEGRAM_WEBHOOK_SECRET` test default from `backend/tests/conftest.py`**

Find:

```python
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("TELEGRAM_BOT_USERNAME", "test_bot")
```

Replace with:

```python
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("TELEGRAM_BOT_USERNAME", "test_bot")
```

- [ ] **Step 4: Add `get_updates` to `backend/app/telegram/client.py`**

Full new file content:

```python
import json

import httpx

from app.config import settings


def _api_url(method: str) -> str:
    return f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"


def send_message(chat_id: int, text: str, reply_markup: dict | None = None) -> dict:
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    response = httpx.post(_api_url("sendMessage"), json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None
    return response.json()["result"]


def edit_message(
    chat_id: int, message_id: int, text: str, reply_markup: dict | None = None
) -> None:
    payload: dict = {"chat_id": chat_id, "message_id": message_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    response = httpx.post(_api_url("editMessageText"), json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None


def answer_callback_query(callback_query_id: str, text: str | None = None) -> None:
    payload: dict = {"callback_query_id": callback_query_id}
    if text is not None:
        payload["text"] = text
    response = httpx.post(_api_url("answerCallbackQuery"), json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None


def get_updates(
    offset: int | None, timeout: int = 30, allowed_updates: list[str] | None = None
) -> list[dict]:
    params: dict = {"timeout": timeout}
    if offset is not None:
        params["offset"] = offset
    if allowed_updates is not None:
        params["allowed_updates"] = json.dumps(allowed_updates)
    response = httpx.get(_api_url("getUpdates"), params=params, timeout=timeout + 10)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"Telegram API error {e.response.status_code}") from None
    return response.json()["result"]
```

`get_updates` is itself a long-polling HTTP call — Telegram holds the connection open for up to `timeout` seconds server-side waiting for new updates before responding. The `httpx.get(..., timeout=timeout + 10)` gives the client 10 extra seconds of headroom over Telegram's own wait, so our own client doesn't time out the connection prematurely while Telegram is legitimately still waiting. `allowed_updates` must be JSON-encoded as a string query parameter — Telegram's HTTP API (as opposed to its JSON-body webhook payloads) expects this field as a JSON-encoded array string, not a repeated query key.

- [ ] **Step 5: Create `backend/app/telegram/handlers.py`**

```python
import datetime
import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Task, TelegramLinkCode, User
from app.tasks.router import _sync_task_calendar
from app.telegram import client as telegram_client
from app.telegram.notifications import render_batch_message

logger = logging.getLogger(__name__)

CODE_INVALID_MESSAGE = "Код недійсний або застарів, спробуйте ще раз у Налаштуваннях."


def handle_start(chat_id: int, code: str, db: Session) -> None:
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


def handle_callback_query(callback_query: dict, db: Session) -> None:
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

This is `_handle_start`/`_handle_callback_query` from Plan 6's `router.py`, renamed to public names (`handle_start`/`handle_callback_query`) and moved here, plus the dispatch logic that used to live directly inside the `webhook()` route — `handle_update` is that same dispatch, with the FastAPI-specific parts (secret-token check, `{"ok": True}` response) removed since polling has no equivalent concepts.

- [ ] **Step 6: Trim `backend/app/telegram/router.py` down to just the connect endpoint**

Full new file content:

```python
import datetime
import secrets

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import TelegramLinkCode, User
from app.security import get_current_user

router = APIRouter(tags=["telegram"])

LINK_CODE_EXPIRY_MINUTES = 10


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
```

- [ ] **Step 7: Create `backend/app/telegram/polling.py`**

```python
import logging
import threading

from app.database import SessionLocal
from app.telegram import client as telegram_client
from app.telegram.handlers import handle_update

logger = logging.getLogger(__name__)

POLL_TIMEOUT_SECONDS = 30
ERROR_RETRY_DELAY_SECONDS = 5
ALLOWED_UPDATES = ["message", "callback_query"]

_stop_event = threading.Event()
_thread: threading.Thread | None = None


def _poll_loop() -> None:
    offset: int | None = None
    while not _stop_event.is_set():
        try:
            updates = telegram_client.get_updates(
                offset, timeout=POLL_TIMEOUT_SECONDS, allowed_updates=ALLOWED_UPDATES
            )
        except Exception:
            logger.exception("failed to fetch Telegram updates")
            _stop_event.wait(ERROR_RETRY_DELAY_SECONDS)
            continue

        for update in updates:
            offset = update["update_id"] + 1
            db = SessionLocal()
            try:
                handle_update(update, db)
            except Exception:
                logger.exception(
                    "failed to handle Telegram update_id=%s", update.get("update_id")
                )
            finally:
                db.close()


def start() -> None:
    global _thread
    _stop_event.clear()
    _thread = threading.Thread(target=_poll_loop, name="telegram-polling", daemon=True)
    _thread.start()


def stop() -> None:
    _stop_event.set()
```

`_stop_event.wait(ERROR_RETRY_DELAY_SECONDS)` (rather than a plain `time.sleep`) lets `stop()` interrupt the retry delay immediately instead of waiting out the full 5 seconds. The blocking `get_updates` call itself (up to ~30-40 seconds including its own network timeout) can't be interrupted mid-flight — `stop()` only takes effect once that call returns and the loop checks `_stop_event.is_set()` again. Since the thread is a daemon thread, this doesn't block application/process shutdown either way; it's an acceptable trade-off for an MVP, matching the "good enough, not overbuilt" bar already established elsewhere in this project (e.g., no retry queue for Calendar sync failures).

- [ ] **Step 8: Wire polling into `backend/app/main.py`'s lifespan**

Find:

```python
from app.tasks.router import router as tasks_router
from app.telegram.router import router as telegram_router
from app.telegram.scheduler import send_daily_digest_and_overdue_nudges, send_scheduled_reminders
from app.transcription.router import router as transcription_router
```

Replace with:

```python
from app.tasks.router import router as tasks_router
from app.telegram import polling as telegram_polling
from app.telegram.router import router as telegram_router
from app.telegram.scheduler import send_daily_digest_and_overdue_nudges, send_scheduled_reminders
from app.transcription.router import router as transcription_router
```

Find:

```python
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
```

Replace with:

```python
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
    telegram_polling.start()
    yield
    telegram_polling.stop()
    scheduler.shutdown()
```

- [ ] **Step 9: Update `backend/tests/test_telegram_link.py` to call the handler directly**

Full new file content:

```python
import datetime
from unittest.mock import MagicMock

from app.telegram import handlers as telegram_handlers


def _signup(client, email="telegramuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_start_with_expired_code_does_not_link(client, monkeypatch, db_session):
    from app.models import TelegramLinkCode, User

    mock_send = MagicMock()
    monkeypatch.setattr(telegram_handlers.telegram_client, "send_message", mock_send)

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

    telegram_handlers.handle_update(
        {"message": {"chat": {"id": 999}, "text": "/start expired-code"}}, db_session
    )

    db_session.refresh(user)
    assert user.telegram_chat_id is None
    mock_send.assert_called_once_with(999, telegram_handlers.CODE_INVALID_MESSAGE)
```

- [ ] **Step 10: Update `backend/tests/test_telegram_approve.py` to call the handler directly**

Full new file content:

```python
import datetime
from unittest.mock import MagicMock

from app.tasks import router as tasks_router
from app.telegram import handlers as telegram_handlers


def _signup(client, email="approveuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_approve_callback_confirms_task_and_syncs_calendar(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_create_event = MagicMock(return_value="fake-event-id")
    monkeypatch.setattr(tasks_router.google_calendar_client, "create_event", mock_create_event)
    monkeypatch.setattr(telegram_handlers.telegram_client, "edit_message", MagicMock())
    monkeypatch.setattr(telegram_handlers.telegram_client, "answer_callback_query", MagicMock())

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

    telegram_handlers.handle_update(
        {
            "callback_query": {
                "id": "cbq-1",
                "data": f"approve:{task.id}",
                "message": {"message_id": 42, "chat": {"id": 555}},
            }
        },
        db_session,
    )

    mock_create_event.assert_called_once()
    db_session.refresh(task)
    assert task.status == "confirmed"
    assert task.google_event_id == "fake-event-id"
```

The mock is patched on `tasks_router.google_calendar_client` (i.e. `app.tasks.router`'s own module-level import) — unchanged from Plan 6, since `_sync_task_calendar` is still defined there and still looks up `google_calendar_client` in that module's namespace regardless of which other module calls it by name.

- [ ] **Step 11: Verify everything**

```bash
cd backend
source venv/bin/activate
DATABASE_URL=sqlite:///:memory: JWT_SECRET=x python3 -c "from app.main import app; print('ok')"
pytest tests/ -v
```

Expected: `ok` printed, no import errors (confirms `webhook`/`Header`/`HTTPException`/`status` imports were fully removed from `router.py` with nothing left referencing them); full test suite passes, including the two updated Telegram tests. There should be no remaining references anywhere in `backend/` to `/telegram/webhook`, `TELEGRAM_WEBHOOK_SECRET`, or `X-Telegram-Bot-Api-Secret-Token` — a quick sanity grep confirms this:

```bash
grep -rn "telegram/webhook\|TELEGRAM_WEBHOOK_SECRET\|telegram_webhook_secret\|X-Telegram-Bot-Api-Secret-Token" backend/ --include="*.py"
```

Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add backend/app/config.py backend/.env.example backend/tests/conftest.py \
  backend/app/telegram/client.py backend/app/telegram/handlers.py \
  backend/app/telegram/router.py backend/app/telegram/polling.py \
  backend/app/main.py backend/tests/test_telegram_link.py backend/tests/test_telegram_approve.py
git commit -m "refactor: replace Telegram webhook delivery with long-polling"
```

---

### Task 2: Deploy to the VPS

**Files:** none (deployment only)

- [ ] **Step 1: On the VPS, pull the changes**

```bash
cd ai-planner
git pull
```

- [ ] **Step 2: Remove the now-unused webhook secret from `backend/.env`**

Edit `backend/.env` and delete the `TELEGRAM_WEBHOOK_SECRET=...` line (harmless to leave, but there's no reason to keep a secret around for a mechanism that no longer exists).

- [ ] **Step 3: Rebuild and restart**

```bash
docker compose up -d --build backend
docker compose logs backend --tail 30
```

Expected: clean startup, no errors. You should NOT see the `apscheduler` startup lines change — the polling thread doesn't log a startup line itself in this plan, but you should see normal `Uvicorn running on http://0.0.0.0:8000` followed shortly by outbound `httpx` log lines to `api.telegram.org/.../getUpdates` as the polling loop begins.

- [ ] **Step 4: Delete the webhook registration — required before polling will receive anything**

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/deleteWebhook"
```

Expected: `{"ok":true,"result":true,"description":"Webhook was deleted"}`. Confirm with:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Expected: `"url":""` — no webhook registered, meaning `getUpdates` will now actually return data.

- [ ] **Step 5: End-to-end manual QA**

1. `/settings` — tap "Підключити Telegram бота," confirm your Telegram app opens to the bot's chat, tap **Start**, confirm the bot replies "✅ Підключено!" within a few seconds and the Settings page flips to "✅ Підключено" on its own.
2. `/capture` — submit a capture that produces 1-2 draft tasks, confirm a "🆕 N нових задач готові до перегляду" message arrives with inline buttons within a few seconds.
3. Tap ✅ on one task — confirm the message updates in place, the task shows `confirmed` in the web app, and (if Calendar is connected and the task has a `scheduled_at`) the event appears in your real Google Calendar.
4. Tap ❌ on another task — confirm it updates to "❌ Відхилено" and disappears from the web Inbox.
5. Schedule a task for a couple of minutes from now, wait for it to pass — confirm a "⏰" reminder arrives.
6. Check `docker compose logs backend --tail 50` at some point during testing — confirm you see periodic outbound `getUpdates` calls and no repeated error/retry log lines.
