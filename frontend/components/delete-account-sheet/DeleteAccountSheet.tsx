"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

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

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api.delete("/auth/me", { remove_google_events: removeGoogleEvents });
      localStorage.removeItem("token");
      // A hard navigation (not router.push) is deliberate here: logout() and the
      // (app) layout's own auth-guard effect each separately redirect to a bare
      // "/login" once the user's cleared, racing the client-side router against
      // this "?deleted=1" URL and dropping the query param. A full page load
      // sidesteps that race and guarantees a clean, fully logged-out app state.
      window.location.href = "/login?deleted=1";
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
