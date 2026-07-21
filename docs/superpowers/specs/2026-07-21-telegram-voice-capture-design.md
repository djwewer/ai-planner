# Plan A: Telegram Voice Capture + Notification Source-Awareness — Design

## Purpose

Two related bugs/gaps in the capture pipeline:

1. **Telegram notifications fire regardless of where a capture came from.** `POST
   /captures` (the web app's only entry point today) unconditionally calls
   `notify_new_tasks_ready` after creating draft tasks, so a user who captures via the
   web app — while already looking at the app — also gets a redundant Telegram
   notification, if they've linked their account.
2. **The Telegram bot cannot receive captures at all.** `handle_update`
   (`backend/app/telegram/handlers.py`) only branches on `/start <code>` (account
   linking) and `callback_query` (the approve/reject buttons on an existing
   notification). Any other message — voice or text — is silently ignored.

This plan fixes both by giving `Capture` a `source` (`"web"` | `"telegram"`), gating the
existing notification on `source == "telegram"` instead of firing unconditionally, and
adding a real Telegram inbound capture path (voice, transcribed locally with the same
`faster-whisper` model the web app already uses, and plain text) that reuses the
existing AI-triage pipeline. The existing notification message *is* the "send the
result back to the bot" mechanism the source of this plan asked for — no new Telegram
message format is needed, it's just now reachable from a genuinely new capture source
instead of only ever firing for web-originated ones.

## Current state (baseline)

- `POST /captures` (`backend/app/captures/router.py`): creates a `Capture` row, calls
  `extract_tasks(raw_text, today)` (OpenAI `gpt-4o-mini` function-calling,
  `backend/app/ai/triage.py`), creates draft `Task` rows from the result, then
  unconditionally calls `notify_new_tasks_ready(current_user, tasks)`.
- `notify_new_tasks_ready` / `render_batch_message`
  (`backend/app/telegram/notifications.py`): builds the existing "Ось нові задачі для
  підтвердження" message with per-task approve/reject inline buttons; no-ops if the
  user has no linked `telegram_chat_id` or `tasks` is empty.
- `POST /transcribe` (`backend/app/transcription/router.py`) calls `transcribe_audio(
  audio_bytes: bytes, filename: str) -> str` (`backend/app/ai/whisper.py`) — a plain
  function, not tied to HTTP, using a lazily-loaded local `faster-whisper` "medium"
  model (`language="uk"` hardcoded). It writes the bytes to a temp file (extension
  taken from `filename`) and lets `faster-whisper`'s ffmpeg-based decoder handle
  whatever container it is — this already works for the web app's WebM/Opus
  `MediaRecorder` output and will work equally well for Telegram's OGG/Opus voice
  notes without any new conversion step.
- `backend/app/telegram/client.py`: thin `httpx`-based wrappers for `sendMessage`,
  `editMessageText`, `answerCallbackQuery`, `getUpdates`. No file-download helpers yet
  (`getFile` / the file-content download endpoint are separate Bot API calls Telegram
  requires for any message attachment, including voice notes).
- `backend/app/telegram/handlers.py`: `handle_update` dispatches `message` updates only
  to `handle_start` (and only when the text is literally `/start <code>`) and
  `callback_query` updates to `handle_callback_query`. Long-polled via
  `backend/app/telegram/polling.py` (`ALLOWED_UPDATES = ["message", "callback_query"]`
  — already broad enough to receive voice messages, nothing to change there).
- Account linking: `GET /telegram/connect` issues a `TelegramLinkCode`, deep-links to
  `t.me/<bot>?start=<code>`; `handle_start` resolves it and sets
  `User.telegram_chat_id`. This is the only existing `chat_id → User` resolution path;
  a chat with no linked user must be handled gracefully (the same way an unrelated
  person messaging the bot cold would be).
- `Capture` model (`backend/app/models.py:23-30`): `id, user_id, raw_text, status,
  created_at` — no `source` field.

## Scope boundaries

**In scope:** `Capture.source` field + migration; gating `notify_new_tasks_ready` on
`source == "telegram"`; extracting the capture-processing logic (currently inline in
the `POST /captures` handler) into a shared, HTTP-independent service function used by
both the existing web endpoint and the new Telegram path; Telegram voice-message
handling (download → transcribe → process as a capture); Telegram plain-text message
handling (skip transcription, process directly) — confirmed in scope per explicit
product decision, extending symmetry with the web app's existing voice+text capture
support; reasonable reply messages for the unlinked-account, empty-result, and
processing-failure cases on the Telegram side.

**Out of scope:** any frontend change (this plan is entirely backend) — the web app's
own capture flow is untouched, its behavior doesn't change. AI-powered replanning
("move X to Thursday") — that is Plan B, layered on top of this plan's transcription
plumbing later. Voice message duration/size limits beyond what Telegram itself enforces
(Telegram caps voice messages at 1 minute via the client UI already, and the Bot API
rejects files over 20MB — both are Telegram-side limits, nothing for this app to
additionally enforce). Rich formatting or a "processing..." follow-up edit for
Telegram — a `sendChatAction` "typing" hint before transcription starts is included
(cheap, standard practice) but there's no multi-message progress UI matching the web
app's `ProcessingView` steps.

## Architecture

### `Capture.source`

New column, `String, nullable=False, default="web"` (existing rows backfilled to
`"web"` via the migration's `server_default`, matching reality — every capture created
before this plan shipped came from the web app).

### Shared capture-processing service

New `backend/app/captures/service.py`:

```python
class CaptureProcessingError(Exception):
    """Raised when AI triage fails; the caller decides how to surface it."""


def process_capture(user: User, raw_text: str, source: str, db: Session) -> list[Task]:
    ...
```

Contains exactly the logic currently inline in `create_capture` (create `Capture` row →
`extract_tasks` → create draft `Task` rows), with two changes: it takes `source` and
sets it on the `Capture` row, and it only calls `notify_new_tasks_ready` when `source ==
"telegram"`. It raises `CaptureProcessingError` on triage failure instead of an
`HTTPException` (it has no HTTP context) — `capture.status` is still set to `"failed"`
and committed before the raise, matching today's behavior.

`POST /captures` (`captures/router.py`) becomes a thin wrapper: calls
`process_capture(current_user, payload.raw_text, source="web", db=db)`, catching
`CaptureProcessingError` to raise the same `HTTPException` (502, same Ukrainian message)
it raises today. No behavior change for the web app from its own perspective — same
request, same response shape, same error message. The only externally-visible change is
that a web capture no longer pings Telegram.

### Telegram inbound handling

`backend/app/telegram/client.py` gains three functions, following this file's existing
`httpx` + `raise_for_status`-wrapped-to-`RuntimeError` pattern for the two that can
meaningfully fail mid-flow, and best-effort (caller-side try/except, not raised) for the
UX-only one:

```python
def get_file(file_id: str) -> str:
    """Returns the file_path Telegram will serve the file at."""

def download_file(file_path: str) -> bytes:
    """Downloads from the file-content endpoint (a different host path than the
    Bot API itself: https://api.telegram.org/file/bot<TOKEN>/<file_path>)."""

def send_chat_action(chat_id: int, action: str) -> None:
    """Best-effort 'typing...' hint; not wrapped in raise_for_status handling since
    a failure here shouldn't interrupt the actual capture flow."""
```

`backend/app/telegram/handlers.py` gains:

```python
NOT_LINKED_MESSAGE = "Спочатку підключіть акаунт: Налаштування → Telegram-бот у застосунку Taska."

def handle_capture_message(chat_id: int, raw_text: str, db: Session) -> None:
    """Shared tail for both voice (post-transcription) and text captures."""

def handle_voice_message(chat_id: int, file_id: str, db: Session) -> None:
    """Resolves the user, downloads + transcribes, then defers to
    handle_capture_message. Sends NOT_LINKED_MESSAGE and returns early — without
    downloading/transcribing anything — if the chat isn't linked."""
```

`handle_capture_message` resolves `chat_id → User` (`db.query(User).filter(
User.telegram_chat_id == chat_id).first()`), replying `NOT_LINKED_MESSAGE` and
returning if unlinked (checked here too, not only in `handle_voice_message`, since text
messages reach this function directly). Otherwise calls
`process_capture(user, raw_text, source="telegram", db=db)`:
- On `CaptureProcessingError`: reply with the same "Не вдалося обробити, спробуйте ще
  раз" message the web app's error path uses.
- On success with a non-empty task list: nothing further to send —
  `process_capture` already triggered `notify_new_tasks_ready` internally (that
  message, with its approve/reject buttons, *is* the reply).
- On success with an empty task list (nothing extracted): reply with a message
  mirroring the web app's `EmptyResultView` copy, adapted for Telegram ("Taska не
  змогла визначити задачі в цьому повідомленні. Спробуйte сформулювати інакше.").

`handle_update` gains two new branches inside the existing `message is not None` block,
checked before the current `/start ` check falls through to nothing:

```python
voice = message.get("voice")
if text.startswith("/start "):
    ...  # unchanged
elif voice is not None:
    handle_voice_message(chat_id, voice["file_id"], db)
elif text:
    handle_capture_message(chat_id, text, db)
```

`handle_voice_message` sends a `send_chat_action(chat_id, "typing")` hint immediately
(best-effort, ignore failures), downloads and transcribes on a threadpool (matching
`POST /transcribe`'s `run_in_threadpool` pattern — Telegram's polling loop is
synchronous and shouldn't block on a CPU-bound whisper call), and on transcription
failure replies with the same "Не вдалося розпізнати мову, спробуйте ще раз" message
`POST /transcribe` uses today.

## Data flow

**Voice:** Telegram `message.voice.file_id` → `get_file` → `download_file` → bytes →
`transcribe_audio(bytes, "voice.ogg")` (threadpool) → `handle_capture_message` → shared
`process_capture` → draft tasks + (if non-empty) the existing Telegram notification with
approve/reject buttons, which already round-trips through the existing
`handle_callback_query` path unchanged.

**Text:** Telegram `message.text` (any non-`/start` text) → directly into
`handle_capture_message` → same tail as above.

**Web (unchanged behavior, now explicit about its source):** `POST /captures` →
`process_capture(..., source="web", ...)` → draft tasks, no Telegram notification
regardless of whether the user has linked Telegram.

## Error handling

| Failure point | Response |
|---|---|
| Chat not linked to any `User` | Reply `NOT_LINKED_MESSAGE`, no further work |
| Telegram file download fails | Caught in `handle_voice_message`, log + reply with the transcription-failure message (can't distinguish "download failed" from "whisper failed" usefully for the user) |
| `transcribe_audio` raises | Same as above |
| `extract_tasks` (AI triage) raises | `process_capture` raises `CaptureProcessingError`; both callers (web router, Telegram handler) already have a defined response for this |
| Triage succeeds but extracts zero tasks | Web: unchanged (frontend's existing `EmptyResultView` handles a `200` with `tasks: []`). Telegram: explicit reply, since there's no client UI to interpret an empty list |
| Any other unexpected exception in `handle_voice_message`/`handle_capture_message` | Caught by `handle_update`'s existing outer `except Exception: logger.exception(...)` — matches the existing crash-isolation behavior for `handle_start`/`handle_callback_query`, one bad update never takes down the polling loop |

## Testing / verification approach

Backend has a real `pytest` suite (unlike the frontend) — this plan adds real tests,
matching the existing convention (`backend/tests/test_tasks_calendar_sync.py`,
`test_google_calendar_client.py`, etc.):

- `process_capture`: web-sourced capture does not call `notify_new_tasks_ready`
  (mock it, assert not called) even with a linked `telegram_chat_id`; telegram-sourced
  capture does call it; `Capture.source` is persisted correctly; `CaptureProcessingError`
  is raised (not `HTTPException`) on a mocked triage failure, and `capture.status`
  is `"failed"`.
- `POST /captures` (existing endpoint, now a thin wrapper): still returns 201 with the
  created tasks on success and 502 with the existing error message on triage failure —
  regression-covering the refactor didn't change the endpoint's contract.
- Telegram handlers: `handle_voice_message` with a mocked `get_file`/`download_file`/
  `transcribe_audio` chain, asserting `process_capture` is called with the transcribed
  text and `source="telegram"`; `handle_capture_message` for the unlinked-chat case
  (asserts `NOT_LINKED_MESSAGE` sent, `process_capture` never called); the empty-result
  reply case; the triage-failure reply case.
- No frontend changes in this plan, so no frontend verification needed.

## Open judgment calls made in this spec (flagged, not blocking)

- Reusing the existing approve/reject-button notification message as the Telegram
  capture's "result" reply (rather than designing a new, simpler confirmation message)
  — this directly matches the source request's "send it back to bot" and avoids a
  second message format to maintain, but means a Telegram-originated capture's reply
  looks identical in shape to what a web-originated-then-notified capture used to look
  like before this plan (before this plan, web captures always looked like this too;
  after this plan, only Telegram-originated ones do).
- `send_chat_action("typing")` before transcription is a small UX addition not
  explicitly requested — cheap, standard, low-risk; flagging since it's scope beyond
  the literal ask.
- The unlinked-chat reply message's exact wording is my own choice, not specified.
