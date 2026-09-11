import { z } from "zod";
import type { ReasoningResult } from "./providers";
export const boardRoles = [
  "Sales Ary",
  "CMO Ary",
  "Research Ary",
  "Developer Ary",
  "Analyst Ary",
  "CEO Ary",
] as const;
export type BoardRole = (typeof boardRoles)[number];
export const boardRequest = z
  .object({
    request_key: z.uuid(),
    focus: z.string().trim().max(300).default(""),
  })
  .strict();
const text = z.string().trim().min(1).max(240);
export const boardOutput = z
  .object({
    summary: text,
    findings: z
      .array(
        z
          .object({
            observation: text,
            next_step: text,
            evidence: z.array(z.string().max(80)).min(1).max(4),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(2),
    order: z.array(z.string().max(80)).max(8),
    plan: z
      .array(
        z.object({ finding_id: z.string().max(80), next_step: text }).strict(),
      )
      .max(5),
  })
  .strict();
export interface BoardEvidence {
  key: string;
  table: string;
  id: string;
  label: string;
  detail: string;
  entity_id: string | null;
  score: number | null;
}
export type BoardFinding = z.infer<typeof boardOutput>["findings"][number] & {
  id: string;
  role: BoardRole;
};
export interface BoardRoleResult {
  role: BoardRole;
  status: "complete" | "failed";
  summary: string;
  findings: BoardFinding[];
  error?: string;
  model: string;
  provider: string;
  metrics: ReasoningResult["metrics"] | null;
}
export interface BoardReport {
  version: "board-v1";
  id: string;
  conversation_id: string;
  created_at: string;
  focus: string;
  status: "complete" | "partial";
  evidence: BoardEvidence[];
  roles: BoardRoleResult[];
  ranked_findings: string[];
  plan: { finding_id: string; next_step: string }[];
  summary: string;
  warnings: string[];
  latency_ms: number;
}
export type BoardEvent =
  | { type: "stage"; stage: string; role?: BoardRole }
  | { type: "role"; result: BoardRoleResult }
  | { type: "complete"; report: BoardReport }
  | { type: "error"; error: string };
