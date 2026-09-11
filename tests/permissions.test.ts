import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { PermissionService } from "../src/services/permission-service";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { toolRegistry } from "../src/domain/permissions";
let directory: string,
  repo: LocalRepository,
  permissions: PermissionService,
  actions: ActionService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-permission-"));
  repo = new LocalRepository(randomUUID(), join(directory, "data.json"));
  permissions = new PermissionService(repo);
  actions = new ActionService(repo);
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});
const scope = { workspace: "ary-nexus", productIds: [] };
it("never grants an unknown tool, including financial and email execution", async () => {
  await permissions.savePolicy({ level: 5, reason: "Broad permission" });
  let called = false;
  for (const tool of [
    "email.send",
    "finance.trade",
    "unknown",
    "constructor",
    "toString",
    "__proto__",
  ]) {
    await expect(
      actions.run(tool, null, async () => {
        called = true;
      }),
    ).rejects.toThrow("not permitted");
  }
  expect(called).toBe(false);
  expect(
    (await repo.list("actions")).every(
      (a) => a.permission_level === 0 && a.status === "blocked",
    ),
  ).toBe(true);
});
it("does not allow inherited object properties to receive permission policies", async () => {
  for (const tool of ["constructor", "toString", "__proto__"])
    await expect(
      permissions.savePolicy({ tool, level: 5, reason: "Invalid capability" }),
    ).rejects.toThrow("Only registered tools");
});
it.each([0, 1, 2, 3, 4, 5])(
  "enforces all capability modes at level %i",
  async (level) => {
    await permissions.savePolicy({ level, reason: "Test level" });
    expect((await permissions.resolve("memory.read", scope)).allowed).toBe(
      level >= 1,
    );
    expect((await permissions.resolve("brain.respond", scope)).allowed).toBe(
      level >= 2,
    );
    expect((await permissions.resolve("reflection.run", scope)).allowed).toBe(
      level >= 3,
    );
    const execution = await permissions.resolve("memory.create", scope);
    expect(execution.allowed).toBe(level === 5);
    expect(execution.approvalRequired).toBe(level === 4);
  },
);
it("intersects tool, action type, workspace, product and user; restrictive policies win", async () => {
  const project = await repo.insert("entities", {
    name: "Ary Nexus",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  await permissions.savePolicy({
    tool: "memory.create",
    level: 5,
    reason: "Allow tool",
  });
  const cap = await permissions.savePolicy({
    action_type: "create",
    workspace: "ary-nexus",
    product_entity_id: project.id,
    subject_user_id: repo.userId,
    level: 0,
    reason: "Project freeze",
  });
  expect((await permissions.resolve("memory.create", scope)).level).toBe(5);
  const decision = await permissions.resolve("memory.create", {
    ...scope,
    productIds: [project.id],
  });
  expect(decision.level).toBe(0);
  expect(decision.matchedPolicyIds).toContain(cap.id);
  expect(
    (
      await permissions.resolve("memory.update", {
        ...scope,
        productIds: [project.id],
      })
    ).allowed,
  ).toBe(true);
});
it("keeps policy revisions immutable and rejects stale/concurrent edits", async () => {
  const first = await permissions.savePolicy({
    tool: "memory.create",
    level: 2,
    reason: "Initial",
  });
  const next = await permissions.savePolicy({
    tool: "memory.create",
    level: 4,
    reason: "Reviewed",
    parent_id: first.id,
  });
  expect((await permissions.currentPolicies()).map((p) => p.id)).toEqual([
    next.id,
  ]);
  expect(await repo.list("permission_policies")).toHaveLength(2);
  await expect(
    permissions.savePolicy({
      tool: "memory.create",
      level: 5,
      reason: "Stale",
      parent_id: first.id,
    }),
  ).rejects.toThrow("changed");
  await expect(
    repo.update("permission_policies", first.id, { level: 5 }),
  ).rejects.toThrow("immutable");
});
async function pending(input = { target: "fixture" }) {
  try {
    await actions.run("memory.create", null, async () => "never", input);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return (e as ApprovalRequiredError).actionId;
  }
  throw new Error("Not gated");
}
it("requires review of the exact action and consumes approval only once under concurrent retries", async () => {
  await permissions.savePolicy({
    tool: "memory.create",
    level: 4,
    reason: "Ask first",
  });
  const id = await pending();
  await permissions.review(id, "approved", "Approve fixture");
  let calls = 0;
  const results = await Promise.allSettled([
    actions.run(
      "memory.create",
      null,
      async () => {
        calls++;
        return 1;
      },
      { target: "fixture" },
    ),
    actions.run(
      "memory.create",
      null,
      async () => {
        calls++;
        return 1;
      },
      { target: "fixture" },
    ),
  ]);
  expect(calls).toBe(1);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await repo.list("action_approvals"))[0].consumed_at).toBeTruthy();
  const logs = await repo.list("actions");
  expect(
    logs.some((a) => a.status === "succeeded" && a.approval_required),
  ).toBe(true);
  expect(
    logs.every((a) => a.created_at && a.input && a.metadata.permission_reason),
  ).toBe(true);
});
it("rejects changed inputs, rejected decisions, expired grants and policy changes", async () => {
  const policy = await permissions.savePolicy({
    tool: "memory.create",
    level: 4,
    reason: "Ask",
  });
  const id = await pending();
  const grant = await permissions.review(id, "approved", "Exact only");
  await expect(
    actions.run("memory.create", null, async () => 1, { target: "changed" }),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  await permissions.savePolicy({
    tool: "memory.create",
    level: 4,
    reason: "New policy revision",
    parent_id: policy.id,
  });
  await expect(
    actions.run("memory.create", null, async () => 1, { target: "fixture" }),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  expect(
    await repo.consumeApproval(grant.id, "incorrect", grant.policy_hash),
  ).toBe(false);
  const rejected = await pending({ target: "rejected" });
  await permissions.review(rejected, "rejected", "No");
  await expect(
    actions.run("memory.create", null, async () => 1, { target: "rejected" }),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
});
it("isolates policies, product references, attempts and approvals by user", async () => {
  const other = new LocalRepository(randomUUID(), join(directory, "data.json"));
  const otherPermissions = new PermissionService(other);
  const product = await other.insert("entities", {
    name: "Private company",
    entity_type: "company",
    description: "",
    metadata: {},
  });
  await expect(
    permissions.savePolicy({
      level: 0,
      reason: "Foreign",
      subject_user_id: other.userId,
    }),
  ).rejects.toThrow("own account");
  await expect(
    permissions.savePolicy({
      level: 0,
      reason: "Foreign",
      product_entity_id: product.id,
    }),
  ).rejects.toThrow("not found");
  await permissions.savePolicy({ level: 4, reason: "Ask" });
  const id = await pending();
  await expect(
    otherPermissions.review(id, "approved", "Wrong owner"),
  ).rejects.toThrow("not found");
  expect(await otherPermissions.currentPolicies()).toEqual([]);
});
it("logs execution failures and prevents later rewriting the attempt", async () => {
  await expect(
    actions.run(
      "memory.create",
      null,
      async () => {
        throw new Error("private failure detail");
      },
      { target: "x" },
    ),
  ).rejects.toThrow();
  const [attempt] = await repo.list("actions");
  expect(attempt.status).toBe("failed");
  expect(attempt.error).not.toContain("private failure");
  expect(attempt.input).toMatchObject({ target: "x" });
  await expect(
    repo.update("actions", attempt.id, { status: "succeeded" }),
  ).rejects.toThrow("immutable");
});
it("owner recovery remains available under a no-access policy and is audited", async () => {
  const policy = await permissions.savePolicy({
    level: 0,
    reason: "Pause Ary",
  });
  await permissions.ownerAction(
    "permissions.policy",
    { parent_id: policy.id },
    () =>
      permissions.savePolicy({
        level: 0,
        reason: "Resume",
        parent_id: policy.id,
        enabled: false,
      }),
  );
  expect((await permissions.resolve("memory.create", scope)).allowed).toBe(
    true,
  );
  expect((await repo.list("actions"))[0].tool_name).toBe("permissions.policy");
  expect(toolRegistry).not.toHaveProperty("permissions.policy");
});

it("expires unused approvals after ten minutes", async () => {
  await permissions.savePolicy({
    tool: "memory.create",
    level: 4,
    reason: "Ask",
  });
  const id = await pending();
  const approval = await permissions.review(id, "approved", "Temporary");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 11 * 60 * 1000);
  expect(
    await repo.consumeApproval(
      approval.id,
      approval.fingerprint,
      approval.policy_hash,
    ),
  ).toBe(false);
});
