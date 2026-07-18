"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export function Nav() {
  const { logout } = useAuth();

  return (
    <nav>
      <Link href="/today">Сьогодні</Link>
      {" · "}
      <Link href="/tasks">Задачі</Link>
      {" · "}
      <Link href="/capture">Занотувати</Link>
      {" · "}
      <Link href="/inbox">Вхідні</Link>
      {" · "}
      <button onClick={logout}>Вийти</button>
    </nav>
  );
}
