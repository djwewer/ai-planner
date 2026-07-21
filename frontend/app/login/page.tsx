"use client";

import { FormEvent, Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import logo from "@/public/taska-logo.png";

function LoginPageInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { setToken } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");
  const justDeleted = searchParams.get("deleted") === "1";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося увійти");
      setSubmitting(false);
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <Image src={logo} alt="Tenoa" width={112} height={112} priority />
        <h1>Tenoa</h1>
        <p>Увійдіть, щоб побачити свої задачі</p>
      </div>

      {oauthError === "email_not_verified" && (
        <p className="auth-notice">
          Електронна пошта вашого облікового запису Google не підтверджена, тому
          автоматичне прив&apos;язування неможливе. Увійдіть за допомогою email та пароля.
        </p>
      )}

      {justDeleted && (
        <p className="auth-notice">Акаунт видалено. Дякуємо, що користувалися Tenoa.</p>
      )}

      <form className="auth-form" onSubmit={handleSubmit}>
        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "Вхід…" : "Увійти"}
        </button>
      </form>

      <div className="auth-divider">або</div>

      <a className="secondary-btn" style={{ display: "block", textAlign: "center" }} href={`${apiUrl}/auth/google/login`}>
        Продовжити з Google
      </a>

      <p className="auth-footer">
        Немає акаунта? <a href="/signup">Зареєструватися</a>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p>Завантаження…</p>}>
      <LoginPageInner />
    </Suspense>
  );
}
