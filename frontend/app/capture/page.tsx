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
