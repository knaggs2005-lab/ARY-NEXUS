import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  controlSchemas,
  controlAction,
  visualControlProposal,
} from "../src/domain/digital-control";
import {
  assertControlAccess,
  assertControlApp,
  assertControlUrl,
  controlOrigins,
  controlProcessEnv,
} from "../src/infrastructure/control/security";
import { ControlFiles } from "../src/infrastructure/control/files";
import {
  MacAccessibility,
  type NativeRunner,
} from "../src/infrastructure/control/mac-accessibility";
import { stopOwnerControl } from "../src/services/action-cancellation";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import {
  capabilityClasses,
  permissionClasses,
} from "../src/domain/permission-classes";
import { getToolDefinition } from "../src/domain/permissions";
let dir: string, owner: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-control-test-"));
  owner = randomUUID();
});
afterEach(async () => {
  await stopOwnerControl(owner);
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each([
  "com.app; touch /tmp/pwn",
  "$(whoami)",
  "/bin/sh",
  "com.app\nopen evil",
  "com.app`id`",
])("rejects injected app identifier %s", (value) => {
  expect(
    controlSchemas["computer.inspect"].safeParse({ app_id: value }).success,
  ).toBe(false);
});
it("rejects arbitrary scripts, selectors, keys and verbs", () => {
  const base = { snapshot_id: randomUUID(), element_id: "e1", verb: "click" };
  for (const extra of [
    { verb: "exec" },
    { script: "alert(1)" },
    { selector: "body" },
    { verb: "key", key: "Meta+Q" },
    { verb: "upload", file_id: "../secret.txt" },
  ])
    expect(controlAction.safeParse({ ...base, ...extra }).success).toBe(false);
});
it("requires explicit local flags and original desktop authority", () => {
  vi.stubEnv("ARY_DIGITAL_CONTROL_ENABLED", "false");
  expect(() => assertControlAccess(owner, false)).toThrow();
  vi.stubEnv("ARY_DESKTOP_BRIDGE_ENABLED", "true");
  vi.stubEnv("ARY_STORAGE", "supabase");
  vi.stubEnv("ARY_DESKTOP_USER_ID", owner);
  expect(() => assertControlAccess(owner, true)).toThrow(
    "Digital control is disabled",
  );
});
it("restricts origin, credentials, internal Ary pages and dangerous app families", () => {
  const origins = controlOrigins("https://example.com");
  expect(assertControlUrl("https://example.com/path", origins)).toContain(
    "/path",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://example.com.evil/path",
    "https://user:pass@example.com",
    "http://127.0.0.1:3000",
  ])
    expect(() => assertControlUrl(url, origins)).toThrow();
  for (const url of [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://example.com/path",
  ])
    expect(() => controlOrigins(url)).toThrow();
  for (const app of [
    "com.apple.Terminal",
    "com.google.Chrome",
    "com.apple.Safari",
    "com.apple.systempreferences",
    "com.clevaryn.ary-nexus",
  ])
    expect(() => assertControlApp(app, [app])).toThrow();
});
it("bounds transfer files, rejects traversal/symlinks, never overwrites", async () => {
  const files = new ControlFiles(dir);
  await files.write("note.txt", Buffer.from("approved"));
  await expect(
    files.write("note.txt", Buffer.from("overwrite")),
  ).rejects.toThrow();
  await writeFile(join(dir, "secret.sh"), "echo no");
  await symlink(join(dir, "note.txt"), join(dir, "linked.txt"));
  expect(await files.list()).toEqual([{ id: "note.txt", bytes: 8 }]);
  await expect(files.read("linked.txt")).rejects.toThrow();
  await expect(files.read("../note.txt")).rejects.toThrow();
  await expect(
    files.write("large.txt", Buffer.alloc(10 * 1024 * 1024 + 1)),
  ).rejects.toThrow("10 MB");
});
const app = "com.example.Fixture";
const window = {
  id: "w0",
  role: "AXWindow",
  label: "Fixture",
  value: "",
  actions: ["focus_window"],
  protected: false,
  bounds: { x: 0, y: 0, width: 100, height: 100 },
};
function native(elements = [window]) {
  const run = vi.fn<NativeRunner>(async (input) =>
    input.verb === "inspect"
      ? { pid: 123, title: "Fixture", elements }
      : input.verb === "capture"
        ? { image: png().toString("base64") }
        : { dispatched: true },
  );
  const vision = {
    propose: vi.fn(async () => ({
      x: 0.5,
      y: 0.4,
      confidence: 0.9,
      reason: "Visible test target",
    })),
  };
  const make = (id = owner) =>
    new MacAccessibility(
      id,
      () => {},
      [app],
      vision,
      run,
      async () => [
        { id: app, name: "Fixture", path: "/Applications/Fixture.app" },
      ],
    );
  return { run, vision, make };
}
function png() {
  const b = Buffer.alloc(64);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.write("IHDR", 12);
  b.writeUInt32BE(64, 16);
  b.writeUInt32BE(64, 20);
  return b;
}
it("pins inspected native identity and consumes it before dispatch", async () => {
  const { make, run } = native();
  const p = make(),
    s = await p.inspect(app),
    input = {
      snapshot_id: s.id,
      element_id: "w0",
      verb: "focus_window" as const,
    };
  await p.act(input);
  expect(run.mock.calls[1][0]).toMatchObject({
    verb: "act",
    pid: 123,
    expected: window,
    app_id: app,
  });
  await expect(p.act(input)).rejects.toThrow("already used");
  await expect(make(randomUUID()).act(input)).rejects.toThrow();
});
it("invalidates uncertain native attempts and stopped snapshots", async () => {
  const { make, run } = native();
  const p = make(),
    s = await p.inspect(app);
  run.mockRejectedValueOnce(Error("native timeout"));
  const input = {
    snapshot_id: s.id,
    element_id: "w0",
    verb: "focus_window" as const,
  };
  await expect(p.act(input)).rejects.toThrow("timeout");
  await expect(p.act(input)).rejects.toThrow("already used");
  const next = await p.inspect(app);
  await stopOwnerControl(owner);
  await expect(p.act({ ...input, snapshot_id: next.id })).rejects.toThrow();
});
it("never falls back visually while structural targets are available", async () => {
  const { make, vision } = native([
    window,
    { ...window, id: "w0.1", role: "AXButton", actions: ["click"] },
  ]);
  const p = make(),
    s = await p.inspect(app);
  await expect(p.propose(s.id, "w0", "Click button")).rejects.toThrow(
    "Structural controls",
  );
  expect(vision.propose).not.toHaveBeenCalled();
});
it("separates visual suggestion from execution and rejects altered points", async () => {
  const { make, run } = native();
  const p = make(),
    s = await p.inspect(app),
    proposal = await p.propose(s.id, "w0", "Select test target");
  expect(run.mock.calls.every(([i]) => i.verb !== "visual_click")).toBe(true);
  await expect(
    p.visualClick(proposal.proposal_id, { x: 0, y: 0 }),
  ).rejects.toThrow("changed");
  await p.visualClick(proposal.proposal_id, proposal.point);
  expect(run.mock.calls.at(-1)?.[0].verb).toBe("visual_click");
  await expect(
    p.visualClick(proposal.proposal_id, proposal.point),
  ).rejects.toThrow();
});
it("rejects changed pixels before visual dispatch", async () => {
  const { make, run } = native();
  const p = make(),
    s = await p.inspect(app),
    proposal = await p.propose(s.id, "w0", "Select test target");
  const changed = png();
  changed[60] = 1;
  run.mockResolvedValueOnce({ image: changed.toString("base64") });
  await expect(
    p.visualClick(proposal.proposal_id, proposal.point),
  ).rejects.toThrow("pixels changed");
  expect(run.mock.calls.every(([i]) => i.verb !== "visual_click")).toBe(true);
});
it("bounds model points and treats generic interactions as all permission classes", () => {
  expect(
    visualControlProposal.safeParse({
      x: 1.1,
      y: 0,
      reason: "bad",
      confidence: 1,
    }).success,
  ).toBe(false);
  for (const tool of ["browser.act", "computer.act", "computer.visual_click"]) {
    expect(capabilityClasses(tool, getToolDefinition(tool))).toEqual(
      permissionClasses,
    );
    expect(getToolDefinition(tool)?.alwaysRequiresApproval).toBe(true);
  }
});
it("uses exact approvals, durable replay, outcomes and browser events", async () => {
  const repo = new LocalRepository(owner, join(dir, "repo.json")),
    actions = new ActionService(repo),
    execute = vi.fn(async () => ({ dispatched: true }));
  const registry = new ToolRegistry().register("browser.act", {
    inputSchema: controlSchemas["browser.act"],
    execute,
  });
  const request = new ActionRequestService(repo, actions, registry),
    raw = {
      tool: "browser.act",
      input: { snapshot_id: randomUUID(), element_id: "e1", verb: "click" },
      reason: "Press fixture button",
      request_key: randomUUID(),
    };
  let id = "";
  try {
    await request.request(raw);
  } catch (e) {
    expect(e).toBeInstanceOf(ApprovalRequiredError);
    id = (e as ApprovalRequiredError).actionId;
  }
  expect(execute).not.toHaveBeenCalled();
  await actions.permissions.review(id, "approved", "Exact fixture");
  const result = await request.request(raw);
  expect((await request.request(raw)).action_id).toBe(result.action_id);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    (await repo.get("actions", result.action_id))?.metadata.simulated,
  ).toBe(false);
  expect(
    (await repo.list("outcomes")).some((o) => o.action_id === result.action_id),
  ).toBe(true);
  expect(
    (await repo.readEvents({ limit: 100 })).events.some(
      (e) => e.type === "browser.result",
    ),
  ).toBe(true);
});
it.each(["deny", "reject", "invalid"])(
  "never dispatches a %s control request",
  async (mode) => {
    const repo = new LocalRepository(owner, join(dir, "repo.json")),
      actions = new ActionService(repo),
      execute = vi.fn(async () => ({ dispatched: true }));
    const registry = new ToolRegistry().register("browser.act", {
      inputSchema: controlSchemas["browser.act"],
      execute,
    });
    const request = new ActionRequestService(repo, actions, registry);
    const raw = {
      tool: "browser.act",
      input: {
        snapshot_id: randomUUID(),
        element_id: "e1",
        verb: mode === "invalid" ? "exec" : "click",
      },
      reason: "Fixture",
      request_key: randomUUID(),
    };
    if (mode === "deny")
      await actions.permissions.savePolicy({
        permission_class: "COMMUNICATE",
        behavior: "deny",
        level: 0,
        reason: "Never communicate",
      });
    try {
      await request.request(raw);
    } catch (e) {
      if (mode === "reject") {
        await actions.permissions.review(
          (e as ApprovalRequiredError).actionId,
          "rejected",
          "Declined",
        );
        await expect(request.request(raw)).rejects.toThrow();
      }
    }
    expect(execute).not.toHaveBeenCalled();
  },
);

it("allows only one concurrent native dispatch from an inspection", async () => {
  const { make, run } = native();
  const p = make(),
    s = await p.inspect(app);
  const input = {
    snapshot_id: s.id,
    element_id: "w0",
    verb: "focus_window" as const,
  };
  const results = await Promise.allSettled([p.act(input), p.act(input)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(run.mock.calls.filter(([i]) => i.verb === "act")).toHaveLength(1);
});
it("allows only one concurrent visual dispatch from a proposal", async () => {
  const { make, run } = native();
  const p = make(),
    s = await p.inspect(app),
    proposal = await p.propose(s.id, "w0", "Select test target");
  const results = await Promise.allSettled([
    p.visualClick(proposal.proposal_id, proposal.point),
    p.visualClick(proposal.proposal_id, proposal.point),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    run.mock.calls.filter(([i]) => i.verb === "visual_click"),
  ).toHaveLength(1);
});

it("keeps API credentials out of controlled child process environments", () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture-secret");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-secret");
  expect(controlProcessEnv()).not.toHaveProperty("OPENAI_API_KEY");
  expect(JSON.stringify(controlProcessEnv())).not.toContain("fixture-secret");
});

it("preserves captured project scope when reviewing a visual click", async () => {
  const { make } = native();
  const p = make(),
    s = await p.inspect(app),
    project = randomUUID();
  const proposal = await p.propose(
    s.id,
    "w0",
    "Select test target",
    undefined,
    { productIds: [project], policyHash: "source-policy" },
  );
  await expect(
    p.visualClick(proposal.proposal_id, proposal.point),
  ).rejects.toThrow("source project scope");
  await expect(
    p.visualClick(proposal.proposal_id, proposal.point, undefined, [project]),
  ).resolves.toMatchObject({ dispatched: true });
});
