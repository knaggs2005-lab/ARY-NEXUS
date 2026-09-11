import { beforeEach, afterEach, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { RoiService } from "../src/services/roi-service";
import { actionTelemetryContext } from "../src/services/action-telemetry-context";
import {
  calculateRoi,
  costEntrySchema,
  outcomeEntrySchema,
} from "../src/domain/roi";
import type { Action, ModelCall, Outcome } from "../src/domain/models";
let directory: string, repo: LocalRepository, service: RoiService;
const month = new Date().toISOString().slice(0, 7);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-roi-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  service = new RoiService(repo);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function action() {
  await new ActionService(repo).run("memory.read", null, async () => undefined);
  const actions = await repo.list("actions");
  const latest = actions.at(-1)!;
  return {
    action: latest,
    outcome: (await repo.list("outcomes", { action_id: latest.id }))[0],
  };
}
const cost = (id: string) => ({
  action_id: id,
  parent_id: null,
  estimated_compute_cost_usd: 2,
  actual_model_cost_usd: null,
  confidence: 0.6,
  attribution_notes: "Synthetic test: estimated action model compute",
  evidence: "",
});
const impact = (id: string) => ({
  outcome_id: id,
  parent_id: null,
  effective_at: new Date().toISOString(),
  time_saved_minutes: 30,
  revenue_influenced_usd: 100,
  expense_avoided_usd: 20,
  confidence: 1,
  status: "confirmed" as const,
  attribution_notes:
    "Synthetic test only: attributable benefit without overlapping amounts",
  evidence: "fixture:measured-outcome",
});
async function call(actionId: string | null, amount: number | null) {
  return repo.insert("model_calls", {
    action_id: actionId,
    operation: "reason",
    model: "fixture",
    input_tokens: 20,
    cached_input_tokens: 0,
    output_tokens: 10,
    latency_ms: 1,
    estimated_cost_usd: amount,
    pricing_version: "fixture",
    retrieval_count: 0,
    memories_extracted: 0,
    status: "succeeded",
    error_code: null,
  });
}
it("empty and successful technical outcomes never fabricate financial impact", async () => {
  expect((await service.report(month)).operatingCost).toBeNull();
  await action();
  const report = await service.report(month);
  expect(report.revenue).toBeNull();
  expect(report.expenses).toBeNull();
  expect(report.minutes).toBeNull();
  expect(report.netContribution).toBeNull();
  expect(report.roiMultiple).toBeNull();
  expect(report.unassessedOutcomes).toBe(1);
});
it("actual cost replaces both action estimate and linked telemetry; legacy calls count once", async () => {
  const { action: a, outcome } = await action();
  await call(a.id, 5);
  await call(a.id, 2);
  await call(null, 3);
  await service.recordCost({
    ...cost(a.id),
    actual_model_cost_usd: 4,
    evidence: "fixture:bill",
  });
  await service.recordOutcome(impact(outcome.id));
  const report = await service.report(month);
  expect(report.operatingCost).toBe(7);
  expect(report.reportedActualCost).toBe(4);
  expect(report.estimatedCost).toBe(3);
  expect(report.netContribution).toBe(113);
  expect(report.roiMultiple).toBeCloseTo(120 / 7);
  expect(report.minutes).toBe(30);
});
it("uses explicit estimates ahead of telemetry without labeling them actual", async () => {
  const { action: a } = await action();
  await call(a.id, 5);
  await service.recordCost(cost(a.id));
  const report = await service.report(month);
  expect(report.operatingCost).toBe(2);
  expect(report.reportedActualCost).toBeNull();
});
it("uncertain, pending and rejected benefits are excluded from confirmed totals", async () => {
  for (const status of ["estimated", "pending", "rejected"] as const) {
    const { outcome } = await action();
    await service.recordOutcome({
      ...impact(outcome.id),
      status,
      confidence: 0.5,
    });
  }
  const report = await service.report(month);
  expect(report.revenue).toBeNull();
  expect(report.uncertain.revenue).toBe(100);
  expect(report.roiMultiple).toBeNull();
});
it("retains revisions but only the current assessment contributes, including rejections", async () => {
  const { outcome } = await action();
  const first = await service.recordOutcome(impact(outcome.id));
  const next = await service.recordOutcome({
    ...impact(outcome.id),
    parent_id: first.id,
    revenue_influenced_usd: 50,
  });
  expect((await service.report(month)).revenue).toBe(50);
  await service.recordOutcome({
    ...impact(outcome.id),
    parent_id: next.id,
    status: "rejected",
  });
  const report = await service.report(month);
  expect(report.revenue).toBeNull();
  expect(report.outcomeHistory).toHaveLength(3);
  await expect(
    repo.update("roi_outcome_entries", first.id, {
      revenue_influenced_usd: 999,
    }),
  ).rejects.toThrow("immutable");
});
it("rejects stale and concurrent revisions and a revision for another target", async () => {
  const { action: a } = await action();
  const { action: b } = await action();
  const first = await service.recordCost(cost(a.id));
  await expect(
    service.recordCost({ ...cost(b.id), parent_id: first.id }),
  ).rejects.toThrow("same action");
  const results = await Promise.allSettled([
    service.recordCost({ ...cost(a.id), parent_id: first.id }),
    service.recordCost({ ...cost(a.id), parent_id: first.id }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await service.report(month)).operatingCost).toBe(2);
});
it("rejects foreign or nonexistent action and outcome references", async () => {
  await expect(service.recordCost(cost(randomUUID()))).rejects.toThrow();
  await expect(service.recordOutcome(impact(randomUUID()))).rejects.toThrow();
  const { action: a, outcome } = await action();
  const foreign = new RoiService(
    new LocalRepository(randomUUID(), join(directory, "data.json")),
  );
  await expect(foreign.recordCost(cost(a.id))).rejects.toThrow();
  await expect(foreign.recordOutcome(impact(outcome.id))).rejects.toThrow();
});
it("requires finite nonnegative amounts, confidence range, notes and evidence", () => {
  for (const value of [-1, NaN, Infinity])
    expect(
      costEntrySchema.safeParse({
        ...cost(randomUUID()),
        actual_model_cost_usd: value,
      }).success,
    ).toBe(false);
  expect(
    costEntrySchema.safeParse({
      ...cost(randomUUID()),
      actual_model_cost_usd: 0,
    }).success,
  ).toBe(false);
  expect(
    outcomeEntrySchema.safeParse({ ...impact(randomUUID()), confidence: 0.8 })
      .success,
  ).toBe(false);
  expect(
    outcomeEntrySchema.safeParse({
      ...impact(randomUUID()),
      attribution_notes: " ",
    }).success,
  ).toBe(false);
});
it("pending outcomes cannot have confirmed impact, including after outcome status changes", async () => {
  const { outcome } = await action();
  await service.recordOutcome(impact(outcome.id));
  await repo.update("outcomes", outcome.id, { status: "pending" });
  expect((await service.report(month)).revenue).toBeNull();
  await expect(service.recordOutcome(impact(outcome.id))).rejects.toThrow(
    "Pending",
  );
});
it("explicit zero benefits stay zero while zero or unknown cost gives no ROI multiple", async () => {
  const { action: a, outcome } = await action();
  await service.recordOutcome({
    ...impact(outcome.id),
    revenue_influenced_usd: 0,
    expense_avoided_usd: 0,
    time_saved_minutes: null,
  });
  expect((await service.report(month)).roiMultiple).toBeNull();
  await service.recordCost({ ...cost(a.id), estimated_compute_cost_usd: 0 });
  const report = await service.report(month);
  expect(report.netContribution).toBe(0);
  expect(report.revenue).toBe(0);
  expect(report.minutes).toBeNull();
  expect(report.roiMultiple).toBeNull();
});
it("keeps partial cost coverage explicit and never prices unknown calls at zero", async () => {
  const { action: a } = await action();
  await call(a.id, 0.01);
  await call(a.id, null);
  const report = await service.report(month);
  expect(report.operatingCost).toBe(0.01);
  expect(report.unknownCalls).toBe(1);
  expect(report.netContribution).toBeNull();
});
it("uses UTC months and places all linked calls in the action start month", () => {
  const a = {
    id: "a",
    created_at: "2026-09-30T23:59:00Z",
    tool_name: "reason",
  } as Action;
  const o = {
    id: "o",
    action_id: "a",
    created_at: a.created_at,
    status: "success",
  } as Outcome;
  const c = {
    id: "c",
    action_id: "a",
    created_at: "2026-10-01T00:01:00Z",
    estimated_cost_usd: 3,
  } as ModelCall;
  expect(calculateRoi("2026-09", [a], [o], [c], [], []).operatingCost).toBe(3);
  expect(
    calculateRoi("2026-10", [a], [o], [c], [], []).operatingCost,
  ).toBeNull();
  expect(() => calculateRoi("2026-13", [], [], [], [], [])).toThrow();
});
it("isolates telemetry attribution across concurrent and nested actions", async () => {
  const service = new ActionService(repo);
  const seen: string[] = [];
  await Promise.all(
    [1, 2].map(async () =>
      service.run("memory.read", null, async () => {
        const parent = actionTelemetryContext.getStore()!;
        await new Promise((resolve) => setTimeout(resolve, 2));
        expect(actionTelemetryContext.getStore()).toBe(parent);
        seen.push(parent);
        await service.run("entity.read", null, async () => {
          expect(actionTelemetryContext.getStore()).not.toBe(parent);
        });
        expect(actionTelemetryContext.getStore()).toBe(parent);
      }),
    ),
  );
  expect(new Set(seen).size).toBe(2);
  expect(actionTelemetryContext.getStore()).toBeUndefined();
});

it("withholds ambiguous legacy cost overrides instead of counting overlapping spend", async () => {
  const { action: a, outcome } = await action();
  const legacy = { ...a, metadata: {} };
  const c = await call(null, 2);
  const entry = await service.recordCost({
    ...cost(a.id),
    actual_model_cost_usd: 3,
    evidence: "fixture:bill",
  });
  const i = await service.recordOutcome(impact(outcome.id));
  const report = calculateRoi(month, [legacy], [outcome], [c], [entry], [i]);
  expect(report.operatingCost).toBe(2);
  expect(report.unresolvedOverlapRows).toBe(1);
  expect(report.netContribution).toBeNull();
  expect(report.roiMultiple).toBeNull();
});
it("counts one action cost across multiple outcomes and permits negative contribution", async () => {
  const { action: a, outcome } = await action();
  const second = await repo.insert("outcomes", {
    action_id: a.id,
    goal_id: null,
    status: "success",
    summary: "Separate synthetic benefit",
    metrics: {},
    metadata: {},
  });
  await service.recordCost({ ...cost(a.id), estimated_compute_cost_usd: 300 });
  await service.recordOutcome(impact(outcome.id));
  await service.recordOutcome(impact(second.id));
  const report = await service.report(month);
  expect(report.operatingCost).toBe(300);
  expect(report.netContribution).toBe(-60);
  expect(report.roiMultiple).toBe(0.8);
});
it("moves revised impact between months without leaving a duplicate in the old month", async () => {
  const { outcome } = await action();
  const first = await service.recordOutcome({
    ...impact(outcome.id),
    effective_at: "2026-08-31T23:30:00Z",
  });
  await service.recordOutcome({
    ...impact(outcome.id),
    parent_id: first.id,
    effective_at: "2026-09-01T00:30:00Z",
  });
  expect((await service.report("2026-08")).revenue).toBeNull();
  expect((await service.report("2026-09")).revenue).toBe(100);
});
it("adds non-model compute and tool costs once without replacing linked model telemetry", async () => {
  const { action: a, outcome } = await action();
  await call(a.id, 5);
  await service.recordCost({
    ...cost(a.id),
    estimated_compute_cost_usd: null,
    additional_compute_cost_usd: 2,
    tool_cost_usd: 3,
  });
  await service.recordOutcome(impact(outcome.id));
  const r = await service.report(month);
  expect(r.modelCost).toBe(5);
  expect(r.computeCost).toBe(2);
  expect(r.toolCost).toBe(3);
  expect(r.operatingCost).toBe(10);
  expect(r.netContribution).toBe(110);
  expect(r.estimatedCost).toBe(5);
  expect(r.roiMultiple).toBe(12);
});
it("actual model cost replaces only model estimate, retaining additional costs", async () => {
  const { action: a } = await action();
  await call(a.id, 9);
  await service.recordCost({
    ...cost(a.id),
    actual_model_cost_usd: 4,
    additional_compute_cost_usd: 2,
    tool_cost_usd: 3,
    evidence: "fixture:bill",
  });
  const r = await service.report(month);
  expect(r.operatingCost).toBe(9);
  expect(r.reportedActualCost).toBe(4);
});
it("known tool costs do not turn an unknown model cost into zero", async () => {
  const { action: a, outcome } = await action();
  await service.recordCost({
    ...cost(a.id),
    estimated_compute_cost_usd: null,
    tool_cost_usd: 3,
  });
  await service.recordOutcome(impact(outcome.id));
  const r = await service.report(month);
  expect(r.operatingCost).toBe(3);
  expect(r.modelCost).toBeNull();
  expect(r.netContribution).toBeNull();
  expect(r.roiMultiple).toBeNull();
  expect(r.calculationStatus).toBe("incomplete_costs");
});
it("withholds ROI when even one linked model call has unknown pricing", async () => {
  const { action: a, outcome } = await action();
  await call(a.id, 1);
  await call(a.id, null);
  await service.recordOutcome(impact(outcome.id));
  const r = await service.report(month);
  expect(r.operatingCost).toBe(1);
  expect(r.roiMultiple).toBeNull();
  expect(r.netContribution).toBeNull();
});
it("reports assessment quality without turning uncertain value into confirmed revenue", async () => {
  const { outcome } = await action();
  await service.recordOutcome({
    ...impact(outcome.id),
    confidence: 0.4,
    status: "estimated",
  });
  const r = await service.report(month);
  expect(r.attributionQuality).toMatchObject({
    confirmed: 0,
    uncertain: 1,
    meanConfidence: 0.4,
  });
  expect(r.revenue).toBeNull();
  expect(r.impactRows[0].outcome_status).toBe("success");
});
it("six-month trends share the existing UTC and revision rules", async () => {
  const { outcome } = await action();
  const first = await service.recordOutcome({
    ...impact(outcome.id),
    effective_at: "2026-08-01T00:00:00Z",
  });
  await service.recordOutcome({
    ...impact(outcome.id),
    parent_id: first.id,
    effective_at: "2026-09-01T00:00:00Z",
  });
  const r = await service.report("2026-09");
  expect(r.trends.map((v) => v.month)).toEqual([
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ]);
  expect(r.trends[4].revenue).toBeNull();
  expect(r.trends[5].revenue).toBe(100);
});
it("counts attempted actions and explicitly separates replays", async () => {
  const { action: a } = await action();
  await repo.insert("actions", {
    ...a,
    id: undefined,
    status: "succeeded",
    metadata: { replay_of: a.id },
  } as unknown as import("../src/domain/models").NewRecord<Action>);
  const r = await service.report(month);
  expect(r.actionCount).toBe(2);
  expect(r.executedActionCount).toBe(1);
  expect(r.replayCount).toBe(1);
});
it.each([-1, Infinity, NaN])("rejects invalid tool cost %s", (value) => {
  expect(
    costEntrySchema.safeParse({ ...cost(randomUUID()), tool_cost_usd: value })
      .success,
  ).toBe(false);
});

it("keeps trend months inside the supported four-digit year range", async () => {
  const report = await service.report("0000-01");
  expect(report.trends.map((row) => row.month)).toEqual(["0000-01"]);
});
