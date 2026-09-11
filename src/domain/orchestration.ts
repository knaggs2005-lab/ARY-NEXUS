import { z } from "zod";
import type { Json } from "./models";
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const planStep = z
  .object({
    id: identifier,
    title: z.string().min(1).max(160),
    tool: z.string().min(1).max(100),
    input: z.record(z.string(), z.unknown()),
    depends_on: z.array(identifier).max(12),
    critical: z.boolean(),
    missing: z.array(z.string().min(1).max(250)).max(8),
    source_action_from: identifier.nullable(),
    when: z
      .object({
        step: identifier,
        path: z.array(z.string().regex(/^[a-zA-Z0-9_]+$/)).max(8),
        equals: z.union([
          z.string().max(500),
          z.number().finite(),
          z.boolean(),
          z.null(),
        ]),
      })
      .strict()
      .optional(),
    wait_for: z
      .object({
        name: identifier,
        timeout_ms: z.number().int().min(100).max(604800000),
      })
      .strict()
      .optional(),
    verification: z
      .object({
        tool: z.string().min(1).max(100),
        input: z.record(z.string(), z.unknown()),
        path: z
          .array(z.string().regex(/^[a-zA-Z0-9_]+$/))
          .min(1)
          .max(8)
          .describe(
            "Path within the verification tool result, without envelope keys. Example for task.inspect: [title] or [status].",
          ),
        equals: z.union([
          z.string().max(500),
          z.number().finite(),
          z.boolean(),
        ]),
        description: z.string().min(1).max(300),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const planSpec = z
  .object({
    title: z.string().min(1).max(160),
    steps: z.array(planStep).min(1).max(12),
    questions: z.array(z.string().max(300)).max(10),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (const s of plan.steps) {
      if (
        seen.has(s.id) ||
        (s.when && !s.depends_on.includes(s.when.step)) ||
        s.depends_on.some((id) => !seen.has(id)) ||
        (s.source_action_from && !s.depends_on.includes(s.source_action_from))
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Steps must be unique and topologically ordered; source actions must be dependencies",
        });
      seen.add(s.id);
    }
  });
export type PlanSpec = z.infer<typeof planSpec>;
export type PlanStep = PlanSpec["steps"][number];
export type StepStatus =
  | "planned"
  | "waiting_event"
  | "waiting_approval"
  | "running"
  | "verified"
  | "failed"
  | "skipped"
  | "needs_verification"
  | "cancelled";
export interface StepState {
  status: StepStatus;
  phase: "execute" | "verify";
  attempt: number;
  key?: string;
  action_id?: string;
  verification_action_id?: string;
  approval_action_id?: string;
  error?: string;
  evidence?: string;
  result?: Json;
  generation?: number;
  failure?: FailureInfo;
}
export interface ExecutionPlan {
  mission?: import("./mission").MissionRuntime;
  version: "orchestrator-v1";
  id: string;
  conversation_id: string;
  source_message_id: string;
  goal: string;
  spec: PlanSpec;
  states: Record<string, StepState>;
  status: "planned" | "active" | "paused" | "stopped" | "complete";
  revision: number;
  events: { at: string; step: string | null; text: string }[];
  summary: string;
  entity_ids: string[];
  memory_ids: string[];
  model: string;
  control_cursor?: string;
  replan_history?: {
    revision: number;
    reason: string;
    before: PlanSpec;
    after: PlanSpec;
  }[];
  step_details?: Record<
    string,
    {
      objective: string;
      action: string;
      risk_level: string;
      permission_requirement: unknown;
      approval_status: string;
      execution_status: string;
      parallel_safe: boolean;
      failure: FailureInfo | null;
    }
  >;
  pending_approvals?: {
    step_id: string;
    action_id: string;
    fingerprint: string;
    policy_hash: string;
    tool: string;
    input: Json;
  }[];
}
/** Only explicit JSON references, never expression evaluation or prototype traversal. */
export function bindInput(
  value: unknown,
  results: Record<string, Json>,
  allowed: string[],
  depth = 0,
): unknown {
  if (depth > 20) throw Error("Input nesting exceeds limit");
  if (Array.isArray(value))
    return value.map((v) => bindInput(v, results, allowed, depth + 1));
  if (value && typeof value === "object") {
    const obj = value as Json;
    if ("$from" in obj) {
      if (
        Object.keys(obj).some((k) => !["$from", "path"].includes(k)) ||
        typeof obj.$from !== "string" ||
        !allowed.includes(obj.$from) ||
        !Array.isArray(obj.path) ||
        obj.path.length > 8
      )
        throw Error("Invalid dependency binding");
      let v: unknown = results[obj.$from];
      for (const key of obj.path) {
        if (
          typeof key !== "string" ||
          !/^[a-zA-Z0-9_]+$/.test(key) ||
          ["__proto__", "constructor", "prototype"].includes(key) ||
          !v ||
          typeof v !== "object" ||
          !Object.hasOwn(v, key)
        )
          throw Error("Dependency result is unavailable");
        v = (v as Json)[key];
      }
      if (v === undefined) throw Error("Dependency result is unavailable");
      return structuredClone(v);
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => {
        if (["__proto__", "constructor", "prototype"].includes(k))
          throw Error("Invalid input property");
        return [k, bindInput(v, results, allowed, depth + 1)];
      }),
    );
  }
  return value;
}

export type FailureKind =
  | "transient"
  | "permission_related"
  | "missing_input"
  | "unavailable_tool"
  | "user_decision_required"
  | "critical_dependency_failure";
export interface FailureInfo {
  kind: FailureKind;
  next_action: string;
  retry_safe: boolean;
}
export function classifyFailure(
  message: string,
  status?: number,
  retrySafe = false,
): FailureInfo {
  if (
    /approval rejected|declined|uncertain|unresolved|read.back|criterion|did not match/i.test(
      message,
    )
  )
    return {
      kind: "user_decision_required",
      next_action: "Review the evidence; do not repeat an uncertain effect.",
      retry_safe: false,
    };
  if (status === 403 || /permission|not permitted|policy/i.test(message))
    return {
      kind: "permission_related",
      next_action:
        "Review the existing permission policy; no privilege was raised.",
      retry_safe: false,
    };
  if (
    /not configured|disabled|unavailable.*tool|not available|not enabled|not installed|connection|connect .*first/i.test(
      message,
    )
  )
    return {
      kind: "unavailable_tool",
      next_action:
        "Configure the existing tool or propose a reviewed alternative.",
      retry_safe: false,
    };
  if (/dependenc.*fail|critical step/i.test(message))
    return {
      kind: "critical_dependency_failure",
      next_action:
        "Repair or explicitly skip the affected branch before continuing.",
      retry_safe: false,
    };
  if (
    status === 400 ||
    /missing|invalid|input|not found|clarification/i.test(message)
  )
    return {
      kind: "missing_input",
      next_action: "Supply the missing information in a visible plan revision.",
      retry_safe: false,
    };
  if (
    [429, 502, 503, 504].includes(status ?? 0) ||
    /transient|timeout|timed out|temporarily/i.test(message)
  )
    return {
      kind: "transient",
      next_action: retrySafe
        ? "A bounded retry is available; permissions and idempotency still apply."
        : "Inspect the external receipt before retrying this effect.",
      retry_safe: retrySafe,
    };
  return {
    kind: "user_decision_required",
    next_action: "Inspect the failed action and choose a reviewed recovery.",
    retry_safe: false,
  };
}
export function executionStatus(plan: ExecutionPlan, step: PlanStep): string {
  const s = plan.states[step.id];
  if (s.status === "cancelled") return "cancelled";
  if (s.status === "verified") return "completed";
  if (s.status === "waiting_approval") return "waiting_for_approval";
  if (s.status === "running")
    return s.phase === "verify" ? "verifying" : "running";
  if (s.status === "needs_verification") return "verifying";
  if (s.status === "planned") {
    if (step.depends_on.some((id) => plan.states[id].status !== "verified"))
      return "waiting_for_dependency";
    return plan.status === "planned" ? "planned" : "ready";
  }
  return s.status;
}
