import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { actionContext } from "../src/server/action-context";
import { ActionRequestService } from "../src/services/action-request-service";
import {
  AryBrainService,
  type BrainEvent,
} from "../src/services/ary-brain-service";
import { EntityService } from "../src/services/entity-service";
import { MemoryService } from "../src/services/memory-service";
import {
  LocalEmbeddingProvider,
  MockLanguageModel,
} from "../src/infrastructure/providers/local";
import type { Entity, Message, Json } from "../src/domain/models";
import { TaskConversationService } from "../src/services/task-conversation-service";

let directory: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  project: Entity,
  source: Message;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-real-task-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  actions = new ActionService(repo);
  requests = new ActionRequestService(repo, actions);
  project = await new EntityService(repo).createEntity({
    name: "Wag Trails",
    entity_type: "project",
  });
  const conversation = await repo.insert("conversations", {
    title: "Task test",
    metadata: {},
  });
  source = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content: "Finish the tracking fix",
    metadata: {},
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});
function request(key = randomUUID()) {
  return {
    tool: "create_task",
    input: {
      title: "Finish Live tracking fix",
      description: "Verify tracking recovery",
      priority: 2,
      due_date: "2026-09-08",
      project_id: project.id,
    },
    conversation_id: source.conversation_id,
    source_message_id: source.id,
    reason: source.content,
    related_entity_ids: [project.id],
    request_key: key,
  };
}
async function pending(raw: unknown) {
  try {
    await requests.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return (e as ApprovalRequiredError).actionId;
  }
  throw Error("Expected approval");
}
async function approve(raw: unknown) {
  return actions.permissions.review(
    await pending(raw),
    "approved",
    "Test owner approval",
  );
}

it("commits a real task with its approved action, outcome and source evidence", async () => {
  const memory = await new MemoryService(
    repo,
    new LocalEmbeddingProvider(),
  ).createMemory({ content: "Live tracking needs repair" });
  const raw = { ...request(), related_memory_ids: [memory.id] };
  const approval = await approve(raw);
  const result = await requests.request(raw);
  const task = await repo.get("tasks", String(result.result.task_id));
  expect(task).toMatchObject({
    user_id: repo.userId,
    title: raw.input.title,
    description: raw.input.description,
    priority: 2,
    status: "pending",
    entity_id: project.id,
    due_at: "2026-09-08T23:59:59.000Z",
    metadata: {
      workspace: "ary-nexus",
      action_id: result.action_id,
      requesting_user_id: repo.userId,
      requesting_agent: "authenticated_user",
      source_conversation_id: source.conversation_id,
      source_message_id: source.id,
      related_entity_ids: [project.id],
      related_memory_ids: [memory.id],
      reason: source.content,
    },
  });
  expect(task?.created_at).toBeTruthy();
  expect(task?.updated_at).toBeTruthy();
  expect(await repo.get("actions", result.action_id)).toMatchObject({
    status: "succeeded",
    metadata: { simulated: false, approval_id: approval.id },
    output: {
      completed: true,
      result: { task_id: task?.id, simulated: false },
    },
  });
  expect(
    await repo.list("outcomes", { action_id: result.action_id }),
  ).toMatchObject([{ status: "success" }]);
});
it("rejected approval creates no task", async () => {
  const raw = request();
  await actions.permissions.review(
    await pending(raw),
    "rejected",
    "Not wanted",
  );
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(await repo.list("tasks")).toEqual([]);
  expect((await repo.list("action_approvals"))[0].decision).toBe("rejected");
});
it.each([0, 1, 2, 3])("permission %i cannot write a task", async (level) => {
  await actions.permissions.savePolicy({
    tool: "create_task",
    level,
    reason: "Restrict task creation",
  });
  await expect(requests.request(request())).rejects.toMatchObject({
    status: 403,
  });
  expect(await repo.list("tasks")).toEqual([]);
  expect((await repo.list("actions")).at(-1)?.status).toBe("blocked");
});
it.each([
  { title: "" },
  { priority: 4 },
  { due_date: "2026-02-30" },
  { status: "unknown" },
])("invalid tool input is audited without a task: %j", async (invalid) => {
  const raw = request();
  raw.input = { ...raw.input, ...invalid } as typeof raw.input;
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 400 });
  expect(await repo.list("tasks")).toEqual([]);
  expect((await repo.list("actions")).at(-1)?.status).toBe("failed");
});
it("requires an execution key and validates the source conversation", async () => {
  await expect(
    requests.request({ ...request(), request_key: undefined }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    requests.request({ ...request(), conversation_id: null }),
  ).rejects.toMatchObject({ status: 400 });
  expect(await repo.list("tasks")).toEqual([]);
});
it("denies foreign project references", async () => {
  const foreignRepo = new LocalRepository(
    randomUUID(),
    join(directory, "data.json"),
  );
  const foreign = await new EntityService(foreignRepo).createEntity({
    name: "Private",
    entity_type: "project",
  });
  const raw = request();
  raw.input.project_id = foreign.id;
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 404 });
  expect(await repo.list("tasks")).toEqual([]);
});
it("replays duplicate execution without another task, including concurrent calls", async () => {
  const raw = request();
  await approve(raw);
  const calls = await Promise.allSettled([
    requests.request(raw),
    requests.request(raw),
  ]);
  expect(calls.some((r) => r.status === "fulfilled")).toBe(true);
  const first = (await repo.list("tasks"))[0];
  const replay = await requests.request(raw);
  expect(replay.result.task_id).toBe(first.id);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect((await repo.list("actions")).some((a) => a.metadata.replay_of)).toBe(
    true,
  );
});
it("rolls back a partial task insert when a later transaction mutation fails", async () => {
  const raw = request();
  await approve(raw);
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) =>
    original(
      mutations.some((m) => m.table === "tasks" && m.kind === "insert")
        ? [
            ...mutations,
            {
              kind: "check",
              table: "entities",
              id: randomUUID(),
              expected_updated_at: "missing",
            },
          ]
        : mutations,
    ),
  );
  await expect(requests.request(raw)).rejects.toThrow();
  expect(await repo.list("tasks")).toEqual([]);
  const failed = (await repo.list("actions")).find(
    (a) => a.status === "failed" && a.tool_name === "create_task",
  )!;
  expect(failed.error).toBeTruthy();
  expect(await repo.list("outcomes", { action_id: failed.id })).toMatchObject([
    { status: "failure" },
  ]);
});
it("requires a fresh key and approval after transient database failure, then creates once", async () => {
  const raw = request();
  await approve(raw);
  const original = repo.batch.bind(repo);
  let fail = true;
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
    if (fail && mutations.some((m) => m.table === "tasks")) {
      fail = false;
      throw Error("Transient database outage");
    }
    return original(mutations);
  });
  await expect(requests.request(raw)).rejects.toThrow(
    "Transient database outage",
  );
  expect(await repo.list("tasks")).toEqual([]);
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 409 });
  const retry = { ...raw, request_key: randomUUID() };
  await approve(retry);
  await requests.request(retry);
  expect(await repo.list("tasks")).toHaveLength(1);
});
it("recovers the committed task after a lost transaction acknowledgement", async () => {
  const raw = request();
  await approve(raw);
  const original = repo.batch.bind(repo);
  let lost = false;
  vi.spyOn(repo, "batch").mockImplementation(async (mutations) => {
    const result = await original(mutations);
    if (!lost && mutations.some((m) => m.table === "tasks")) {
      lost = true;
      throw Error("Lost commit acknowledgement");
    }
    return result;
  });
  await expect(requests.request(raw)).rejects.toThrow();
  const replay = await requests.request(raw);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(replay.result.task_id).toBe((await repo.list("tasks"))[0].id);
  expect((await repo.get("actions", replay.action_id))?.status).toBe(
    "succeeded",
  );
});
it("autonomous internal permission commits without an approval", async () => {
  await actions.permissions.savePolicy({
    tool: "create_task",
    level: 5,
    reason: "Internal task test",
  });
  await requests.request(request());
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(await repo.list("action_approvals")).toHaveLength(0);
});
it("runs the conversation → canonical project → approval → real task → grounded confirmation flow", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T01:00:00Z"));
  const brain = new AryBrainService(
    repo,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    new EntityService(repo),
    new MockLanguageModel(),
    actions,
  );
  async function turn(input: string, conversation_id?: string) {
    const events: BrainEvent[] = [];
    for await (const event of brain.respond({
      input,
      conversation_id,
      time_zone: "America/Denver",
    }))
      events.push(event);
    expect(events.some((e) => e.type === "error")).toBe(false);
    return events.find(
      (e): e is Extract<BrainEvent, { type: "response" }> =>
        e.type === "response",
    )!;
  }
  const proposal = await turn(
    "Ary, create a high priority task to finish the Wag Trails Live tracking bug fix tomorrow.",
  );
  const data = proposal.message.metadata.task_proposal as {
    action_id: string;
    request: Json;
  };
  expect(data.request.input).toMatchObject({
    project_id: project.id,
    priority: 2,
    due_date: "2026-09-08",
  });
  expect(await repo.list("tasks")).toHaveLength(0);
  expect(
    (await turn("What task did you just create?", proposal.conversation_id))
      .message.content,
  ).toContain("not created");
  await actions.permissions.review(
    data.action_id,
    "approved",
    "Owner approves",
  );
  const result = await requests.request(data.request);
  // Reading the record, not echoing the proposal: a later authorized edit is reflected.
  await repo.update("tasks", String(result.result.task_id), {
    title: "Verified tracking fix task",
  });
  const confirmation = await turn(
    "What task did you just create?",
    proposal.conversation_id,
  );
  expect(confirmation.message.content).toContain("Verified tracking fix task");
  expect(confirmation.message.content).toContain(String(result.result.task_id));
  expect(confirmation.message.metadata.provider_id).toBe("internal");
  expect((await repo.list("extraction_jobs")).length).toBe(3);
});

it("uses the same connected-product approval scope from Chat and HTTP dispatch", async () => {
  const entities = new EntityService(repo);
  const hub = await entities.createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  await entities.linkEntities({
    source_entity_id: hub.id,
    target_entity_id: project.id,
    relationship_type: "tracks",
  });
  const raw = { ...request(), product_entity_id: project.id };
  const grant = await approve(raw);
  const http = new Request("http://localhost/api/actions/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
  });
  const fromHttp = new ActionRequestService(
    repo,
    new ActionService(repo, await actionContext(http, repo)),
  );
  const result = await fromHttp.request(raw);
  expect(
    (await repo.get("actions", result.action_id))?.metadata.approval_id,
  ).toBe(grant.id);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(await repo.list("action_approvals")).toHaveLength(1);
});

it("only saves a real-action memory after explicit review", async () => {
  const memories = new MemoryService(repo, new LocalEmbeddingProvider());
  const reviewed = new ActionRequestService(repo, actions, undefined, memories);
  const raw = request();
  await approve(raw);
  const result = await reviewed.request(raw);
  expect(await repo.list("memories")).toHaveLength(0);
  const saved = await reviewed.remember(result.action_id);
  const memory = await repo.get("memories", saved.memory_id);
  expect(memory?.content).toContain(String(result.result.task_id));
  expect(memory?.content).not.toContain("Simulated");
  expect(memory?.metadata).toMatchObject({
    simulated: false,
    action_id: result.action_id,
  });
  expect((await reviewed.remember(result.action_id)).memory_id).toBe(
    saved.memory_id,
  );
  expect(await repo.list("memories")).toHaveLength(1);
});

it.each([
  "Create a task for me to review Wag Trails Live tomorrow.",
  "Ary, could you please create a task to review Wag Trails Live tomorrow.",
  "Can you add a task to review Wag Trails Live tomorrow?",
  "Please create a task to review Wag Trails Live tomorrow.",
])("routes a natural task request to existing approval: %s", async (text) => {
  const message = await repo.update("messages", source.id, {
    content: text,
    metadata: { modality: "voice" },
  });
  const reply = await new TaskConversationService(repo, actions).handle(
    text,
    message,
    [project],
    false,
  );
  const proposal = reply?.metadata.task_proposal as { request: Json };
  expect(proposal.request.input).toMatchObject({
    title: "review Wag Trails Live",
    project_id: project.id,
  });
  expect(proposal.request.reason).toBe(text);
  expect(await repo.list("tasks")).toHaveLength(0);
  expect((await repo.list("actions")).at(-1)?.status).toBe("approval_required");
});

it.each([
  "I create a task for Wag Trails every morning.",
  "Do not create a task to review Wag Trails Live tomorrow.",
  "She said create a task to review Wag Trails Live tomorrow.",
])(
  "does not execute narrative, negative or quoted intent: %s",
  async (text) => {
    const reply = await new TaskConversationService(repo, actions).handle(
      text,
      source,
      [project],
      false,
    );
    expect(reply).toBeNull();
    expect(await repo.list("tasks")).toEqual([]);
    expect(await repo.list("actions")).toEqual([]);
  },
);

it("clarifies a misheard voice request, then uses canonical resolution, approval and real task recall", async () => {
  const model = new MockLanguageModel();
  const brain = new AryBrainService(
    repo,
    new MemoryService(repo, new LocalEmbeddingProvider()),
    new EntityService(repo),
    model,
    actions,
  );
  async function turn(input: string) {
    const events: BrainEvent[] = [];
    for await (const event of brain.respond({
      input,
      conversation_id: source.conversation_id,
      modality: "voice",
      time_zone: "America/Los_Angeles",
    }))
      events.push(event);
    expect(events.some((event) => event.type === "error")).toBe(false);
    return events.find(
      (event): event is Extract<BrainEvent, { type: "response" }> =>
        event.type === "response",
    )!.message;
  }
  const misheard = "I create a task for me to review Wagtrails live tomorrow.";
  const clarification = await turn(misheard);
  expect(clarification.metadata).toMatchObject({
    provider_id: "internal",
    task_clarification: "unclear_voice_request",
  });
  expect(clarification.content).toContain("I can help create tasks");
  expect(
    (await repo.list("messages")).some((m) => m.content === misheard),
  ).toBe(true);
  const unknownProject = await turn(
    "Create a task for me to review Wagtrails Live tomorrow.",
  );
  expect(unknownProject.metadata.task_clarification).toBe("project_required");
  expect(await repo.list("actions", { tool_name: "create_task" })).toEqual([]);
  expect(await repo.list("tasks")).toEqual([]);

  const proposal = await turn(
    "Ary, create a task for me to review Wag Trails Live tomorrow.",
  );
  const data = proposal.metadata.task_proposal as {
    action_id: string;
    request: Json;
  };
  expect(data.request.input).toMatchObject({
    title: "review Wag Trails Live",
    project_id: project.id,
  });
  expect(await repo.list("tasks")).toEqual([]);
  await actions.permissions.review(
    data.action_id,
    "approved",
    "Reviewed exact voice task",
  );
  const result = await requests.request(data.request);
  expect(await repo.list("tasks")).toHaveLength(1);
  expect(
    await repo.list("outcomes", { action_id: result.action_id }),
  ).toMatchObject([{ status: "success" }]);
  const confirmation = await turn("What task did you just create?");
  expect(confirmation.content).toContain(String(result.result.task_id));
  expect(confirmation.content).toContain("review Wag Trails Live");
  expect(confirmation.metadata.provider_id).toBe("internal");
});
