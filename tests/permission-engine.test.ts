import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { PermissionService, digest } from "../src/services/permission-service";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { actionCancellation } from "../src/services/action-cancellation";
import { agentExecution } from "../src/services/agent-context";
import {
  capabilityClasses,
  permissionClasses,
} from "../src/domain/permission-classes";
import { getToolDefinition, policyInput } from "../src/domain/permissions";
let dir: string,
  repo: LocalRepository,
  policies: PermissionService,
  actions: ActionService;
const scope = { workspace: "ary-nexus", productIds: [] };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-permissions-"));
  repo = new LocalRepository(randomUUID(), join(dir, "data.json"));
  policies = new PermissionService(repo);
  actions = new ActionService(repo);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
async function stop(active: boolean) {
  return policies.ownerAction(
    "permissions.emergency_stop",
    { active, reason: "Isolated owner test" },
    async () =>
      policies.setEmergencyStop(
        active,
        "Isolated owner test",
        (await policies.emergencyStatus()).revision,
      ),
  );
}
async function pending(tool = "mock.execute") {
  try {
    await actions.run(tool, null, async () => "unexpected");
    throw Error("Expected approval");
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    return (e as ApprovalRequiredError).actionId;
  }
}
it.each(permissionClasses)(
  "accepts %s as an additive class without inventing a capability",
  async (permission_class) => {
    await policies.savePolicy({
      permission_class,
      behavior: "deny",
      level: 5,
      reason: "Class boundary",
    });
    expect((await policies.resolve("unknown.tool", scope)).level).toBe(0);
  },
);
it("keeps legacy scope hashes, policy revisions and numeric semantics", async () => {
  const p = await policies.savePolicy({
    tool: "mock.execute",
    level: 4,
    reason: "Legacy",
  });
  expect(p.scope_key).toBe(digest(["mock.execute", null, null, null, null]));
  expect(p).not.toHaveProperty("permission_class");
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Revision",
    parent_id: p.id,
  });
  expect((await policies.resolve("mock.execute", scope)).allowed).toBe(true);
});
it("intersects class denial with always-allow tool rules", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 0,
    behavior: "always_allow",
    reason: "Allow",
  });
  await policies.savePolicy({
    permission_class: "EXECUTE",
    level: 5,
    behavior: "deny",
    reason: "Deny execution",
  });
  const operation = vi.fn();
  await expect(actions.run("mock.execute", null, operation)).rejects.toThrow(
    "not permitted",
  );
  expect(operation).not.toHaveBeenCalled();
  expect((await repo.list("actions"))[0].status).toBe("blocked");
});
it.each(["mock.observe", "mock.recommend", "mock.draft", "mock.execute"])(
  "ask every time uses one-use approvals for %s",
  async (tool) => {
    await policies.savePolicy({
      tool,
      behavior: "ask_every_time",
      level: 5,
      reason: "Ask",
    });
    const id = await pending(tool);
    await policies.ownerAction(
      "permissions.review",
      { action_id: id, reason: "Exact request" },
      () => policies.review(id, "approved", "Exact request"),
    );
    const operation = vi.fn(async () => "done");
    expect(await actions.run(tool, null, operation)).toBe("done");
    expect(operation).toHaveBeenCalledTimes(1);
    await pending(tool);
    expect((await repo.list("action_approvals"))[0].consumed_at).toBeTruthy();
  },
);
it.each(["gmail.send", "phone.initiate", "desktop.launch_app", "mcp.invoke"])(
  "always allow preserves mandatory %s approval",
  async (tool) => {
    await policies.savePolicy({
      tool,
      behavior: "always_allow",
      level: 5,
      reason: "Allow within ceiling",
    });
    const decision = await policies.resolve(tool, scope);
    expect(decision.allowed).toBe(false);
    expect(decision.approvalRequired).toBe(true);
  },
);
it("agent rules match server identity only and retain its ceiling", async () => {
  const conversation = await repo.insert("conversations", {
    title: "Agent fixture",
    metadata: {},
  });
  const agent = await repo.insert("messages", {
    conversation_id: conversation.id,
    role: "system",
    content: "Agent",
    metadata: { agent_version: "agent-v1", agent: { name: "Worker" } },
  });
  await policies.savePolicy({
    subject_agent_id: agent.id,
    tool: "mock.execute",
    behavior: "deny",
    level: 5,
    reason: "Worker denied",
  });
  expect((await policies.resolve("mock.execute", scope)).level).toBe(4);
  await agentExecution.run(
    {
      id: agent.id,
      userId: repo.userId,
      permissionLevel: 5,
      tools: ["mock.execute"],
      check: async () => {},
    },
    async () => {
      expect((await policies.resolve("mock.execute", scope)).level).toBe(0);
      await expect(
        policies.ownerAction("permissions.policy", {}, async () => true),
      ).rejects.toThrow("authenticated owner");
    },
  );
  await policies.savePolicy({
    tool: "mock.draft",
    behavior: "always_allow",
    level: 5,
    reason: "Draft grant",
  });
  await agentExecution.run(
    {
      id: agent.id,
      userId: repo.userId,
      permissionLevel: 1,
      tools: ["mock.draft"],
      check: async () => {},
    },
    async () =>
      expect((await policies.resolve("mock.draft", scope)).allowed).toBe(false),
  );
  await expect(
    policies.savePolicy({
      subject_agent_id: randomUUID(),
      level: 5,
      reason: "Invalid agent",
    }),
  ).rejects.toThrow("owned registered agent");
  expect(
    policyInput.safeParse({ agent_name: "Worker", level: 5, reason: "Spoof" })
      .success,
  ).toBe(false);
});
it("scopes class rules to an owned project", async () => {
  const p = await repo.insert("entities", {
    name: "Scope",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  await policies.savePolicy({
    permission_class: "READ",
    product_entity_id: p.id,
    behavior: "deny",
    level: 5,
    reason: "Project private",
  });
  expect((await policies.resolve("memory.read", scope)).allowed).toBe(true);
  expect(
    (await policies.resolve("memory.read", { ...scope, productIds: [p.id] }))
      .allowed,
  ).toBe(false);
});
it("denied and stale approvals never execute", async () => {
  const id = await pending();
  await policies.review(id, "rejected", "Declined");
  const operation = vi.fn();
  await expect(
    actions.run("mock.execute", null, operation),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  expect(operation).not.toHaveBeenCalled();
  const id2 = await pending();
  await policies.review(id2, "approved", "Approve exact request");
  await policies.savePolicy({
    tool: "mock.execute",
    behavior: "ask_every_time",
    level: 5,
    reason: "New policy",
  });
  await expect(
    actions.run("mock.execute", null, operation),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  expect(operation).not.toHaveBeenCalled();
});
it("emergency latch survives restart, keeps reads available and invalidates prior approvals after reset", async () => {
  const id = await pending();
  await policies.review(id, "approved", "Approve");
  await stop(true);
  const reopened = new PermissionService(
    new LocalRepository(repo.userId, join(dir, "data.json")),
  );
  expect((await reopened.emergencyStatus()).active).toBe(true);
  expect((await reopened.resolve("mock.execute", scope)).level).toBe(0);
  expect((await reopened.resolve("memory.read", scope)).allowed).toBe(true);
  expect((await reopened.resolve("phone.cancel", scope)).allowed).toBe(true);
  await stop(false);
  await expect(
    actions.run("mock.execute", null, async () => true),
  ).rejects.toBeInstanceOf(ApprovalRequiredError);
  const controls = (await repo.list("actions")).filter(
    (a) => a.tool_name === "permissions.emergency_stop",
  );
  expect(controls.map((a) => a.status)).toEqual(["succeeded", "succeeded"]);
  expect(
    (await repo.readEvents({ limit: 100 })).events.some((e) =>
      e.type.startsWith("permission."),
    ),
  ).toBe(true);
});
it("stale emergency reset fails, records failure, and leaves the stop on", async () => {
  await stop(true);
  await expect(
    policies.ownerAction("permissions.emergency_stop", { active: false }, () =>
      policies.setEmergencyStop(false, "Stale reset", null),
    ),
  ).rejects.toThrow("changed");
  expect((await policies.emergencyStatus()).active).toBe(true);
  expect((await repo.list("actions")).at(-1)?.status).toBe("failed");
});
it("cancels cooperative work and records its failure", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Internal fixture",
  });
  let entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const execution = actions.run(
    "mock.execute",
    null,
    () =>
      new Promise<void>((_, reject) => {
        actionCancellation
          .getStore()!
          .addEventListener("abort", () => reject(Error("Cancelled")), {
            once: true,
          });
        entered();
      }),
  );
  const check = expect(execution).rejects.toThrow("Cancelled");
  await ready;
  await stop(true);
  await check;
  expect(
    (await repo.list("actions")).find((a) => a.tool_name === "mock.execute")
      ?.status,
  ).toBe("failed");
  expect(
    (await repo.list("outcomes")).some((o) => o.status === "failure"),
  ).toBe(true);
});
it("rolls back staged internal writes when emergency stop occurs before commit", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Internal fixture",
  });
  await expect(
    actions.run(
      "mock.execute",
      null,
      async () => {
        await stop(true);
        return {};
      },
      {},
      {},
      {
        result: () => ({}),
        mutations: () => [
          {
            kind: "insert",
            table: "entities",
            data: {
              name: "Must not commit",
              entity_type: "project",
              description: "",
              metadata: {},
            },
          },
        ],
      },
    ),
  ).rejects.toThrow("Permissions changed");
  expect(await repo.list("entities")).toHaveLength(0);
});
it("records real completed external receipts even if cancellation arrived too late", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Fixture",
  });
  await actions.run(
    "mock.execute",
    null,
    async () => {
      await stop(true);
      return { receipt: "completed-before-stop" };
    },
    {},
    {},
    { result: (r) => r },
  );
  expect(
    (await repo.list("actions")).find((a) => a.tool_name === "mock.execute")
      ?.output,
  ).toEqual({ receipt: "completed-before-stop" });
  expect(
    (await repo.list("outcomes")).some(
      (o) => o.metadata.cancellation_requested === true,
    ),
  ).toBe(true);
});
it("records the approval explanation on the attempted action", async () => {
  const id = await pending();
  const action = await repo.get("actions", id);
  expect(action?.metadata.permission_explanation).toMatchObject({
    classes: ["EXECUTE", "WRITE"],
    risk: "unspecified",
  });
  expect(
    capabilityClasses("gmail.send", getToolDefinition("gmail.send")),
  ).toContain("COMMUNICATE");
  expect(
    capabilityClasses("finance.read", getToolDefinition("finance.read")),
  ).toContain("FINANCIAL");
});
it("opaque MCP calls cannot evade a class denial", async () => {
  await policies.savePolicy({
    permission_class: "DELETE",
    behavior: "deny",
    level: 0,
    reason: "No deletions",
  });
  expect((await policies.resolve("mcp.invoke", scope)).level).toBe(0);
  expect((await policies.resolve("mcp.invoke", scope)).approvalRequired).toBe(
    false,
  );
});
it("failure to read durable stop state fails closed and records the attempted action", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Fixture",
  });
  vi.spyOn(actions.permissions, "emergencyStatus").mockRejectedValueOnce(
    Error("Storage unavailable"),
  );
  const operation = vi.fn();
  await expect(actions.run("mock.execute", null, operation)).rejects.toThrow(
    "Storage unavailable",
  );
  expect(operation).not.toHaveBeenCalled();
  expect((await repo.list("actions"))[0].status).toBe("failed");
  expect((await repo.list("outcomes"))[0].status).toBe("failure");
});
it("rechecks changed permissions after validation and before dispatch", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Fixture",
  });
  const original = actions.permissions.emergencyStatus.bind(
    actions.permissions,
  );
  vi.spyOn(actions.permissions, "emergencyStatus").mockImplementationOnce(
    async () => {
      await policies.savePolicy({
        permission_class: "EXECUTE",
        behavior: "deny",
        level: 0,
        reason: "Concurrent freeze",
      });
      return original();
    },
  );
  const operation = vi.fn();
  await expect(actions.run("mock.execute", null, operation)).rejects.toThrow(
    "Permissions changed",
  );
  expect(operation).not.toHaveBeenCalled();
});
it("observes a persisted stop from another runtime within the polling interval", async () => {
  await policies.savePolicy({
    tool: "mock.execute",
    level: 5,
    reason: "Fixture",
  });
  let entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const execution = actions.run(
    "mock.execute",
    null,
    () =>
      new Promise<void>((_, reject) => {
        actionCancellation
          .getStore()!
          .addEventListener(
            "abort",
            () => reject(Error("Durable stop observed")),
            { once: true },
          );
        entered();
      }),
  );
  const check = expect(execution).rejects.toThrow("Durable stop observed");
  await ready;
  // Direct persistence simulates another process, without invoking the in-process controller map.
  await repo.insert("permission_policies", {
    scope_key: "nexus-emergency-stop-v1",
    parent_id: null,
    enabled: true,
    tool: null,
    action_type: null,
    workspace: null,
    product_entity_id: null,
    subject_user_id: null,
    level: 0,
    reason: "Stop from another runtime",
  });
  await check;
});
it("clearing emergency stop does not restart an activated mission after recovery", async () => {
  const { missionFixture } = await import("../scripts/lib/mission-fixture");
  const f = missionFixture(join(dir, "data.json"), repo.userId);
  const { planSpec } = await import("../src/domain/orchestration");
  const project = await repo.insert("entities", {
    name: "Isolated project",
    entity_type: "project",
    description: "",
    metadata: {},
  });
  const spec = planSpec.parse({
    title: "Paused objective",
    questions: [],
    steps: [
      {
        id: "task",
        title: "Create a task",
        tool: "create_task",
        input: { title: "Must await explicit resume", project_id: project.id },
        depends_on: [],
        critical: true,
        missing: [],
        source_action_from: null,
        verification: null,
      },
    ],
  });
  let plan = await f.engine.create("Isolated mission", spec);
  plan = await f.engine.control(plan.id, "plan", plan.revision);
  plan = await f.engine.tick(plan.id);
  plan = await f.engine.control(plan.id, "start", plan.revision);
  expect(plan.mission?.activated).toBe(true);
  await stop(true);
  await stop(false);
  const reopened = missionFixture(join(dir, "data.json"), repo.userId);
  const paused = await reopened.engine.tick(plan.id);
  expect(paused.mission?.state).toBe("PAUSED");
  expect(paused.mission?.activated).toBe(false);
  expect(await repo.list("tasks")).toHaveLength(0);
});
it.each(["PGRST204", "42703"])(
  "explains missing hosted migration (%s) without weakening legacy policies",
  async (code) => {
    const { SupabaseRepository } =
      await import("../src/infrastructure/repositories/supabase");
    const single = vi.fn(async () => ({
      data: null,
      error: { code, message: "permission_class column is missing" },
    }));
    const client = {
      from: () => ({ insert: () => ({ select: () => ({ single }) }) }),
    };
    const hosted = new SupabaseRepository(repo.userId, client as never);
    await expect(
      hosted.insert("permission_policies", {
        scope_key: "fixture",
        parent_id: null,
        enabled: true,
        tool: null,
        action_type: null,
        workspace: null,
        product_entity_id: null,
        subject_user_id: null,
        permission_class: "READ",
        behavior: "deny",
        level: 0,
        reason: "Fixture",
      }),
    ).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("migration 017"),
    });
  },
);
