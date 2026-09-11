import { z } from "zod";
import type { Memory, MemoryHit, RecordBase } from "./models";
export const memoryClasses = [
  "WORKING",
  "EPISODIC",
  "SEMANTIC",
  "ENTITY",
  "PROCEDURAL",
  "OUTCOME",
] as const;
export const memoryPolicy = z
  .object({
    version: z.literal(1),
    class: z.enum(memoryClasses),
    conversation_id: z.uuid().nullable().default(null),
    expires_at: z.iso.datetime({ offset: true }).nullable().default(null),
    outcome_id: z.uuid().nullable().default(null),
    consolidated_from: z
      .array(
        z.object({
          id: z.uuid(),
          updated_at: z.string(),
          content_hash: z.string().optional(),
        }),
      )
      .max(8)
      .default([]),
  })
  .strict();
export type MemoryPolicy = z.infer<typeof memoryPolicy>;
export function policyFor(
  m: Pick<Memory, "metadata" | "memory_type">,
): MemoryPolicy {
  const p = memoryPolicy.safeParse(m.metadata.nexus_memory);
  if (p.success) return p.data;
  return {
    version: 1,
    class:
      m.memory_type === "episodic"
        ? "EPISODIC"
        : m.memory_type === "procedural"
          ? "PROCEDURAL"
          : "SEMANTIC",
    conversation_id: null,
    expires_at: null,
    outcome_id: null,
    consolidated_from: [],
  };
}
/** Existing rows keep their IDs, legacy types, evidence and embeddings. */
export function memoryInScope(
  m: Omit<Memory, "embedding">,
  conversationId?: string,
  now = Date.now(),
) {
  const p = policyFor(m);
  if (
    m.metadata.nexus_memory !== undefined &&
    !memoryPolicy.safeParse(m.metadata.nexus_memory).success
  )
    return false;
  return (
    (!p.expires_at || Date.parse(p.expires_at) > now) &&
    (p.class !== "WORKING" ||
      Boolean(conversationId && p.conversation_id === conversationId))
  );
}
export function explainHit(m: MemoryHit) {
  return {
    class: policyFor(m).class,
    learned_at: m.created_at,
    confidence: m.confidence_score,
    confidence_basis:
      "Recorded confidence; not a calibrated probability or independent verification.",
    relevant_because: (m.retrieval_reasons ?? [])
      .slice(0, 8)
      .map((reason) => reason.slice(0, 500)),
    provenance: (m.source_evidence ?? []).slice(0, 2).map((s) => ({
      kind: s.kind,
      reference: s.reference.slice(0, 500),
      quote: s.quote?.slice(0, 1000) ?? null,
    })),
    valid_from: m.valid_from,
    valid_to: m.valid_to,
    unresolved_conflicts: m.unresolved_conflict_count ?? 0,
  };
}
export const captureMemoryInput = z
  .object({
    class: z.enum(memoryClasses),
    content: z.string().trim().min(1).max(20000),
    summary: z.string().trim().max(1000).default(""),
    confidence: z.number().min(0).max(1).default(0.8),
    importance: z.number().min(0).max(1).default(0.5),
    entity_ids: z.array(z.uuid()).max(20).default([]),
    outcome_id: z.uuid().nullable().default(null),
    conversation_id: z.uuid().nullable().default(null),
    source_message_id: z.uuid().nullable().default(null),
    expires_at: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export const consolidateInput = z
  .object({
    sources: z
      .array(z.object({ id: z.uuid(), updated_at: z.string().min(1) }).strict())
      .min(2)
      .max(8),
    summary: z.string().trim().min(1).max(2000),
  })
  .strict();
export const forgetInput = z
  .object({
    id: z.uuid(),
    expected_updated_at: z.string().min(1),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const knowledgeInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20000),
    reference: z.string().trim().min(3).max(1000),
    confidence: z.number().min(0).max(1).default(0.8),
    entity_ids: z.array(z.uuid()).max(20).default([]),
    supersedes_id: z.uuid().nullable().default(null),
  })
  .strict();
export interface KnowledgeDocument extends RecordBase {
  title: string;
  content: string;
  reference: string;
  confidence: number;
  entity_ids: string[];
  supersedes_id: string | null;
  archived_at: string | null;
}

export const classifyMemoryInput = captureMemoryInput
  .omit({
    content: true,
    summary: true,
    confidence: true,
    importance: true,
    source_message_id: true,
  })
  .extend({ id: z.uuid(), expected_updated_at: z.string().min(1) })
  .strict();
