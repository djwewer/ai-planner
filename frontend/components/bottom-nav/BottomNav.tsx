"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck2, Inbox, Archive, Settings, Plus } from "lucide-react";
import { useCaptureFlow } from "@/lib/capture-flow-context";

const LEADING_ITEMS = [
  { key: "tasks", href: "/tasks", label: "Задачі", Icon: CalendarCheck2 },
  { key: "inbox", href: "/inbox", label: "Вхідні", Icon: Inbox },
] as const;

const TRAILING_ITEMS = [
  { key: "archive", href: "/archive", label: "Архів", Icon: Archive },
  { key: "settings", href: "/settings", label: "Налаштування", Icon: Settings },
] as const;

export function BottomNav({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();
  const { open } = useCaptureFlow();

  function isActive(href: string) {
    return pathname.startsWith(href);
  }

  return (
    <nav className="bottom-nav">
      {LEADING_ITEMS.map(({ key, href, label, Icon }) => (
        <Link key={key} href={href} className={`nav-item${isActive(href) ? " active" : ""}`}>
          <span className="nav-icon-wrap">
            <Icon />
            {key === "inbox" && inboxCount > 0 && <span className="badge">{inboxCount}</span>}
          </span>
          <span className="nav-label">{label}</span>
        </Link>
      ))}
      <span className="nav-item spacer" aria-hidden="true" />
      {TRAILING_ITEMS.map(({ key, href, label, Icon }) => (
        <Link key={key} href={href} className={`nav-item${isActive(href) ? " active" : ""}`}>
          <span className="nav-icon-wrap"><Icon /></span>
          <span className="nav-label">{label}</span>
        </Link>
      ))}
      <button className="nav-plus" aria-label="Створити нову задачу" onClick={open}>
        <Plus />
      </button>
    </nav>
  );
}
