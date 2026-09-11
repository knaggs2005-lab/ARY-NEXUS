import { randomUUID } from "node:crypto";
import {
  createNexusEvent,
  type EventDraft,
  type PersistedNexusEvent,
} from "../domain/nexus-events";
import type { Repository } from "../domain/repository";
import type { PresenceEvent } from "../domain/presence";
/** Durable, owner-scoped event publication. Database cursor is the cross-process transport authority. */
export class NexusEventBus {
  constructor(private repository: Repository) {}
  async publish(
    draft: EventDraft,
    id = randomUUID(),
  ): Promise<PersistedNexusEvent> {
    return this.repository.appendEvent(createNexusEvent(draft, id));
  }
  /** Domain work remains authoritative if optional telemetry storage is unavailable. Canonical record events are atomic. */
  async record(draft: EventDraft) {
    try {
      return await this.publish(draft);
    } catch {
      console.warn(
        "Nexus operational event could not be stored; inspect event-stream health.",
      );
      return null;
    }
  }
  async presence(
    event: PresenceEvent,
    correlation: string | null = null,
    entity: string | null = null,
    mission: string | null = null,
  ) {
    const family =
      event.state === "retrieving" || event.state === "remembering"
        ? "memory"
        : event.state === "delegating"
          ? "agent"
          : event.state === "acting"
            ? "tool"
            : event.state === "mission"
              ? "mission"
              : event.state === "approval"
                ? "permission"
                : "ary";
    return this.record({
      type: `${family}.${event.state}`,
      source: { kind: "backend", name: "presence-telemetry" },
      correlation_id: correlation,
      related_entity_id: entity,
      mission_id: mission,
      visibility: "ambient",
      severity: event.state === "error" ? "error" : "info",
      payload: {
        label: event.label.slice(0, 240),
        state: event.state,
        operation_id: event.operation,
        terminal: event.terminal,
        count: event.count,
      },
    });
  }
}
