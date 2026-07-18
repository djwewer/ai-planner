"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function LoginPageInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося увійти");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Увійти</h1>
      {oauthError === "email_not_verified" && (
        <p>
          Електронна пошта вашого облікового запису Google не підтверджена, тому
          автоматичне прив&apos;язування неможливе. Увійдіть за допомогою email та
          пароля.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p>{error}</p>}
        <button type="submit">Увійти</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Увійти через Google</a>
      <p>
        Немає акаунта? <a href="/signup">Зареєструватися</a>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <LoginPageInner />
    </Suspense>
  );
}
