"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Mic, MicOff, Square } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useCaptureFlow } from "@/lib/capture-flow-context";

const MAX_RECORDING_MS = 2 * 60 * 1000;

type Phase = "idle" | "recording" | "transcribing";

export function VoiceFlow() {
  const { close, submitCapture } = useCaptureFlow();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [micSupported] = useState(
    () => typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof MediaRecorder !== "undefined"
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function handleRecordingComplete(blob: Blob, mimeType: string) {
    try {
      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const formData = new FormData();
      formData.append("file", blob, `recording.${ext}`);
      const { text } = await api.upload<{ text: string }>("/transcribe", formData);
      if (!text.trim()) {
        setError("Не вдалося розпізнати мову, спробуйте ще раз");
        setPhase("idle");
        return;
      }
      submitCapture(text);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося розпізнати мову, спробуйте ще раз");
      setPhase("idle");
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
        setPhase("transcribing");
        handleRecordingComplete(new Blob(chunksRef.current, { type: mimeType }), mimeType);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
      setSeconds(0);
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      stopTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch {
      setError("Немає доступу до мікрофона");
    }
  }

  function stopRecording() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    mediaRecorderRef.current?.stop();
  }

  function handleClose() {
    if (phase === "recording") stopRecording();
    close();
  }

  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flow">
      <div className="flow-header">
        <button className="icon-btn" aria-label="Назад" onClick={handleClose}><ArrowLeft /></button>
      </div>
      {phase !== "recording" && (
        <div className="flow-body">
          <h3 className="flow-heading">Скажіть Tenoa, що потрібно зробити</h3>
          <p className="flow-sub">Tenoa перетворить ваш запис на чернетки задач, які можна переглянути й відредагувати.</p>
          {(error || !micSupported) && (
            <div className="empty-block">
              <div className="empty-icon warn"><MicOff /></div>
              <p>{error ?? "Диктування недоступне у цьому браузері. Скористайтеся текстом."}</p>
            </div>
          )}
          <div className="mic-stage">
            <button
              className="mic-btn"
              aria-label="Почати запис"
              onClick={startRecording}
              disabled={phase === "transcribing" || !micSupported}
            >
              <Mic />
            </button>
            <div className="mic-caption">{phase === "transcribing" ? "Розпізнавання…" : "Почати запис"}</div>
          </div>
        </div>
      )}
      {phase === "recording" && (
        <div className="flow-body">
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
            <div className="rec-timer">{minutes}:{secs}</div>
            <div className="waveform">
              {Array.from({ length: 20 }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.06}s` }} />
              ))}
            </div>
            <div className="mic-caption rec">Слухаю…</div>
          </div>
          <div className="mic-stage" style={{ paddingBottom: 16 }}>
            <button className="stop-btn" aria-label="Зупинити запис" onClick={stopRecording}>
              <Square fill="currentColor" />
            </button>
            <div className="mic-caption">Зупинити</div>
          </div>
        </div>
      )}
    </div>
  );
}
