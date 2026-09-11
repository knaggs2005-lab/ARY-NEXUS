import { z } from "zod";
export const eventFamilies = [
  "ary",
  "agent",
  "mission",
  "memory",
  "tool",
  "skill",
  "automation",
  "device",
  "voice",
  "computer",
  "browser",
  "permission",
  "model",
  "system",
] as const;
export const eventType = z
  .string()
  .max(120)
  .regex(
    /^(ary|agent|mission|memory|tool|skill|automation|device|voice|computer|browser|permission|model|system)\.[a-z][a-z0-9_.]*$/,
  );
const text = z.string().max(240);
/** Explicit operational fields only. Unknown fields (prompts, bodies, keys, media etc.) are stripped. */
export const eventPayload = z.object({
  agent_id: z.uuid().optional(),
  parent_agent_id: z.uuid().nullable().optional(),
  label: text.optional(),
  state: text.optional(),
  status: text.optional(),
  phase: text.optional(),
  role: text.optional(),
  operation_id: text.optional(),
  action_id: z.uuid().nullable().optional(),
  record_id: z.uuid().optional(),
  conversation_id: z.uuid().nullable().optional(),
  source_message_id: z.uuid().nullable().optional(),
  memory_id: z.uuid().optional(),
  tool: text.optional(),
  capability: text.optional(),
  device_id: text.optional(),
  terminal: z.boolean().optional(),
  count: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative().optional(),
  model: text.optional(),
  provider: text.optional(),
  duration_ms: z.number().nonnegative().nullable().optional(),
  input_tokens: z.number().nonnegative().nullable().optional(),
  output_tokens: z.number().nonnegative().nullable().optional(),
  estimated_cost_usd: z.number().nonnegative().nullable().optional(),
  reason_code: text.optional(),
  retryable: z.boolean().optional(),
});
export const eventDraft = z
  .object({
    type: eventType,
    source: z
      .object({
        kind: z.enum(["backend", "database", "client"]),
        name: z.string().min(1).max(80),
      })
      .strict(),
    related_entity_id: z.uuid().nullable().default(null),
    correlation_id: z.uuid().nullable().default(null),
    mission_id: z.uuid().nullable().default(null),
    severity: z
      .enum(["debug", "info", "warning", "error", "critical"])
      .default("info"),
    visibility: z.enum(["ambient", "systems", "internal"]).default("systems"),
    payload: eventPayload.default({}),
  })
  .strict();
export const nexusEvent = eventDraft.extend({
  version: z.literal(1),
  id: z.uuid(),
  timestamp: z.iso.datetime({ offset: true }),
});
export type EventDraft = z.input<typeof eventDraft>;
export type NexusEvent = z.infer<typeof nexusEvent>;
export type StoredNexusEvent = NexusEvent & {
  user_id: string;
  sequence: string;
};
export type PersistedNexusEvent = NexusEvent & {
  user_id: string;
  sequence: string | null;
};
export interface EventPage {
  events: StoredNexusEvent[];
  cursor: string;
  has_more: boolean;
}
export const eventQuery = z
  .object({
    after: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    before: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((v) => !(v.after && v.before), "Choose one cursor");
export interface NexusEventRepository {
  appendEvent(event: NexusEvent): Promise<PersistedNexusEvent>;
  readEvents(query: z.input<typeof eventQuery>): Promise<EventPage>;
}
export function createNexusEvent(
  draft: EventDraft,
  id: string,
  timestamp = new Date().toISOString(),
): NexusEvent {
  return nexusEvent.parse({
    ...eventDraft.parse(draft),
    version: 1,
    id,
    timestamp,
  });
}
/** Deliberately does not replay old activity as live work. Used by all client projections. */
export const isFreshEvent = (event: NexusEvent, now: number) =>
  now - Date.parse(event.timestamp) >= -5000 &&
  now - Date.parse(event.timestamp) < 15000;
