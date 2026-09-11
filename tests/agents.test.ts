import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { agentInput, type Agent } from "../src/domain/agent";
import { planSpec, type ExecutionPlan } from "../src/domain/orchestration";
import { agentExecution } from "../src/services/agent-context";
import { AppError } from "../src/domain/validation";
import type { LanguageModelProvider } from "../src/domain/providers";
let project: string;
let dir: string,
  file: string,
  user: string,
  f: ReturnType<typeof missionFixture>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-agents-"));
  file = join(dir, "data.json");
  user = randomUUID();
  f = missionFixture(file, user, true);
  project = (
    await f.entities.createEntity({
      name: "Wag Trails",
      entity_type: "project",
    })
  ).id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const spec = () =>
  planSpec.parse({
    title: "Worker task",
    questions: [],
    steps: [
      {
        id: "task",
        depends_on: [],
        critical: true,
        missing: [],
        source_action_from: null,
        title: "Create scoped task",
        tool: "create_task",
        input: {
          title: "Worker acceptance task",
          priority: 3,
          project_id: project,
        },
        verification: {
          tool: "task.inspect",
          input: { task_id: { $from: "task", path: ["result", "task_id"] } },
          path: ["status"],
          equals: "pending",
          description: "Task exists",
        },
      },
    ],
  });
const config = (extra = {}) =>
  agentInput.parse({
    name: "Delivery specialist",
    purpose: "Review and complete scoped delivery work",
    specialization: "Developer Ary",
    capabilities: ["analyze", "tools", "delegate"],
    tool_access: [
      "mission.agent",
      "agent.delegate",
      "create_task",
      "task.inspect",
    ],
    permission_level: 4,
    ...extra,
  });
async function create(extra = {}) {
  return f.agents.create(config(extra), randomUUID());
}
async function start(agent: Agent, supplied = spec()) {
  let p = await f.agents.submit(
    agent.id,
    "Complete the delivery task",
    randomUUID(),
    supplied,
  );
  expect(p.mission?.agent_id).toBe(agent.id);
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("READY");
  return f.engine.control(p.id, "start", p.revision);
}
async function finish(p: ExecutionPlan) {
  for (let n = 0; n < 8 && p.mission?.state !== "COMPLETED"; n++)
    p = await f.engine.tick(p.id);
  return p;
}
async function policy(level: number) {
  await f.actions.permissions.savePolicy({
    tool: "create_task",
    level,
    reason: "Isolated worker test policy",
  });
}
async function profile(id: string) {
  return (await f.agents.list()).find((v) => v.agent.id === id)!;
}
it("starts empty; persists stable identity without inventing personalities", async () => {
  expect(await f.agents.list()).toEqual([]);
  const id = randomUUID(),
    a = await f.agents.create(config(), id);
  expect(await f.agents.create(config(), id)).toEqual(a);
  f = missionFixture(file, user, true);
  expect((await profile(id)).agent.id).toBe(id);
  expect((await profile(id)).status).toBe("IDLE");
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it("exposes only registered scoped tools and rejects unknown models / arbitrary agent fields", async () => {
  expect(
    f.tools
      .describe()
      .filter((t) => t.name.startsWith("agent."))
      .map((t) => t.name),
  ).toEqual([
    "agent.create",
    "agent.submit",
    "agent.delegate",
    "agent.terminate",
  ]);
  await expect(create({ model: "unapproved-model" })).rejects.toThrow(
    /not enabled/,
  );
  await expect(create({ tool_access: ["desktop.launch_app"] })).rejects.toThrow(
    /Unsupported/,
  );
  expect(agentInput.safeParse({ ...config(), shell: "rm -rf /" }).success).toBe(
    false,
  );
});
it("agent control operations retain action receipts, outcomes and required request keys", async () => {
  await expect(
    f.coordinator.requests.request({ tool: "agent.create", input: config() }),
  ).rejects.toThrow(/key/i);
  const r = await f.coordinator.requests.request({
    tool: "agent.create",
    input: config(),
    request_key: randomUUID(),
    reason: "Create functional test worker",
  });
  expect(r.result.agent).toBeTruthy();
  expect(
    (await f.repo.list("outcomes")).some((o) => o.action_id === r.action_id),
  ).toBe(true);
});
it("creates exactly one dormant mission per assignment key, including after restart", async () => {
  const a = await create(),
    key = randomUUID();
  const p = await f.agents.submit(a.id, "Task assignment", key, spec());
  expect(p.mission?.state).toBe("DRAFT");
  expect(await f.repo.list("tasks")).toHaveLength(0);
  f = missionFixture(file, user, true);
  expect((await f.agents.submit(a.id, "Task assignment", key, spec())).id).toBe(
    p.id,
  );
  expect((await profile(a.id)).agent.run_keys).toEqual([key]);
});
it("recovers mission receipt after profile-link checkpoint failure without duplication", async () => {
  const a = await create(),
    key = randomUUID(),
    batch = f.repo.batch.bind(f.repo);
  let fail = true;
  vi.spyOn(f.repo, "batch").mockImplementation(async (mutations) => {
    if (
      fail &&
      mutations.some(
        (m) =>
          m.kind === "update" &&
          m.table === "messages" &&
          m.id === a.id &&
          ((m.data.metadata as any)?.agent?.missions?.length ?? 0) > 0,
      )
    ) {
      fail = false;
      throw new Error("link outage");
    }
    return batch(mutations);
  });
  await expect(
    f.agents.submit(a.id, "Recover assignment", key, spec()),
  ).rejects.toThrow(/link outage/);
  const p = await f.agents.submit(a.id, "Recover assignment", key, spec());
  expect(p.mission?.agent_id).toBe(a.id);
  expect((await profile(a.id)).missions).toHaveLength(1);
});
it("retains permission ceiling even when owner policy is autonomous, approves then creates one real task", async () => {
  await policy(5);
  const a = await create();
  let p = await f.engine.tick((await start(a)).id);
  expect(p.mission?.state).toBe("APPROVAL_REQUIRED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
  await f.actions.permissions.review(
    p.states.task.approval_action_id!,
    "approved",
    "Approve scoped worker task",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await finish(p);
  expect(p.mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
  expect(
    (await f.repo.get("actions", p.states.task.action_id!))?.metadata.agent_id,
  ).toBe(a.id);
  await f.engine.tick(p.id);
  expect(await f.repo.list("tasks")).toHaveLength(1);
});
it("rejecting approval never executes the worker action", async () => {
  const a = await create();
  let p = await f.engine.tick((await start(a)).id);
  await f.actions.permissions.review(
    p.states.task.approval_action_id!,
    "rejected",
    "Decline task",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it.each([0, 1, 2, 3])(
  "ceiling %i blocks execution despite owner level five",
  async (permission_level) => {
    await policy(5);
    const a = await create({ permission_level });
    const p = await f.engine.tick((await start(a)).id);
    expect(p.mission?.state).toBe("FAILED");
    expect(await f.repo.list("tasks")).toHaveLength(0);
  },
);
it("owner denial cannot be raised by an autonomous worker", async () => {
  await policy(0);
  const a = await create({ permission_level: 5 });
  const p = await f.engine.tick((await start(a)).id);
  expect(p.mission?.state).toBe("FAILED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("autonomous internal scope still executes through receipts and outcome verification", async () => {
  await policy(5);
  const a = await create({ permission_level: 5 });
  const p = await finish(await start(a));
  expect(p.mission?.state).toBe("COMPLETED");
  expect(
    (await f.repo.list("outcomes")).some(
      (o) => o.action_id === p.states.task.action_id,
    ),
  ).toBe(true);
  expect(p.states.task.verification_action_id).toBeTruthy();
});
it("rejects plan tools outside scope before creating a mission", async () => {
  const a = await create({ tool_access: ["mission.agent"] });
  await expect(
    f.agents.submit(a.id, "Out of scope", randomUUID(), spec()),
  ).rejects.toThrow(/tool access/);
  expect((await profile(a.id)).missions).toHaveLength(0);
});
it("ephemeral workers accept one assignment; persistent workers obey run budget", async () => {
  const a = await create({ lifetime: "ephemeral" });
  await f.agents.submit(a.id, "First assignment", randomUUID(), spec());
  await expect(
    f.agents.submit(a.id, "Second assignment", randomUUID(), spec()),
  ).rejects.toThrow(/one assignment/);
  const b = await create({ budgets: { runs: 1 } });
  await f.agents.submit(b.id, "First assignment", randomUUID(), spec());
  await expect(
    f.agents.submit(b.id, "Second assignment", randomUUID(), spec()),
  ).rejects.toThrow(/budget/);
});
it("creates real child nodes without memory duplication and narrows child scope", async () => {
  const parent = await create(),
    child = await f.agents.delegate(
      parent.id,
      config({
        permission_level: 2,
        tool_access: ["mission.agent"],
        capabilities: ["analyze"],
        memory_scope: "none",
        budgets: { runs: 1, tool_calls: 1, model_calls: 1, children: 0 },
      }),
      "Analyze delivery evidence",
      randomUUID(),
    );
  expect(child.agent.parent_id).toBe(parent.id);
  expect(child.agent.lifetime).toBe("ephemeral");
  expect((await profile(parent.id)).agent.children).toEqual([child.agent.id]);
  expect(child.mission.mission?.agent_id).toBe(child.agent.id);
  expect(
    (await f.repo.readEvents({ limit: 100 })).events.some(
      (e) =>
        e.type === "agent.child_created" &&
        e.payload.parent_agent_id === parent.id,
    ),
  ).toBe(true);
  expect(await f.repo.list("memories")).toHaveLength(0);
});
it.each([
  { permission_level: 5 },
  { memory_scope: "mission" },
  { tool_access: ["update_task"] },
  { budgets: { runs: 40 } },
  { capabilities: ["analyze", "tools", "delegate"] },
])("blocks child scope escalation %j", async (expansion) => {
  const parent = await create({
    memory_scope: "none",
    capabilities: ["analyze", "delegate"],
    tool_access: ["mission.agent", "agent.delegate"],
  });
  await expect(
    f.agents.create(
      config({
        parent_id: parent.id,
        capabilities: ["analyze"],
        tool_access: ["mission.agent"],
        memory_scope: "none",
        ...expansion,
      }),
      randomUUID(),
    ),
  ).rejects.toThrow();
});
it("cannot delegate on behalf of a different parent", async () => {
  const a = await create(),
    b = await create();
  await expect(
    agentExecution.run(
      {
        id: a.id,
        userId: user,
        tools: a.tool_access,
        permissionLevel: 4,
        check: async () => {},
      },
      () =>
        f.agents.delegate(
          b.id,
          config(),
          "Wrong parent assignment",
          randomUUID(),
        ),
    ),
  ).rejects.toThrow(/own child/);
});
it("reserves aggregate parent budgets and prevents excess concurrent calls", async () => {
  const a = await create({ budgets: { tool_calls: 1 } }),
    p = await f.agents.submit(a.id, "Budget check", randomUUID(), spec()),
    work = vi.fn(async () => true);
  const r = await Promise.allSettled([
    f.agents.dispatch(p, "create_task", "one", work),
    f.agents.dispatch(p, "create_task", "two", work),
  ]);
  expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(work).toHaveBeenCalledTimes(1);
  expect((await profile(a.id)).agent.dispatch_keys).toHaveLength(1);
});
it("retries CAS conflicts before dispatch without rerunning work or charging a replay key", async () => {
  const a = await create(),
    p = await f.agents.submit(
      a.id,
      "Concurrent observations",
      randomUUID(),
      spec(),
    ),
    batch = f.repo.batch.bind(f.repo);
  let once = true;
  vi.spyOn(f.repo, "batch").mockImplementation(async (m) => {
    if (once) {
      once = false;
      throw new AppError("Concurrent checkpoint", 409);
    }
    return batch(m);
  });
  const work = vi.fn(async () => true);
  await f.agents.dispatch(p, "task.inspect", "stable", work);
  await f.agents.dispatch(p, "task.inspect", "stable", work);
  expect((await profile(a.id)).agent.dispatch_keys).toEqual(["stable"]);
});
it("terminates a subtree durably and blocks later work after restart", async () => {
  const a = await create(),
    c = await f.agents.delegate(
      a.id,
      config(),
      "Review a delivery issue",
      randomUUID(),
    );
  await f.agents.terminate(a.id, "Owner cancelled work");
  f = missionFixture(file, user, true);
  await f.agents.terminate(a.id, "Retry cancellation");
  expect((await profile(c.agent.id)).status).toBe("TERMINATED");
  await expect(
    f.agents.dispatch(c.mission, "mission.agent", "new", async () => true),
  ).rejects.toThrow(/terminated/);
  await expect(
    f.agents.submit(a.id, "New assignment", randomUUID(), spec()),
  ).rejects.toThrow(/terminated/);
});
it("isolates profiles by authenticated repository owner", async () => {
  const a = await create(),
    other = missionFixture(file, randomUUID(), true);
  expect(await other.agents.list()).toEqual([]);
  await expect(
    other.agents.submit(a.id, "Cross owner", randomUUID(), spec()),
  ).rejects.toThrow(/not found/i);
});
it("calls selected provider with no memory when scope is none and records canonical submission", async () => {
  const provider = f.model as LanguageModelProvider;
  const call = vi.fn(async () => ({
    content: JSON.stringify({
      summary: "No supporting evidence available",
      findings: [],
      order: [],
      plan: [],
    }),
    model: "isolated-model",
    provider: "fixture",
    metrics: {
      input_tokens: 12,
      cached_input_tokens: 0,
      output_tokens: 8,
      latency_ms: 3,
      estimated_cost_usd: null,
      retrieval_count: 0,
      pricing_version: "test",
    },
  }));
  provider.reasonWithUsage = call;
  const a = await create({ memory_scope: "none" });
  let p = await f.agents.submit(a.id, "Review delivery evidence", randomUUID());
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  p = await f.engine.control(p.id, "start", p.revision);
  p = await finish(p);
  expect(p.mission?.state).toBe("COMPLETED");
  expect(call).toHaveBeenCalledTimes(1);
  expect((call.mock.calls[0] as any)[0].memories).toEqual([]);
  expect((call.mock.calls[0] as any)[0].history).toEqual([]);
  expect((await profile(a.id)).agent.model_keys).toHaveLength(1);
});
it("enforces model budget before invoking another advisory call", async () => {
  const a = await create({ budgets: { model_calls: 1 } }),
    p = await f.agents.submit(a.id, "Budgeted reasoning", randomUUID()),
    work = vi.fn(async () => true);
  await f.agents.dispatch(p, "mission.agent", "call-one", work);
  await expect(
    f.agents.dispatch(p, "mission.agent", "call-two", work),
  ).rejects.toThrow(/model-call budget/);
  expect(work).toHaveBeenCalledTimes(1);
});
it("child work consumes its ancestors' tool budget atomically", async () => {
  const a = await create({ budgets: { tool_calls: 1 } }),
    c = await f.agents.delegate(
      a.id,
      config({ budgets: { tool_calls: 1 } }),
      "Review scoped evidence",
      randomUUID(),
    );
  await f.agents.dispatch(
    c.mission,
    "mission.agent",
    "child-call",
    async () => true,
  );
  expect((await profile(a.id)).agent.dispatch_keys).toEqual(["child-call"]);
  const p = await f.agents.submit(a.id, "Parent work", randomUUID());
  await expect(
    f.agents.dispatch(p, "mission.agent", "parent-call", async () => true),
  ).rejects.toThrow(/budget/);
});
it("termination aborts an in-flight cooperative model and prevents a successful late submission", async () => {
  let began!: () => void;
  const started = new Promise<void>((r) => (began = r));
  (f.model as LanguageModelProvider).reasonWithUsage = async (_, options) =>
    new Promise((_, reject) => {
      began();
      options!.signal!.addEventListener(
        "abort",
        () => reject(new Error("model interrupted")),
        { once: true },
      );
    });
  const a = await create();
  let p = await f.agents.submit(a.id, "Review delivery evidence", randomUUID());
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  p = await f.engine.control(p.id, "start", p.revision);
  const pending = f.engine.tick(p.id);
  await started;
  await f.agents.terminate(a.id, "Owner interrupted analysis");
  await pending;
  expect((await profile(a.id)).status).toBe("TERMINATED");
  expect(
    (await f.repo.list("actions"))
      .filter((x) => x.tool_name === "mission.agent")
      .some((x) => x.status === "succeeded"),
  ).toBe(false);
});
it("projects real worker relationships into the existing Nexus map", async () => {
  const { NexusMapService } = await import("../src/services/nexus-map-service");
  const a = await create(),
    c = await f.agents.delegate(
      a.id,
      config(),
      "Review delivery dependencies",
      randomUUID(),
    );
  const map = await new NexusMapService(
    f.repo,
    f.actions,
    f.coordinator.requests,
  ).query({ kind: "agent" });
  expect(map.nodes.some((n) => n.id === `agent:${a.id}`)).toBe(true);
  expect(
    map.edges.some(
      (e) => e.source === `agent:${a.id}` && e.target === `agent:${c.agent.id}`,
    ),
  ).toBe(true);
});
it("does not reassign a stable identity to different configuration", async () => {
  const a = await create();
  await expect(
    f.agents.create(config({ name: "Different specialization" }), a.id),
  ).rejects.toThrow(/different configuration/);
});
it("fails closed if a trusted execution scope is accidentally attached to another owner", async () => {
  const a = await create();
  const decision = await agentExecution.run(
    {
      id: a.id,
      userId: randomUUID(),
      tools: ["create_task"],
      permissionLevel: 5,
      check: async () => {},
    },
    () =>
      f.actions.permissions.resolve("create_task", {
        workspace: "ary-nexus",
        productIds: [],
      }),
  );
  expect(decision.level).toBe(0);
});
it("reuses existing model telemetry and preserves unknown cost, with Economics visibility gated", async () => {
  const a = await create();
  const p = await f.agents.submit(
    a.id,
    "Observe task evidence",
    randomUUID(),
    spec(),
  );
  let actionId = "";
  await f.agents.dispatch(p, "task.inspect", "usage-fixture", async () =>
    f.actions.run("activity.read", null, async () => true),
  );
  actionId = (await f.repo.list("actions")).find(
    (x) => x.metadata.agent_id === a.id,
  )!.id;
  await f.repo.insert("model_calls", {
    action_id: actionId,
    operation: "reason",
    model: "fixture",
    input_tokens: 12,
    cached_input_tokens: 0,
    output_tokens: 8,
    latency_ms: 3,
    estimated_cost_usd: null,
    pricing_version: "test",
    retrieval_count: 0,
    memories_extracted: 0,
    status: "succeeded",
    error_code: null,
  });
  expect((await profile(a.id)).usage).toMatchObject({
    calls: 1,
    input_tokens: 12,
    estimated_cost_usd: null,
    unknown_cost_calls: 1,
  });
  await f.actions.permissions.savePolicy({
    tool: "roi.read",
    level: 0,
    reason: "Restrict cost visibility",
  });
  expect((await profile(a.id)).usage.calls).toBe(0);
  expect((await profile(a.id)).usage.estimated_cost_usd).toBeNull();
});
