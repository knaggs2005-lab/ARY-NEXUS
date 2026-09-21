import { AppError } from "./validation";
import { z } from "zod";
import type { Json } from "./models";
import type { PlanSpec } from "./orchestration";

export class WorkspacePolicyError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export const DEVELOPMENT = "self_development_v1";
export const sha = z.string().regex(/^[a-f0-9]{64}$/);
export const sourcePath = z
  .string()
  .max(240)
  .regex(/^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/)
  .refine(
    (p) => !p.split("/").some((s) => !s || s === "." || s === ".."),
    "Invalid repository path",
  );
export const evidenceRef = z
  .object({
    table: z.enum(["messages", "actions", "outcomes", "tasks", "entities"]),
    id: z.uuid(),
  })
  .strict();
export const observeInput = z
  .object({
    observation: z.string().trim().min(5).max(2000),
    evidence: z.array(evidenceRef).min(1).max(8),
  })
  .strict();
export const planInput = z
  .object({
    run_id: z.uuid(),
    revision: z.number().int().nonnegative(),
    base_commit: z.string().regex(/^[a-f0-9]{40}$/),
    paths: z.array(sourcePath).min(1).max(12),
    acceptance: z.array(z.string().trim().min(5).max(500)).min(1).max(8),
    risks: z.array(z.string().trim().min(3).max(500)).min(1).max(8),
    rollback: z.string().trim().min(10).max(1000),
    focused_tests: z.array(sourcePath).min(1).max(8),
  })
  .strict()
  .refine((i) => new Set(i.paths).size === i.paths.length, "Duplicate paths");
export type EngineeringPlan = z.infer<typeof planInput>;
export const patchInput = z
  .object({
    run_id: z.uuid(),
    revision: z.number().int().nonnegative(),
    changes: z
      .array(
        z
          .object({
            path: sourcePath,
            before: sha.nullable(),
            content: z.string().max(32000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .refine(
    (i) => new Set(i.changes.map((c) => c.path)).size === i.changes.length,
    "Duplicate paths",
  );
export type Patch = z.infer<typeof patchInput>;
export const reviewCategories = [
  "permission_weakening",
  "approval_bypass",
  "secret_exposure",
  "schema_changes",
  "audit_removal",
  "memory_provenance",
  "disabled_tests",
  "execution_authority",
  "external_side_effects",
] as const;
export const reviewOutput = z
  .object({
    summary: z.string().min(5).max(2000),
    checks: z
      .object(
        Object.fromEntries(
          reviewCategories.map((k) => [
            k,
            z
              .object({
                verdict: z.enum(["pass", "concern", "unknown"]),
                reason: z.string().min(5).max(500),
              })
              .strict(),
          ]),
        ) as unknown as Record<
          (typeof reviewCategories)[number],
          z.ZodType<{ verdict: "pass" | "concern" | "unknown"; reason: string }>
        >,
      )
      .strict(),
  })
  .strict();
export type Review = z.infer<typeof reviewOutput>;
export type CommandName = "test" | "focused" | "typecheck" | "format" | "build";
export interface CommandReceipt {
  command: CommandName;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  output: string;
  truncated: boolean;
  termination?: "exited" | "timeout" | "cancelled" | "output_limit";
  timeout_ms?: number;
  output_bytes?: number;
}
export interface ValidationReceipt {
  candidate: string;
  commands: CommandReceipt[];
  passed: boolean;
  sandbox: string;
  operation_id: string;
}
export interface WorkspaceReceipt {
  branch: string;
  base: string;
  candidate: string;
}
export interface DevelopmentRun {
  version: 1;
  id: string;
  revision: number;
  owner: string;
  conversation_id: string;
  observation: string;
  evidence: { table: string; id: string; hash: string; snapshot: Json }[];
  proposal?: string;
  plan?: EngineeringPlan;
  plan_hash?: string;
  mission_id?: string;
  phase:
    | "OBSERVATION"
    | "PROPOSAL"
    | "ARCHITECTURE_PLAN"
    | "APPROVED"
    | "WORKSPACE"
    | "IMPLEMENTATION"
    | "TEST"
    | "REVIEW"
    | "RELEASE_CANDIDATE"
    | "COMPLETED"
    | "REJECTED";
  protected_approval?: string;
  workspace?: WorkspaceReceipt;
  patch?: { value: Patch; hash: string; author: string; action_id: string };
  validation?: ValidationReceipt;
  review?: {
    result: Review;
    action_id: string;
    candidate: string;
    reviewer: string;
    model: string;
    provider: string;
    metrics: import("./providers").ReasoningResult["metrics"];
    ready: boolean;
  };
  release?: { hash: string; manifest: Json };
  decision?: {
    accept: boolean;
    reason: string;
    action_id: string;
    release_hash: string;
  };
  history: { phase: string; role: string; action_id: string; at: string }[];
}
/** Future outcome import only. No autonomous learning loop or merge implementation. */
export interface ReleasedDevelopmentOutcome {
  run_id: string;
  release_hash: string;
  verified_merge_commit: string;
  source_action_id: string;
  outcome_id: string;
  metrics: { name: string; value: number; unit: string }[];
}
export interface DevelopmentExecutor {
  source(
    base: string,
    paths: string[],
  ): Promise<{ path: string; content: string; hash: string }[]>;
  isolate(
    run: DevelopmentRun,
    operation: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceReceipt>;
  apply(
    run: DevelopmentRun,
    operation: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceReceipt>;
  inspect(
    run: DevelopmentRun,
  ): Promise<{ candidate: string; diff: string; files: string[] }>;
  validate(
    run: DevelopmentRun,
    operation: string,
    signal?: AbortSignal,
  ): Promise<ValidationReceipt>;
  cleanup(run: DevelopmentRun): Promise<{
    removed: boolean;
    branch_retained: boolean;
    evidence_retained: boolean;
  }>;
  releaseReservation(run: DevelopmentRun): Promise<void>;
}
/** File-name boundary complements content redaction; no credential-file inspection. */
export function secretPath(path: string) {
  return (
    /(^|\/)(?:\.env[^/]*|\.git|\.data|\.ssh|\.aws|\.config|\.npmrc|credentials?|secrets?|vault|id_rsa|id_ed25519)(?:\/|\.|$)/i.test(
      path,
    ) || /\.(?:pem|key|p12|pfx)$/i.test(path)
  );
}
/** No secret inspection or authority modification through this capability, even with ADMIN approval. */
export function forbiddenPath(path: string) {
  return (
    secretPath(path) ||
    /(^|\/)(\.env[^/]*|\.git|\.data|node_modules|credentials?|secrets?|vault)(\/|\.|$)/i.test(
      path,
    ) ||
    /(?:permission|authorization|action-service|action-request-service|action-cancellation|agent-context|mission-execution-context|self-development|development-tools|tool-registry|security|oauth|vault)/i.test(
      path,
    ) ||
    /^(?:AGENTS\.md|\.gitattributes|\.gitmodules|\.npmrc|package(?:-lock)?\.json|(?:tsconfig|next\.config|vitest\.config)\.|scripts\/|desktop\/|src\/infrastructure\/development\/)/i.test(
      path,
    )
  );
}
export function protectedPath(path: string) {
  return (
    forbiddenPath(path) ||
    /^(?:supabase\/|deploy\/|vercel\.json|Dockerfile|docker-compose|netlify\.toml|fly\.toml|\.github\/|src\/server\/|src\/infrastructure\/(?:providers|repositories|mcp|control|desktop)\/)/i.test(
      path,
    ) ||
    /(?:memory|brain|entity|retrieval|orchestrat|mission|agent-runtime|outcome|audit)/i.test(
      path,
    )
  );
}
export function engineeringSpec(run: DevelopmentRun): PlanSpec {
  const id = run.id;
  const steps: PlanSpec["steps"] = [];
  function step(
    name: string,
    tool: string,
    input: Record<string, unknown>,
    wait?: string,
  ) {
    steps.push({
      id: name,
      title: name.replaceAll("_", " "),
      tool,
      input: { run_id: id, ...input },
      depends_on: steps.length ? [steps.at(-1)!.id] : [],
      critical: true,
      missing: [],
      source_action_from: null,
      verification: null,
      ...(wait ? { wait_for: { name: wait, timeout_ms: 604800000 } } : {}),
    });
  }
  step("workspace", "development.workspace", { plan_hash: run.plan_hash });
  step("patch_ready", "development.patch_ready", {}, "patch_ready");
  step("implement", "development.implement", {
    patch_hash: { $from: "patch_ready", path: ["result", "patch_hash"] },
  });
  step("test", "development.test", {});
  step("review", "development.review", {});
  step("release", "development.release", {});
  step("decision", "development.finalize", {}, "owner_decision");
  for (const item of steps)
    if (item.id !== "patch_ready")
      item.verification = {
        tool: "development.verify",
        input: { run_id: id, stage: item.id },
        path: ["verified"],
        equals: true,
        description:
          "Read durable stage evidence and verify the current candidate hash",
      };
  return { title: run.proposal!.slice(0, 160), steps, questions: [] };
}
