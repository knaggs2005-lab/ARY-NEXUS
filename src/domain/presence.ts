/** Presentation-only events. Never authority to execute, approve, or write memory. */
export type PresenceState =
  | "idle"
  | "understanding"
  | "thinking"
  | "retrieving"
  | "remembering"
  | "acting"
  | "delegating"
  | "mission"
  | "waiting"
  | "approval"
  | "complete"
  | "error"
  | "listening"
  | "speaking";
export interface PresenceEvent {
  operation: string;
  state: PresenceState;
  label: string;
  terminal?: boolean;
  count?: number;
}
export const presencePriority: Record<PresenceState, number> = {
  idle: 0,
  complete: 1,
  waiting: 2,
  remembering: 3,
  understanding: 4,
  thinking: 5,
  retrieving: 6,
  delegating: 7,
  mission: 8,
  acting: 9,
  listening: 10,
  speaking: 10,
  approval: 11,
  error: 12,
};
export const idlePresence: PresenceEvent = {
  operation: "idle",
  state: "idle",
  label: "Ready",
};
/** Concurrent work cannot clear a different operation; terminal events are receipts, not work. */
export function selectPresence(events: PresenceEvent[]): PresenceEvent {
  return events.reduce(
    (best, event) =>
      presencePriority[event.state] >= presencePriority[best.state]
        ? event
        : best,
    idlePresence,
  );
}
