"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import logo from "@/public/taska-logo.png";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { setToken } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.post<{ access_token: string }>("/auth/signup", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося зареєструватися");
      setSubmitting(false);
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <Image src={logo} alt="Taska" width={112} height={112} priority />
        <h1>Taska</h1>
        <p>Створіть акаунт, щоб почати планувати</p>
      </div>

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
          placeholder="Пароль (мінімум 8 символів)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p className="auth-error">{error}</p>}
        <button className="primary-btn" type="submit" disabled={submitting}>
          {submitting ? "Реєстрація…" : "Зареєструватися"}
        </button>
      </form>

      <div className="auth-divider">або</div>

      <a className="secondary-btn" style={{ display: "block", textAlign: "center" }} href={`${apiUrl}/auth/google/login`}>
        Продовжити з Google
      </a>

      <p className="auth-footer">
        Вже є акаунт? <a href="/login">Увійти</a>
      </p>
    </div>
  );
}
