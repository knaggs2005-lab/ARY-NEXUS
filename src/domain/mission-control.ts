import type { Action, ModelCall, Outcome } from "./models";
import type { ActionApproval } from "./permissions";
import type { ExecutionPlan } from "./orchestration";
import { executionStatus } from "./orchestration";
import type { calculateRoi } from "./roi";

export interface MissionReceipt {
  action: Action;
  approvals: ActionApproval[];
  outcomes: Outcome[];
  calls: ModelCall[];
}
export interface MissionControlSnapshot {
  plan: ExecutionPlan;
  receipts: MissionReceipt[];
  receipt_count: number;
  costs: ReturnType<typeof calculateRoi>["costRows"] | null;
  observed_at: string;
}
export type MissionNodeKind =
  "agent" | "tool" | "decision" | "approval" | "wait" | "output";
export interface MissionGraphNode {
  id: string;
  step_id: string;
  kind: MissionNodeKind;
  title: string;
  subtitle: string;
  status: string;
  active: boolean;
  position: { x: number; y: number };
}
export interface MissionGraphEdge {
  id: string;
  source: string;
  target: string;
  active: boolean;
}

/** Read-only projection. Graph identity/selection never becomes execution authority. */
export function missionGraph(plan: ExecutionPlan) {
  const nodes: MissionGraphNode[] = [],
    edges: MissionGraphEdge[] = [];
  const terminals = new Map<string, string>();
  const levels = new Map<string, number>();
  const stopped =
    ["PAUSED", "CANCELLED", "FAILED", "COMPLETED"].includes(
      plan.mission?.state ?? "",
    ) || ["paused", "stopped", "complete"].includes(plan.status);
  for (const step of plan.spec.steps) {
    const state = plan.states[step.id];
    const current =
      plan.step_details?.[step.id]?.execution_status ??
      executionStatus(plan, step);
    const firstLevel = Math.max(
      0,
      ...step.depends_on.map(
        (id) => (levels.get(terminals.get(id) ?? "") ?? -1) + 1,
      ),
    );
    let previous: string | undefined,
      level = firstLevel;
    const append = (
      kind: MissionNodeKind,
      title: string,
      subtitle: string,
      status: string,
      active = false,
    ) => {
      const id = `${step.id}:${kind}`;
      const node: MissionGraphNode = {
        id,
        step_id: step.id,
        kind,
        title,
        subtitle,
        status,
        active: active && !stopped,
        position: { x: level * 250, y: 0 },
      };
      nodes.push(node);
      levels.set(id, level++);
      for (const source of previous
        ? [previous]
        : step.depends_on.map((id) => terminals.get(id)!)) {
        edges.push({
          id: `${source}->${id}`,
          source,
          target: id,
          active: node.active,
        });
      }
      previous = id;
    };
    if (step.when)
      append(
        "decision",
        "Evidence condition",
        `${step.when.step} · ${step.when.path.join(".")} = ${String(step.when.equals)}`,
        state.status === "skipped"
          ? "skipped"
          : state.status === "planned"
            ? "pending"
            : "recorded — inspect evidence",
      );
    if (step.wait_for)
      append(
        "wait",
        "External evidence",
        step.wait_for.name,
        state.status === "waiting_event"
          ? "waiting_event"
          : state.status === "planned"
            ? "pending"
            : "see checkpoint evidence",
      );
    const approval = plan.pending_approvals?.find((a) => a.step_id === step.id);
    if (approval || state.approval_action_id)
      append(
        "approval",
        "Human approval",
        "Exact action inputs",
        plan.step_details?.[step.id]?.approval_status ?? "recorded",
      );
    append(
      step.tool === "mission.agent" ? "agent" : "tool",
      step.title,
      step.tool === "mission.agent"
        ? String(step.input.role ?? "Assigned role")
        : step.tool,
      current,
      state.status === "running",
    );
    append(
      "output",
      step.verification ? "Verify outcome" : "Recorded output",
      step.verification?.description ?? "Tool receipt; inspect its evidence",
      state.status === "verified"
        ? "completed"
        : state.phase === "verify"
          ? current
          : state.status === "skipped"
            ? "skipped"
            : ["failed", "cancelled"].includes(state.status)
              ? "not verified"
              : "pending",
      state.status === "running" && state.phase === "verify",
    );
    // During verification the output, not the execution node, is active.
    if (state.phase === "verify") {
      const tool = nodes.find(
        (n) =>
          n.id ===
          `${step.id}:${step.tool === "mission.agent" ? "agent" : "tool"}`,
      )!;
      tool.active = false;
      if (state.result) tool.status = "receipt recorded";
    }
    terminals.set(step.id, previous!);
  }
  const columns = new Map<number, MissionGraphNode[]>();
  for (const node of nodes) {
    const column = columns.get(node.position.x) ?? [];
    column.push(node);
    columns.set(node.position.x, column);
  }
  for (const column of columns.values())
    column.forEach((node, index) => {
      node.position.y = (index - (column.length - 1) / 2) * 155;
    });
  for (const edge of edges)
    edge.active = nodes.find((n) => n.id === edge.target)?.active ?? false;
  return { nodes, edges };
}

export function missionAttention(plan: ExecutionPlan) {
  const items = plan.spec.steps.map((step) => ({
    step,
    state: plan.states[step.id],
  }));
  return {
    running: items.filter((i) => i.state.status === "running"),
    waiting: items.filter((i) =>
      ["waiting_event", "waiting_approval", "needs_verification"].includes(
        i.state.status,
      ),
    ),
    failed: items.filter((i) => i.state.status === "failed"),
    completed: items.filter((i) => i.state.status === "verified"),
    agents: items.filter((i) => i.step.tool === "mission.agent"),
  };
}

/** Exact action references plus the existing scoped execution-key namespace, including past attempts. */
export function actionBelongsToMission(action: Action, plan: ExecutionPlan) {
  const refs = new Set(
    Object.values(plan.states)
      .flatMap((s) => [
        s.action_id,
        s.approval_action_id,
        s.verification_action_id,
      ])
      .filter(Boolean),
  );
  const key = (
    action.metadata.request_envelope as { request_key?: unknown } | undefined
  )?.request_key;
  return (
    refs.has(action.id) ||
    (["orchestrator.plan", "mission.create"].includes(action.tool_name) &&
      (action.output.result as { id?: string } | undefined)?.id === plan.id) ||
    (action.metadata.requesting_agent === "ary_orchestrator" &&
      typeof key === "string" &&
      key.startsWith(`plan:${plan.id}:`)) ||
    ((action.tool_name.startsWith("mission.") ||
      action.tool_name.startsWith("orchestrator.")) &&
      (action.input.mission_id === plan.id || action.input.plan_id === plan.id))
  );
}
