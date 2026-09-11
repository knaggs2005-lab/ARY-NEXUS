import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { MissionControlService } from "../src/services/mission-control-service";
import {
  missionGraph,
  missionAttention,
  actionBelongsToMission,
} from "../src/domain/mission-control";
import type { ExecutionPlan, PlanSpec } from "../src/domain/orchestration";
import { RoiService } from "../src/services/roi-service";
let dir: string,
  f: ReturnType<typeof missionFixture>,
  service: MissionControlService,
  plan: ExecutionPlan;
const step = (
  id: string,
  depends_on: string[] = [],
): PlanSpec["steps"][number] => ({
  id,
  title: `Inspect ${id}`,
  tool: "mock.fetch_project_summary",
  input: { project_id: "30000000-0000-4000-8000-000000000001" },
  depends_on,
  critical: true,
  missing: [],
  source_action_from: null,
  verification: null,
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-mission-control-"));
  f = missionFixture(join(dir, "data.json"), randomUUID());
  service = new MissionControlService(f.repo, f.coordinator, f.actions);
  plan = await f.engine.create("Prepare a reviewed project brief", {
    title: "Project brief",
    questions: [],
    steps: [step("first"), step("second", ["first"])],
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
it("projects canonical steps and dependencies without altering the plan", () => {
  const before = structuredClone(plan),
    graph = missionGraph(plan);
  expect(plan).toEqual(before);
  expect(
    graph.edges.some(
      (e) => e.source === "first:output" && e.target === "second:tool",
    ),
  ).toBe(true);
  expect(graph.nodes.every((n) => !n.active)).toBe(true);
  expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
});
it("shows only actual executing nodes; verification activates the output", () => {
  plan.status = "active";
  plan.mission!.state = "RUNNING";
  plan.states.first = {
    status: "running",
    phase: "verify",
    attempt: 0,
    result: { receipt: "recorded" },
  };
  const graph = missionGraph(plan);
  expect(graph.nodes.filter((n) => n.active).map((n) => n.id)).toEqual([
    "first:output",
  ]);
  expect(graph.edges.filter((e) => e.active).map((e) => e.target)).toEqual([
    "first:output",
  ]);
});
it("pause/cancel suppress activity even with an unsettled running receipt", () => {
  plan.states.first.status = "running";
  for (const state of ["PAUSED", "CANCELLED", "FAILED", "COMPLETED"] as const) {
    plan.mission!.state = state;
    expect(missionGraph(plan).nodes.some((n) => n.active)).toBe(false);
  }
});
it("shows declared decisions/waits and actual approvals without inventing sub-missions or loops", () => {
  plan.spec.steps[1].when = {
    step: "first",
    path: ["result", "status"],
    equals: "ready",
  };
  plan.spec.steps[1].wait_for = { name: "source_ready", timeout_ms: 1000 };
  plan.states.second.approval_action_id = randomUUID();
  const kinds = missionGraph(plan)
    .nodes.filter((n) => n.step_id === "second")
    .map((n) => n.kind);
  expect(kinds).toEqual(["decision", "wait", "approval", "tool", "output"]);
});
it("preserves node identity/positions through ordinary state updates", () => {
  const before = missionGraph(plan);
  plan.states.first.status = "verified";
  expect(missionGraph(plan).nodes.map((n) => [n.id, n.position])).toEqual(
    before.nodes.map((n) => [n.id, n.position]),
  );
});
it("does not advertise a failed action as a verified output", () => {
  plan.states.first.status = "failed";
  plan.states.first.error = "Provider unavailable";
  expect(missionAttention(plan).failed).toHaveLength(1);
  expect(
    missionGraph(plan).nodes.find((n) => n.id === "first:output")?.status,
  ).toBe("not verified");
});
it("labels only explicit agent steps as agent work", () => {
  expect(missionAttention(plan).agents).toHaveLength(0);
  plan.spec.steps[1].tool = "mission.agent";
  plan.spec.steps[1].input = { role: "analyst", objective: "Review evidence" };
  expect(
    missionGraph(plan).nodes.find((n) => n.kind === "agent")?.subtitle,
  ).toBe("analyst");
});
it("loads an owner mission by stable ID and does not execute its plan", async () => {
  const execute = vi.spyOn(f.tools, "execute");
  const result = await service.inspect(plan.id);
  expect(result.plan.id).toBe(plan.id);
  expect(result.plan.goal).toBe(plan.goal);
  expect(execute).not.toHaveBeenCalled();
  expect(result.costs).toEqual([]);
});
it("rejects another owner's mission before exposing receipts", async () => {
  const other = missionFixture(join(dir, "data.json"), randomUUID());
  await expect(
    new MissionControlService(
      other.repo,
      other.coordinator,
      other.actions,
    ).inspect(plan.id),
  ).rejects.toThrow();
});
it("honors existing activity-read denial", async () => {
  await f.actions.permissions.savePolicy({
    tool: "activity.read",
    level: 0,
    reason: "Fixture denial",
  });
  await expect(service.inspect(plan.id)).rejects.toThrow();
});
async function receipt(key: string) {
  return f.repo.insert("actions", {
    tool_name: "mock.fetch_project_summary",
    action_type: "read",
    conversation_id: plan.conversation_id,
    permission_level: 1,
    status: "succeeded",
    input: {},
    output: { result: { title: "Fixture receipt" } },
    error: null,
    metadata: {
      requesting_agent: "ary_orchestrator",
      request_envelope: { request_key: key },
    },
  });
}
it("includes retries in the exact namespace and excludes unrelated conversation actions", async () => {
  const first = await receipt(`plan:${plan.id}:first:execute:0`),
    retry = await receipt(`plan:${plan.id}:first:execute:1`);
  const unrelated = await receipt(`plan:${plan.id}extra:first:execute:0`);
  expect(actionBelongsToMission(unrelated, plan)).toBe(false);
  const report = await service.inspect(plan.id);
  expect(report.receipts.map((r) => r.action.id)).toEqual([first.id, retry.id]);
});
it("reuses Economics cost revisions without double-counting estimates or inventing unknown costs", async () => {
  const a = await receipt(`plan:${plan.id}:first:execute:0`),
    b = await receipt(`plan:${plan.id}:second:execute:0`);
  await f.repo.insert("model_calls", {
    action_id: a.id,
    operation: "reason",
    model: "fixture",
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 2,
    latency_ms: 20,
    estimated_cost_usd: 0.03,
    pricing_version: "fixture",
    retrieval_count: 0,
    memories_extracted: null,
    status: "succeeded",
    error_code: null,
  });
  const roi = new RoiService(f.repo);
  const cost = await roi.recordCost({
    action_id: a.id,
    parent_id: null,
    actual_model_cost_usd: null,
    estimated_compute_cost_usd: 0.04,
    confidence: 0.8,
    attribution_notes: "Fixture estimate",
    evidence: "",
  });
  await roi.recordCost({
    action_id: a.id,
    parent_id: cost.id,
    actual_model_cost_usd: 0.02,
    estimated_compute_cost_usd: null,
    confidence: 1,
    attribution_notes: "Fixture corrected cost",
    evidence: "fixture:receipt",
  });
  const result = await service.inspect(plan.id);
  expect(result.costs?.find((c) => c.action_id === a.id)?.amount).toBe(0.02);
  expect(result.costs?.find((c) => c.action_id === b.id)?.amount).toBeNull();
  expect(result.receipts[0].calls).toHaveLength(1);
});
it("keeps mission context available when Economics permission is denied", async () => {
  await f.actions.permissions.savePolicy({
    tool: "roi.read",
    level: 0,
    reason: "Fixture cost access denial",
  });
  const result = await service.inspect(plan.id);
  expect(result.plan.id).toBe(plan.id);
  expect(result.costs).toBeNull();
});

it("does not let a user-chosen key alone attribute an unrelated action to a mission", async () => {
  const action = await receipt(`plan:${plan.id}:first:execute:0`);
  action.metadata.requesting_agent = "authenticated_user";
  expect(actionBelongsToMission(action, plan)).toBe(false);
});
