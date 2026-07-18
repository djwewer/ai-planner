"use client";

import { FormEvent, useEffect, useState } from "react";
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

export default function CapturePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

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
