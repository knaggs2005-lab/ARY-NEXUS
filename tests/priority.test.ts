import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { PriorityService } from "../src/services/priority-service";
import {
  rankPriorities,
  deadlineValue,
  priorityPolicy,
} from "../src/domain/priority";
import type { Task, Entity, Goal } from "../src/domain/models";
let directory: string, repo: LocalRepository, service: PriorityService;
const now = new Date("2026-09-07T12:00:00Z");
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-priority-"));
  repo = new LocalRepository(randomUUID(), join(directory, "db.json"));
  service = new PriorityService(repo);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
const task = (patch: Partial<Task> = {}) =>
  repo.insert("tasks", {
    title: "Finish tracking fix",
    description: "",
    status: "pending",
    priority: 1,
    due_at: null,
    entity_id: null,
    goal_id: null,
    metadata: {},
    ...patch,
  });
const project = (patch: Partial<Entity> = {}) =>
  repo.insert("entities", {
    name: "Wag Trails",
    description: "",
    entity_type: "project",
    metadata: {},
    ...patch,
  });
const goal = (patch: Partial<Goal> = {}) =>
  repo.insert("goals", {
    title: "Reliable tracking",
    description: "",
    status: "active",
    progress: 0,
    target_date: null,
    entity_id: null,
    metadata: {},
    ...patch,
  });
const signal = (
  value: number,
  evidence = "Reviewed estimate from project owner",
) => ({ value, evidence });
it("returns empty work without inventing priorities or revenue", async () => {
  const report = await service.report(now);
  expect(report.items).toEqual([]);
  expect(rankPriorities(report)).toEqual([]);
});
it("ranks deadlines and explicit urgency with stable IDs and inspectable points", async () => {
  const later = await task({ priority: 0, due_at: "2026-10-20T00:00:00Z" });
  const urgent = await task({ priority: 3, due_at: "2026-09-08T00:00:00Z" });
  const rows = rankPriorities(await service.report(now));
  expect(rows[0].record_id).toBe(urgent.id);
  expect(rows[0].score).toBe(34);
  expect(rows[1].record_id).toBe(later.id);
  expect(
    rows[0].factors.find((f) => f.factor === "urgency")?.evidence[0].id,
  ).toBe(urgent.id);
  expect(rows[0].factors.every((f) => f.would_change.length > 10)).toBe(true);
});
it("ties use canonical identity, not the record title or insertion order", async () => {
  await task({ title: "A" });
  await task({ title: "Z" });
  const report = await service.report(now);
  const a = rankPriorities(report).map((r) => r.id);
  const b = rankPriorities({
    ...report,
    items: [...report.items].reverse(),
  }).map((r) => r.id);
  expect(a).toEqual(b);
  expect(a).toEqual([...a].sort());
});
it.each([
  [-1, 1],
  [0.5, 0.95],
  [5, 0.8],
  [20, 0.4],
  [40, 0.1],
])("uses explicit deadline bands at %s days", (days, score) => {
  expect(
    deadlineValue(
      new Date(now.getTime() + days * 86400000).toISOString(),
      now.toISOString(),
    ),
  ).toBe(score);
});
it("ignores malformed dates and reports them", async () => {
  await task({ due_at: "garbage" });
  const report = await service.report(now);
  expect(report.items[0].due_at).toBeNull();
  expect(report.items[0].warnings.join()).toContain("Invalid deadline");
});
it("excludes completed/cancelled tasks, paused goals and archived projects", async () => {
  await task({ status: "completed" });
  await task({ status: "cancelled" });
  await goal({ status: "paused" });
  await project({ metadata: { status: "archived" } });
  const report = await service.report(now);
  expect(report.items).toHaveLength(0);
  expect(report.excluded).toHaveLength(4);
});
it("does not infer task goal alignment from shared project membership", async () => {
  const p = await project();
  const g = await goal({ entity_id: p.id });
  const t = await task({ entity_id: p.id });
  let report = await service.report(now);
  expect(
    report.items
      .find((r) => r.record_id === t.id)
      ?.signals.find((s) => s.factor === "goals")?.value,
  ).toBeNull();
  await repo.update("tasks", t.id, { goal_id: g.id });
  report = await service.report(now);
  expect(
    report.items
      .find((r) => r.record_id === t.id)
      ?.signals.find((s) => s.factor === "goals")?.value,
  ).toBe(1);
});
it("follows directed task prerequisites for two hops and ignores completed prerequisites", async () => {
  const a = await task({ title: "A" }),
    b = await task({
      title: "B",
      metadata: { depends_on_task_ids: [a.id, a.id] },
    }),
    c = await task({ title: "C", metadata: { depends_on_task_ids: [b.id] } });
  const report = await service.report(now);
  const row = report.items.find((r) => r.record_id === a.id)!;
  expect(row.paths.filter((p) => p.direction === "unblocks")).toHaveLength(2);
  expect(
    report.items
      .find((r) => r.record_id === c.id)
      ?.paths.some((p) => p.nodes.length === 3),
  ).toBe(true);
  await repo.update("tasks", a.id, { status: "completed" });
  expect(
    (await service.report(now)).items
      .find((r) => r.record_id === b.id)
      ?.paths.filter((p) => p.direction === "requires"),
  ).toHaveLength(0);
});
it("cancelled prerequisites remain constraints rather than being treated as completed", async () => {
  const a = await task({ status: "cancelled" });
  const b = await task({ metadata: { depends_on_task_ids: [a.id] } });
  const report = await service.report(now);
  expect(report.items.find((r) => r.record_id === b.id)?.readiness).toBe(
    "Resolve prerequisites",
  );
  expect(report.warnings.join()).toContain("cancellation is not completion");
});
it("bounds cycles and counts each reachable dependent once", async () => {
  const a = await task(),
    b = await task({ metadata: { depends_on_task_ids: [a.id] } });
  await repo.update("tasks", a.id, {
    metadata: { depends_on_task_ids: [b.id] },
  });
  const report = await service.report(now);
  expect(report.items[0].readiness).toBe("Resolve dependency cycle");
  expect(report.items[0].paths.length).toBe(2);
});
it("uses current relationship direction, excludes expired and future edges", async () => {
  const a = await project({ name: "Dependency" }),
    b = await project({ name: "Consumer" });
  const link = (
    from: string,
    to: string,
    kind: string,
    valid_from: string | null = null,
    valid_to: string | null = null,
  ) =>
    repo.insert("relationships", {
      source_entity_id: from,
      target_entity_id: to,
      relationship_type: kind,
      strength: 1,
      metadata: {},
      valid_from,
      valid_to,
      memory_id: null,
    });
  await link(b.id, a.id, "depends_on");
  await link(a.id, b.id, "blocks", null, "2026-09-01T00:00:00Z");
  await link(a.id, b.id, "blocks", "2027-01-01T00:00:00Z");
  const report = await service.report(now);
  expect(
    report.items
      .find((r) => r.record_id === b.id)
      ?.paths.filter((p) => p.direction === "requires"),
  ).toHaveLength(1);
  expect(
    report.items.find((r) => r.record_id === a.id)?.paths[0].direction,
  ).toBe("unblocks");
});
it("never copies project blockers onto individual task dependency scores", async () => {
  const a = await project(),
    b = await project();
  await repo.insert("relationships", {
    source_entity_id: a.id,
    target_entity_id: b.id,
    relationship_type: "blocks",
    strength: 1,
    metadata: {},
    valid_from: null,
    valid_to: null,
    memory_id: null,
  });
  const t = await task({ entity_id: b.id });
  const row = (await service.report(now)).items.find(
    (r) => r.record_id === t.id,
  )!;
  expect(row.paths).toEqual([]);
  expect(row.warnings.join()).toContain("not proof this task depends");
});
it("requires evidence and confidence for future revenue and never guesses effort/strategy", async () => {
  const t = await task({
    metadata: {
      priority_intelligence: {
        expected_revenue_usd: signal(100000),
        effort_hours: { value: 2 },
      },
    },
  });
  let row = (await service.report(now)).items[0];
  expect(row.signals.find((f) => f.factor === "revenue")?.value).toBeNull();
  expect(row.signals.find((f) => f.factor === "effort")?.value).toBeNull();
  expect(row.signals.find((f) => f.factor === "strategy")?.value).toBeNull();
  await repo.update("tasks", t.id, {
    metadata: {
      priority_intelligence: {
        expected_revenue_usd: signal(100000),
        confidence: signal(0.5),
        effort_hours: signal(8),
        strategic_importance: signal(0.9),
      },
    },
  });
  row = (await service.report(now)).items[0];
  expect(row.signals.find((f) => f.factor === "revenue")?.value).toBe(0.5);
  expect(row.signals.find((f) => f.factor === "effort")?.value).toBe(0.5);
  expect(row.signals.find((f) => f.factor === "strategy")?.value).toBe(0.9);
});
it("historical ROI remains evidence context, not expected future impact", async () => {
  const g = await goal();
  await task({ goal_id: g.id });
  const action = await repo.insert("actions", {
    conversation_id: null,
    tool_name: "mock.create_task",
    action_type: "test",
    permission_level: 5,
    status: "succeeded",
    input: {},
    output: {},
    error: null,
    metadata: {},
  });
  const o = await repo.insert("outcomes", {
    action_id: action.id,
    goal_id: g.id,
    status: "success",
    summary: "Previous outcome",
    metrics: {},
    metadata: {},
  });
  await repo.insert("roi_outcome_entries", {
    outcome_id: o.id,
    parent_id: null,
    effective_at: "2026-09-01T00:00:00Z",
    time_saved_minutes: null,
    revenue_influenced_usd: 10000,
    expense_avoided_usd: null,
    status: "confirmed",
    confidence: 1,
    evidence: "Invoice",
    attribution_notes: "Recorded attribution",
  });
  const row = (await service.report(now)).items.find((r) => r.kind === "task")!;
  expect(row.historical_revenue[0].amount).toBe(10000);
  expect(row.signals.find((f) => f.factor === "revenue")?.value).toBeNull();
});
it("scenario reordering changes no stored records and time preview only changes deadline bands", async () => {
  const a = await task({ priority: 3 }),
    b = await task({ priority: 0, due_at: "2026-10-01T00:00:00Z" });
  const before = await repo.list("tasks");
  const report = await service.report(now);
  expect(rankPriorities(report)[0].record_id).toBe(a.id);
  const rows = rankPriorities(
    report,
    priorityPolicy.weights,
    "2026-10-01T01:00:00Z",
  );
  expect(rows[0].record_id).toBe(b.id);
  expect(await repo.list("tasks")).toEqual(before);
  expect(report.items[1].due_at).toBe("2026-10-01T00:00:00Z");
});
it("is user scoped and fails closed on an unavailable evidence read", async () => {
  await task();
  const other = new LocalRepository(randomUUID(), join(directory, "db.json"));
  await other.insert("tasks", {
    title: "Private",
    description: "",
    status: "pending",
    priority: 3,
    due_at: null,
    goal_id: null,
    entity_id: null,
    metadata: {},
  });
  expect((await service.report(now)).items).toHaveLength(1);
  vi.spyOn(repo, "list").mockRejectedValue(new Error("database unavailable"));
  await expect(service.report(now)).rejects.toThrow("database unavailable");
});
it("rejects invalid weighting instead of returning NaN or a misleading score", async () => {
  const report = await service.report(now);
  expect(() =>
    rankPriorities(report, { ...priorityPolicy.weights, deadline: -1 }),
  ).toThrow();
  expect(() =>
    rankPriorities(report, priorityPolicy.weights, "invalid"),
  ).toThrow();
});
it("paused project prerequisites remain constraints on active consumers", async () => {
  const a = await project({ metadata: { status: "paused" } }),
    b = await project({ metadata: { status: "active" } });
  await repo.insert("relationships", {
    source_entity_id: a.id,
    target_entity_id: b.id,
    relationship_type: "blocks",
    strength: 1,
    metadata: {},
    valid_from: null,
    valid_to: null,
    memory_id: null,
  });
  const report = await service.report(now);
  expect(report.items).toHaveLength(1);
  expect(report.items[0].readiness).toBe("Resolve prerequisites");
});
it("missing dependency evidence is not mistaken for readiness", async () => {
  await task({ metadata: { depends_on_task_ids: [randomUUID()] } });
  expect((await service.report(now)).items[0].readiness).toBe(
    "Dependency evidence incomplete",
  );
});
