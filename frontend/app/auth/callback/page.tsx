"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function AuthCallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setToken } = useAuth();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      router.push("/tasks");
    } else {
      router.push("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return <p>Signing you in…</p>;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <AuthCallbackInner />
    </Suspense>
  );
}
