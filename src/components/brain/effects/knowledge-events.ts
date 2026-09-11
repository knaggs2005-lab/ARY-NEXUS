/** Ephemeral presentation notifications. Never infer creation from graph differences. */
export interface KnowledgeEvent {
  id: string;
  kind: "memory" | "relationship";
  entityIds: string[];
  at: number;
}
const pending: KnowledgeEvent[] = [];
const listeners = new Set<() => void>();
const TTL = 15_000;
export function noteKnowledgeCreated(event: Omit<KnowledgeEvent, "at">) {
  if (pending.some((item) => item.id === event.id)) return;
  pending.push({ ...event, at: Date.now() });
  pending.splice(0, Math.max(0, pending.length - 8));
  for (const listener of listeners) listener();
}
export function takeKnowledgeEvents(now = Date.now()) {
  return pending.splice(0).filter((event) => now - event.at < TTL);
}
export function subscribeKnowledgeEvents(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function clearKnowledgeEvents() {
  pending.length = 0;
}
