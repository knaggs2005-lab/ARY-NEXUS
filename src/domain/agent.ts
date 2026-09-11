import { z } from "zod";
import { boardRoles } from "./board";
import type { ExecutionPlan, PlanSpec } from "./orchestration";
import type { Json } from "./models";

export const agentBudgets = z
  .object({
    runs: z.number().int().min(1).max(40).default(10),
    tool_calls: z.number().int().min(1).max(200).default(40),
    model_calls: z.number().int().min(1).max(40).default(10),
    children: z.number().int().min(0).max(8).default(2),
    timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  })
  .strict();
export const agentInput = z
  .object({
    name: z.string().trim().min(3).max(80),
    purpose: z.string().trim().min(10).max(1000),
    specialization: z.enum(boardRoles),
    lifetime: z.enum(["persistent", "ephemeral"]).default("persistent"),
    capabilities: z
      .array(z.enum(["analyze", "tools", "delegate"]))
      .min(1)
      .max(3)
      .default(["analyze"]),
    tool_access: z
      .array(z.string().max(100))
      .min(1)
      .max(20)
      .default(["mission.agent"]),
    memory_scope: z.enum(["none", "mission"]).default("mission"),
    permission_level: z.number().int().min(0).max(5).default(2),
    model: z.string().min(1).max(100).default("configured"),
    budgets: agentBudgets.default(() => agentBudgets.parse({})),
    parent_id: z.uuid().nullable().default(null),
  })
  .strict();
export type AgentSpec = z.infer<typeof agentInput>;
export interface Agent extends AgentSpec {
  version: 1;
  id: string;
  user_id: string;
  created_at: string;
  terminated_at: string | null;
  termination_reason: string | null;
  children: string[];
  missions: string[];
  run_keys: string[];
  assignments: Record<string, string | null>;
  dispatch_keys: string[];
  model_keys: string[];
  source_action_id: string | null;
}
export type AgentStatus =
  | "IDLE"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "APPROVAL_REQUIRED"
  | "PAUSED"
  | "FAILED"
  | "COMPLETED"
  | "TERMINATED"
  | "EXHAUSTED";
export interface AgentView {
  agent: Agent;
  status: AgentStatus;
  missions: ExecutionPlan[];
  usage: {
    available: boolean;
    calls: number;
    input_tokens: number | null;
    output_tokens: number | null;
    estimated_cost_usd: number | null;
    unknown_cost_calls: number;
  };
}
export interface AgentRuntime {
  create(input: z.input<typeof agentInput>, actionId: string): Promise<Agent>;
  list(): Promise<AgentView[]>;
  submit(
    id: string,
    objective: string,
    key: string,
    spec?: PlanSpec,
  ): Promise<ExecutionPlan>;
  delegate(
    parentId: string,
    input: z.input<typeof agentInput>,
    objective: string,
    key: string,
  ): Promise<{ agent: Agent; mission: ExecutionPlan }>;
  terminate(id: string, reason: string): Promise<void>;
  submission(
    role: AgentSpec["specialization"],
    objective: string,
    missionId: string,
    actionId: string,
  ): Promise<Json>;
}
/** Status is a projection of actual missions/receipts, never a simulated personality loop. */
export function agentStatus(
  agent: Agent,
  missions: ExecutionPlan[],
  sourceStatus?: string,
): AgentStatus {
  if (agent.terminated_at) return "TERMINATED";
  if (sourceStatus === "requested") return "RUNNING";
  if (sourceStatus === "succeeded") return "COMPLETED";
  if (sourceStatus === "failed" || sourceStatus === "blocked") return "FAILED";
  for (const state of [
    "RUNNING",
    "APPROVAL_REQUIRED",
    "WAITING",
    "PAUSED",
    "FAILED",
  ] as const)
    if (missions.some((m) => m.mission?.state === state)) return state;
  if (
    missions.some((m) =>
      ["DRAFT", "PLANNING", "READY"].includes(m.mission?.state ?? ""),
    )
  )
    return "READY";
  if (
    agent.lifetime === "ephemeral" &&
    missions.some((m) => m.mission?.state === "COMPLETED")
  )
    return "COMPLETED";
  if (
    agent.run_keys.length >= agent.budgets.runs ||
    agent.dispatch_keys.length >= agent.budgets.tool_calls ||
    agent.model_keys.length >= agent.budgets.model_calls
  )
    return "EXHAUSTED";
  return "IDLE";
}
