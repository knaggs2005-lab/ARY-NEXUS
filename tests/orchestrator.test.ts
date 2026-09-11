import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { createActionToolRegistry } from "../src/services/action-request-service";
import { OrchestratorService } from "../src/services/orchestrator-service";
import { registerOrchestratorTools } from "../src/infrastructure/tools/orchestrator-tools";
import { EntityService } from "../src/services/entity-service";
import { MemoryService } from "../src/services/memory-service";
import {
  MockLanguageModel,
  LocalEmbeddingProvider,
} from "../src/infrastructure/providers/local";
import {
  planSpec,
  bindInput,
  type PlanSpec,
  type ExecutionPlan,
} from "../src/domain/orchestration";
import type { Entity } from "../src/domain/models";
import { AppError } from "../src/domain/validation";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  service: OrchestratorService,
  project: Entity;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-orchestrator-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  const entities = new EntityService(repo);
  project = await entities.createEntity({
    name: "Wag Trails",
    entity_type: "project",
  });
  const tools = createActionToolRegistry(repo, undefined, actions);
  service = new OrchestratorService(
    repo,
    actions,
    tools,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    entities,
    new MockLanguageModel(),
  );
  registerOrchestratorTools(tools, service, repo, actions);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
function spec(): PlanSpec {
  return {
    title: "Prepare the edit",
    questions: [],
    steps: [
      {
        id: "task",
        title: "Create editing task",
        tool: "create_task",
        input: {
          title: "Finish interview edit",
          project_id: project.id,
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
          description: "Task exists and is pending",
        },
      },
      {
        id: "inspect",
        title: "Read resulting task",
        tool: "task.inspect",
        input: { task_id: { $from: "task", path: ["result", "task_id"] } },
        depends_on: ["task"],
        critical: false,
        missing: [],
        source_action_from: null,
        verification: null,
      },
    ],
  };
}
const next = (
  p: ExecutionPlan,
  cmd: "advance" | "pause" | "stop" | "retry" | "recover" = "advance",
) => service.command(p.id, cmd, p.revision);
async function approve(
  p: ExecutionPlan,
  decision: "approved" | "rejected" = "approved",
) {
  await actions.permissions.review(
    p.states.task.approval_action_id!,
    decision,
    "Isolated test review",
  );
  return next(p);
}
async function policy(tool: string, level: 0 | 1 | 2 | 3 | 4 | 5) {
  await actions.permissions.savePolicy({ tool, level, reason: "test policy" });
}
it("saves a canonical plan with original user intent and no tool effects", async () => {
  const p = await service.create("Prepare Wag Trails edit", spec());
  expect(p.entity_ids).toContain(project.id);
  expect((await repo.get("messages", p.source_message_id))?.role).toBe("user");
  expect(await repo.list("tasks")).toHaveLength(0);
  expect((await service.history())[0].id).toBe(p.id);
});
it("requires per-step approval, creates one real task, verifies read-back, then runs dependent step", async () => {
  let p = await next(await service.create("Prepare Wag Trails edit", spec()));
  expect(p.states.task.status).toBe("waiting_approval");
  expect(await repo.list("tasks")).toHaveLength(0);
  p = await approve(p);
  expect(p.states.task.phase).toBe("verify");
  expect(p.states.inspect.status).toBe("planned");
  p = await next(p);
  expect(p.states.task.status).toBe("verified");
  expect(p.states.task.verification_action_id).toBeTruthy();
  p = await next(p);
  p = await next(p);
  expect(p.status).toBe("complete");
  expect(await repo.list("tasks")).toHaveLength(1);
  const task = (await repo.list("tasks"))[0];
  expect(task.metadata.source_conversation_id).toBe(p.conversation_id);
  expect(
    (await repo.list("outcomes")).some(
      (o) => o.action_id === p.states.task.action_id,
    ),
  ).toBe(true);
});
it.each([0, 1, 2, 3] as const)(
  "blocks create at permission level %s",
  async (level) => {
    await policy("create_task", level);
    const p = await next(
      await service.create("Prepare Wag Trails edit", spec()),
    );
    expect(p.states.task.status).toBe("failed");
    expect(await repo.list("tasks")).toHaveLength(0);
  },
);
it("declined approval stops execution", async () => {
  let p = await next(await service.create("Prepare Wag Trails edit", spec()));
  p = await approve(p, "rejected");
  expect(p.states.task.status).toBe("failed");
  expect(await repo.list("tasks")).toHaveLength(0);
  p = await next(p);
  expect(p.status).toBe("paused");
});
it("rechecks permissions after approval", async () => {
  let p = await next(await service.create("Prepare Wag Trails edit", spec()));
  await actions.permissions.review(
    p.states.task.approval_action_id!,
    "approved",
    "test",
  );
  await policy("create_task", 0);
  p = await next(p);
  expect(p.states.task.status).toBe("failed");
  expect(await repo.list("tasks")).toHaveLength(0);
});
it("rejects cycles, duplicate IDs, unknown tools and effectful verification", async () => {
  const p = spec();
  p.steps[0].depends_on = ["inspect"];
  expect(() => planSpec.parse(p)).toThrow();
  p.steps[0].depends_on = [];
  p.steps[1].id = "task";
  expect(() => planSpec.parse(p)).toThrow();
  const unknown = spec();
  unknown.steps[0].tool = "shell.exec";
  await expect(service.create("Do work", unknown)).rejects.toThrow(
    "Unavailable",
  );
  const bad = spec();
  bad.steps[0].verification!.tool = "create_task";
  await expect(service.create("Do work", bad)).rejects.toThrow("observation");
});
it("refuses untrusted expressions, prototype traversal and undeclared dependency references", () => {
  expect(() =>
    bindInput({ $from: "a", path: ["__proto__"] }, { a: {} }, ["a"]),
  ).toThrow();
  expect(() => bindInput({ $from: "a", path: [] }, { a: {} }, [])).toThrow();
  expect(() =>
    bindInput({ $from: "a", path: [], eval: "x" }, { a: {} }, ["a"]),
  ).toThrow();
});
it("pauses for missing inputs instead of inventing an external destination", async () => {
  const s = spec();
  s.steps[0].missing = ["Approved project ID"];
  const p = await next(await service.create("Prepare edit", s));
  expect(p.status).toBe("paused");
  expect(await repo.list("tasks")).toHaveLength(0);
});
it("successful receipt without read-back is not marked verified", async () => {
  const s = spec();
  s.steps[0].verification = null;
  let p = await next(await service.create("Prepare edit", s));
  p = await approve(p);
  expect(p.states.task.status).toBe("needs_verification");
  p = await next(p);
  expect(p.states.inspect.status).toBe("planned");
});
it("failed read-back keeps evidence and blocks dependants", async () => {
  const s = spec();
  s.steps[0].verification!.equals = "completed";
  let p = await next(await service.create("Prepare edit", s));
  p = await approve(p);
  p = await next(p);
  expect(p.states.task.status).toBe("failed");
  expect(p.states.task.action_id).toBeTruthy();
  expect(p.states.task.verification_action_id).toBeTruthy();
});
it("concurrent advance uses the existing CAS guard, producing one approval checkpoint", async () => {
  const p = await service.create("Prepare edit", spec());
  const results = await Promise.allSettled([next(p), next(p)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    (await repo.list("actions")).filter((a) => a.tool_name === "create_task"),
  ).toHaveLength(1);
});
it("resumes after a lost checkpoint write without duplicating the successful effect", async () => {
  let p = await next(await service.create("Prepare edit", spec()));
  await actions.permissions.review(
    p.states.task.approval_action_id!,
    "approved",
    "test",
  );
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
    if (
      mutations.some(
        (m) =>
          m.kind === "update" &&
          m.table === "messages" &&
          (m.data.metadata?.plan as ExecutionPlan | undefined)?.states.task
            .phase === "verify",
      )
    ) {
      throw new AppError("checkpoint offline", 503);
    }
    return original(mutations);
  });
  await expect(next(p)).rejects.toThrow("checkpoint offline");
  vi.restoreAllMocks();
  p = (await service.history())[0];
  expect(p.states.task.status).toBe("running");
  p = await next(p, "recover");
  expect(p.states.task.phase).toBe("verify");
  expect(await repo.list("tasks")).toHaveLength(1);
});
it("transactional failure rolls back task and bounded retry needs fresh approval", async () => {
  let p = await next(await service.create("Prepare edit", spec()));
  await actions.permissions.review(
    p.states.task.approval_action_id!,
    "approved",
    "test",
  );
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
    if (mutations.some((m) => m.kind === "insert" && m.table === "tasks"))
      throw new AppError("transient database failure", 503);
    return original(mutations);
  });
  p = await next(p);
  expect(p.states.task.status).toBe("failed");
  expect(await repo.list("tasks")).toHaveLength(0);
  vi.restoreAllMocks();
  p = await next(p, "retry");
  p = await next(p);
  expect(p.states.task.status).toBe("waiting_approval");
  p = await approve(p);
  expect(await repo.list("tasks")).toHaveLength(1);
});
it("unknown in-flight effects never reset to planned", async () => {
  const p = await service.create("Prepare edit", spec());
  const record = (await repo.get("messages", p.id))!;
  p.states.task.status = "running";
  p.states.task.key = "unknown-request";
  await repo.update("messages", p.id, {
    metadata: { ...record.metadata, plan: p },
  });
  await expect(next(p, "recover")).rejects.toThrow("unresolved");
});
it("stop skips pending work and survives a new service instance", async () => {
  let p = await service.create("Prepare edit", spec());
  p = await next(p, "stop");
  expect(p.states.task.status).toBe("skipped");
  expect((await service.history())[0].status).toBe("stopped");
  expect((await next(p)).states.task.status).toBe("skipped");
});
it("foreign plans remain inaccessible", async () => {
  const p = await service.create("Prepare edit", spec());
  const stranger = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  const gate = new ActionService(stranger);
  const tools = createActionToolRegistry(stranger, undefined, gate);
  const other = new OrchestratorService(
    stranger,
    gate,
    tools,
    new MemoryService(stranger, new LocalEmbeddingProvider()),
    new EntityService(stranger),
    new MockLanguageModel(),
  );
  await expect(other.command(p.id, "advance", p.revision)).rejects.toThrow(
    "not found",
  );
});
it("outcome memory requires its own exact approval and preserves source references", async () => {
  let p = await next(await service.create("Prepare edit", spec()));
  p = await approve(p);
  p = await next(p);
  p = await next(p);
  p = await next(p);
  const envelope = {
    tool: "orchestrator.remember",
    input: { plan_id: p.id, revision: p.revision, summary: p.summary },
    request_key: randomUUID(),
  };
  await expect(service.requests.request(envelope)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(await repo.list("memories")).toHaveLength(0);
  const a = (await repo.list("actions")).find(
    (a) => a.tool_name === "orchestrator.remember",
  )!;
  await actions.permissions.review(
    a.id,
    "approved",
    "Reviewed factual execution summary",
  );
  await service.requests.request(envelope);
  await service.requests.request(envelope);
  expect(await repo.list("memories")).toHaveLength(1);
  expect((await repo.list("memory_sources"))[0].kind).toBe("manual");
  expect((await repo.list("memories"))[0].metadata.source_action_ids).toContain(
    p.states.task.action_id,
  );
});
it("model planning is advisory and receives bounded shared context plus registered schemas", async () => {
  const model = new MockLanguageModel();
  const reason = vi.fn(async () => ({
    content: JSON.stringify(spec()),
    model: "fixture-planner",
    provider: "fixture",
    metrics: {
      input_tokens: 1,
      cached_input_tokens: 0,
      output_tokens: 1,
      latency_ms: 1,
      estimated_cost_usd: 0,
      retrieval_count: 0,
      pricing_version: "fixture",
    },
  }));
  Object.assign(model, { planWithUsage: reason });
  const tools = createActionToolRegistry(repo, undefined, actions);
  const planner = new OrchestratorService(
    repo,
    actions,
    tools,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    new EntityService(repo),
    model,
  );
  registerOrchestratorTools(tools, planner, repo, actions);
  const p = await planner.create("Prepare Wag Trails edit");
  expect(p.model).toBe("fixture-planner");
  expect(await repo.list("tasks")).toHaveLength(0);
  expect(reason.mock.calls[0]).toBeTruthy();
});
it("failed verification permission retains the original execution action", async () => {
  let p = await next(await service.create("Prepare Wag Trails edit", spec()));
  p = await approve(p);
  const execution = p.states.task.action_id;
  await policy("task.inspect", 0);
  p = await next(p);
  expect(p.states.task.status).toBe("failed");
  expect(p.states.task.action_id).toBe(execution);
  expect(p.states.task.verification_action_id).toBeTruthy();
});
it("scoped plan control cannot bypass a project denial", async () => {
  const p = await service.create("Prepare Wag Trails edit", spec());
  await actions.permissions.savePolicy({
    tool: "orchestrator.advance",
    product_entity_id: project.id,
    level: 0,
    reason: "Project locked",
  });
  await expect(
    service.requests.request({
      tool: "orchestrator.advance",
      input: { plan_id: p.id, revision: 0, command: "advance" },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow("not permitted");
  expect(await repo.list("tasks")).toHaveLength(0);
});
it("recovery finds the pending approval if its checkpoint was lost", async () => {
  let p = await service.create("Prepare edit", spec());
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
    if (
      mutations.some(
        (m) =>
          m.kind === "update" &&
          m.table === "messages" &&
          (m.data.metadata?.plan as ExecutionPlan | undefined)?.states.task
            .status === "waiting_approval",
      )
    )
      throw new AppError("checkpoint unavailable", 503);
    return original(mutations);
  });
  await expect(next(p)).rejects.toThrow();
  vi.restoreAllMocks();
  p = (await service.history())[0];
  p = await next(p, "recover");
  expect(p.states.task.status).toBe("waiting_approval");
  expect(await repo.list("tasks")).toHaveLength(0);
});
it("changed outcome cannot use an approval for an old summary", async () => {
  let p = await service.create("Prepare edit", spec());
  p = await next(p, "stop");
  await expect(
    service.remember(p.id, p.revision, "Everything succeeded"),
  ).rejects.toThrow("Outcome changed");
  expect(await repo.list("memories")).toHaveLength(0);
});
it("noncritical failure skips only dependants and permits independent work", async () => {
  const task = await repo.insert("tasks", {
    entity_id: project.id,
    goal_id: null,
    title: "Existing",
    description: "",
    status: "pending",
    priority: 1,
    due_at: null,
    metadata: {},
  });
  const s = spec();
  s.steps[0].critical = false;
  s.steps.push({
    id: "independent",
    title: "Inspect preexisting task",
    tool: "task.inspect",
    input: { task_id: task.id },
    depends_on: [],
    critical: false,
    missing: [],
    source_action_from: null,
    verification: null,
  });
  await policy("create_task", 0);
  let p = await next(await service.create("Prepare edit", s));
  p = await next(p);
  expect(p.states.inspect.status).toBe("skipped");
  expect(p.states.independent.status).toBe("verified");
});
it("stale duplicate advance cannot execute a step twice", async () => {
  const p = await service.create("Prepare edit", spec());
  await next(p);
  await expect(next(p)).rejects.toThrow("Plan changed");
  expect(
    (await repo.list("actions")).filter((a) => a.tool_name === "create_task"),
  ).toHaveLength(1);
});
it("uncertain execution result stops dependants and cannot be blindly retried", async () => {
  const { ToolRegistry } = await import("../src/domain/tool-registry");
  const tools = new ToolRegistry();
  const execute = vi.fn(async () => ({ status: "uncertain", steps: [] }));
  tools.register("mock.create_task", {
    inputSchema: z.object({}).strict(),
    execute,
  });
  const coordinated = new OrchestratorService(
    repo,
    actions,
    tools,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    new EntityService(repo),
    new MockLanguageModel(),
  );
  const s: PlanSpec = {
    title: "Controlled studio fixture",
    questions: [],
    steps: [
      {
        id: "studio",
        title: "Studio fixture",
        tool: "mock.create_task",
        input: {},
        depends_on: [],
        critical: true,
        missing: [],
        source_action_from: null,
        verification: null,
      },
    ],
  };
  let p = await coordinated.create("Studio fixture", s);
  p = await coordinated.command(p.id, "advance", p.revision);
  await actions.permissions.review(
    p.states.studio.approval_action_id!,
    "approved",
    "Fixture only",
  );
  p = await coordinated.command(p.id, "advance", p.revision);
  expect(p.states.studio.status).toBe("failed");
  await expect(coordinated.command(p.id, "retry", p.revision)).rejects.toThrow(
    "domain-specific recovery",
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it("atomic reviewed memory rejects a changed plan without leaving a memory", async () => {
  let p = await service.create("Prepare edit", spec());
  p = await next(p, "stop");
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
    if (mutations.some((m) => m.kind === "insert" && m.table === "memories"))
      throw new AppError("Record changed; reload and retry", 409);
    return original(mutations);
  });
  await expect(service.remember(p.id, p.revision, p.summary)).rejects.toThrow(
    "Record changed",
  );
  expect(await repo.list("memories")).toHaveLength(0);
  expect(await repo.list("memory_sources")).toHaveLength(0);
});
it("concurrent reviewed memory attempts use one deterministic canonical ID", async () => {
  let p = await service.create("Prepare edit", spec());
  p = await next(p, "stop");
  await Promise.allSettled([
    service.remember(p.id, p.revision, p.summary),
    service.remember(p.id, p.revision, p.summary),
  ]);
  expect(await repo.list("memories")).toHaveLength(1);
  expect(await repo.list("memory_sources")).toHaveLength(1);
});
it("coordinates Studio, Premiere and Calendar observation fixtures in dependency order", async () => {
  const { ToolRegistry } = await import("../src/domain/tool-registry");
  const registry = new ToolRegistry(),
    order: string[] = [];
  for (const tool of [
    "studio.inspect",
    "premiere.inspect",
    "google_calendar.read",
  ])
    registry.register(tool, {
      inputSchema: z.object({}).strict(),
      execute: async () => {
        order.push(tool);
        return { fixture: true, ready: true };
      },
    });
  const coordinator = new OrchestratorService(
    repo,
    actions,
    registry,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    new EntityService(repo),
    new MockLanguageModel(),
  );
  const planned: PlanSpec = {
    title: "Inspect operating context",
    questions: [],
    steps: ["studio.inspect", "premiere.inspect", "google_calendar.read"].map(
      (tool, i) => ({
        id: `step_${i}`,
        title: tool,
        tool,
        input: {},
        depends_on: i ? [`step_${i - 1}`] : [],
        critical: true,
        missing: [],
        source_action_from: null,
        verification: null,
      }),
    ),
  };
  let p = await coordinator.create(
    "Inspect studio, Premiere and Calendar context",
    planned,
  );
  for (let i = 0; i < 4; i++)
    p = await coordinator.command(p.id, "advance", p.revision);
  expect(p.status).toBe("complete");
  expect(order).toEqual([
    "studio.inspect",
    "premiere.inspect",
    "google_calendar.read",
  ]);
  expect(
    (await repo.list("actions")).filter(
      (a) => order.includes(a.tool_name) && a.status === "succeeded",
    ),
  ).toHaveLength(3);
});

// Multi-tool v1 extends the same coordinator and canonical action records.
import { classifyFailure, executionStatus } from "../src/domain/orchestration";
import { OrchestrationConversationService } from "../src/services/orchestration-conversation-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import { ToolRegistry } from "../src/domain/tool-registry";
function withTools(configure: (tools: ToolRegistry) => void) {
  const tools = createActionToolRegistry(repo, undefined, actions);
  const model = new MockLanguageModel();
  const memories = new MemoryService(repo, new LocalEmbeddingProvider());
  const entities = new EntityService(repo);
  const coordinator = new OrchestratorService(
    repo,
    actions,
    tools,
    memories,
    entities,
    model,
  );
  registerOrchestratorTools(tools, coordinator, repo, actions);
  const fixtures = new ToolRegistry();
  configure(fixtures);
  const originalPrepare = tools.prepare.bind(tools);
  vi.spyOn(tools, "prepare").mockImplementation((name) =>
    fixtures.describe().some((t) => t.name === name)
      ? Promise.resolve()
      : originalPrepare(name),
  );
  const original = tools.execute.bind(tools);
  vi.spyOn(tools, "execute").mockImplementation((name, input, context) =>
    fixtures.describe().some((t) => t.name === name)
      ? fixtures.execute(name, input, context)
      : original(name, input, context),
  );
  return { coordinator, model, memories, entities };
}
const observation = (id: string, tool: string, depends_on: string[] = []) => ({
  id,
  title: id,
  tool,
  input: {},
  depends_on,
  critical: false,
  missing: [],
  source_action_from: null,
  verification: null,
});
it("runs independent whitelisted observations concurrently, with separate receipts and outcomes", async () => {
  let started = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { coordinator } = withTools((tools) => {
    for (const tool of ["studio.inspect", "premiere.inspect"])
      tools.register(tool, {
        inputSchema: z.object({}).strict(),
        execute: async () => {
          started++;
          if (started === 2) release();
          await barrier;
          return { status: "observed" };
        },
      });
  });
  let p = await coordinator.create("Inspect studio and Premiere", {
    title: "Parallel observations",
    questions: [],
    steps: [
      observation("studio", "studio.inspect"),
      observation("premiere", "premiere.inspect"),
    ],
  });
  p = await coordinator.command(p.id, "advance", p.revision);
  expect(started).toBe(2);
  expect(Object.values(p.states).every((s) => s.status === "verified")).toBe(
    true,
  );
  expect(
    p.events.some((e) => e.text.includes("Parallel observation wave")),
  ).toBe(true);
  for (const s of Object.values(p.states))
    expect(
      (await repo.list("outcomes")).some((o) => o.action_id === s.action_id),
    ).toBe(true);
});
it("serializes observations in the same domain and respects dependent reads", async () => {
  const execute = vi.fn(async () => ({ status: "observed" }));
  const { coordinator } = withTools((tools) =>
    tools.register("studio.inspect", { inputSchema: z.object({}), execute }),
  );
  let p = await coordinator.create("Inspect studio", {
    title: "Reads",
    questions: [],
    steps: [
      observation("one", "studio.inspect"),
      observation("two", "studio.inspect"),
      observation("three", "studio.inspect", ["two"]),
    ],
  });
  expect(executionStatus(p, p.spec.steps[2])).toBe("waiting_for_dependency");
  p = await coordinator.command(p.id, "advance", p.revision);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(p.states.two.status).toBe("planned");
});
it("serializes independent writes and bundles only the exact related pending approvals", async () => {
  const s = spec();
  s.steps = [
    s.steps[0],
    {
      ...structuredClone(s.steps[0]),
      id: "second",
      title: "Second task",
      verification: null,
    },
  ];
  let p = await next(await service.create("Two tasks", s));
  expect(p.states.task.status).toBe("waiting_approval");
  expect(p.states.second.status).toBe("planned");
  p = await next(p);
  expect(p.states.second.status).toBe("waiting_approval");
  const shown = (await service.history())[0];
  expect(shown.pending_approvals).toHaveLength(2);
  const result = await service.requests.request({
    tool: "orchestrator.review_steps",
    input: {
      plan_id: p.id,
      revision: p.revision,
      items: shown.pending_approvals,
      decision: "approved",
      reason: "Review two exact task inputs",
    },
    request_key: randomUUID(),
  });
  expect(result.result.executed).toBe(false);
  expect(await repo.list("tasks")).toHaveLength(0);
  expect(
    (await repo.list("action_approvals")).filter(
      (a) => a.decision === "approved",
    ),
  ).toHaveLength(2);
  p = await next(p);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(p.states.second.status).toBe("waiting_approval");
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "permissions.review" && a.status === "succeeded",
    ),
  ).toBe(true);
});
it("rejects tampered approval inputs and unrelated/high-risk bundles", async () => {
  const p = await next(await service.create("Task", spec()));
  const shown = (await service.history())[0];
  const item = shown.pending_approvals![0];
  await expect(
    service.reviewSteps(
      p.id,
      p.revision,
      [{ ...item, input: { title: "Changed" } }],
      "approved",
      "Tamper test",
    ),
  ).rejects.toThrow("snapshot changed");
  await expect(
    service.reviewSteps(
      p.id,
      p.revision,
      [item, { ...item, step_id: "other", tool: "gmail.send" }],
      "approved",
      "unrelated test",
    ),
  ).rejects.toThrow("Unrelated or high-risk");
  expect(await repo.list("action_approvals")).toHaveLength(0);
});
it.each([
  ["Permission denied", 403, "permission_related"],
  ["Input missing", 400, "missing_input"],
  ["Tool not configured", 503, "unavailable_tool"],
  ["Dependency failed", 409, "critical_dependency_failure"],
  ["Approval rejected", 409, "user_decision_required"],
  ["temporarily unavailable", 503, "transient"],
] as const)(
  "classifies %s with a visible next action",
  (message, status, kind) => {
    const failure = classifyFailure(message, status, true);
    expect(failure.kind).toBe(kind);
    expect(failure.next_action.length).toBeGreaterThan(10);
  },
);
it("re-plans changed unexecuted inputs with a fresh key and preserves old approval evidence", async () => {
  let p = await next(await service.create("Task", spec()));
  const old = p.states.task.approval_action_id!;
  await actions.permissions.review(old, "approved", "Old exact title");
  const revised = structuredClone(p.spec);
  revised.steps[0].input.title = "Different final edit";
  p = await service.replan(p.id, p.revision, revised, "Correct the task title");
  expect(p.replan_history).toHaveLength(1);
  p = await next(p);
  expect(p.states.task.status).toBe("waiting_approval");
  expect(p.states.task.approval_action_id).not.toBe(old);
  expect(p.states.task.key).toContain(":g1");
  expect(await repo.list("tasks")).toHaveLength(0);
});
it("preserves completed evidence across revisions and forbids rewriting successful effects", async () => {
  let p = await next(await service.create("Task", spec()));
  p = await approve(p);
  p = await next(p);
  const revision = structuredClone(p.spec);
  revision.steps[0].input.title = "Rewrite history";
  await expect(
    service.replan(p.id, p.revision, revision, "Wrong edit"),
  ).rejects.toThrow("retain their original");
  const safe = structuredClone(p.spec);
  safe.steps[1].title = "Inspect the existing result";
  const id = p.states.task.action_id;
  p = await service.replan(
    p.id,
    p.revision,
    safe,
    "Clarify dependent observation",
  );
  expect(p.states.task.action_id).toBe(id);
  expect(p.states.task.status).toBe("verified");
});
it("can repair a failed branch with missing input without losing its original revision", async () => {
  const s = spec();
  s.steps[0].missing = ["title"];
  let p = await next(await service.create("Task", s));
  expect(await repo.list("tasks")).toHaveLength(0);
  const fixed = structuredClone(s);
  fixed.steps[0].missing = [];
  p = await service.replan(p.id, p.revision, fixed, "Owner supplied title");
  p = await next(p);
  expect(p.states.task.status).toBe("waiting_approval");
  expect(p.replan_history![0].before.steps[0].missing).toEqual(["title"]);
});
it("explicit skip stops its dependants, and cancellation retains existing evidence", async () => {
  let p = await service.create("Task", spec());
  p = await service.command(p.id, "skip", p.revision, "task");
  p = await next(p);
  expect(p.states.inspect.status).toBe("skipped");
  expect(await repo.list("tasks")).toHaveLength(0);
  let q = await service.create("Task again", spec());
  q = await service.command(q.id, "cancel", q.revision);
  expect(q.status).toBe("stopped");
  expect(q.states.task.status).toBe("cancelled");
});
it.each(["pause", "cancel"] as const)(
  "honors in-flight %s after read settles and never dispatches the next effect",
  async (command) => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const { coordinator } = withTools((tools) =>
      tools.register("studio.inspect", {
        inputSchema: z.object({}),
        execute: async () => {
          entered();
          await blocked;
          return { ready: true };
        },
      }),
    );
    const s = spec();
    s.steps.unshift(observation("observe", "studio.inspect"));
    s.steps[1].depends_on = ["observe"];
    let p = await coordinator.create("Inspect then task", s);
    const run = coordinator.command(p.id, "advance", p.revision);
    await started;
    const current = (await coordinator.history())[0];
    await coordinator.command(p.id, command, current.revision);
    release();
    p = await run;
    expect(p.status).toBe(command === "pause" ? "paused" : "stopped");
    expect(p.states.observe.status).toBe("verified");
    p = await coordinator.command(p.id, "advance", p.revision);
    expect(await repo.list("tasks")).toHaveLength(0);
    expect(p.states.task.status).toBe(
      command === "cancel" ? "cancelled" : "planned",
    );
    if (command === "pause") {
      p = await coordinator.command(p.id, "resume", p.revision);
      expect(p.states.task.status).toBe("waiting_approval");
    }
  },
);
it("text and voice share scoped pause/resume, exact approval review, and audit", async () => {
  const tools = createActionToolRegistry(repo, undefined, actions),
    model = new MockLanguageModel(),
    memories = new MemoryService(repo, new LocalEmbeddingProvider()),
    entities = new EntityService(repo);
  const coordinator = new OrchestratorService(
    repo,
    actions,
    tools,
    memories,
    entities,
    model,
  );
  registerOrchestratorTools(tools, coordinator, repo, actions);
  const adapter = new OrchestrationConversationService(repo, coordinator);
  const brain = new AryBrainService(
    repo,
    memories,
    entities,
    model,
    actions,
    undefined,
    undefined,
    adapter,
  );
  let p = await coordinator.create("Prepare edit", spec());
  const conversation = await repo.insert("conversations", {
    title: "Voice plan",
    metadata: {},
  });
  await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "assistant",
    content: "Plan ready",
    metadata: { orchestration_plan_id: p.id },
  });
  async function say(input: string, modality: "text" | "voice" = "voice") {
    let content = "";
    for await (const e of brain.respond({
      input,
      conversation_id: conversation.id,
      modality,
    }))
      if (e.type === "response") content = e.message.content;
    return content;
  }
  expect(await say("Ary, pause that.")).toContain("Paused");
  expect(await repo.list("tasks")).toHaveLength(0);
  await say("Resume the plan");
  p = (await coordinator.history())[0];
  expect(p.states.task.status).toBe("waiting_approval");
  expect(await say("Approve task step")).toContain("Please review");
  expect(await repo.list("action_approvals")).toHaveLength(0);
  expect(await say("Approve task step", "text")).toContain(
    "exact step is approved",
  );
  await say("Resume the plan");
  expect(await repo.list("tasks")).toHaveLength(1);
  await say("Resume the plan");
  expect((await coordinator.history())[0].states.task.status).toBe("verified");
  const records = await repo.list("actions");
  expect(
    records.some(
      (a) =>
        a.tool_name === "orchestrator.review_steps" && a.status === "succeeded",
    ),
  ).toBe(true);
  expect(
    records.some(
      (a) => a.tool_name === "create_task" && a.status === "succeeded",
    ),
  ).toBe(true);
});
it("never cancels unrelated plans from a context-free voice command", async () => {
  const p = await service.create("Task", spec());
  const conversation = await repo.insert("conversations", {
    title: "Unrelated",
    metadata: {},
  });
  const source = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content: "Cancel everything",
    metadata: { modality: "voice" },
  });
  const reply = await new OrchestrationConversationService(
    repo,
    service,
  ).handle(source.content, source);
  expect(reply?.content).toContain("Which execution plan");
  expect((await service.history())[0].revision).toBe(p.revision);
});
it("runs the requested Studio/Premiere/task/Calendar scenario with isolated provider fixtures, exact approvals and read-back", async () => {
  const registry = new ToolRegistry(),
    real = createActionToolRegistry(repo, undefined, actions);
  const state = { scene: "off", project: "", event: "" };
  registry.register("studio.plan_scene", {
    inputSchema: z.object({ scene: z.string() }),
    execute: async () => ({ scene_id: "podcast", plan_id: randomUUID() }),
  });
  registry.register("studio.execute_scene", {
    inputSchema: z.object({
      plan_action_id: z.uuid(),
      scene: z.literal("podcast"),
    }),
    execute: async () => {
      state.scene = "podcast";
      return {
        status: "success",
        scene_id: state.scene,
        steps: [],
        fixture: true,
      };
    },
  });
  registry.register("studio.inspect", {
    inputSchema: z.object({}),
    execute: async () => ({ scene: state.scene, fixture: true }),
  });
  registry.register("premiere.inspect", {
    inputSchema: z.object({}),
    execute: async () => ({ project: state.project, fixture: true }),
  });
  registry.register("premiere.open_project", {
    inputSchema: z.object({ path: z.string() }),
    execute: async (i) => {
      state.project = i.path;
      return { opened: true, fixture: true };
    },
  });
  registry.register("google_calendar.create", {
    inputSchema: z.object({
      title: z.string(),
      duration_minutes: z.literal(90),
    }),
    execute: async (i) => {
      state.event = i.title;
      return { event_id: randomUUID(), fixture: true };
    },
  });
  registry.register("google_calendar.read", {
    inputSchema: z.object({}),
    execute: async () => ({ title: state.event, fixture: true }),
  });
  registry.register("create_task", {
    inputSchema: z.object({
      title: z.string(),
      project_id: z.uuid(),
      priority: z.number(),
    }),
    execute: async (i, c) => {
      real.validate("create_task", i);
      return real.execute("create_task", i, c);
    },
  });
  const coordinator = new OrchestratorService(
    repo,
    actions,
    registry,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    new EntityService(repo),
    new MockLanguageModel(),
  );
  registerOrchestratorTools(registry, coordinator, repo, actions);
  const s: PlanSpec = {
    title: "Podcast interview finishing workflow",
    questions: [],
    steps: [
      observation("studio_state", "studio.inspect"),
      observation("premiere_state", "premiere.inspect"),
      {
        ...observation("scene_plan", "studio.plan_scene", ["studio_state"]),
        input: { scene: "podcast" },
      },
      {
        ...observation("podcast", "studio.execute_scene", ["scene_plan"]),
        critical: true,
        source_action_from: "scene_plan",
        input: {
          plan_action_id: { $from: "scene_plan", path: ["action_id"] },
          scene: "podcast",
        },
        verification: {
          tool: "studio.inspect",
          input: {},
          path: ["scene"],
          equals: "podcast",
          description: "Fixture scene reached podcast",
        },
      },
      {
        ...observation("interview", "premiere.open_project", [
          "premiere_state",
          "podcast",
        ]),
        critical: true,
        input: { path: "fixture/latest-interview.prproj" },
        verification: {
          tool: "premiere.inspect",
          input: {},
          path: ["project"],
          equals: "fixture/latest-interview.prproj",
          description: "Fixture project is loaded",
        },
      },
      { ...spec().steps[0], depends_on: ["interview"] },
      {
        ...observation("calendar", "google_calendar.create", ["task"]),
        input: { title: "Finish final edit tomorrow", duration_minutes: 90 },
        verification: {
          tool: "google_calendar.read",
          input: {},
          path: ["title"],
          equals: "Finish final edit tomorrow",
          description: "Fixture finishing block exists",
        },
      },
    ],
  };
  let p = await coordinator.create(
    "Put the studio into podcast mode, open the latest interview project in Premiere, create a task for the final edit, and schedule 90 minutes tomorrow",
    s,
  );
  for (let i = 0; i < 24 && p.status !== "complete"; i++) {
    const shown = (await coordinator.history())[0];
    if (shown.pending_approvals?.length)
      await coordinator.reviewSteps(
        p.id,
        p.revision,
        [shown.pending_approvals[0]],
        "approved",
        "Exact fixture action reviewed",
      );
    p = await coordinator.command(p.id, "advance", p.revision);
  }
  expect(p.status, JSON.stringify(p.states)).toBe("complete");
  expect(Object.values(p.states).every((s) => s.status === "verified")).toBe(
    true,
  );
  expect(await repo.list("tasks")).toHaveLength(1);
  expect((await repo.list("tasks"))[0].entity_id).toBe(project.id);
  for (const id of ["podcast", "interview", "task", "calendar"]) {
    expect(p.states[id].verification_action_id).toBeTruthy();
    expect(
      (await repo.list("outcomes")).some(
        (o) => o.action_id === p.states[id].action_id && o.status === "success",
      ),
    ).toBe(true);
  }
  const request = {
    tool: "orchestrator.remember",
    input: { plan_id: p.id, revision: p.revision, summary: p.summary },
    request_key: randomUUID(),
  };
  let pending: string | undefined;
  try {
    await coordinator.requests.request(request);
  } catch (e) {
    if (e instanceof ApprovalRequiredError) pending = e.actionId;
    else throw e;
  }
  expect(pending).toBeTruthy();
  await actions.permissions.review(
    pending!,
    "approved",
    "Keep one meaningful fixture workflow outcome",
  );
  await coordinator.requests.request(request);
  expect(await repo.list("memories")).toHaveLength(1);
  expect(await repo.list("memory_sources")).toHaveLength(1);
});
