"use client";
import { useSyncExternalStore } from "react";
import {
  nexusEvent,
  createNexusEvent,
  type NexusEvent,
  type StoredNexusEvent,
  type EventDraft,
} from "../../domain/nexus-events";
export type ClientEvent = NexusEvent & { sequence?: string; user_id?: string };
export type EventConnection =
  "connecting" | "live" | "reconnecting" | "unavailable" | "paused";
const empty = {
  events: [] as ClientEvent[],
  connection: "connecting" as EventConnection,
  error: "",
};
export class NexusClientBus {
  private snapshot = empty;
  private listeners = new Set<() => void>();
  read = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private notify() {
    this.listeners.forEach((fn) => fn());
  }
  receive(events: ClientEvent[]) {
    const merged = new Map(
      this.snapshot.events.map((event) => [event.id, event]),
    );
    for (const raw of events) {
      const event = nexusEvent.strip().parse(raw);
      if (event.visibility === "internal") continue;
      merged.set(event.id, {
        ...event,
        ...(raw.sequence ? { sequence: raw.sequence } : {}),
      });
    }
    const ordered = [...merged.values()].sort((a, b) =>
      a.sequence && b.sequence
        ? BigInt(a.sequence) < BigInt(b.sequence)
          ? -1
          : BigInt(a.sequence) > BigInt(b.sequence)
            ? 1
            : 0
        : a.timestamp.localeCompare(b.timestamp),
    );
    this.snapshot = { ...this.snapshot, events: ordered.slice(-300) };
    this.notify();
  }
  status(connection: EventConnection, error = "") {
    const changed = this.snapshot.connection !== connection;
    this.snapshot = { ...this.snapshot, connection, error };
    if (changed)
      this.receive([
        createNexusEvent(
          {
            type: `system.events_${connection}`,
            source: { kind: "client", name: "Nexus transport" },
            severity: connection === "unavailable" ? "warning" : "debug",
            payload: { status: connection },
          },
          crypto.randomUUID(),
        ),
      ]);
    else this.notify();
  }
  reset() {
    this.snapshot = empty;
    this.notify();
  }
}
export const nexusClientBus = new NexusClientBus();
export const useNexusEvents = () =>
  useSyncExternalStore(
    nexusClientBus.subscribe,
    nexusClientBus.read,
    () => empty,
  );
/** Browser-owned facts are explicitly client observations, never server acknowledgements. No content/media. */
export function publishClientEvent(draft: Omit<EventDraft, "source">) {
  nexusClientBus.receive([
    createNexusEvent(
      { ...draft, source: { kind: "client", name: "Nexus UI" } },
      crypto.randomUUID(),
    ),
  ]);
}
export function parseEventBatch(data: string): {
  events: StoredNexusEvent[];
  cursor: string;
  has_more: boolean;
} {
  const raw = JSON.parse(data);
  if (
    !Array.isArray(raw.events) ||
    raw.events.length > 100 ||
    typeof raw.cursor !== "string" ||
    !/^\d{1,18}$/.test(raw.cursor) ||
    typeof raw.has_more !== "boolean"
  )
    throw Error("Invalid event batch");
  return {
    events: raw.events.map((e: StoredNexusEvent) => {
      if (!/^\d{1,18}$/.test(e.sequence)) throw Error("Invalid event sequence");
      return {
        ...nexusEvent.strip().parse(e),
        sequence: e.sequence,
        user_id: e.user_id,
      };
    }),
    cursor: raw.cursor,
    has_more: raw.has_more,
  };
}
