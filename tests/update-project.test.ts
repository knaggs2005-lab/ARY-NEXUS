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
import {
  projectSnapshot,
  projectStatuses,
  projectTaskRollup,
  type ProjectChanges,
} from "../src/domain/project-actions";
import type { Entity, Goal } from "../src/domain/models";
let directory: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  project: Entity,
  blocker: Entity,
  goal: Goal;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-project-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  actions = new ActionService(repo);
  requests = new ActionRequestService(repo, actions);
  project = await new EntityService(repo).createEntity({
    name: "Wag Trails",
    entity_type: "project",
    metadata: { custom: "preserved" },
  });
  blocker = await new EntityService(repo).createEntity({
    name: "Tracking bug",
    entity_type: "task",
  });
  goal = await repo.insert("goals", {
    title: "Reliable tracking",
    description: "",
    entity_id: null,
    status: "active",
    progress: 0,
    target_date: null,
    metadata: { custom: true },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
async function request(changes: ProjectChanges) {
  const current = (await repo.get("entities", project.id))!;
  return {
    tool: "update_project_status",
    input: {
      project_id: project.id,
      expected_updated_at: current.updated_at,
      before: projectSnapshot(
        current,
        await repo.list("relationships"),
        await repo.list("goals"),
      ),
      changes,
    },
    request_key: randomUUID(),
    reason: "Reviewed project changes",
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
    "Approve reviewed change",
  );
}
it("commits all fields, real graph links, task rollups, evidence and outcome through approval", async () => {
  const task = await repo.insert("tasks", {
    entity_id: project.id,
    goal_id: goal.id,
    title: "Fix",
    description: "",
    status: "completed",
    priority: 2,
    due_at: null,
    metadata: {},
  });
  const conversation = await repo.insert("conversations", {
    title: "Project review",
    metadata: {},
  });
  const message = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "user",
    content: "Mark Wag Trails blocked and link its tracking bug",
    metadata: {},
  });
  const raw = {
    ...(await request({
      status: "blocked",
      priority: 2,
      health: "at_risk",
      notes: "Tracking fix under review",
      blocker_entity_ids: [blocker.id],
      goal_ids: [goal.id],
    })),
    conversation_id: conversation.id,
    source_message_id: message.id,
  };
  await approve(raw);
  expect(await repo.get("entities", project.id)).toEqual(project);
  const result = await requests.request(raw);
  expect(result.result).toMatchObject({
    simulated: false,
    project_id: project.id,
    changed_fields: [
      "status",
      "priority",
      "health",
      "notes",
      "blocker_entity_ids",
      "goal_ids",
    ],
    task_rollup: { total: 1, completed: 1 },
  });
  expect(await repo.get("entities", project.id)).toMatchObject({
    name: "Wag Trails",
    entity_type: "project",
    metadata: {
      custom: "preserved",
      status: "blocked",
      priority: 2,
      health: "at_risk",
      project_notes: "Tracking fix under review",
      last_update_action_id: result.action_id,
      last_update_source_message_id: message.id,
    },
  });
  expect(await repo.get("tasks", task.id)).toEqual(task);
  expect(await repo.get("goals", goal.id)).toMatchObject({
    entity_id: project.id,
    metadata: { custom: true },
  });
  const graph = await repo.queryGraph({
    root: project.id,
    depth: 1,
    q: "",
    types: [],
    relationships: "current",
    limit: 80,
    edge_limit: 400,
  });
  expect(graph.nodes.find((n) => n.id === project.id)).toMatchObject({
    status: "blocked",
    activeBlockerCount: 1,
    relatedGoalCount: 1,
  });
  expect(
    await repo.list("outcomes", { action_id: result.action_id }),
  ).toMatchObject([{ status: "success" }]);
  expect(await repo.get("actions", result.action_id)).toMatchObject({
    status: "succeeded",
    metadata: { simulated: false, source_message_id: message.id },
  });
});
it.each(
  projectStatuses.flatMap((from) =>
    projectStatuses.map((to) => [from, to] as const),
  ),
)("supports %s → %s", async (from, to) => {
  await repo.update("entities", project.id, { metadata: { status: from } });
  const raw = await request({ status: to, notes: `${from} → ${to}` });
  await approve(raw);
  await requests.request(raw);
  expect((await repo.get("entities", project.id))?.metadata.status).toBe(to);
});
it("ends and reopens blockers without deleting relationship history or duplicating IDs", async () => {
  const add = await request({
    blocker_entity_ids: [blocker.id],
    goal_ids: [goal.id],
  });
  await approve(add);
  await requests.request(add);
  const original = (await repo.list("relationships"))[0];
  const remove = await request({ blocker_entity_ids: [], goal_ids: [] });
  await approve(remove);
  await requests.request(remove);
  expect((await repo.get("relationships", original.id))?.valid_to).toBeTruthy();
  expect((await repo.get("goals", goal.id))?.entity_id).toBeNull();
  const reopen = await request({ blocker_entity_ids: [blocker.id] });
  await approve(reopen);
  await requests.request(reopen);
  expect(await repo.list("relationships")).toMatchObject([
    { id: original.id, valid_to: null },
  ]);
  expect(
    (await repo.list("relationship_versions")).filter(
      (v) => v.record_id === original.id,
    ).length,
  ).toBeGreaterThanOrEqual(3);
});
it.each([0, 1, 2, 3])("blocks project writes at level %i", async (level) => {
  await actions.permissions.savePolicy({
    tool: "update_project_status",
    level,
    reason: "Restrict",
  });
  await expect(
    requests.request(await request({ status: "active" })),
  ).rejects.toMatchObject({ status: 403 });
  expect(await repo.get("entities", project.id)).toEqual(project);
});
it("honors rejection and linked product restrictions", async () => {
  const raw = await request({ status: "active" });
  await actions.permissions.review(await pending(raw), "rejected", "No");
  await expect(requests.request(raw)).rejects.toBeInstanceOf(
    ApprovalRequiredError,
  );
  await actions.permissions.savePolicy({
    tool: "update_project_status",
    product_entity_id: project.id,
    level: 0,
    reason: "Restricted project",
  });
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 403 });
  expect(await repo.get("entities", project.id)).toEqual(project);
});
it.each([
  { priority: 4 },
  { status: "deleted" },
  { health: "good" },
  { notes: "x".repeat(10001) },
  { goal_ids: ["bad"] },
  {},
])("rejects invalid input %j", async (changes) => {
  await expect(
    requests.request(await request(changes as ProjectChanges)),
  ).rejects.toMatchObject({ status: 400 });
  expect(await repo.get("entities", project.id)).toEqual(project);
});
it("rejects stale snapshots and forged before values", async () => {
  const raw = await request({ status: "completed" });
  await approve(raw);
  await repo.update("entities", project.id, { description: "Concurrent edit" });
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 409 });
  const forged = await request({ status: "completed" });
  forged.input.before.notes = "Invented";
  await approve(forged);
  await expect(requests.request(forged)).rejects.toMatchObject({ status: 409 });
});
it("rolls back project, goal, edge and success records on a late transaction failure", async () => {
  const raw = await request({
    status: "blocked",
    blocker_entity_ids: [blocker.id],
    goal_ids: [goal.id],
  });
  await approve(raw);
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementation((m) =>
    original(
      m.some((v) => v.table === "entities" && v.kind === "update")
        ? [
            ...m,
            {
              kind: "check",
              table: "entities",
              id: randomUUID(),
              expected_updated_at: "missing",
            },
          ]
        : m,
    ),
  );
  await expect(requests.request(raw)).rejects.toThrow();
  expect(await repo.get("entities", project.id)).toEqual(project);
  expect((await repo.get("goals", goal.id))?.entity_id).toBeNull();
  expect(await repo.list("relationships")).toHaveLength(0);
  const failed = (await repo.list("actions")).find(
    (a) => a.tool_name === "update_project_status" && a.status === "failed",
  )!;
  expect(await repo.list("outcomes", { action_id: failed.id })).toMatchObject([
    { status: "failure" },
  ]);
});
it("requires a fresh key/approval after transient failure and replays success without reapplying", async () => {
  const raw = await request({ status: "paused" });
  await approve(raw);
  const original = repo.batch.bind(repo);
  let fail = true;
  vi.spyOn(repo, "batch").mockImplementation(async (m) => {
    if (fail && m.some((v) => v.table === "entities" && v.kind === "update")) {
      fail = false;
      throw Error("Outage");
    }
    await original(m);
  });
  await expect(requests.request(raw)).rejects.toThrow("Outage");
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 409 });
  const retry = await request({ status: "paused" });
  await approve(retry);
  const result = await requests.request(retry);
  await repo.update("entities", project.id, { metadata: { status: "active" } });
  expect(await requests.request(retry)).toEqual(result);
  expect((await repo.get("entities", project.id))?.metadata.status).toBe(
    "active",
  );
});
it("prevents independently approved concurrent changes from overwriting one another", async () => {
  const a = await request({ status: "paused" }),
    b = await request({ status: "completed" });
  await approve(a);
  await approve(b);
  const results = await Promise.allSettled([
    requests.request(a),
    requests.request(b),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("rejects other tenants, company targets, self blockers and stealing goals", async () => {
  const foreign = new LocalRepository(
    randomUUID(),
    join(directory, "data.json"),
  );
  const privateEntity = await new EntityService(foreign).createEntity({
    name: "Private",
    entity_type: "project",
  });
  await expect(
    requests.request(await request({ blocker_entity_ids: [privateEntity.id] })),
  ).rejects.toMatchObject({ status: 404 });
  const self = await request({ blocker_entity_ids: [project.id] });
  await approve(self);
  await expect(requests.request(self)).rejects.toMatchObject({ status: 400 });
  await repo.update("goals", goal.id, { entity_id: blocker.id });
  await expect(
    requests.request(await request({ goal_ids: [goal.id] })),
  ).rejects.toMatchObject({ status: 409 });
  await repo.update("entities", project.id, { entity_type: "company" });
  const company = await request({ status: "active" });
  await approve(company);
  await expect(requests.request(company)).rejects.toMatchObject({
    status: 400,
  });
});
it("rejects missing keys/no-op and reports empty rollups without invented progress", async () => {
  expect(projectTaskRollup(project.id, [])).toEqual({
    total: 0,
    pending: 0,
    in_progress: 0,
    completed: 0,
    cancelled: 0,
  });
  await expect(
    requests.request({
      ...(await request({ status: "active" })),
      request_key: undefined,
    }),
  ).rejects.toMatchObject({ status: 400 });
  const raw = await request({ notes: "" });
  await approve(raw);
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 400 });
});

it("recovers a lost commit acknowledgement without duplicating links or outcomes", async () => {
  const raw = await request({
    status: "blocked",
    blocker_entity_ids: [blocker.id],
  });
  await approve(raw);
  const original = repo.batch.bind(repo);
  let lost = false;
  vi.spyOn(repo, "batch").mockImplementation(async (m) => {
    await original(m);
    if (!lost && m.some((v) => v.table === "entities" && v.kind === "update")) {
      lost = true;
      throw Error("Lost acknowledgement");
    }
  });
  await expect(requests.request(raw)).rejects.toThrow();
  const replay = await requests.request(raw);
  expect(replay.result.after).toMatchObject({ status: "blocked" });
  expect(await repo.list("relationships")).toHaveLength(1);
  expect(
    await repo.list("outcomes", { action_id: replay.action_id }),
  ).toMatchObject([{ status: "success" }]);
});
it("allows explicit autonomous internal policy and clears optional values", async () => {
  await actions.permissions.savePolicy({
    tool: "update_project_status",
    level: 5,
    reason: "Explicit internal authority",
  });
  await requests.request(
    await request({ priority: 3, notes: "Reviewed notes", health: "on_track" }),
  );
  await requests.request(
    await request({ priority: null, notes: "", health: "unknown" }),
  );
  expect((await repo.get("entities", project.id))?.metadata).toMatchObject({
    priority: null,
    project_notes: "",
    health: "unknown",
    custom: "preserved",
  });
});
it("detects goal edits after staging and rolls back every project mutation", async () => {
  const raw = await request({ status: "active", goal_ids: [goal.id] });
  await approve(raw);
  const original = repo.batch.bind(repo);
  let changed = false;
  vi.spyOn(repo, "batch").mockImplementation(async (m) => {
    if (
      !changed &&
      m.some((v) => v.table === "entities" && v.kind === "update")
    ) {
      changed = true;
      await repo.update("goals", goal.id, { title: "Concurrent goal edit" });
    }
    return original(m);
  });
  await expect(requests.request(raw)).rejects.toMatchObject({ status: 409 });
  expect(await repo.get("entities", project.id)).toEqual(project);
  expect((await repo.get("goals", goal.id))?.entity_id).toBeNull();
});
