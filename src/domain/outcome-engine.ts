import { z } from "zod";
import type { Json } from "./models";
export const sourceRef = z
  .object({
    table: z.enum([
      "messages",
      "entities",
      "goals",
      "tasks",
      "actions",
      "outcomes",
    ]),
    id: z.uuid(),
  })
  .strict();
export const outcomeLink = z
  .object({
    kind: z.enum([
      "skill",
      "agent",
      "person",
      "company",
      "project",
      "strategy",
    ]),
    id: z.uuid(),
    version: z.number().int().positive().optional(),
  })
  .strict();
export const assessmentInput = z
  .object({
    outcome_id: z.uuid(),
    revision: z.number().int().nonnegative(),
    result: z.string().trim().min(3).max(2000),
    achievement: z.enum(["unknown", "success", "failure", "partial"]),
    confidence: z.number().min(0).max(1),
    metrics: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            value: z.number().finite(),
            unit: z.string().trim().min(1).max(40),
          })
          .strict(),
      )
      .max(20),
    correction: z.string().trim().max(2000),
    lessons: z.array(z.string().trim().min(3).max(1000)).max(10),
    links: z.array(outcomeLink).max(20),
    evidence: z.array(sourceRef).min(1).max(20),
  })
  .strict();
export type AssessmentInput = z.infer<typeof assessmentInput>;
export interface Evidence extends z.infer<typeof sourceRef> {
  hash: string;
  snapshot: Json;
}
export interface Assessment extends Omit<
  AssessmentInput,
  "outcome_id" | "revision" | "evidence"
> {
  revision: number;
  evidence: Evidence[];
  action_id: string;
  at: string;
  actor: string;
}
export interface Recommendation {
  id: string;
  tool: string;
  reason: string;
  proposal: string;
  evidence: { outcome_id: string; hash: string; run: string; snapshot: Json }[];
  history: {
    state: "proposed" | "accepted" | "rejected" | "withdrawn";
    reason: string;
    at: string;
    action_id: string;
    actor: string;
  }[];
}
export interface OutcomeLearning {
  revision: number;
  assessments: Assessment[];
  recommendations: Recommendation[];
}
export const LEARNING = "nexus_outcome_engine_v1";
export const emptyLearning = (): OutcomeLearning => ({
  revision: 0,
  assessments: [],
  recommendations: [],
});
