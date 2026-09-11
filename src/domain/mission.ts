import { z } from "zod";
import type { ExecutionPlan, PlanSpec } from "./orchestration";
import type { Message } from "./models";
export const missionStates = [
  "DRAFT",
  "PLANNING",
  "READY",
  "RUNNING",
  "WAITING",
  "APPROVAL_REQUIRED",
  "PAUSED",
  "FAILED",
  "CANCELLED",
  "COMPLETED",
] as const;
export type MissionState = (typeof missionStates)[number];
export const missionOptions = z
  .object({
    step_timeout_ms: z.number().int().min(100).max(300000).default(120000),
    max_attempts: z.number().int().min(1).max(3).default(3),
    retry_delay_ms: z.number().int().min(100).max(3600000).default(5000),
  })
  .strict();
export const submissionInput = z
  .object({
    id: z.uuid(),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    payload: z.record(
      z.string(),
      z.union([
        z.string().max(1000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    ),
  })
  .strict()
  .refine((v) => JSON.stringify(v).length <= 4096, "Submission exceeds 4 KB");
export type MissionSubmission = z.infer<typeof submissionInput> & {
  at: string;
};
export interface MissionRuntime {
  agent_id?: string;
  version: 1;
  engine: "checkpoint-v1";
  state: MissionState;
  activated: boolean;
  wake_at: string | null;
  options: z.infer<typeof missionOptions>;
  submissions: MissionSubmission[];
  wait_deadlines: Record<string, string>;
  retry?: { step: string; at: string };
  dispatch_deadline?: string;
  uncertain?: boolean;
  reason?: string;
}
/** The application speaks this contract; it does not import workflow-vendor APIs. */
export interface MissionEngine {
  readonly implementation: string;
  create(
    goal: string,
    spec?: PlanSpec,
    options?: z.input<typeof missionOptions>,
    agentId?: string,
  ): Promise<ExecutionPlan>;
  inspect(id: string): Promise<ExecutionPlan>;
  control(
    id: string,
    command:
      "plan" | "start" | "pause" | "resume" | "cancel" | "checkpoint" | "retry",
    revision: number,
  ): Promise<ExecutionPlan>;
  submit(
    id: string,
    submission: z.infer<typeof submissionInput>,
  ): Promise<ExecutionPlan>;
  tick(id: string): Promise<ExecutionPlan>;
  runDue(limit?: number): Promise<{ processed: string[]; errors: string[] }>;
}
/** Lease ownership and checkpoint CAS must be atomic in the persistence implementation. */
export interface MissionRepository {
  claimMission(id: string, token: string, ttlMs: number): Promise<boolean>;
  releaseMission(id: string, token: string): Promise<void>;
  checkpointMission(
    id: string,
    token: string,
    expectedUpdatedAt: string,
    plan: ExecutionPlan,
  ): Promise<void>;
  dueMissions(limit: number): Promise<Message[]>;
}
export function newMission(
  options: z.input<typeof missionOptions> = {},
): MissionRuntime {
  return {
    version: 1,
    engine: "checkpoint-v1",
    state: "DRAFT",
    activated: false,
    wake_at: null,
    options: missionOptions.parse(options),
    submissions: [],
    wait_deadlines: {},
  };
}
/** Legacy status remains intact for existing consumers; durable state is explicit and stricter. */
export function syncMission(plan: ExecutionPlan) {
  const m = plan.mission;
  if (!m) return;
  if (plan.status === "stopped") {
    m.state = "CANCELLED";
    m.activated = false;
  } else if (m.state === "PAUSED" && !m.activated) {
    m.wake_at = null;
    return;
  } else if (m.retry || m.uncertain) m.state = "WAITING";
  else if (Object.values(plan.states).some((s) => s.status === "failed"))
    m.state = "FAILED";
  else if (plan.status === "complete") m.state = "COMPLETED";
  else if (
    Object.values(plan.states).some((s) => s.status === "waiting_approval")
  )
    m.state = "APPROVAL_REQUIRED";
  else if (Object.values(plan.states).some((s) => s.status === "running"))
    m.state = "RUNNING";
  else if (plan.status === "active") m.state = "RUNNING";
  else if (plan.status === "paused" && m.activated) m.state = "WAITING";
  if (["CANCELLED", "COMPLETED", "FAILED", "PAUSED"].includes(m.state))
    m.wake_at = null;
}
