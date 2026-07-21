"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import { CalendarEvent } from "@/lib/types";

type EventDetailContextValue = {
  event: CalendarEvent | null;
  open: (event: CalendarEvent) => void;
  close: () => void;
};

const EventDetailContext = createContext<EventDetailContextValue | undefined>(undefined);

export function EventDetailProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  return (
    <EventDetailContext.Provider value={{ event, open: setEvent, close: () => setEvent(null) }}>
      {children}
    </EventDetailContext.Provider>
  );
}

export function useEventDetail() {
  const ctx = useContext(EventDetailContext);
  if (!ctx) throw new Error("useEventDetail must be used within EventDetailProvider");
  return ctx;
}
