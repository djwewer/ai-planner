"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ access_token: string }>("/auth/signup", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не вдалося зареєструватися");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Зареєструватися</h1>
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
          placeholder="Пароль (мінімум 8 символів)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p>{error}</p>}
        <button type="submit">Зареєструватися</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Зареєструватися через Google</a>
      <p>
        Вже є акаунт? <a href="/login">Увійти</a>
      </p>
    </main>
  );
}
