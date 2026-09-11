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
import {
  createActionToolRegistry,
  ActionRequestService,
} from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import { context } from "../src/server/context";
import { actionContext } from "../src/server/action-context";
import { handle } from "../src/server/http";

vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => false,
}));
let directory: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService;
const execution = { tool: "mock.execute", input: { message: "Example plan" } };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-action-request-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  actions = new ActionService(repo);
  requests = new ActionRequestService(repo, actions);
  vi.mocked(context).mockImplementation(
    async (request) =>
      ({
        repository: repo,
        actions: new ActionService(repo, await actionContext(request, repo)),
      }) as unknown as Awaited<ReturnType<typeof context>>,
  );
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function pending(raw: unknown = execution) {
  try {
    await requests.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return (e as ApprovalRequiredError).actionId;
  }
  throw new Error("Expected an approval request");
}

it("runs observe, recommend and draft simulations with audit results and no knowledge writes", async () => {
  for (const [tool, input] of [
    ["mock.observe", {}],
    ["mock.recommend", { message: "Example" }],
    ["mock.draft", { message: "Example" }],
  ] as const) {
    const response = await requests.request({ tool, input });
    const action = await repo.get("actions", response.action_id);
    expect(response.result.simulated).toBe(true);
    expect(action).toMatchObject({
      tool_name: tool,
      status: "succeeded",
      approval_required: false,
      output: { completed: true, result: response.result },
    });
    expect(action?.created_at).toBeTruthy();
    expect(action?.metadata.permission_reason).toBeTruthy();
  }
  for (const table of [
    "memories",
    "entities",
    "relationships",
    "tasks",
    "model_calls",
    "roi_cost_entries",
    "roi_outcome_entries",
  ] as const)
    expect(await repo.list(table)).toEqual([]);
  expect((await repo.list("outcomes")).map((o) => o.status)).toEqual([
    "success",
    "success",
    "success",
  ]);
});

it.each([0, 1, 2, 3, 4, 5])(
  "enforces every mock operation at permission level %i",
  async (level) => {
    await actions.permissions.savePolicy({ level, reason: "Simulation test" });
    for (const [tool, minimum] of [
      ["mock.observe", 1],
      ["mock.recommend", 2],
      ["mock.draft", 3],
      ["mock.execute", 5],
    ] as const) {
      const operation = requests.request({
        tool,
        input: tool === "mock.observe" ? {} : { message: "Example" },
      });
      if (level >= minimum)
        await expect(operation).resolves.toHaveProperty(
          "result.simulated",
          true,
        );
      else if (tool === "mock.execute" && level === 4)
        await expect(operation).rejects.toBeInstanceOf(ApprovalRequiredError);
      else await expect(operation).rejects.toMatchObject({ status: 403 });
    }
  },
);

it("requires approval by default, binds execution to it, and permits only one concurrent use", async () => {
  const id = await pending();
  const approval = await actions.permissions.review(
    id,
    "approved",
    "Approve the simulation",
  );
  const results = await Promise.allSettled([
    requests.request(execution),
    requests.request(execution),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const completed = (await repo.list("actions")).filter(
    (a) => a.status === "succeeded",
  );
  expect(completed).toHaveLength(1);
  expect(completed[0].metadata.approval_id).toBe(approval.id);
  expect(
    (await repo.get("action_approvals", approval.id))?.consumed_at,
  ).toBeTruthy();
  expect((await repo.get("actions", id))?.status).toBe("approval_required");
  await expect(requests.request(execution)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
});

it("rejects an approval without executing and invalidates grants when input or scope changes", async () => {
  await actions.permissions.review(
    await pending(),
    "rejected",
    "Do not simulate",
  );
  const approval = await actions.permissions.review(
    await pending(),
    "approved",
    "Approve this exact request",
  );
  await pending({ ...execution, input: { message: "Different plan" } });
  const product = await repo.insert("entities", {
    name: "Example project",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  await pending({ ...execution, product_entity_id: product.id });
  expect(
    (await repo.list("actions")).some((a) => a.status === "succeeded"),
  ).toBe(false);
  expect(
    (await repo.get("action_approvals", approval.id))?.consumed_at,
  ).toBeNull();
});

it("applies intersecting product/action/user policies to dispatch", async () => {
  const product = await repo.insert("entities", {
    name: "Example project",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  await actions.permissions.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Allow simulation",
  });
  await actions.permissions.savePolicy({
    action_type: "mock_execute",
    product_entity_id: product.id,
    workspace: "ary-nexus",
    subject_user_id: repo.userId,
    level: 0,
    reason: "Block this scope",
  });
  await expect(
    requests.request({ ...execution, product_entity_id: product.id }),
  ).rejects.toMatchObject({ status: 403 });
  expect((await repo.list("actions"))[0]).toMatchObject({
    status: "blocked",
    product_entity_ids: [product.id],
    permission_level: 0,
  });
  await expect(requests.request(execution)).resolves.toHaveProperty(
    "result.simulated",
    true,
  );
});

it("records failure, consumes its approval, and requires new approval for retry", async () => {
  const raw = {
    ...execution,
    input: { message: "Example plan", simulate_failure: true },
  };
  const approval = await actions.permissions.review(
    await pending(raw),
    "approved",
    "Test failure",
  );
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 422 });
  const failed = (await repo.list("actions")).find(
    (a) => a.status === "failed",
  )!;
  expect(failed.error).toContain("Simulated tool failure");
  expect(failed.metadata.approval_id).toBe(approval.id);
  expect(
    (await repo.list("outcomes")).find((o) => o.action_id === failed.id)
      ?.status,
  ).toBe("failure");
  await expect(
    repo.update("actions", failed.id, { error: null }),
  ).rejects.toThrow();
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
});

it("does not dispatch internal operations, unregistered integrations, or prototype names", async () => {
  await actions.permissions.savePolicy({
    level: 5,
    reason: "Broad scope cannot expose handlers",
  });
  for (const tool of [
    "memory.create",
    "permissions.policy",
    "email.send",
    "finance.trade",
    "constructor",
    "toString",
    "__proto__",
  ])
    await expect(
      requests.request({ tool, input: { content: "Do not save" } }),
    ).rejects.toMatchObject({ status: 403 });
  expect(await repo.list("memories")).toEqual([]);
  const attempts = await repo.list("actions");
  expect(attempts).toHaveLength(7);
  expect(
    attempts
      .slice(1)
      .every((a) => a.status === "blocked" && a.permission_level === 0),
  ).toBe(true);
});

it("validates tool input before its handler and audits invalid tool input", async () => {
  await expect(
    requests.request({
      tool: "mock.draft",
      input: { message: "Example", execute: true },
    }),
  ).rejects.toMatchObject({ status: 400 });
  const action = (await repo.list("actions"))[0];
  expect(action).toMatchObject({
    status: "failed",
    error: "Invalid tool input",
  });
  for (const extra of [
    { permission_level: 5 },
    { user_id: randomUUID() },
    { mode: "observe" },
    { approvalId: randomUUID() },
  ])
    await expect(
      requests.request({ ...execution, ...extra }),
    ).rejects.toThrow();
  expect(await repo.list("actions")).toHaveLength(1);
});

it("rejects foreign scope/conversation identifiers and inappropriate entity types", async () => {
  const foreign = new LocalRepository(
    randomUUID(),
    join(directory, "data.json"),
  );
  const product = await foreign.insert("entities", {
    name: "Private",
    entity_type: "company",
    description: "",
    metadata: {},
  });
  const conversation = await foreign.insert("conversations", {
    title: "Private",
    metadata: {},
  });
  await expect(
    requests.request({ ...execution, product_entity_id: product.id }),
  ).rejects.toThrow();
  await expect(
    requests.request({ ...execution, conversation_id: conversation.id }),
  ).rejects.toThrow();
  const person = await repo.insert("entities", {
    name: "Example",
    entity_type: "person",
    description: "",
    metadata: {},
  });
  await expect(
    requests.request({ ...execution, product_entity_id: person.id }),
  ).rejects.toThrow("Scope must be");
  expect(await repo.list("actions")).toEqual([]);
});

it("supports typed server registration with validation, duplicate checks and no permission bypass", async () => {
  const execute = vi.fn(async ({ count }: { count: number }) => ({ count }));
  const definition = {
    inputSchema: z.object({ count: z.number().int().positive() }).strict(),
    execute,
  };
  const registry = new ToolRegistry().register("mock.observe", definition);
  expect(() => registry.register("mock.observe", definition)).toThrow(
    "Duplicate",
  );
  expect(() => registry.register("unregistered", definition)).toThrow(
    "Missing capability",
  );
  const dispatch = new ActionRequestService(repo, actions, registry);
  await expect(
    dispatch.request({ tool: "mock.observe", input: { count: -1 } }),
  ).rejects.toMatchObject({ status: 400 });
  expect(execute).not.toHaveBeenCalled();
  await actions.permissions.savePolicy({
    tool: "mock.observe",
    level: 0,
    reason: "Block",
  });
  await expect(
    dispatch.request({ tool: "mock.observe", input: { count: 1 } }),
  ).rejects.toMatchObject({ status: 403 });
  expect(execute).not.toHaveBeenCalled();
});

it("runs the HTTP approval/retry flow with exact request hashing and saved output", async () => {
  const post = (raw: unknown) =>
    handle(
      new Request("http://localhost/api/actions/request", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify(raw),
      }),
      ["actions", "request"],
    );
  const first = await post(execution);
  expect(first.status).toBe(409);
  const prompt = await first.json();
  expect(prompt.code).toBe("approval_required");
  const review = await handle(
    new Request(
      `http://localhost/api/permissions/attempts/${prompt.action_id}/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "approved",
          reason: "Approve exact simulation",
        }),
      },
    ),
    ["permissions", "attempts", prompt.action_id, "review"],
  );
  expect(review.status).toBe(201);
  const second = await post(execution);
  expect(second.status).toBe(201);
  const response = await second.json();
  expect(response.result.simulated).toBe(true);
  expect((await repo.get("actions", response.action_id))?.output).toEqual({
    completed: true,
    result: response.result,
  });
  expect((await post(execution)).status).toBe(409);
  expect((await post({ ...execution, permission_level: 5 })).status).toBe(400);
});

it("discovers all six named mocks with schemas, risk and effective authority", async () => {
  const catalog = await requests.catalog();
  for (const name of [
    "create_task",
    "update_task",
    "update_project_status",
    "draft_message",
    "create_note",
    "fetch_project_summary",
  ]) {
    const item = catalog.find((tool) => tool.name === `mock.${name}`)!;
    expect(item).toBeTruthy();
    expect(item.simulated).toBe(true);
    expect(item.risk_level).toBe("low");
    expect(item.available_actions).toHaveLength(1);
    expect(item.required_inputs.length).toBeGreaterThan(0);
    expect(item.input_schema.type).toBe("object");
    expect(item.permission.level).toBe(
      item.permission_requirements.default_level,
    );
  }
});

it("validates an execution request before asking for approval", async () => {
  await expect(
    requests.request({ tool: "mock.create_task", input: {} }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await repo.list("action_approvals")).toEqual([]);
  expect((await repo.list("actions"))[0]).toMatchObject({
    status: "failed",
    approval_required: false,
    error: "Invalid tool input",
  });
});

it("returns an identical persisted result on retries across service instances without re-executing", async () => {
  const execute = vi.fn(async () => ({ simulated: true, saved: false }));
  const registry = new ToolRegistry().register("mock.observe", {
    inputSchema: z.object({ a: z.string(), b: z.string() }).strict(),
    execute,
  });
  const raw = {
    tool: "mock.observe",
    input: { b: "B", a: "A" },
    request_key: randomUUID(),
  };
  const first = await new ActionRequestService(repo, actions, registry).request(
    raw,
  );
  const reopened = new LocalRepository(
    repo.userId,
    join(directory, "data.json"),
  );
  const retry = new ActionRequestService(
    reopened,
    new ActionService(reopened),
    registry,
  );
  expect(await retry.request({ ...raw, input: { a: "A", b: "B" } })).toEqual(
    first,
  );
  expect(execute).toHaveBeenCalledTimes(1);
  await expect(
    retry.request({ ...raw, input: { a: "changed", b: "B" } }),
  ).rejects.toThrow("different inputs");
  expect(execute).toHaveBeenCalledTimes(1);
  const attempts = await repo.list("actions");
  expect(attempts).toHaveLength(3);
  expect(attempts[1].metadata.replay_of).toBe(first.action_id);
  expect(await repo.list("outcomes")).toHaveLength(3);
});

it("claims a concurrent autonomous request only once", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => {
    await waiting;
    return { simulated: true };
  });
  const registry = new ToolRegistry().register("mock.observe", {
    inputSchema: z.object({}).strict(),
    execute,
  });
  const dispatcher = new ActionRequestService(repo, actions, registry);
  const raw = { tool: "mock.observe", input: {}, request_key: randomUUID() };
  const first = dispatcher.request(raw);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  await expect(dispatcher.request(raw)).rejects.toThrow("already running");
  release();
  const response = await first;
  expect(await dispatcher.request(raw)).toEqual(response);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("requires a new key after failure and preserves failed execution history", async () => {
  await actions.permissions.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Allow internal simulation",
  });
  const raw = {
    ...execution,
    input: { message: "Fail", simulate_failure: true },
    request_key: randomUUID(),
  };
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 422 });
  await expect(requests.request(raw)).rejects.toThrow(
    "Previous attempt failed",
  );
  await expect(
    requests.request({
      ...raw,
      request_key: randomUUID(),
      input: { message: "Retry" },
    }),
  ).resolves.toHaveProperty("result.simulated", true);
  expect((await repo.list("actions")).map((a) => a.status)).toEqual([
    "failed",
    "blocked",
    "succeeded",
  ]);
});

it("edits pending approvals as linked new requests and preserves original evidence and rejection", async () => {
  const raw = {
    ...execution,
    reason: "Original reason",
    request_key: randomUUID(),
  };
  const original = await pending(raw);
  const changed = {
    ...raw,
    input: { message: "Edited plan" },
    reason: "Correct the scope",
    request_key: randomUUID(),
  };
  await expect(requests.revise(original, changed)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  const old = await repo.get("actions", original);
  expect(
    (old?.metadata.request_envelope as Record<string, unknown>).reason,
  ).toBe("Original reason");
  expect(
    (await repo.list("action_approvals")).find((a) => a.action_id === original)
      ?.decision,
  ).toBe("rejected");
  const revised = (await repo.list("actions")).find(
    (a) => a.metadata.revision_of === original,
  )!;
  expect(revised.status).toBe("approval_required");
  await actions.permissions.review(revised.id, "approved", "Reviewed the edit");
  const response = await requests.request(changed);
  expect(response.result.summary).toContain("Edited plan");
  expect(await requests.request(changed)).toEqual(response);
});

it("runs all six named mocks without changing task/project state", async () => {
  await actions.permissions.savePolicy({
    level: 5,
    reason: "Allow simulations in this fixture",
  });
  const project = await repo.insert("entities", {
    name: "Fixture project",
    entity_type: "project",
    description: "",
    metadata: { status: "active" },
  });
  const task = await repo.insert("tasks", {
    title: "Original",
    description: "",
    entity_id: project.id,
    goal_id: null,
    status: "pending",
    priority: 1,
    due_at: null,
    metadata: {},
  });
  const fixtures = [
    ["mock.create_task", { title: "New", project_id: project.id }],
    ["mock.update_task", { task_id: task.id, status: "completed" }],
    [
      "mock.update_project_status",
      { project_id: project.id, status: "paused" },
    ],
    ["mock.draft_message", { recipient: "Example", message: "Draft only" }],
    ["mock.create_note", { title: "Note", content: "Example" }],
    ["mock.fetch_project_summary", { project_id: project.id }],
  ] as const;
  for (const [tool, input] of fixtures) {
    const response = await requests.request({
      tool,
      input,
      request_key: randomUUID(),
      reason: "Verify simulation",
    });
    expect(response.result.simulated).toBe(true);
    const action = await repo.get("actions", response.action_id);
    expect(action?.metadata.requesting_agent).toBe("authenticated_user");
    expect(action?.metadata.reason).toBe("Verify simulation");
  }
  expect(await repo.get("tasks", task.id)).toEqual(task);
  expect(await repo.get("entities", project.id)).toEqual(project);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(await repo.list("memories")).toEqual([]);
});

it("saves only explicitly reviewed episodic simulation records through memory permissions, idempotently", async () => {
  const { MemoryService } = await import("../src/services/memory-service");
  const { LocalEmbeddingProvider } =
    await import("../src/infrastructure/providers/local");
  const service = new ActionRequestService(
    repo,
    actions,
    undefined,
    new MemoryService(repo, new LocalEmbeddingProvider()),
  );
  const response = await service.request({
    tool: "mock.observe",
    input: {},
    request_key: randomUUID(),
  });
  expect(await repo.list("memories")).toEqual([]);
  const deny = await actions.permissions.savePolicy({
    tool: "memory.create",
    level: 0,
    reason: "No memory changes",
  });
  await expect(service.remember(response.action_id)).rejects.toMatchObject({
    status: 403,
  });
  expect(await repo.list("memories")).toEqual([]);
  await actions.permissions.savePolicy({
    tool: "memory.create",
    level: 5,
    parent_id: deny.id,
    reason: "Accept reviewed records",
  });
  const saved = await service.remember(response.action_id);
  expect(await service.remember(response.action_id)).toEqual(saved);
  expect(await repo.list("memories")).toHaveLength(1);
  const memory = await repo.get("memories", saved.memory_id);
  expect(memory).toMatchObject({
    memory_type: "episodic",
    metadata: { simulated: true, action_id: response.action_id },
  });
  expect(memory?.content).toContain("Simulation record only");
  expect(await repo.list("memory_sources")).toHaveLength(1);
});

it("fails closed before consuming approval when the production key migration is unavailable", async () => {
  const ready = vi.fn(async () => {
    const { AppError } = await import("../src/domain/validation");
    throw new AppError("Migration missing", 503);
  });
  Object.assign(repo, { ensureActionExecutionKeys: ready });
  await expect(
    requests.request({ ...execution, request_key: randomUUID() }),
  ).rejects.toMatchObject({ status: 503 });
  expect(await repo.list("action_approvals")).toEqual([]);
  expect((await repo.list("actions"))[0].status).toBe("failed");
});

it("returns complete, owner-scoped history with approval, outcome and evidence fields", async () => {
  const raw = {
    ...execution,
    request_key: randomUUID(),
    reason: "Audit this simulation",
  };
  const id = await pending(raw);
  await actions.permissions.review(id, "approved", "Reviewed evidence");
  const result = await requests.request(raw);
  const response = await handle(
    new Request("http://localhost/api/actions/history"),
    ["actions", "history"],
  );
  expect(response.status).toBe(200);
  const history = await response.json();
  expect(history.total).toBe(2);
  const completed = history.items.find(
    (item: { id: string }) => item.id === result.action_id,
  );
  expect(completed).toMatchObject({
    user_id: repo.userId,
    tool_name: "mock.execute",
    status: "succeeded",
    output: { result: result.result },
    metadata: {
      requesting_agent: "authenticated_user",
      reason: raw.reason,
      related_entity_ids: [],
      related_memory_ids: [],
    },
  });
  expect(completed.outcomes[0].status).toBe("success");
  expect(completed.approval.reason).toBe("Reviewed evidence");
  expect(completed.model_calls).toEqual([]);
  expect(
    history.items.find((item: { id: string }) => item.id === id).approval
      .reason,
  ).toBe("Reviewed evidence");
  const queue = await handle(
    new Request("http://localhost/api/actions/history?pending=true"),
    ["actions", "history"],
  );
  expect((await queue.json()).total).toBe(0);
});

it("derives restrictive project scope from linked evidence memories", async () => {
  const { MemoryService } = await import("../src/services/memory-service");
  const { LocalEmbeddingProvider } =
    await import("../src/infrastructure/providers/local");
  const memoryService = new MemoryService(repo, new LocalEmbeddingProvider());
  const entity = await repo.insert("entities", {
    entity_type: "project",
    name: "Restricted fixture",
    description: "",
    metadata: {},
  });
  const memory = await memoryService.createMemory({
    content: "Fixture source",
    metadata: {},
  });
  await memoryService.linkMemoryToEntity(memory.id, entity.id);
  await actions.permissions.savePolicy({
    tool: "mock.observe",
    product_entity_id: entity.id,
    level: 0,
    reason: "Restricted evidence scope",
  });
  await expect(
    requests.request({
      tool: "mock.observe",
      input: {},
      related_memory_ids: [memory.id],
    }),
  ).rejects.toMatchObject({ status: 403 });
  const attempt = (await repo.list("actions"))[0];
  expect(attempt.product_entity_ids).toEqual([entity.id]);
  expect(attempt.metadata.related_memory_ids).toEqual([memory.id]);
});

it("production omits simulated executors, denies forged mock requests and records the failure", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const registry = createActionToolRegistry(repo);
  const catalog = registry.describe();
  expect(catalog.some((t) => t.simulated || t.name.startsWith("mock."))).toBe(
    false,
  );
  expect(
    catalog.find((t) => t.name === "create_task")?.permission_requirements
      .minimum_level,
  ).toBe(4);
  const production = new ActionRequestService(repo, actions, registry);
  await expect(
    production.request({
      tool: "mock.observe",
      input: {},
      request_key: "production-mock-probe",
    }),
  ).rejects.toThrow("not available");
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "mock.observe" && a.status !== "succeeded",
    ),
  ).toBe(true);
  expect(await repo.list("tasks")).toHaveLength(0);
});
it("production permission catalog hides the development playground without hiding existing audit history", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const response = await handle(
    new Request("http://localhost/api/permissions"),
    ["permissions"],
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.development).toBe(false);
  expect(Object.keys(result.tools).some((n) => n.startsWith("mock."))).toBe(
    false,
  );
  expect(result).toHaveProperty("attempts");
});
