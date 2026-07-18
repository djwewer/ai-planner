"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();

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
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Log in</h1>
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
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p>{error}</p>}
        <button type="submit">Log in</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Sign in with Google</a>
      <p>
        No account? <a href="/signup">Sign up</a>
      </p>
    </main>
  );
}
