import { z } from "zod";
import type { Json, RecordBase, Table } from "./models";
export const reflectionChange = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("memory_update"),
      memory_id: z.uuid(),
      summary: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("importance_adjustment"),
      memory_id: z.uuid(),
      importance_score: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relationship_update"),
      relationship_id: z.uuid(),
      strength: z.literal(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal("lesson_learned"),
      content: z.string().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("outcome_link"),
      outcome_id: z.uuid(),
      goal_id: z.uuid(),
    })
    .strict(),
]);
export type ReflectionChange = z.infer<typeof reflectionChange>;
export interface ReflectionEvidence {
  table: Table;
  id: string;
  snapshot: Json;
}
export interface ReflectionObservation {
  category: string;
  noticed: string;
  evidence: ReflectionEvidence[];
}
export interface ReflectionJob extends RecordBase {
  conversation_id: string;
  source_message_id: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  lease_until: string | null;
  error: string | null;
  version: string;
  observations: ReflectionObservation[];
}
export interface ReflectionProposal extends RecordBase {
  job_id: string;
  fingerprint: string;
  kind: ReflectionChange["kind"];
  status: "pending" | "accepted" | "rejected";
  noticed: string;
  reason: string;
  change: ReflectionChange;
  evidence: ReflectionEvidence[];
  review_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  applied_changes: Json[];
}
