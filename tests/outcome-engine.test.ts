import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { OutcomeEngine } from "../src/services/outcome-engine";
import { registerOutcomeTools } from "../src/infrastructure/tools/outcome-tools";
import { ApprovalRequiredError } from "../src/services/action-service";
import { RoiService } from "../src/services/roi-service";
import type {
  AssessmentInput,
  Recommendation,
} from "../src/domain/outcome-engine";
let dir: string, f: ReturnType<typeof missionFixture>, engine: OutcomeEngine;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-outcome-"));
  f = missionFixture(join(dir, "data.json"), randomUUID());
  engine = new OutcomeEngine(f.repo);
  registerOutcomeTools(f.tools, engine, f.actions);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const request = (
  tool: string,
  input: Record<string, unknown>,
  key = randomUUID(),
) =>
  f.coordinator.requests.request({
    tool,
    input,
    request_key: key,
    reason: "Isolated outcome evidence review",
  });
async function approved(
  tool: string,
  input: Record<string, unknown>,
  key = randomUUID(),
) {
  const e = await request(tool, input, key).catch((e) => e);
  expect(e).toBeInstanceOf(ApprovalRequiredError);
  await f.actions.permissions.review(
    e.actionId,
    "approved",
    "Reviewed exact evidence and change",
  );
  return request(tool, input, key);
}
async function seed(
  status: "success" | "failure" = "failure",
  tool = "mock.execute",
  conversation: string | null = null,
) {
  const a = await f.repo.insert("actions", {
    conversation_id: conversation,
    tool_name: tool,
    action_type: "fixture",
    permission_level: 4,
    status: status === "success" ? "succeeded" : "failed",
    input: { fixture: true },
    output: { recorded: "actual fixture result" },
    error: status === "failure" ? "Fixture failure" : null,
    metadata: { execution_key: randomUUID(), requesting_agent: "ary" },
  });
  return f.repo.insert("outcomes", {
    action_id: a.id,
    goal_id: null,
    status,
    summary: "Recorded fixture result",
    metrics: {},
    metadata: { original: true },
  });
}
function assessment(id: string, revision = 0): AssessmentInput {
  return {
    outcome_id: id,
    revision,
    result: "User observed a partial result",
    achievement: "partial",
    confidence: 0.7,
    metrics: [{ name: "clips verified", value: 3, unit: "clips" }],
    correction: "Confirm the intended output before proceeding",
    lessons: ["Inspect the source before execution"],
    links: [],
    evidence: [{ table: "outcomes", id }],
  };
}
async function proposal() {
  const os = await Promise.all([seed(), seed(), seed()]);
  const result = await request("outcome.propose", {
    outcome_ids: os.map((o) => o.id),
  });
  return {
    os,
    ...(result.result as {
      outcome_id: string;
      recommendation_id: string;
      proposal: Recommendation;
    }),
  };
}
it("projects actual execution receipts without inventing goal success or cost", async () => {
  const o = await seed("success");
  const r = (await engine.report()).rows[0];
  expect(r.outcome.id).toBe(o.id);
  expect(r.assessment).toBeNull();
  expect(r.cost).toBeNull();
  expect(r.plan).toBeNull();
  expect(r.result).toEqual({ recorded: "actual fixture result" });
  expect(r.duration_ms).toBeGreaterThanOrEqual(0);
});
it("assessment requires exact approval and preserves canonical receipt", async () => {
  const o = await seed();
  const e = await request("outcome.assess", assessment(o.id)).catch((e) => e);
  expect(e).toBeInstanceOf(ApprovalRequiredError);
  expect(
    engine.learning((await f.repo.get("outcomes", o.id))!).assessments,
  ).toHaveLength(0);
  await approved("outcome.assess", assessment(o.id));
  const saved = (await f.repo.get("outcomes", o.id))!;
  expect(saved.status).toBe(o.status);
  expect(saved.summary).toBe(o.summary);
  expect(saved.metadata.original).toBe(true);
  const a = engine.learning(saved).assessments[0];
  expect(a.evidence[0].hash).toBeTruthy();
  expect(a.actor).toBe(f.repo.userId);
  expect((await f.repo.get("actions", a.action_id))?.status).toBe("succeeded");
});
it("rejected approval leaves no assessment", async () => {
  const o = await seed(),
    i = assessment(o.id),
    key = randomUUID();
  const e = await request("outcome.assess", i, key).catch((e) => e);
  await f.actions.permissions.review(
    e.actionId,
    "rejected",
    "Evidence insufficient",
  );
  await expect(request("outcome.assess", i, key)).rejects.toThrow();
  expect(engine.learning((await f.repo.get("outcomes", o.id))!).revision).toBe(
    0,
  );
});
it("corrections append versions and stale revisions cannot overwrite", async () => {
  const o = await seed();
  await approved("outcome.assess", assessment(o.id));
  await approved("outcome.assess", {
    ...assessment(o.id, 1),
    result: "Correction: output was complete",
    achievement: "success",
  });
  expect(
    engine
      .learning((await f.repo.get("outcomes", o.id))!)
      .assessments.map((a) => a.achievement),
  ).toEqual(["partial", "success"]);
  await expect(approved("outcome.assess", assessment(o.id))).rejects.toThrow(
    /changed/,
  );
});
it("duplicate execution replays without an extra assessment", async () => {
  const o = await seed(),
    i = assessment(o.id),
    key = randomUUID();
  await approved("outcome.assess", i, key);
  await request("outcome.assess", i, key);
  expect(
    engine.learning((await f.repo.get("outcomes", o.id))!).assessments,
  ).toHaveLength(1);
});
it("commit failure rolls back the assessment and keeps a failed audit", async () => {
  const o = await seed(),
    batch = f.repo.batch.bind(f.repo);
  vi.spyOn(f.repo, "batch").mockImplementation(async (mutations) => {
    if (
      mutations.some(
        (m) => m.kind === "update" && m.table === "outcomes" && m.id === o.id,
      )
    )
      throw new Error("Transient database failure");
    return batch(mutations);
  });
  await expect(approved("outcome.assess", assessment(o.id))).rejects.toThrow(
    "Transient database failure",
  );
  expect(engine.learning((await f.repo.get("outcomes", o.id))!).revision).toBe(
    0,
  );
  expect(
    (await f.repo.list("actions")).some(
      (a) => a.tool_name === "outcome.assess" && a.status === "failed",
    ),
  ).toBe(true);
  vi.restoreAllMocks();
  await approved("outcome.assess", assessment(o.id));
  expect(engine.learning((await f.repo.get("outcomes", o.id))!).revision).toBe(
    1,
  );
});
it("foreign outcomes cannot be inspected or amended", async () => {
  const o = await seed();
  const other = missionFixture(join(dir, "data.json"), randomUUID());
  const service = new OutcomeEngine(other.repo);
  expect((await service.report()).rows).toHaveLength(0);
  await expect(
    service.assess(assessment(o.id), {
      userId: other.repo.userId,
      productIds: [],
      conversationId: null,
    }),
  ).rejects.toThrow("Outcome");
});
it("invalid metrics and fabricated links fail validation", async () => {
  const o = await seed();
  await expect(
    request("outcome.assess", { ...assessment(o.id), confidence: 2 }),
  ).rejects.toThrow();
  await expect(
    approved("outcome.assess", {
      ...assessment(o.id),
      links: [{ kind: "project", id: randomUUID() }],
    }),
  ).rejects.toThrow("Linked record");
});
it("entity links preserve canonical IDs and enforce their types", async () => {
  const o = await seed(),
    e = await f.entities.createEntity({
      name: "Clevaryn",
      entity_type: "company",
    });
  await approved("outcome.assess", {
    ...assessment(o.id),
    links: [{ kind: "company", id: e.id }],
  });
  expect((await engine.report()).rows[0].links[0].label).toBe("Clevaryn");
  await expect(
    approved("outcome.assess", {
      ...assessment(o.id, 1),
      links: [{ kind: "person", id: e.id }],
    }),
  ).rejects.toThrow(/type/);
});
it("fewer than three runs, duplicate IDs and unrelated tools cannot generate learning", async () => {
  const a = await seed(),
    b = await seed(),
    c = await seed("failure", "mock.draft");
  await expect(
    request("outcome.propose", { outcome_ids: [a.id, b.id] }),
  ).rejects.toThrow();
  await expect(
    request("outcome.propose", { outcome_ids: [a.id, b.id, b.id] }),
  ).rejects.toThrow(/Duplicate/);
  await expect(
    request("outcome.propose", { outcome_ids: [a.id, b.id, c.id] }),
  ).rejects.toThrow(/independent/);
});
it("multiple failures from one conversation are not independent runs", async () => {
  const c = await f.repo.insert("conversations", {
    title: "One attempt",
    metadata: {},
  });
  const os = await Promise.all([
    seed("failure", "mock.execute", c.id),
    seed("failure", "mock.execute", c.id),
    seed("failure", "mock.execute", c.id),
  ]);
  await expect(
    request("outcome.propose", { outcome_ids: os.map((o) => o.id) }),
  ).rejects.toThrow(/independent/);
});
it("successful execution without corrections is not a failure pattern", async () => {
  const os = await Promise.all([
    seed("success"),
    seed("success"),
    seed("success"),
  ]);
  await expect(
    request("outcome.propose", { outcome_ids: os.map((o) => o.id) }),
  ).rejects.toThrow(/independent/);
});
it("reordered evidence deduplicates the same recommendation", async () => {
  const p = await proposal();
  await request("outcome.propose", {
    outcome_ids: p.os.map((o) => o.id).reverse(),
  });
  expect((await engine.report()).recommendations).toHaveLength(1);
});
it("acceptance is explicit and withdrawal reverses advice with full history", async () => {
  const before = await f.repo.list("messages"),
    p = await proposal();
  const input = {
    outcome_id: p.outcome_id,
    recommendation_id: p.recommendation_id,
    state: "accepted",
    reason: "Evidence supports a controlled experiment",
  };
  await approved("outcome.review", input);
  expect((await engine.report()).recommendations[0].active).toBe(true);
  await approved("outcome.review", {
    ...input,
    state: "withdrawn",
    reason: "Experiment did not help",
  });
  const r = (await engine.report()).recommendations[0];
  expect(r.active).toBe(false);
  expect(r.history.map((h) => h.state)).toEqual([
    "proposed",
    "accepted",
    "withdrawn",
  ]);
  expect(await f.repo.list("messages")).toEqual(before);
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("rejected recommendation cannot become accepted without a fresh proposal", async () => {
  const p = await proposal(),
    i = {
      outcome_id: p.outcome_id,
      recommendation_id: p.recommendation_id,
      state: "rejected",
      reason: "Insufficient causal evidence",
    };
  await approved("outcome.review", i);
  await expect(
    approved("outcome.review", { ...i, state: "accepted" }),
  ).rejects.toThrow(/transition/);
});
it("changed evidence blocks acceptance and deactivates accepted advice", async () => {
  const p = await proposal(),
    i = {
      outcome_id: p.outcome_id,
      recommendation_id: p.recommendation_id,
      state: "accepted",
      reason: "Trial this suggestion",
    };
  await approved("outcome.review", i);
  const changed = p.os.find((o) => o.id !== p.outcome_id)!;
  await approved("outcome.assess", assessment(changed.id));
  expect((await engine.report()).recommendations[0].active).toBe(false);
  await approved("outcome.review", {
    ...i,
    state: "withdrawn",
    reason: "Evidence changed",
  });
});
it("stale proposal is refused after correction before acceptance", async () => {
  const p = await proposal(),
    target = p.os.find((o) => o.id !== p.outcome_id)!;
  await approved("outcome.assess", assessment(target.id));
  await expect(
    approved("outcome.review", {
      outcome_id: p.outcome_id,
      recommendation_id: p.recommendation_id,
      state: "accepted",
      reason: "Review the proposed change",
    }),
  ).rejects.toThrow(/Evidence changed/);
});
it("Economics revision precedence is reused and unavailable costs remain unknown", async () => {
  const o = await seed();
  const roi = new RoiService(f.repo);
  await roi.recordCost({
    action_id: o.action_id,
    parent_id: null,
    estimated_compute_cost_usd: 2,
    actual_model_cost_usd: 1,
    confidence: 1,
    attribution_notes: "Synthetic billed cost",
    evidence: "fixture invoice",
  });
  expect((await engine.report(true)).rows[0].cost?.amount).toBe(1);
  expect((await engine.report()).rows[0].cost).toBeNull();
});
it("learning actions and idempotent replay outcomes do not train themselves", async () => {
  await proposal();
  const rows = (await engine.report()).rows;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.tool === "mock.execute")).toBe(true);
});
it("permissions still deny the outcome tool", async () => {
  const o = await seed();
  await f.actions.permissions.savePolicy({
    tool: "outcome.assess",
    action_type: null,
    workspace: null,
    product_entity_id: null,
    subject_user_id: null,
    level: 0,
    enabled: true,
    reason: "No learning write access",
    parent_id: null,
  });
  await expect(request("outcome.assess", assessment(o.id))).rejects.toThrow();
  expect(engine.learning((await f.repo.get("outcomes", o.id))!).revision).toBe(
    0,
  );
});
it("read capability restrictions cannot be bypassed using outcome inspect", async () => {
  const o = await seed();
  await f.actions.permissions.savePolicy({
    tool: "conversation.read",
    action_type: null,
    workspace: null,
    product_entity_id: null,
    subject_user_id: null,
    level: 0,
    enabled: true,
    reason: "No source access",
    parent_id: null,
  });
  await expect(
    request("outcome.inspect", { outcome_ids: [o.id] }),
  ).rejects.toThrow();
});
it("source task changes invalidate advice while retaining historical evidence", async () => {
  const t = await f.repo.insert("tasks", {
    entity_id: null,
    goal_id: null,
    title: "Evidence task",
    description: "Observed failure",
    status: "pending",
    priority: 1,
    due_at: null,
    metadata: {},
  });
  const os = await Promise.all([seed(), seed(), seed()]);
  await approved("outcome.assess", {
    ...assessment(os[0].id),
    evidence: [{ table: "tasks", id: t.id }],
  });
  const p = (
    await request("outcome.propose", { outcome_ids: os.map((o) => o.id) })
  ).result as { outcome_id: string; recommendation_id: string };
  await approved("outcome.review", {
    outcome_id: p.outcome_id,
    recommendation_id: p.recommendation_id,
    state: "accepted",
    reason: "Controlled experiment",
  });
  await f.repo.update("tasks", t.id, { status: "completed" });
  expect((await engine.report()).recommendations[0].active).toBe(false);
  const history = engine.learning((await f.repo.get("outcomes", os[0].id))!)
    .assessments[0];
  expect(history.evidence[0].snapshot.status).toBe("pending");
});
it("receipt drift invalidates a pending recommendation", async () => {
  const p = await proposal();
  await expect(
    f.repo.update("actions", p.os[0].action_id, {
      output: { corrected: true },
    }),
  ).rejects.toThrow("immutable");
  await f.repo.update("outcomes", p.os[0].id, {
    summary: "Corrected outcome receipt",
  });
  await expect(
    approved("outcome.review", {
      outcome_id: p.outcome_id,
      recommendation_id: p.recommendation_id,
      state: "accepted",
      reason: "Review evidence",
    }),
  ).rejects.toThrow(/Evidence changed/);
});
it("Skill versions, agents and strategies reference the existing records", async () => {
  const o = await seed(),
    conversation = await f.repo.insert("conversations", {
      title: "Artifacts",
      metadata: {},
    });
  const skill = await f.repo.insert("messages", {
    conversation_id: conversation.id,
    role: "system",
    content: "Existing skill",
    metadata: { nexus_skill_v1: { versions: [{ version: 1 }] } },
  });
  const agent = await f.repo.insert("messages", {
    conversation_id: conversation.id,
    role: "system",
    content: "Existing agent",
    metadata: { agent_version: "agent-v1", agent: {} },
  });
  const strategy = await f.entities.createEntity({
    name: "Source-first strategy",
    entity_type: "project",
    metadata: { entity_facet: "strategy" },
  });
  await approved("outcome.assess", {
    ...assessment(o.id),
    links: [
      { kind: "skill", id: skill.id, version: 1 },
      { kind: "agent", id: agent.id },
      { kind: "strategy", id: strategy.id },
    ],
  });
  expect((await engine.report()).rows[0].links.map((l) => l.kind)).toEqual([
    "skill",
    "agent",
    "strategy",
  ]);
  await expect(
    approved("outcome.assess", {
      ...assessment(o.id, 1),
      links: [{ kind: "skill", id: skill.id, version: 2 }],
    }),
  ).rejects.toThrow(/Skill version/);
});
it("concurrent reviews use a compare-and-swap guard", async () => {
  const o = await seed();
  const staged: import("../src/domain/repository").Mutation[][] = [];
  const context = {
    userId: f.repo.userId,
    productIds: [],
    conversationId: null,
    actionId: o.action_id,
    stage: (m: import("../src/domain/repository").Mutation[]) => staged.push(m),
  };
  await engine.assess(assessment(o.id), context);
  await engine.assess(
    { ...assessment(o.id), result: "Concurrent correction" },
    context,
  );
  await f.repo.batch(staged[0]);
  await expect(f.repo.batch(staged[1])).rejects.toThrow();
  expect(
    engine.learning((await f.repo.get("outcomes", o.id))!).assessments,
  ).toHaveLength(1);
});
