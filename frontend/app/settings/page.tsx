"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/nav";

type Me = {
  id: number;
  email: string;
  google_calendar_connected: boolean;
  telegram_connected: boolean;
};

function SettingsPageInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Me>("/auth/me").then((me) => {
        setCalendarConnected(me.google_calendar_connected);
        setTelegramConnected(me.telegram_connected);
      });
    }
  }, [user]);

  useEffect(() => {
    if (searchParams.get("error") === "calendar_connect_failed") {
      setError("Не вдалося підключити Google Calendar, спробуйте ще раз");
    }
    if (searchParams.get("connected") === "1") {
      setCalendarConnected(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (telegramConnected) return;
    const interval = setInterval(() => {
      api.get<Me>("/auth/me").then((me) => {
        if (me.telegram_connected) setTelegramConnected(true);
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [telegramConnected]);

  async function handleConnectCalendar() {
    setError(null);
    setConnectingCalendar(true);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        "/auth/google/calendar/connect"
      );
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

  if (loading || !user) return <p>Завантаження…</p>;

  return (
    <main>
      <Nav />
      <h1>Налаштування</h1>
      {error && <p>{error}</p>}
      <section>
        <h2>Google Calendar</h2>
        {calendarConnected ? (
          <p>✅ Підключено</p>
        ) : (
          <button onClick={handleConnectCalendar} disabled={connectingCalendar}>
            {connectingCalendar ? "Підключення…" : "Підключити Google Calendar"}
          </button>
        )}
      </section>
      <section>
        <h2>Telegram</h2>
        {telegramConnected ? (
          <p>✅ Підключено</p>
        ) : (
          <button onClick={handleConnectTelegram} disabled={connectingTelegram}>
            {connectingTelegram ? "Підключення…" : "Підключити Telegram бота"}
          </button>
        )}
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <SettingsPageInner />
    </Suspense>
  );
}
