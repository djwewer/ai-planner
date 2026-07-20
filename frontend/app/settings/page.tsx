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
};

function SettingsPageInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Me>("/auth/me").then((me) => setConnected(me.google_calendar_connected));
    }
  }, [user]);

  useEffect(() => {
    if (searchParams.get("error") === "calendar_connect_failed") {
      setError("Не вдалося підключити Google Calendar, спробуйте ще раз");
    }
    if (searchParams.get("connected") === "1") {
      setConnected(true);
    }
  }, [searchParams]);

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>(
        "/auth/google/calendar/connect"
      );
      window.location.href = authorize_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося підключити Google Calendar");
      setConnecting(false);
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
        {connected ? (
          <p>✅ Підключено</p>
        ) : (
          <button onClick={handleConnect} disabled={connecting}>
            {connecting ? "Підключення…" : "Підключити Google Calendar"}
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
