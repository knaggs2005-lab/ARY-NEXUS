import { z } from "zod";
import { entityTypes, memoryTypes } from "./models";
const metadata = z.record(z.string(), z.unknown()).default({});
const score = z.number().min(0).max(1);
export const memoryInput = z
  .object({
    memory_type: z.enum(memoryTypes).default("fact"),
    content: z.string().trim().min(1).max(20000),
    summary: z.string().trim().max(1000).default(""),
    importance_score: score.default(0.5),
    confidence_score: score.default(0.8),
    metadata,
    source_message_id: z.uuid().nullable().default(null),
    valid_from: z.iso.datetime({ offset: true }).nullable().default(null),
    valid_to: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const memoryUpdate = z
  .object({
    memory_type: z.enum(memoryTypes).optional(),
    content: z.string().trim().min(1).max(20000).optional(),
    summary: z.string().trim().max(1000).optional(),
    importance_score: score.optional(),
    confidence_score: score.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );
export const entityInput = z
  .object({
    entity_type: z.enum(entityTypes),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(""),
    metadata,
  })
  .strict();
export const relationshipInput = z
  .object({
    valid_from: z.iso.datetime({ offset: true }).nullable().default(null),
    valid_to: z.iso.datetime({ offset: true }).nullable().default(null),
    memory_id: z.uuid().nullable().default(null),
    source_entity_id: z.uuid(),
    target_entity_id: z.uuid(),
    relationship_type: z.string().trim().min(1).max(100),
    strength: score.default(1),
    metadata,
  })
  .strict()
  .refine(
    (x) => x.source_entity_id !== x.target_entity_id,
    "Cannot link an entity to itself",
  );
export const chatInput = z
  .object({
    modality: z.enum(["text", "voice"]).default("text"),
    time_zone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid time zone")
      .optional(),
    input: z.string().trim().min(1).max(10000),
    conversation_id: z.uuid().optional(),
  })
  .strict();
export const extractionCandidate = z
  .object({
    memory: memoryInput,
    evidence_quote: z.string().trim().min(1).max(10000),
    entity_ids: z.array(z.uuid()).max(20).default([]),
    disposition: z
      .enum(["new", "duplicate", "supersede", "conflict"])
      .default("new"),
    related_memory_id: z.uuid().nullable().default(null),
    reason: z.string().max(1000).default(""),
  })
  .strict();
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function required<T>(value: T | null, name: string): T {
  if (!value) throw new AppError(`${name} not found`, 404);
  return value;
}
