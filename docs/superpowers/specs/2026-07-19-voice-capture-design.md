# AI Planner — Plan 3: Voice Capture — Design

_Date: 2026-07-19_

## Overview

Adds a microphone button to the `/capture` page that records audio on-device,
uploads it to the backend for transcription via self-hosted `faster-whisper`
(forced to Ukrainian), and fills the existing capture text box with the
result. From there, the flow is identical to typed capture — the user
reviews/edits the transcript and submits it through the unchanged
`POST /captures` → AI triage → Inbox pipeline built in Plan 2.

Because the transcript only ever fills the text box, this plan requires **no
changes** to `POST /captures`, the AI triage module, or the `Capture`/`Task`
data model — by the time text reaches those, it's indistinguishable from
something the user typed.

## Scope

**In scope:**
- `POST /transcribe` — new auth-required backend endpoint. Accepts an
  uploaded audio file, transcribes it with a self-hosted `faster-whisper`
  model (medium, int8 quantized, Ukrainian forced), returns `{"text": "..."}`.
  Audio is discarded immediately after transcription — nothing is stored.
- Mic button on `/capture` — tap to start/stop recording (`MediaRecorder`
  API). On stop, uploads the recording and fills the text box with the
  transcript (appending with a space if the box already has typed text).
  Recording auto-stops at 2 minutes as a safety cap. If `MediaRecorder`
  isn't supported, the mic button doesn't render — typing still works.

**Explicitly out of scope:**
- Any change to `POST /captures`, AI triage, or the data model.
- Scheduled time-of-day / Google Calendar sync (Plan 4).
- Telegram bot (Plan 5).
- Storing or replaying recorded audio.

## Architecture

**Backend — new module `app/ai/whisper.py`** (sibling to `triage.py`):
- Loads the model once at module import: `WhisperModel("medium",
  compute_type="int8")` — kept resident in memory, not reloaded per request.
- `transcribe_audio(audio_bytes: bytes, filename: str) -> str` — writes the
  uploaded bytes to a temp file (keeping the browser's original extension so
  `ffmpeg` can auto-detect the format), calls `model.transcribe(path,
  language="uk")` (forcing Ukrainian skips slower, less-reliable language
  auto-detection on short clips), joins the resulting segments into one
  string, deletes the temp file in a `finally` block regardless of outcome.

**New endpoint `app/transcription/router.py`** — `POST /transcribe`,
protected by `get_current_user`, accepts `multipart/form-data` with an audio
file, calls `transcribe_audio`, returns `{"text": "..."}`. Any failure
(corrupt audio, Whisper exception, empty result) is logged via
`logger.exception` (matching `captures/router.py`'s pattern) and returns a
generic Ukrainian 502.

**Infra:**
- `ffmpeg` added as a system package in the Docker image, needed to decode
  whatever format the browser records (webm/opus on Chrome/Android, mp4/aac
  on Safari).
- `faster-whisper` added to `requirements.txt`.
- A new named Docker volume for the Hugging Face model cache, so the
  ~1.5GB model weights download once on first use and persist across
  container rebuilds — without it, every `--build` deploy would re-download
  the model. The first transcription request after a fresh volume is slow
  (waiting on the download); every request after that is fast.

**Frontend:**
- `frontend/lib/api.ts` gains `api.upload(path, formData)` — like `api.post`
  but sends `FormData` directly without forcing a JSON `Content-Type` (the
  browser sets the correct multipart boundary automatically).
- `/capture` page gains a mic button with three states: idle
  ("🎤 Диктувати"), recording (pulsing, "Зупинити"), transcribing (spinner,
  "Розпізнавання..."). Uses `navigator.mediaDevices.getUserMedia` +
  `MediaRecorder`, feature-detected on page load (button doesn't render if
  unsupported).

## Core Flow

1. Tap mic → browser requests mic permission if needed → recording starts,
   button shows "recording" state.
2. Tap again to stop → `MediaRecorder` finalizes the blob → button shows
   "transcribing" state.
3. Frontend uploads the blob via `api.upload("/transcribe", formData)`.
4. Backend writes it to a temp file, transcribes with Whisper
   (`language="uk"`), deletes the temp file, returns the text.
5. Frontend sets/appends the transcript into the text box, button returns
   to idle.
6. From here it's the unchanged typed-capture flow: review/edit the text,
   hit "Надіслати" → `POST /captures` → triage → Inbox.

## Error Handling

- **Mic permission denied** → Ukrainian message ("Немає доступу до
  мікрофона"); mic button returns to idle, text box untouched.
- **`MediaRecorder` unsupported** → mic button doesn't render at all
  (feature-detected); typing still works.
- **Upload/network failure** → Ukrainian error via the existing `ApiError`
  pattern; text box untouched, button returns to idle so the user can retry.
- **Whisper produces empty/no speech detected** → Ukrainian message ("Не
  вдалося розпізнати мову, спробуйте ще раз"); text box untouched.
- **Backend transcription error** (corrupt audio, Whisper exception) →
  logged via `logger.exception`; generic Ukrainian 502, same shape as the
  existing triage-failure error.

## Testing

- Backend: unit tests for `transcribe_audio` with `WhisperModel.transcribe`
  mocked (same external-boundary-only mocking pattern as `triage.py`'s
  tests) — verify temp file creation/cleanup and that `language="uk"` is
  passed.
- Integration tests for `POST /transcribe`: 401 without auth, successful
  transcription returns the mocked text, a Whisper failure returns the
  Ukrainian 502.
- No automated test can meaningfully verify real transcription accuracy —
  that's manual QA, the same category as the AI triage's real-world prompt
  behavior. Manual QA: record real Ukrainian phrases on an actual phone
  (iOS Safari + Android Chrome, per the project's mobile-first requirement)
  and confirm the transcript is reasonable and lands in the text box
  correctly.
