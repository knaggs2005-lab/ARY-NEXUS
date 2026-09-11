import { isFreshEvent, type StoredNexusEvent } from "../../domain/nexus-events";
import { presencePriority, type PresenceState } from "../../domain/presence";
import { PresenceStore } from "../presence/store";
/** Presentation leases avoid animating abandoned work forever. Expiry means unknown, not failed/completed. */
export class EventPresenceProjector {
  private active = new Map<string, { operation: string; expires: number }>();
  private completed = new Map<string, number>();
  constructor(private store: PresenceStore) {}
  receive(events: StoredNexusEvent[], now = Date.now()) {
    for (const event of events) {
      const payload = event.payload,
        operation = payload.operation_id ?? event.id,
        key = `nexus:${operation}`;
      if (
        ["agent.complete", "agent.error"].includes(event.type) &&
        event.correlation_id
      ) {
        this.completed.set(event.correlation_id, now + 300000);
        for (const [key, value] of this.active)
          if (value.operation.startsWith(event.correlation_id + ":")) {
            this.active.delete(key);
            this.store.clear(key);
          }
      }
      if (event.correlation_id && this.completed.has(event.correlation_id))
        continue;
      if (payload.terminal) {
        this.active.delete(key);
        this.store.clear(key);
        continue;
      }
      if (!isFreshEvent(event, now) || event.visibility !== "ambient") continue;
      if (payload.state && Object.hasOwn(presencePriority, payload.state)) {
        this.store.set(key, {
          operation,
          state: payload.state as PresenceState,
          label: payload.label ?? event.type,
        });
        this.active.set(key, { operation, expires: now + 120000 });
      }
    }
  }
  expire(now = Date.now()) {
    for (const [key, value] of this.active)
      if (now >= value.expires) {
        this.store.set(key, {
          operation: value.operation,
          state: "waiting",
          label: "No recent update · current state unconfirmed",
        });
        value.expires = Infinity;
      }
    for (const [id, until] of this.completed)
      if (now >= until) this.completed.delete(id);
  }
  clear() {
    this.active.clear();
    this.completed.clear();
    this.store.clearScope("nexus");
  }
}
