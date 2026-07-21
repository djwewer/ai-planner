# Delete Account Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user permanently delete their own Taska account and everything they own, via a typed-confirmation frontend flow calling a new authenticated backend endpoint.

**Architecture:** A new `DELETE /auth/me` endpoint (backend) deletes the user's tasks, captures, Telegram link codes, and user row in dependency-safe order, optionally cleaning up their synced Google Calendar events/Tasks first and sending a final Telegram notice if linked. A new full-screen confirmation overlay (frontend, mirroring the existing `EditTaskSheet`/`CaptureFlow` `.flow` pattern) gates the call behind a typed confirmation word, then redirects to a one-time login-page notice.

**Tech Stack:** FastAPI/SQLAlchemy backend (reuses existing Google Calendar/Tasks client functions and Telegram client, no new dependency), Next.js/React frontend (no new dependency).

## Global Constraints

- No new pip/npm dependency.
- `DELETE /auth/me` requires the existing `get_current_user` auth dependency — no extra step-up authentication, matching every other mutating endpoint in this codebase.
- This is a real, permanent delete — no soft-delete, no undo, no grace period.
- Ukrainian-only user-facing copy.
- Confirmation word is the literal string `ВИДАЛИТИ`.
- Backend tests required for the new logic, matching this project's existing `pytest` convention (mock all external calls — Google Calendar/Tasks API, Telegram API — never hit real services in tests). Keep the test set lean — cover the meaningfully distinct code paths the spec calls out, not exhaustive permutations.
- Frontend has no unit test framework (established convention) — verification is `npm run build`/`npm run lint` clean plus a browser walkthrough.

---

### Task 1: `DELETE /auth/me` backend endpoint

**Files:**
- Create: `backend/app/auth/service.py`
- Modify: `backend/app/auth/router.py`
- Modify: `backend/app/schemas.py` (add `DeleteAccountRequest`)
- Test: `backend/tests/test_delete_account.py`

**Interfaces:**
- Produces: `delete_account(user: User, remove_google_events: bool, db: Session) -> None` from `backend/app/auth/service.py` — this is the only thing Task 2 (frontend) depends on indirectly, via the HTTP contract below. No other task in this plan consumes this function directly.
- HTTP contract: `DELETE /auth/me`, body `{"remove_google_events": bool}`, requires `Authorization: Bearer <token>`, returns `204 No Content` on success.

- [ ] **Step 1: Add the request schema**

In `backend/app/schemas.py`, add this class at the end of the file (after the existing `CaptureResponse` class):

```python
class DeleteAccountRequest(BaseModel):
    remove_google_events: bool = False
```

- [ ] **Step 2: Create the account-deletion service function**

Create `backend/app/auth/service.py`:

```python
import logging

from sqlalchemy.orm import Session

from app.google_calendar import client as google_calendar_client
from app.google_calendar import tasks_client as google_tasks_client
from app.models import Capture, Task, TelegramLinkCode, User
from app.telegram import client as telegram_client

logger = logging.getLogger(__name__)


def delete_account(user: User, remove_google_events: bool, db: Session) -> None:
    tasks = db.query(Task).filter(Task.user_id == user.id).all()

    if remove_google_events:
        for task in tasks:
            if task.google_event_id is not None:
                try:
                    google_calendar_client.delete_event(user, task.google_event_id)
                except Exception:
                    logger.exception(
                        "failed to delete calendar event for task_id=%s during account deletion",
                        task.id,
                    )
            if task.google_task_id is not None:
                try:
                    google_tasks_client.delete_task(user, task.google_task_id)
                except Exception:
                    logger.exception(
                        "failed to delete google task for task_id=%s during account deletion",
                        task.id,
                    )

    if user.telegram_chat_id is not None:
        try:
            telegram_client.send_message(
                user.telegram_chat_id,
                "Ваш акаунт Taska видалено. Дякуємо, що користувалися сервісом!",
            )
        except Exception:
            logger.exception(
                "failed to send account-deletion notice to chat_id=%s", user.telegram_chat_id
            )

    for task in tasks:
        db.delete(task)
    db.flush()

    db.query(Capture).filter(Capture.user_id == user.id).delete(synchronize_session=False)
    db.query(TelegramLinkCode).filter(TelegramLinkCode.user_id == user.id).delete(
        synchronize_session=False
    )
    db.delete(user)
    db.commit()
```

- [ ] **Step 3: Add the route**

In `backend/app/auth/router.py`, add this import alongside the existing ones (the file currently imports `Token, UserCreate, UserLogin, UserOut` from `app.schemas` — extend that same import line):

```python
from app.schemas import DeleteAccountRequest, Token, UserCreate, UserLogin, UserOut
```

Add this import for the new service function, alongside the existing `from app.security import ...` line:

```python
from app.auth.service import delete_account
```

Add this route at the end of `backend/app/auth/router.py` (after the existing `google_callback` function):

```python
@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(
    payload: DeleteAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    delete_account(current_user, payload.remove_google_events, db)
```

- [ ] **Step 4: Write the tests**

Create `backend/tests/test_delete_account.py`:

```python
from unittest.mock import MagicMock

from app.auth import service as auth_service


def _signup_and_get_token(client, email="deleteme@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_delete_account_requires_auth(client):
    response = client.delete("/auth/me", json={"remove_google_events": False})
    assert response.status_code == 401


def test_delete_account_removes_user_and_owned_rows(client, db_session):
    from app.models import Capture, Task, User

    token = _signup_and_get_token(client)
    user = db_session.query(User).filter(User.email == "deleteme@example.com").first()
    capture = Capture(user_id=user.id, raw_text="test", status="complete", source="web")
    db_session.add(capture)
    db_session.commit()
    db_session.refresh(capture)
    task = Task(user_id=user.id, capture_id=capture.id, title="Задача", status="confirmed")
    db_session.add(task)
    db_session.commit()

    response = client.delete(
        "/auth/me",
        json={"remove_google_events": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert db_session.query(User).filter(User.email == "deleteme@example.com").first() is None
    assert db_session.query(Task).filter(Task.user_id == user.id).first() is None
    assert db_session.query(Capture).filter(Capture.user_id == user.id).first() is None


def test_delete_account_with_google_cleanup_calls_google_clients(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_delete_event = MagicMock()
    mock_delete_task = MagicMock()
    monkeypatch.setattr(auth_service.google_calendar_client, "delete_event", mock_delete_event)
    monkeypatch.setattr(auth_service.google_tasks_client, "delete_task", mock_delete_task)

    token = _signup_and_get_token(client, email="googlecleanup@example.com")
    user = db_session.query(User).filter(User.email == "googlecleanup@example.com").first()
    task_with_event = Task(
        user_id=user.id, title="Зустріч", status="confirmed", google_event_id="evt-1"
    )
    task_with_gtask = Task(
        user_id=user.id, title="Купити молоко", status="confirmed", google_task_id="gt-1"
    )
    db_session.add_all([task_with_event, task_with_gtask])
    db_session.commit()

    response = client.delete(
        "/auth/me",
        json={"remove_google_events": True},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    mock_delete_event.assert_called_once()
    assert mock_delete_event.call_args.args[1] == "evt-1"
    mock_delete_task.assert_called_once()
    assert mock_delete_task.call_args.args[1] == "gt-1"


def test_delete_account_without_google_cleanup_skips_google_clients(client, monkeypatch, db_session):
    from app.models import Task, User

    mock_delete_event = MagicMock()
    monkeypatch.setattr(auth_service.google_calendar_client, "delete_event", mock_delete_event)

    token = _signup_and_get_token(client, email="nocleanup@example.com")
    user = db_session.query(User).filter(User.email == "nocleanup@example.com").first()
    task = Task(user_id=user.id, title="Зустріч", status="confirmed", google_event_id="evt-2")
    db_session.add(task)
    db_session.commit()

    response = client.delete(
        "/auth/me",
        json={"remove_google_events": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    mock_delete_event.assert_not_called()


def test_delete_account_notifies_linked_telegram_chat(client, monkeypatch, db_session):
    from app.models import User

    mock_send = MagicMock()
    monkeypatch.setattr(auth_service.telegram_client, "send_message", mock_send)

    token = _signup_and_get_token(client, email="tglinked@example.com")
    user = db_session.query(User).filter(User.email == "tglinked@example.com").first()
    user.telegram_chat_id = 4242
    db_session.commit()

    response = client.delete(
        "/auth/me",
        json={"remove_google_events": False},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    mock_send.assert_called_once()
    assert mock_send.call_args.args[0] == 4242


def test_delete_account_survives_google_cleanup_failure(client, monkeypatch, db_session):
    from app.models import Task, User

    monkeypatch.setattr(
        auth_service.google_calendar_client,
        "delete_event",
        MagicMock(side_effect=RuntimeError("Google API down")),
    )

    token = _signup_and_get_token(client, email="cleanupfails@example.com")
    user = db_session.query(User).filter(User.email == "cleanupfails@example.com").first()
    task = Task(user_id=user.id, title="Зустріч", status="confirmed", google_event_id="evt-3")
    db_session.add(task)
    db_session.commit()

    response = client.delete(
        "/auth/me",
        json={"remove_google_events": True},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 204
    assert db_session.query(User).filter(User.email == "cleanupfails@example.com").first() is None
```

- [ ] **Step 5: Run the tests**

```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_delete_account.py -v
```

Expected: 6 passed.

- [ ] **Step 6: Run the full backend suite to check for regressions**

```bash
cd backend && source venv/bin/activate && python -m pytest -q
```

Expected: all tests pass, no regressions in unrelated files.

- [ ] **Step 7: Commit**

```bash
git add backend/app/auth/service.py backend/app/auth/router.py backend/app/schemas.py backend/tests/test_delete_account.py
git commit -m "feat(backend): add DELETE /auth/me to permanently delete a user's account"
```

---

### Task 2: Frontend confirmation overlay

**Files:**
- Modify: `frontend/lib/api.ts` (add an optional body param to `delete`)
- Create: `frontend/components/delete-account-sheet/DeleteAccountSheet.tsx`
- Modify: `frontend/app/(app)/settings/page.tsx` (add the trigger button + overlay)
- Modify: `frontend/app/login/page.tsx` (add the post-deletion notice)

**Interfaces:**
- Consumes: `DELETE /auth/me` (Task 1's HTTP contract — body `{remove_google_events: boolean}`, `204` on success); existing `useAuth()` (`frontend/lib/auth-context.tsx`, exposes `logout()` which already does the token-clear + redirect this task partially reuses); existing `Me` type already defined inline in `frontend/app/(app)/settings/page.tsx` (`{id, email, google_calendar_connected, telegram_connected}`).
- Produces: nothing consumed by a later task — this is the last task in this plan.

- [ ] **Step 1: Give `api.delete` an optional body**

In `frontend/lib/api.ts`, find this line:

```ts
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
```

Replace it with:

```ts
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body ? JSON.stringify(body) : undefined }),
```

(This is backward-compatible — every existing call site passes no second argument and is unaffected.)

- [ ] **Step 2: Create the confirmation overlay**

Create `frontend/components/delete-account-sheet/DeleteAccountSheet.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const CONFIRM_WORD = "ВИДАЛИТИ";

export function DeleteAccountSheet({
  googleCalendarConnected,
  onClose,
}: {
  googleCalendarConnected: boolean;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [removeGoogleEvents, setRemoveGoogleEvents] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { logout } = useAuth();
  const router = useRouter();

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api.delete("/auth/me", { remove_google_events: removeGoogleEvents });
      logout();
      router.push("/login?deleted=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося видалити акаунт");
      setDeleting(false);
    }
  }

  return (
    <div className="flow">
      <div className="flow-header">
        <button className="text-btn" onClick={onClose}>Скасувати</button>
        <div className="flow-title">Видалити акаунт</div>
        <span style={{ width: 44 }} aria-hidden="true" />
      </div>
      <div className="flow-body" style={{ gap: 16 }}>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
          Це незворотна дія. Усі ваші задачі та дані буде видалено назавжди.
        </p>
        {googleCalendarConnected && (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={removeGoogleEvents}
              onChange={(e) => setRemoveGoogleEvents(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            Також видалити пов&apos;язані події з Google Calendar
          </label>
        )}
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
          Введіть {CONFIRM_WORD}, щоб підтвердити
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            style={{
              width: "100%",
              marginTop: 6,
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: 15,
              fontFamily: "var(--font-ui)",
            }}
          />
        </label>
        {error && <p style={{ color: "var(--error)", fontSize: 13 }}>{error}</p>}
        <button
          className="primary-btn"
          style={{ background: "var(--error)", marginTop: "auto" }}
          disabled={confirmText !== CONFIRM_WORD || deleting}
          onClick={handleDelete}
        >
          {deleting ? "Видалення…" : "Видалити назавжди"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the trigger button into Settings**

In `frontend/app/(app)/settings/page.tsx`, add this import alongside the existing ones:

```tsx
import { DeleteAccountSheet } from "@/components/delete-account-sheet/DeleteAccountSheet";
```

Add a new state variable inside `SettingsPageInner`, alongside the existing `useState` calls:

```tsx
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
```

Find this block (the logout button, currently the last thing rendered before the closing `</>`):

```tsx
            <div style={{ margin: "0 20px" }}>
              <button className="secondary-btn" onClick={logout}>Вийти з акаунта</button>
            </div>
```

Replace it with:

```tsx
            <div style={{ margin: "0 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="secondary-btn" onClick={logout}>Вийти з акаунта</button>
              <button
                className="text-btn"
                style={{ color: "var(--error)" }}
                onClick={() => setShowDeleteAccount(true)}
              >
                Видалити акаунт
              </button>
            </div>
```

Find the closing of the component's returned JSX (the end of the `<div className="scroll">...</div>` block, right before the final `</>`  in the `return` statement), and add the overlay right after `</div>` (the closing tag of `<div className="scroll">`), still inside the outer fragment:

```tsx
      </div>
      {showDeleteAccount && (
        <DeleteAccountSheet
          googleCalendarConnected={me?.google_calendar_connected ?? false}
          onClose={() => setShowDeleteAccount(false)}
        />
      )}
    </>
```

(This replaces whatever the current final two lines of the return statement are — the closing `</div>` for `.scroll` followed immediately by `</>`.)

- [ ] **Step 4: Add the post-deletion login notice**

In `frontend/app/login/page.tsx`, find this line:

```tsx
  const oauthError = searchParams.get("error");
```

Add a new line right after it:

```tsx
  const justDeleted = searchParams.get("deleted") === "1";
```

Find this block:

```tsx
      {oauthError === "email_not_verified" && (
        <p className="auth-notice">
          Електронна пошта вашого облікового запису Google не підтверджена, тому
          автоматичне прив&apos;язування неможливе. Увійдіть за допомогою email та пароля.
        </p>
      )}
```

Add this right after it (still before the `<form>`):

```tsx
      {justDeleted && (
        <p className="auth-notice">Акаунт видалено. Дякуємо, що користувалися Taska.</p>
      )}
```

- [ ] **Step 5: Verify — build and lint**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both clean, no errors.

- [ ] **Step 6: Verify in the browser**

Start the dev server and a test backend, sign up a fresh test account, go to Settings, tap "Видалити акаунт" — confirm the delete button stays disabled until `ВИДАЛИТИ` is typed exactly, confirm the Google Calendar checkbox only appears if that account has Google Calendar connected, then complete a real deletion and confirm: redirect to `/login?deleted=1`, the notice text appears, and the deleted account can no longer log in.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/api.ts frontend/components/delete-account-sheet/DeleteAccountSheet.tsx "frontend/app/(app)/settings/page.tsx" frontend/app/login/page.tsx
git commit -m "feat(frontend): add delete-account confirmation flow"
```

---

## Self-Review

**Spec coverage:** `DELETE /auth/me` with `get_current_user` auth, no step-up (Task 1 Step 3); dependency-safe deletion order (tasks → flush → captures/telegram codes → user → commit) matching the spec's exact reasoning about the missing cascades (Task 1 Step 2); opt-in Google cleanup reusing `delete_event`/`delete_task`, best-effort/swallowed failures (Task 1 Step 2); best-effort final Telegram notice before the user row is gone (Task 1 Step 2); typed-confirmation gate with the exact word `ВИДАЛИТИ`, Google checkbox shown only when connected and unticked by default (Task 2 Step 2); post-deletion redirect to `/login?deleted=1` with a one-time notice mirroring the existing `email_not_verified` pattern (Task 2 Steps 2 and 4) — all covered.

**Placeholder scan:** no TBD/TODO; every step has complete, runnable code.

**Type consistency:** `delete_account(user: User, remove_google_events: bool, db: Session) -> None` (Task 1 Step 2) is called with matching argument order/types in Task 1 Step 3's route handler. `DeleteAccountRequest.remove_google_events: bool = False` (Task 1 Step 1) matches the frontend's `{remove_google_events: boolean}` request body (Task 2 Step 2) exactly. `api.delete<T>(path, body?)` (Task 2 Step 1) is called with a body argument consistently in Task 2 Step 2, and every pre-existing call site (task deletion in `frontend/app/(app)/tasks/page.tsx`, archive undo, etc.) remains a single-argument call, unaffected by the new optional parameter.
