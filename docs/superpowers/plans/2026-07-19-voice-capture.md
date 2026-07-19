# AI Planner — Plan 3: Voice Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mic button to `/capture` that records audio, transcribes it via self-hosted `faster-whisper` (Ukrainian), and fills the existing text box — the rest of the capture flow is unchanged.

**Architecture:** A new `app/ai/whisper.py` module wraps a lazily-loaded `faster-whisper` model (loaded on first use, not at import, so tests and app startup don't pay the load cost). A new `POST /transcribe` endpoint accepts an uploaded audio file, calls it, and returns the text. The frontend gains an `api.upload()` helper and a mic button on `/capture` using the browser's `MediaRecorder` API.

**Tech Stack:** `faster-whisper` (Python), `ffmpeg` (system package, for audio decoding), browser `MediaRecorder`/`getUserMedia` APIs. Everything else (FastAPI, Next.js) is unchanged from Plans 1–2.

## Global Constraints

- Product language is Ukrainian — every UI string and backend error message.
- Transcription is forced to Ukrainian (`language="uk"`), not auto-detected.
- Audio is transcribed and immediately discarded — never stored.
- No changes to `POST /captures`, AI triage, or the `Capture`/`Task` data model — the transcript only ever fills the existing text box.
- Backend is FastAPI on the Hostinger VPS behind Traefik; frontend is Next.js on Vercel (inherited infra, already live).

---

## File Structure

```
backend/
  app/
    ai/
      whisper.py            # lazily-loaded faster-whisper model + transcribe_audio()
    transcription/
      router.py               # POST /transcribe
  Dockerfile                    # + ffmpeg system package
  requirements.txt               # + faster-whisper
  tests/
    test_whisper.py
    test_transcription.py
docker-compose.yml                # + named volume for the HF model cache
frontend/
  lib/
    api.ts                         # + api.upload()
  app/
    capture/page.tsx                # + mic button/recording state
```

---

### Task 1: Backend — Whisper transcription module and `/transcribe` endpoint

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/Dockerfile`
- Modify: `docker-compose.yml`
- Create: `backend/app/ai/whisper.py`
- Create: `backend/tests/test_whisper.py`
- Create: `backend/app/transcription/__init__.py`
- Create: `backend/app/transcription/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_transcription.py`

**Interfaces:**
- Consumes: `app.security.get_current_user`, `app.models.User`
- Produces: `app.ai.whisper.transcribe_audio(audio_bytes: bytes, filename: str) -> str`; `app.ai.whisper._get_model()` (monkeypatch target for tests — returns a lazily-constructed, cached `WhisperModel`); `POST /transcribe` — auth-required, multipart `file` field, returns `{"text": str}` (200) or a Ukrainian 502 on failure; router object `app.transcription.router.router`

- [ ] **Step 1: Add `faster-whisper` to `backend/requirements.txt`**

Append this line to the end of the file:

```
faster-whisper==1.0.3
```

If this exact version is unavailable, install the latest with `pip install faster-whisper` and update this line to match.

- [ ] **Step 2: Add `ffmpeg` to `backend/Dockerfile`**

Full new file content:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 3: Add a named volume for the Whisper model cache to the root `docker-compose.yml`**

Full new file content:

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: planner
      POSTGRES_PASSWORD: planner
      POSTGRES_DB: planner
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U planner"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    restart: unless-stopped
    env_file:
      - ./backend/.env
    environment:
      - DATABASE_URL=postgresql://planner:planner@postgres:5432/planner
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "8000:8000"
    volumes:
      - whisper_cache:/root/.cache/huggingface
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ai-planner-api.rule=Host(`bcknd.srv1440057.hstgr.cloud`)"
      - "traefik.http.routers.ai-planner-api.entrypoints=websecure"
      - "traefik.http.routers.ai-planner-api.tls.certresolver=letsencrypt"
      - "traefik.http.services.ai-planner-api.loadbalancer.server.port=8000"

volumes:
  postgres_data:
  whisper_cache:
```

(This only adds the `whisper_cache` volume mount and declaration — nothing else changes from the current file.)

- [ ] **Step 4: Install the new dependency locally**

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

Expected: install completes with no errors. (`faster-whisper` itself doesn't require `ffmpeg` to *install*, only to actually decode non-WAV audio at runtime — that's only needed in the Docker image, not your local dev venv, unless you plan to run real transcriptions locally too.)

- [ ] **Step 5: Write the failing tests for the transcription module**

`backend/tests/test_whisper.py`:

```python
import os
from unittest.mock import MagicMock

from app.ai import whisper


def _mock_model(text_segments):
    segments = [MagicMock(text=t) for t in text_segments]
    model = MagicMock()
    model.transcribe.return_value = (segments, MagicMock())
    return model


def test_transcribe_audio_returns_joined_text(monkeypatch):
    mock_model = _mock_model(["Купити молоко", " і подзвонити"])
    monkeypatch.setattr(whisper, "_get_model", lambda: mock_model)

    result = whisper.transcribe_audio(b"fake-audio-bytes", "recording.webm")

    assert result == "Купити молоко і подзвонити"
    assert mock_model.transcribe.call_args.kwargs["language"] == "uk"


def test_transcribe_audio_cleans_up_temp_file(monkeypatch):
    mock_model = _mock_model(["test"])
    created_paths = []

    def _capture_path(path, **kwargs):
        created_paths.append(path)
        assert os.path.exists(path)
        return mock_model.transcribe.return_value

    mock_model.transcribe.side_effect = _capture_path
    monkeypatch.setattr(whisper, "_get_model", lambda: mock_model)

    whisper.transcribe_audio(b"fake-audio-bytes", "recording.webm")

    assert len(created_paths) == 1
    assert not os.path.exists(created_paths[0])
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_whisper.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.ai.whisper'`.

- [ ] **Step 7: Create `backend/app/ai/whisper.py`**

```python
import logging
import os
import tempfile
from typing import Optional

from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

_model: Optional[WhisperModel] = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        logger.info("loading faster-whisper model (medium, int8) — this may take a while on first run")
        _model = WhisperModel("medium", compute_type="int8")
    return _model


def transcribe_audio(audio_bytes: bytes, filename: str) -> str:
    suffix = os.path.splitext(filename)[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, _info = _get_model().transcribe(tmp_path, language="uk")
        return "".join(segment.text for segment in segments).strip()
    finally:
        os.remove(tmp_path)
```

Note the lazy `_get_model()` — the model is only loaded (and, on the VPS, downloaded if not cached) on the first real transcription request, not at import time. This keeps app startup fast and keeps tests from ever touching the real model.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd backend
pytest tests/test_whisper.py -v
```

Expected: both tests PASS.

- [ ] **Step 9: Write the failing tests for the endpoint**

`backend/tests/test_transcription.py`:

```python
from unittest.mock import MagicMock

from app.transcription import router as transcription_router


def _signup_and_get_token(client, email="voiceuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def test_transcribe_requires_auth(client):
    response = client.post(
        "/transcribe",
        files={"file": ("recording.webm", b"fake-audio", "audio/webm")},
    )
    assert response.status_code == 401


def test_transcribe_returns_text(client, monkeypatch):
    monkeypatch.setattr(
        transcription_router, "transcribe_audio", MagicMock(return_value="Купити молоко")
    )
    token = _signup_and_get_token(client)
    response = client.post(
        "/transcribe",
        files={"file": ("recording.webm", b"fake-audio", "audio/webm")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json() == {"text": "Купити молоко"}


def test_transcribe_handles_whisper_failure(client, monkeypatch):
    def _raise(audio_bytes, filename):
        raise RuntimeError("model error")

    monkeypatch.setattr(transcription_router, "transcribe_audio", _raise)
    token = _signup_and_get_token(client)
    response = client.post(
        "/transcribe",
        files={"file": ("recording.webm", b"fake-audio", "audio/webm")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "Не вдалося розпізнати мову, спробуйте ще раз"
```

- [ ] **Step 10: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_transcription.py -v
```

Expected: FAIL — `404 Not Found` for `POST /transcribe`.

- [ ] **Step 11: Create `backend/app/transcription/__init__.py`** (empty file)

- [ ] **Step 12: Create `backend/app/transcription/router.py`**

```python
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from app.ai.whisper import transcribe_audio
from app.models import User
from app.security import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transcribe", tags=["transcription"])


@router.post("")
async def transcribe(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
):
    audio_bytes = await file.read()
    try:
        text = transcribe_audio(audio_bytes, file.filename or "recording.webm")
    except Exception:
        logger.exception("transcription failed for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося розпізнати мову, спробуйте ще раз",
        )
    return {"text": text}
```

- [ ] **Step 13: Register the router in `backend/app/main.py`**

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


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Перевірте введені дані"})


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 14: Run the full backend test suite to verify everything passes**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS, including the 5 new ones.

- [ ] **Step 15: Commit**

```bash
git add backend/requirements.txt backend/Dockerfile docker-compose.yml \
  backend/app/ai/whisper.py backend/tests/test_whisper.py \
  backend/app/transcription/__init__.py backend/app/transcription/router.py \
  backend/app/main.py backend/tests/test_transcription.py
git commit -m "feat: add self-hosted Whisper transcription and /transcribe endpoint"
```

---

### Task 2: Frontend — upload helper and mic button

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/capture/page.tsx`

**Interfaces:**
- Consumes: `POST /transcribe` (Task 1) — multipart `file` field, returns `{"text": str}`
- Produces: `api.upload<T>(path: string, formData: FormData) => Promise<T>` in `frontend/lib/api.ts`

- [ ] **Step 1: Modify `frontend/lib/api.ts` to support `FormData` uploads**

Full new file content:

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL as string;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.detail;
    let message: string;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = detail
        .map((item) => item?.msg)
        .filter((msg): msg is string => Boolean(msg))
        .join("; ") || "Request failed";
    } else {
      message = "Request failed";
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: "POST", body: formData }),
};
```

(Only change: `headers` no longer unconditionally sets `Content-Type: application/json` — it's skipped when the body is `FormData`, since the browser must set that header itself with the correct multipart boundary. Plus the new `api.upload` method.)

- [ ] **Step 2: Modify `frontend/app/capture/page.tsx` to add the mic button**

Full new file content:

```tsx
"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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

type RecordingState = "idle" | "recording" | "transcribing";

const MAX_RECORDING_MS = 2 * 60 * 1000;

export default function CapturePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [micSupported, setMicSupported] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    setMicSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof MediaRecorder !== "undefined"
    );
  }, []);

  async function handleRecordingComplete(blob: Blob, mimeType: string) {
    try {
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const formData = new FormData();
      formData.append("file", blob, `recording.${ext}`);
      const { text: transcript } = await api.upload<{ text: string }>("/transcribe", formData);
      if (!transcript.trim()) {
        setError("Не вдалося розпізнати мову, спробуйте ще раз");
      } else {
        setText((current) => (current ? `${current} ${transcript}` : transcript));
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Не вдалося розпізнати мову, спробуйте ще раз"
      );
    } finally {
      setRecordingState("idle");
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const mimeType = recorder.mimeType || "audio/webm";
        handleRecordingComplete(new Blob(chunksRef.current, { type: mimeType }), mimeType);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingState("recording");
      stopTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch {
      setError("Немає доступу до мікрофона");
    }
  }

  function stopRecording() {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    setRecordingState("transcribing");
  }

  function handleMicClick() {
    if (recordingState === "idle") {
      startRecording();
    } else if (recordingState === "recording") {
      stopRecording();
    }
  }

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
        {micSupported && (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={recordingState === "transcribing"}
          >
            {recordingState === "idle" && "🎤 Диктувати"}
            {recordingState === "recording" && "🔴 Зупинити"}
            {recordingState === "transcribing" && "Розпізнавання…"}
          </button>
        )}
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

- [ ] **Step 3: Verify the build**

```bash
cd frontend
npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Manually verify in the browser** (requires a live backend and a real microphone — this is the one part of this task that can't be verified by an automated build)

1. On `/capture`, confirm the "🎤 Диктувати" button appears (in any modern desktop/mobile browser).
2. Click it, grant mic permission when prompted, say a short Ukrainian phrase, click "🔴 Зупинити".
3. Confirm the button briefly shows "Розпізнавання…", then the transcript appears in the text box.
4. Type something first, then record — confirm the transcript is appended after the typed text with a space, not replacing it.
5. Submit the resulting text as normal and confirm it still creates draft tasks correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/app/capture/page.tsx
git commit -m "feat: add voice recording to the capture page"
```

---

### Task 3: Deploy to the VPS

**Files:** none (deployment only)

**Interfaces:** none new — this makes Task 1–2 live

- [ ] **Step 1: Rebuild and restart the backend on the VPS**

```bash
cd ai-planner
git pull
docker compose up -d --build backend
docker compose logs backend --tail 30
```

Expected: clean startup, no errors. (The Whisper model itself is NOT downloaded yet at this point — it downloads lazily on the first real `/transcribe` request, which will be noticeably slow the very first time as it fetches ~1.5GB into the new `whisper_cache` volume. Every request after that is fast.)

- [ ] **Step 2: Confirm Vercel auto-deployed the frontend**

Vercel redeploys automatically on every push to `main` — confirm the latest deployment in the Vercel dashboard shows "Ready" and matches this plan's final commit.

- [ ] **Step 3: End-to-end manual QA on the live site, on a real phone**

On both iPhone Safari and Android Chrome (per the project's mobile-first requirement):
1. Go to `/capture`, confirm the mic button appears.
2. Record a short Ukrainian phrase (e.g. "терміново подзвонити клієнту сьогодні"), confirm the transcript appears correctly in the text box (allow extra time for the very first request while the model downloads).
3. Submit it, confirm it produces a sensible draft task in the Inbox.
4. Try denying mic permission once (if your OS lets you test this) and confirm the Ukrainian permission-denied message appears instead of a crash.

Expected: voice capture works end to end on both browsers, entirely in Ukrainian.

---

## Self-Review Notes

- **Spec coverage:** `/transcribe` endpoint, lazy Whisper loading, Ukrainian forcing, temp file cleanup, audio never persisted → Task 1. Mic button states, `MediaRecorder` feature detection, 2-minute safety cap, append-vs-replace text box behavior, Ukrainian error messages for permission-denied/unsupported/empty-transcript/upload-failure → Task 2. Model-cache volume, deployment, mobile manual QA → Task 3. No changes to `POST /captures`/triage/data model, as the spec required.
- **Type/signature consistency:** `transcribe_audio(audio_bytes: bytes, filename: str) -> str` (Task 1) is exactly what `transcription/router.py`'s `transcribe` endpoint calls. `api.upload<T>(path, formData)` (Task 2) matches how `capture/page.tsx` calls it (`api.upload<{ text: string }>("/transcribe", formData)`), and the endpoint's `{"text": str}` response shape matches what the frontend destructures.
- **No placeholders:** every step has complete file contents or an exact command with expected output. Test coverage is intentionally lighter than Plans 1–2 (2–3 tests per component instead of 4–5) per the project owner's request to reduce development overhead for this plan — still covering the real happy path, resource cleanup, and the auth/failure edge cases that matter most.
