"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Check, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Me = {
  id: number;
  email: string;
  google_calendar_connected: boolean;
  telegram_connected: boolean;
};

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const { logout } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);

  useEffect(() => {
    api.get<Me>("/auth/me").then(setMe);
  }, []);

  useEffect(() => {
    // OAuth redirect result arrives via URL params, not props/state — syncing it into
    // state here is the correct place for it, so the resulting extra render is expected.
    if (searchParams.get("error") === "calendar_connect_failed") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("Не вдалося підключити Google Calendar, спробуйте ще раз");
    }
    if (searchParams.get("connected") === "1") {
      setMe((current) => (current ? { ...current, google_calendar_connected: true } : current));
    }
  }, [searchParams]);

  useEffect(() => {
    if (!me || me.telegram_connected) return;
    const interval = setInterval(() => {
      api.get<Me>("/auth/me").then((updated) => {
        if (updated.telegram_connected) setMe(updated);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [me]);

  async function handleConnectCalendar() {
    setError(null);
    setConnectingCalendar(true);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>("/auth/google/calendar/connect");
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

  return (
    <>
      <div className="screen-header"><h2>Налаштування</h2></div>
      {error && <p style={{ padding: "0 20px", color: "var(--error)", fontSize: 13 }}>{error}</p>}
      <div className="scroll">
        {me === null ? (
          <div style={{ padding: "0 20px" }}>
            <div className="skeleton-card" />
          </div>
        ) : (
          <>
            <div className="integration-card">
              <div className="integration-top">
                <div className="integration-icon"><CalendarDays /></div>
                <div style={{ flex: 1 }}>
                  <div className="integration-name">Google Calendar</div>
                  <div className={`status-pill ${me.google_calendar_connected ? "connected" : "off"}`}>
                    {me.google_calendar_connected && <Check />} {me.google_calendar_connected ? "Підключено" : "Не підключено"}
                  </div>
                </div>
              </div>
              {me.google_calendar_connected ? (
                <>
                  <div className="integration-detail">{me.email}<br />Події синхронізуються автоматично.</div>
                  <button className="text-btn" onClick={handleConnectCalendar} disabled={connectingCalendar}>Керувати підключенням</button>
                </>
              ) : (
                <button className="primary-btn" style={{ marginTop: 12 }} onClick={handleConnectCalendar} disabled={connectingCalendar}>
                  {connectingCalendar ? "Підключення…" : "Підключити Google Calendar"}
                </button>
              )}
            </div>
            <div className="integration-card">
              <div className="integration-top">
                <div className="integration-icon"><Send /></div>
                <div style={{ flex: 1 }}>
                  <div className="integration-name">Telegram-бот</div>
                  <div className={`status-pill ${me.telegram_connected ? "connected" : "off"}`}>
                    {me.telegram_connected && <Check />} {me.telegram_connected ? "Підключено" : "Не підключено"}
                  </div>
                </div>
              </div>
              {me.telegram_connected ? (
                <div className="integration-detail">Нагадування та підтвердження надходять у Telegram.</div>
              ) : (
                <button className="primary-btn" style={{ marginTop: 12 }} onClick={handleConnectTelegram} disabled={connectingTelegram}>
                  {connectingTelegram ? "Підключення…" : "Підключити Telegram бота"}
                </button>
              )}
            </div>
            <div style={{ margin: "0 20px" }}>
              <button className="secondary-btn" onClick={logout}>Вийти з акаунта</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <SettingsPageInner />
    </Suspense>
  );
}
