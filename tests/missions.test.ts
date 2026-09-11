import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { missionStates, submissionInput } from "../src/domain/mission";
import {
  planSpec,
  type ExecutionPlan,
  type PlanSpec,
} from "../src/domain/orchestration";
import { AppError } from "../src/domain/validation";
let dir: string,
  file: string,
  user: string,
  f: ReturnType<typeof missionFixture>,
  project: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-mission-"));
  file = join(dir, "data.json");
  user = randomUUID();
  f = missionFixture(file, user);
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
function taskSpec(): PlanSpec {
  return {
    title: "Finish tracking fix",
    questions: [],
    steps: [
      {
        id: "task",
        title: "Create tracking task",
        tool: "create_task",
        input: {
          title: "Finish Wag Trails tracking bug",
          project_id: project,
          priority: 3,
        },
        depends_on: [],
        critical: true,
        missing: [],
        source_action_from: null,
        verification: {
          tool: "task.inspect",
          input: { task_id: { $from: "task", path: ["result", "task_id"] } },
          path: ["status"],
          equals: "pending",
          description: "Real task is pending",
        },
      },
    ],
  };
}
async function ready(spec = taskSpec(), options = {}) {
  let p = await f.engine.create(
    "Finish Wag Trails tracking fix",
    spec,
    options,
  );
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("READY");
  return p;
}
async function start(spec = taskSpec(), options = {}) {
  const p = await ready(spec, options);
  return f.engine.control(p.id, "start", p.revision);
}
async function autonomous() {
  await f.actions.permissions.savePolicy({
    tool: "create_task",
    level: 5,
    reason: "Isolated internal task acceptance",
  });
}
async function finish(p: ExecutionPlan) {
  for (let i = 0; i < 8 && p.mission?.state !== "COMPLETED"; i++) {
    p = await f.engine.tick(p.id);
  }
  return p;
}
it("defines all requested lifecycle states", () =>
  expect(missionStates).toEqual([
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
  ]));
it("persists a DRAFT without reasoning or execution, then plans the same canonical ID", async () => {
  const p = await f.engine.create("Finish fix", taskSpec());
  expect(p.mission?.state).toBe("DRAFT");
  expect(await f.repo.list("tasks")).toHaveLength(0);
  const planning = await f.engine.control(p.id, "plan", p.revision);
  expect(planning.mission?.state).toBe("PLANNING");
  const next = await f.engine.tick(p.id);
  expect(next.id).toBe(p.id);
  expect(next.source_message_id).toBe(p.source_message_id);
  expect(next.mission?.state).toBe("READY");
  expect(await f.coordinator.history()).toHaveLength(1);
});
it("does not run READY or DRAFT missions without activation", async () => {
  const p = await ready();
  await f.engine.tick(p.id);
  expect(await f.repo.list("tasks")).toHaveLength(0);
  expect(await f.repo.dueMissions(10)).toHaveLength(0);
});
it("uses exact approval then one real task, read-back and COMPLETED", async () => {
  let p = await f.engine.tick((await start()).id);
  expect(p.mission?.state).toBe("APPROVAL_REQUIRED");
  await f.actions.permissions.review(
    p.states.task.approval_action_id!,
    "approved",
    "Approve exact test task",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await finish(p);
  expect(p.mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
  expect(p.states.task.verification_action_id).toBeTruthy();
  expect(
    (await f.repo.list("outcomes")).some(
      (o) => o.action_id === p.states.task.action_id,
    ),
  ).toBe(true);
});
it("declined approval is FAILED, not successful completion", async () => {
  let p = await f.engine.tick((await start()).id);
  await f.actions.permissions.review(
    p.states.task.approval_action_id!,
    "rejected",
    "Do not create this task",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("permission denied blocks a started mission", async () => {
  await f.actions.permissions.savePolicy({
    tool: "create_task",
    level: 0,
    reason: "deny fixture",
  });
  const p = await f.engine.tick((await start()).id);
  expect(p.mission?.state).toBe("FAILED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("survives reconstruction while waiting approval and preserves its exact action", async () => {
  let p = await f.engine.tick((await start()).id),
    id = p.states.task.approval_action_id;
  f = missionFixture(file, user);
  p = await f.engine.inspect(p.id);
  expect(p.states.task.approval_action_id).toBe(id);
  await f.actions.permissions.review(id!, "approved", "Resume after restart");
  p = await f.engine.control(p.id, "resume", p.revision);
  expect((await finish(p)).mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
});
it("pause/resume persists and cancel is terminal", async () => {
  await autonomous();
  let p = await start();
  p = await f.engine.control(p.id, "pause", p.revision);
  f = missionFixture(file, user);
  expect((await f.engine.tick(p.id)).mission?.state).toBe("PAUSED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await f.engine.control(p.id, "cancel", p.revision);
  expect((await f.engine.tick(p.id)).mission?.state).toBe("CANCELLED");
  expect(
    (await f.engine.control(p.id, "resume", p.revision)).mission?.state,
  ).toBe("CANCELLED");
});
it("fences concurrent and expired workers", async () => {
  const p = await ready(),
    a = randomUUID(),
    b = randomUUID();
  expect(await f.repo.claimMission(p.id, a, 100)).toBe(true);
  expect(await f.repo.claimMission(p.id, b, 100)).toBe(false);
  await new Promise((r) => setTimeout(r, 120));
  expect(await f.repo.claimMission(p.id, b, 1000)).toBe(true);
  const row = (await f.repo.get("messages", p.id))!;
  await expect(
    f.repo.checkpointMission(p.id, a, row.updated_at, p),
  ).rejects.toThrow(/lease/);
  await f.repo.releaseMission(p.id, a);
  await expect(f.repo.claimMission(p.id, randomUUID(), 1000)).resolves.toBe(
    false,
  );
});
it("does not allow old manual coordinator dispatch around mission ownership", async () => {
  const p = await start();
  await expect(
    f.coordinator.command(p.id, "advance", p.revision),
  ).rejects.toThrow(/lease/);
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("recovers a crash after an internal task commits without creating a duplicate", async () => {
  await autonomous();
  let p = await start();
  const original = f.repo.checkpointMission.bind(f.repo);
  let crash = true;
  vi.spyOn(f.repo, "checkpointMission").mockImplementation(async (...args) => {
    if (crash && args[3].states.task.action_id) {
      crash = false;
      throw Error("simulated checkpoint outage");
    }
    return original(...args);
  });
  await expect(f.engine.tick(p.id)).rejects.toThrow(/checkpoint outage/);
  expect(await f.repo.list("tasks")).toHaveLength(1);
  f = missionFixture(file, user);
  p = await finish(await f.engine.inspect(p.id));
  expect(p.mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
});
it("recovers a persisted running checkpoint before any dispatch with the same step key", async () => {
  await autonomous();
  const p = await start();
  const row = (await f.repo.get("messages", p.id))!;
  p.states.task = {
    ...p.states.task,
    status: "running",
    key: `plan:${p.id}:task:execute:0`,
  };
  await f.repo.update("messages", p.id, {
    metadata: { ...row.metadata, plan: p },
  });
  f = missionFixture(file, user);
  const done = await finish(await f.engine.inspect(p.id));
  expect(done.mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
});
it("durably waits for an external event across restart, deduplicates submissions, never interprets them as approval", async () => {
  const spec = taskSpec();
  spec.steps[0].wait_for = { name: "edit_ready", timeout_ms: 10000 };
  let p = await f.engine.tick((await start(spec)).id);
  expect(p.mission?.state).toBe("WAITING");
  expect(p.states.task.status).toBe("waiting_event");
  f = missionFixture(file, user);
  const input = {
    id: randomUUID(),
    name: "edit_ready",
    payload: { approved: true },
  };
  p = await f.engine.submit(p.id, input);
  expect(
    (await f.engine.submit(p.id, input)).mission?.submissions,
  ).toHaveLength(1);
  await expect(
    f.engine.submit(p.id, { ...input, payload: { approved: false } }),
  ).rejects.toThrow(/different/);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("APPROVAL_REQUIRED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("event deadlines survive restart and fail without dispatch", async () => {
  const spec = taskSpec();
  spec.steps[0].wait_for = { name: "edit_ready", timeout_ms: 100 };
  let p = await f.engine.tick((await start(spec)).id);
  await new Promise((r) => setTimeout(r, 120));
  f = missionFixture(file, user);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  expect(p.states.task.error).toContain("deadline");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("rejects undeclared, oversized and malformed submissions", async () => {
  const p = await ready();
  await expect(
    f.engine.submit(p.id, { id: randomUUID(), name: "approve", payload: {} }),
  ).rejects.toThrow(/declared/);
  expect(
    submissionInput.safeParse({
      id: randomUUID(),
      name: "x",
      payload: { secret: "x".repeat(5000) },
    }).success,
  ).toBe(false);
});
it("evaluates a branch using a real predecessor receipt, not arbitrary code", async () => {
  await autonomous();
  const spec = taskSpec();
  spec.steps.push({
    ...spec.steps[0],
    id: "optional",
    depends_on: ["task"],
    input: { ...spec.steps[0].input, title: "Should not exist" },
    when: {
      step: "task",
      path: ["result", "task_id"],
      equals: "not-the-actual-id",
    },
    verification: null,
  });
  const p = await finish(await start(spec));
  expect(p.mission?.state).toBe("COMPLETED");
  expect(p.states.optional.status).toBe("skipped");
  expect(await f.repo.list("tasks")).toHaveLength(1);
  expect(
    planSpec.safeParse({
      ...spec,
      steps: [
        {
          ...spec.steps[0],
          when: { step: "future", path: ["x"], equals: true },
        },
      ],
    }).success,
  ).toBe(false);
});
it("isolates ownership and preserves audit events without submission contents", async () => {
  const p = await ready();
  const stranger = missionFixture(file, randomUUID());
  await expect(stranger.engine.inspect(p.id)).rejects.toThrow();
  await expect(
    stranger.repo.claimMission(p.id, randomUUID(), 1000),
  ).rejects.toThrow();
  const events = (await f.repo.readEvents({ limit: 100 })).events;
  expect(
    events.some((e) => e.type === "mission.draft" && e.mission_id === p.id),
  ).toBe(true);
  expect(events.some((e) => e.type === "mission.planning")).toBe(true);
  expect(events.some((e) => e.type === "mission.ready")).toBe(true);
});
it("runs due checkpoints through ToolRegistry and respects a denied worker policy", async () => {
  await start();
  await f.actions.permissions.savePolicy({
    tool: "mission.tick",
    level: 0,
    reason: "Disable fixture worker",
  });
  const r = await f.engine.runDue();
  expect(r.errors).toHaveLength(1);
  expect(await f.repo.list("tasks")).toHaveLength(0);
  expect(
    (await f.repo.list("actions")).some(
      (a) => a.tool_name === "mission.tick" && a.status === "blocked",
    ),
  ).toBe(true);
});
it("restarts an actual Node process after task commit, then recovers the exact task and completes", async () => {
  await autonomous();
  const p = await start(taskSpec(), { step_timeout_ms: 1000 });
  const run = promisify(execFile);
  await expect(
    run(process.execPath, [
      "--import",
      "tsx",
      "scripts/mission-restart-fixture.ts",
      file,
      user,
      p.id,
      "crash-after-task",
    ]),
  ).rejects.toMatchObject({ code: 77 });
  expect(await f.repo.list("tasks")).toHaveLength(1);
  const task = (await f.repo.list("tasks"))[0];
  const row = (await f.repo.get("messages", p.id))!;
  // The crashed process cannot release its lease. Wait for the real persisted deadline.
  const until = Date.parse(
    (row.metadata.mission_lease as { until: string }).until,
  );
  expect(await f.repo.claimMission(p.id, randomUUID(), 1000)).toBe(false);
  await new Promise((r) => setTimeout(r, Math.max(0, until - Date.now()) + 30));
  const resumed = await run(process.execPath, [
    "--import",
    "tsx",
    "scripts/mission-restart-fixture.ts",
    file,
    user,
    p.id,
    "recover",
  ]);
  expect(JSON.parse(resumed.stdout).states.task.action_id).toBeTruthy();
  f = missionFixture(file, user);
  expect((await finish(await f.engine.inspect(p.id))).mission?.state).toBe(
    "COMPLETED",
  );
  expect((await f.repo.list("tasks")).map((t) => t.id)).toEqual([task.id]);
}, 20000);
it("retries only a safe transient failure with a durable backoff and attempt bound", async () => {
  await autonomous();
  const original = f.tools.execute.bind(f.tools);
  let attempts = 0;
  vi.spyOn(f.tools, "execute").mockImplementation(async (...args) => {
    if (args[0] === "create_task" && attempts++ === 0)
      throw new AppError("temporarily unavailable", 503);
    return original(...args);
  });
  let p = await f.engine.tick(
    (await start(taskSpec(), { retry_delay_ms: 100 })).id,
  );
  expect(p.mission?.state).toBe("WAITING");
  expect(p.mission?.retry).toBeTruthy();
  await f.engine.tick(p.id);
  expect(attempts).toBe(1);
  await new Promise((r) => setTimeout(r, 120));
  p = await finish(await f.engine.inspect(p.id));
  expect(p.mission?.state).toBe("COMPLETED");
  expect(p.states.task.attempt).toBe(0);
  expect(attempts).toBe(2);
  expect(await f.repo.list("tasks")).toHaveLength(1);
});
it("stops automatic retries at the configured maximum", async () => {
  await autonomous();
  vi.spyOn(f.tools, "execute").mockRejectedValue(
    new AppError("temporarily unavailable", 503),
  );
  let p = await f.engine.tick(
    (await start(taskSpec(), { retry_delay_ms: 100, max_attempts: 2 })).id,
  );
  await new Promise((r) => setTimeout(r, 120));
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  expect(p.states.task.attempt).toBe(1);
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("does not burn checkpoint history while waiting for a human", async () => {
  let p = await f.engine.tick((await start()).id);
  const revision = p.revision;
  const row = (await f.repo.get("messages", p.id))!;
  p.mission!.wake_at = new Date(0).toISOString();
  await f.repo.update("messages", p.id, {
    metadata: { ...row.metadata, plan: p },
  });
  for (let i = 0; i < 4; i++) p = await f.engine.tick(p.id);
  expect(p.revision).toBe(revision);
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("pauses an in-flight mission without claiming its effect was undone", async () => {
  await autonomous();
  const original = f.tools.execute.bind(f.tools);
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>((r) => (started = r)),
    hold = new Promise<void>((r) => (release = r));
  vi.spyOn(f.tools, "execute").mockImplementation(async (...args) => {
    if (args[0] === "create_task") {
      started();
      await hold;
    }
    return original(...args);
  });
  const p = await start(),
    execution = f.engine.tick(p.id);
  await entered;
  const latest = await f.engine.inspect(p.id);
  const paused = await f.engine.control(p.id, "pause", latest.revision);
  expect(paused.summary).toContain("requested durably");
  release();
  const result = await execution;
  expect(result.mission?.state).toBe("PAUSED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
  expect(
    (await f.engine.tick(p.id)).states.task.verification_action_id,
  ).toBeUndefined();
});
it("timeout waits for a late receipt and fences stale checkpoint writes", async () => {
  await autonomous();
  const original = f.tools.execute.bind(f.tools);
  let release!: () => void, done!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    settled = new Promise<void>((r) => (done = r));
  vi.spyOn(f.tools, "execute").mockImplementation(async (...args) => {
    if (args[0] === "create_task") await hold;
    const result = await original(...args);
    done();
    return result;
  });
  let p = await f.engine.tick(
    (await start(taskSpec(), { step_timeout_ms: 100 })).id,
  );
  expect(p.mission?.state).toBe("WAITING");
  expect(p.mission?.uncertain).toBe(true);
  release();
  await settled;
  await new Promise((r) => setTimeout(r, 50));
  p = await f.engine.control(
    p.id,
    "resume",
    (await f.engine.inspect(p.id)).revision,
  );
  p = await finish(p);
  expect(p.mission?.state).toBe("COMPLETED");
  expect(await f.repo.list("tasks")).toHaveLength(1);
});
it("submits to an existing Board role with central evidence and captures structured output", async () => {
  Object.assign(f.model, {
    reasonWithUsage: vi.fn(async (context: { entities: { id: string }[] }) => ({
      content: JSON.stringify({
        summary: "Review tracking before release",
        findings: [
          {
            observation: "Project exists",
            next_step: "Inspect tracking bug",
            evidence: [context.entities[0].id],
            confidence: 0.8,
          },
        ],
        order: [],
        plan: [],
      }),
      model: "fixture",
      provider: "fixture",
      metrics: {
        input_tokens: 20,
        cached_input_tokens: 0,
        output_tokens: 20,
        latency_ms: 1,
        estimated_cost_usd: 0,
        retrieval_count: 0,
        pricing_version: "fixture",
      },
    })),
  });
  const spec = taskSpec();
  spec.steps = [
    {
      ...spec.steps[0],
      tool: "mission.agent",
      input: {
        role: "Developer Ary",
        objective: "Review Wag Trails tracking priorities",
      },
      verification: null,
    },
  ];
  const p = await finish(await start(spec));
  expect(p.mission?.state).toBe("COMPLETED");
  expect(p.states.task.result?.result).toMatchObject({
    role: "Developer Ary",
    mission_id: p.id,
  });
  expect(await f.repo.list("tasks")).toHaveLength(0);
  expect(
    (await f.repo.readEvents({ limit: 100 })).events.some(
      (e) => e.type === "agent.completed" && e.mission_id === p.id,
    ),
  ).toBe(true);
});
it("does not allow a plan to submit nested mission control as a tool", async () => {
  const spec = taskSpec();
  spec.steps[0].tool = "mission.control";
  spec.steps[0].input = {
    mission_id: randomUUID(),
    revision: 0,
    command: "start",
  };
  await expect(f.engine.create("Nested", spec)).rejects.toThrow(
    /Unavailable plan tool/,
  );
});
it("preserves idempotent creation through the existing action key infrastructure", async () => {
  const request = {
    tool: "mission.create",
    input: { goal: "Wag Trails fix", spec: taskSpec() },
    request_key: randomUUID(),
  };
  const a = await f.coordinator.requests.request(request),
    b = await f.coordinator.requests.request(request);
  expect(a.action_id).toBe(b.action_id);
  expect(await f.coordinator.history()).toHaveLength(1);
});
it("runs safe observations from distinct domains in one parallel wave", async () => {
  const spec = taskSpec();
  spec.steps = ["studio.inspect", "premiere.inspect"].map((tool, i) => ({
    ...spec.steps[0],
    id: `observe_${i}`,
    tool,
    input: {},
    verification: null,
  }));
  vi.spyOn(f.tools, "prepare").mockResolvedValue(undefined); // Isolated provider fixture.
  const original = f.tools.execute.bind(f.tools);
  let active = 0,
    peak = 0;
  vi.spyOn(f.tools, "execute").mockImplementation(async (...args) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 100));
    try {
      return ["studio.inspect", "premiere.inspect"].includes(args[0])
        ? { status: "observed" }
        : await original(...args);
    } finally {
      active--;
    }
  });
  const p = await f.engine.tick((await start(spec)).id);
  expect(peak).toBe(2);
  expect(Object.values(p.states).every((s) => s.status === "verified")).toBe(
    true,
  );
});
it("preserves project-scoped denial on mission control", async () => {
  const p = await ready();
  await f.actions.permissions.savePolicy({
    tool: "mission.control",
    product_entity_id: project,
    level: 0,
    reason: "Project restricted",
  });
  await expect(
    f.coordinator.requests.request({
      tool: "mission.control",
      input: { mission_id: p.id, revision: p.revision, command: "start" },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow(/not permitted/);
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("rejects durable-only gates on legacy plans instead of silently ignoring them", async () => {
  const spec = taskSpec();
  spec.steps[0].wait_for = { name: "input", timeout_ms: 100 };
  await expect(f.coordinator.create("legacy", spec)).rejects.toThrow(/durable/);
  const p = await f.coordinator.create("legacy", taskSpec());
  await expect(
    f.coordinator.replan(p.id, p.revision, spec, "add wait"),
  ).rejects.toThrow(/durable/);
});
it("persists planning failure and allows deliberate planning retry", async () => {
  let p = await f.engine.create("Prepare an objective without supplied plan");
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  p = await f.engine.control(p.id, "retry", p.revision);
  expect(p.mission?.state).toBe("PLANNING");
  expect(p.mission?.wake_at).toBeTruthy();
});

it("planning times out durably and fences a late model result", async () => {
  Object.assign(f.model, {
    planWithUsage: async () => {
      await new Promise((r) => setTimeout(r, 180));
      return {
        content: JSON.stringify(taskSpec()),
        model: "fixture",
        provider: "fixture",
        metrics: {},
      };
    },
  });
  let p = await f.engine.create("Wag Trails planning timeout", undefined, {
    step_timeout_ms: 100,
  });
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  expect(p.mission?.state).toBe("FAILED");
  await new Promise((r) => setTimeout(r, 120));
  expect((await f.engine.inspect(p.id)).mission?.state).toBe("FAILED");
  expect(await f.repo.list("tasks")).toHaveLength(0);
});
it("the explicit worker command resumes an activated local mission across separate invocations", async () => {
  const { resolve } = await import("node:path");
  const demoUser = "00000000-0000-4000-8000-000000000001";
  const worker = missionFixture(join(dir, ".data/demo.json"), demoUser);
  const entity = await worker.entities.createEntity({
    name: "Worker project",
    entity_type: "project",
  });
  await worker.actions.permissions.savePolicy({
    tool: "create_task",
    level: 5,
    reason: "Isolated worker acceptance",
  });
  const spec = taskSpec();
  spec.steps[0].input.project_id = entity.id;
  let p = await worker.engine.create("Worker project objective", spec);
  p = await worker.engine.control(p.id, "plan", p.revision);
  p = await worker.engine.tick(p.id);
  p = await worker.engine.control(p.id, "start", p.revision);
  const command = resolve("scripts/run-missions.ts"),
    loader = resolve("node_modules/tsx/dist/loader.mjs");
  const workerLogs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const output = await promisify(execFile)(
      process.execPath,
      ["--import", loader, command, "--once"],
      {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: "development",
          ARY_STORAGE: "demo",
          ARY_LLM_PROVIDER: "mock",
          ARY_EMBEDDING_PROVIDER: "local",
          ARY_MISSION_WORKER_ENABLED: "true",
        },
      },
    );
    workerLogs.push(output.stdout);
  }
  expect(
    (await worker.engine.inspect(p.id)).mission?.state,
    JSON.stringify({
      workerLogs,
      actions: (await worker.repo.list("actions"))
        .filter((a) => a.status === "failed" || a.status === "blocked")
        .map((a) => ({ tool: a.tool_name, error: a.error })),
    }),
  ).toBe("COMPLETED");
  expect(
    (await worker.repo.list("tasks")).filter(
      (task) => task.metadata.source_conversation_id === p.conversation_id,
    ),
  ).toHaveLength(1);
}, 20000);
