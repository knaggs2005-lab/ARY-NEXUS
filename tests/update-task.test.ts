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
import { ActionRequestService } from "../src/services/action-request-service";
import { EntityService } from "../src/services/entity-service";
import { taskSnapshot, type TaskChanges } from "../src/domain/task-actions";
import type { Task, Entity } from "../src/domain/models";
let directory: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  task: Task,
  project: Entity;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-update-task-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  actions = new ActionService(repo);
  requests = new ActionRequestService(repo, actions);
  project = await new EntityService(repo).createEntity({
    name: "Wag Trails",
    entity_type: "project",
  });
  task = await repo.insert("tasks", {
    title: "Original",
    description: "Original description",
    status: "pending",
    priority: 1,
    due_at: null,
    entity_id: project.id,
    goal_id: null,
    metadata: {
      action_id: "creation-evidence",
      related_entity_ids: [project.id],
      custom: "preserve",
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
function request(changes: TaskChanges, current = task) {
  return {
    tool: "update_task",
    input: {
      task_id: current.id,
      expected_updated_at: current.updated_at,
      before: taskSnapshot(current),
      changes,
    },
    request_key: randomUUID(),
    reason: "Owner reviewed these task changes",
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
    "Approve exact change",
  );
}
const statuses = ["pending", "in_progress", "completed", "cancelled"] as const;
it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))(
  "supports reviewed status transition %s → %s",
  async (from, to) => {
    task = await repo.update("tasks", task.id, { status: from });
    const raw = request({ status: to, title: `Reviewed ${from} to ${to}` });
    await approve(raw);
    const result = await requests.request(raw);
    expect((await repo.get("tasks", task.id))?.status).toBe(to);
    expect(result.result).toMatchObject({
      before: { status: from },
      after: { status: to },
    });
    expect(
      await repo.list("outcomes", { action_id: result.action_id }),
    ).toMatchObject([{ status: "success" }]);
  },
);
it("updates every supported field and preserves creation metadata and ID", async () => {
  const next = await new EntityService(repo).createEntity({
    name: "Ary Nexus",
    entity_type: "project",
  });
  const person = await new EntityService(repo).createEntity({
    name: "Austin",
    entity_type: "person",
  });
  const raw = request({
    title: "New",
    description: "New description",
    priority: 3,
    status: "completed",
    due_date: "2026-09-10",
    project_id: next.id,
    related_entity_ids: [person.id],
  });
  await approve(raw);
  const result = await requests.request(raw);
  const saved = (await repo.get("tasks", task.id))!;
  expect(saved).toMatchObject({
    id: task.id,
    title: "New",
    description: "New description",
    priority: 3,
    status: "completed",
    due_at: "2026-09-10T23:59:59.000Z",
    entity_id: next.id,
    metadata: {
      action_id: "creation-evidence",
      custom: "preserve",
      last_update_action_id: result.action_id,
    },
  });
  expect(saved.metadata.related_entity_ids).toEqual(
    [next.id, person.id].sort(),
  );
  expect(result.result.changed_fields).toHaveLength(7);
  expect(await repo.list("tasks")).toHaveLength(1);
});
it("can clear due date, description, project and related entities", async () => {
  task = await repo.update("tasks", task.id, {
    due_at: "2026-09-10T23:59:59.000Z",
  });
  const raw = request({
    due_date: null,
    description: "",
    project_id: null,
    related_entity_ids: [],
  });
  await approve(raw);
  await requests.request(raw);
  expect(await repo.get("tasks", task.id)).toMatchObject({
    due_at: null,
    description: "",
    entity_id: null,
    metadata: { related_entity_ids: [] },
  });
});
it.each([0, 1, 2, 3])("denies writes at permission level %i", async (level) => {
  await actions.permissions.savePolicy({
    tool: "update_task",
    level,
    reason: "Restrict",
  });
  await expect(
    requests.request(request({ title: "Denied" })),
  ).rejects.toMatchObject({ status: 403 });
  expect(await repo.get("tasks", task.id)).toEqual(task);
});
it("rejects approval without changing the task", async () => {
  const raw = request({ priority: 3 });
  await actions.permissions.review(await pending(raw), "rejected", "Reject");
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  expect(await repo.get("tasks", task.id)).toEqual(task);
});
it("checks policy on both sides of project reassignment", async () => {
  const next = await new EntityService(repo).createEntity({
    name: "Protected",
    entity_type: "project",
  });
  await actions.permissions.savePolicy({
    tool: "update_task",
    product_entity_id: next.id,
    level: 0,
    reason: "Block destination",
  });
  await expect(
    requests.request(request({ project_id: next.id })),
  ).rejects.toMatchObject({ status: 403 });
  await actions.permissions.savePolicy({
    tool: "update_task",
    product_entity_id: project.id,
    level: 0,
    reason: "Block origin",
  });
  await expect(
    requests.request(request({ project_id: null })),
  ).rejects.toMatchObject({ status: 403 });
  expect(await repo.get("tasks", task.id)).toEqual(task);
});
it.each([
  { title: "" },
  { priority: 4 },
  { status: "deleted" },
  { due_date: "2026-02-30" },
  { unexpected: true },
  {},
])("rejects invalid input %j", async (changes) => {
  await expect(
    requests.request(request(changes as TaskChanges)),
  ).rejects.toMatchObject({ status: 400 });
  expect(await repo.get("tasks", task.id)).toEqual(task);
});
it("rejects stale or forged review snapshots and records failure", async () => {
  const raw = request({ title: "Overwrite" });
  await approve(raw);
  await repo.update("tasks", task.id, { title: "Concurrent edit" });
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 409 });
  expect((await repo.get("tasks", task.id))?.title).toBe("Concurrent edit");
  const forged = request(
    { title: "Another overwrite" },
    (await repo.get("tasks", task.id))!,
  );
  forged.input.before.description = "Fake review";
  await approve(forged);
  await expect(requests.request(forged)).rejects.toMatchObject({ status: 409 });
  expect(
    (await repo.list("actions")).filter(
      (a) => a.tool_name === "update_task" && a.status === "failed",
    ),
  ).toHaveLength(2);
});
it("rolls back a task update when the success transaction fails late", async () => {
  const raw = request({ title: "Rollback", status: "completed" });
  await approve(raw);
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation((mutations) =>
    original(
      mutations.some((m) => m.table === "tasks")
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
  expect(await repo.get("tasks", task.id)).toEqual(task);
  const failed = (await repo.list("actions")).find(
    (a) => a.tool_name === "update_task" && a.status === "failed",
  )!;
  expect(await repo.list("outcomes", { action_id: failed.id })).toMatchObject([
    { status: "failure" },
  ]);
});
it("retries transient failure with fresh approval and replays a success without reapplying it", async () => {
  const raw = request({ priority: 3 });
  await approve(raw);
  const original = repo.batch.bind(repo);
  let failed = false;
  vi.spyOn(repo, "batch").mockImplementation(async (m) => {
    if (!failed && m.some((v) => v.table === "tasks")) {
      failed = true;
      throw Error("Transient outage");
    }
    return original(m);
  });
  await expect(requests.request(raw)).rejects.toThrow("Transient outage");
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 409 });
  const retry = request({ priority: 3 });
  await approve(retry);
  const result = await requests.request(retry);
  await repo.update("tasks", task.id, { priority: 0 });
  expect(await requests.request(retry)).toEqual(result);
  expect((await repo.get("tasks", task.id))?.priority).toBe(0);
});
it("recovers a committed update after losing its acknowledgement", async () => {
  const raw = request({ description: "Committed once" });
  await approve(raw);
  const original = repo.batch.bind(repo);
  let lost = false;
  vi.spyOn(repo, "batch").mockImplementation(async (m) => {
    await original(m);
    if (!lost && m.some((v) => v.table === "tasks")) {
      lost = true;
      throw Error("Lost acknowledgement");
    }
  });
  await expect(requests.request(raw)).rejects.toThrow();
  const result = await requests.request(raw);
  expect(result.result.after).toMatchObject({ description: "Committed once" });
  expect((await repo.get("tasks", task.id))?.description).toBe(
    "Committed once",
  );
});
it("prevents two independently approved stale updates from overwriting each other", async () => {
  const first = request({ title: "Winner A" }),
    second = request({ title: "Winner B" });
  await approve(first);
  await approve(second);
  const settled = await Promise.allSettled([
    requests.request(first),
    requests.request(second),
  ]);
  expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("allows autonomous internal updates under an explicit level-5 policy", async () => {
  await actions.permissions.savePolicy({
    tool: "update_task",
    level: 5,
    reason: "Internal",
  });
  await requests.request(request({ priority: 0 }));
  expect((await repo.get("tasks", task.id))?.priority).toBe(0);
});
it("does not permit cross-user task or entity references", async () => {
  const foreign = new LocalRepository(
    randomUUID(),
    join(directory, "data.json"),
  );
  const entity = await new EntityService(foreign).createEntity({
    name: "Private",
    entity_type: "project",
  });
  await expect(
    requests.request(request({ project_id: entity.id })),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    new ActionRequestService(foreign, new ActionService(foreign)).request(
      request({ title: "Stolen" }),
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it.each([0, 1, 2, 3].flatMap((from) => [0, 1, 2, 3].map((to) => [from, to])))(
  "supports priority transition %i → %i",
  async (from, to) => {
    task = await repo.update("tasks", task.id, { priority: from });
    const raw = request({ priority: to, title: `Priority ${from} to ${to}` });
    await approve(raw);
    await requests.request(raw);
    expect((await repo.get("tasks", task.id))?.priority).toBe(to);
  },
);
it("keeps source provenance in the update audit without replacing creation evidence", async () => {
  const conversation = await repo.insert("conversations", {
    title: "Update discussion",
    metadata: {},
  });
  const source = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content: "Change the task title",
    metadata: {},
  });
  const raw = {
    ...request({ title: "Reviewed title" }),
    conversation_id: conversation.id,
    source_message_id: source.id,
  };
  await approve(raw);
  const result = await requests.request(raw);
  expect(await repo.get("tasks", task.id)).toMatchObject({
    metadata: {
      action_id: "creation-evidence",
      last_update_action_id: result.action_id,
      last_update_source_message_id: source.id,
      last_update_conversation_id: conversation.id,
    },
  });
  expect(await repo.get("actions", result.action_id)).toMatchObject({
    conversation_id: conversation.id,
    metadata: { source_message_id: source.id, simulated: false },
  });
});
it("rejects a missing execution key and a no-op without touching the task", async () => {
  await expect(
    requests.request({ ...request({ priority: 3 }), request_key: undefined }),
  ).rejects.toMatchObject({ status: 400 });
  const raw = request({ title: task.title });
  await approve(raw);
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 400 });
  expect(await repo.get("tasks", task.id)).toEqual(task);
});
