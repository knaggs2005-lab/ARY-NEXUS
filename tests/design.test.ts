import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import {
  DesignBridge,
  authorizeDesignBridge,
  validateDesignFiles,
} from "../src/infrastructure/design/bridge";
import {
  designArguments,
  designVerbs,
  validateDesignPlan,
  type DesignState,
  type DesignTool,
} from "../src/domain/design-tool";
import { PermissionService } from "../src/services/permission-service";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: DesignTool,
  bridge: DesignBridge,
  vault: EncryptedCalendarVault;
const state: DesignState = {
  adapter: "cinema4d",
  revision: "fixture-1",
  document_id: "doc-1",
  document_name: "Fixture",
  document_path: "/fixture.c4d",
  mm_per_unit: 10,
  complete: true,
  safe_scene: true,
  undo_token: null,
  export_formats: ["obj"],
  objects: [
    {
      id: "object-1",
      name: "Box",
      kind: "box",
      dimensions_mm: [50, 20, 10],
      selected: false,
      editable: true,
    },
  ],
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-design-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  provider = {
    assertAvailable: () => {},
    inspect: vi.fn(async () => state),
    execute: vi.fn(async (verb, input) => ({
      verb,
      operation_id: input.operation_id,
      object_id: "created-object",
    })),
  };
  requests = new ActionRequestService(
    repo,
    actions,
    createActionToolRegistry(
      repo,
      undefined,
      actions,
      undefined,
      undefined,
      undefined,
      provider,
    ),
  );
  vault = new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64));
  bridge = new DesignBridge(repo.userId, vault);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const input = () => ({
  operation_id: randomUUID(),
  expected_revision: state.revision,
  args: { kind: "box", name: "Bracket", dimensions_mm: [50, 20, 10] },
});
const request = () => ({
  tool: "design.create_object",
  input: input(),
  request_key: randomUUID(),
  reason: "Create reviewed box",
});
async function queued() {
  await vi.waitFor(async () =>
    expect(
      (await vault.read<unknown[]>(`design:${repo.userId}:jobs`))?.length,
    ).toBe(1),
  );
}
it("discovers every requested Design action in the existing registry", async () => {
  const catalog = await requests.catalog();
  for (const verb of designVerbs)
    expect(JSON.stringify(catalog)).toContain(`design.${verb}`);
});
it("inspects and plans without executing", async () => {
  const r = await requests.request({
    tool: "design.plan",
    input: {
      verb: "create_object",
      args: { kind: "box", name: "Bracket", dimensions_mm: [50, 20, 10] },
    },
    request_key: randomUUID(),
  });
  expect(JSON.stringify(r)).toContain("fixture-1");
  expect(provider.execute).not.toHaveBeenCalled();
});
it("planning cannot bypass revoked inspection permission", async () => {
  await actions.permissions.savePolicy({
    tool: "design.inspect",
    level: 0,
    reason: "Denied",
  });
  await expect(
    requests.request({
      tool: "design.plan",
      input: { verb: "preview", args: { mode: "viewport" } },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow();
  expect(provider.inspect).not.toHaveBeenCalled();
});
it("blocked action never reaches Design and retains audit", async () => {
  await actions.permissions.savePolicy({
    tool: "design.create_object",
    level: 0,
    reason: "Denied",
  });
  await expect(requests.request(request())).rejects.toThrow();
  expect(provider.execute).not.toHaveBeenCalled();
  expect((await repo.list("actions")).at(-1)?.status).toBe("blocked");
});
it("requires explicit approval even at autonomous permission level", async () => {
  await actions.permissions.savePolicy({
    tool: "design.create_object",
    level: 5,
    reason: "Test ceiling",
  });
  await expect(requests.request(request())).rejects.toThrow(
    "Approval required",
  );
  expect(provider.execute).not.toHaveBeenCalled();
});
it("rejected approval does not execute", async () => {
  const r = request();
  await requests.request(r).catch(() => {});
  const pending = (await repo.list("actions")).at(-1)!;
  await actions.permissions.review(pending.id, "rejected", "Do not edit");
  await expect(requests.request(r)).rejects.toThrow();
  expect(provider.execute).not.toHaveBeenCalled();
});
it("approved execution produces an outcome and idempotent replay", async () => {
  const r = request();
  await requests.request(r).catch(() => {});
  await actions.permissions.review(
    (await repo.list("actions")).at(-1)!.id,
    "approved",
    "Exact plan reviewed",
  );
  const result = await requests.request(r);
  await requests.request(r);
  expect(provider.execute).toHaveBeenCalledTimes(1);
  expect(
    (await repo.list("outcomes")).some((o) => o.action_id === result.action_id),
  ).toBe(true);
});
it("provider failures are recorded without success claims", async () => {
  vi.mocked(provider.execute).mockRejectedValue(Error("Design unavailable"));
  const r = request();
  await requests.request(r).catch(() => {});
  await actions.permissions.review(
    (await repo.list("actions")).at(-1)!.id,
    "approved",
    "Reviewed",
  );
  await expect(requests.request(r)).rejects.toThrow();
  expect((await repo.list("actions")).at(-1)?.status).toBe("failed");
});
it.each(["delete_object", "eval", "create_object; rm -rf /", "shutdown"])(
  "rejects unregistered verb %s",
  async (verb) => {
    await expect(
      requests.request({
        tool: `design.${verb}`,
        input: {},
        request_key: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(provider.execute).not.toHaveBeenCalled();
  },
);
it("rejects caller-supplied script fields and nonexistent object identifiers", () => {
  expect(
    designArguments.create_object.safeParse({
      name: "x",
      kind: "box",
      dimensions_mm: [50, 20, 10],
      script: "alert(1)",
    }).success,
  ).toBe(false);
  expect(() =>
    validateDesignPlan("select_object", { object_id: "not-found" }, state),
  ).toThrow();
});
it("rejects missing documents, unsafe scenes and incomplete inventories", () => {
  for (const patch of [
    { document_id: null },
    { safe_scene: false },
    { complete: false },
  ])
    expect(() =>
      validateDesignPlan(
        "preview",
        { mode: "viewport" },
        { ...state, ...patch },
      ),
    ).toThrow();
});
it("rejects stale state before queuing", async () => {
  await bridge.poll({ state });
  await expect(
    bridge.dispatch(
      "create_object",
      { ...input(), expected_revision: "old" },
      randomUUID(),
    ),
  ).rejects.toThrow("changed");
});
it("disconnected bridge fails closed", async () => {
  await expect(bridge.inspect()).rejects.toThrow("unavailable");
});
it("claim is delivered once and a stored result can recover without another command", async () => {
  await bridge.poll({ state });
  const i = input();
  const done = bridge.dispatch("create_object", i, randomUUID());
  await queued();
  expect((await bridge.poll({ state }))?.operation_id).toBe(i.operation_id);
  expect(await bridge.poll({ state })).toBeNull();
  const receipt = {
    ok: true,
    may_have_changed: true,
    error: null,
    result: { object_id: "new-object" },
  };
  await bridge.complete({ operation_id: i.operation_id, receipt });
  await expect(done).resolves.toMatchObject({ object_id: "new-object" });
  await expect(
    bridge.dispatch("create_object", i, randomUUID(), async () => {
      throw Error("must not revalidate completed export files");
    }),
  ).resolves.toMatchObject({ object_id: "new-object" });
  await bridge.complete({ operation_id: i.operation_id, receipt });
  await expect(
    bridge.complete({
      operation_id: i.operation_id,
      receipt: { ...receipt, result: { object_id: "different" } },
    }),
  ).rejects.toThrow("immutable");
});
it("uncertain partial failure blocks new operation IDs", async () => {
  await bridge.poll({ state });
  const i = input();
  const done = bridge.dispatch("create_object", i, randomUUID());
  const failure = expect(done).rejects.toThrow("may exist");
  await queued();
  await bridge.poll({ state });
  await bridge.complete({
    operation_id: i.operation_id,
    receipt: {
      ok: false,
      may_have_changed: true,
      error: "Interrupted",
      result: {},
    },
  });
  await failure;
  await expect(
    bridge.dispatch("create_object", input(), randomUUID()),
  ).rejects.toThrow("uncertain");
});
it("operation IDs cannot change meaning", async () => {
  await bridge.poll({ state });
  const i = input();
  const done = bridge.dispatch("create_object", i, randomUUID());
  await queued();
  await bridge.poll({ state });
  await bridge.complete({
    operation_id: i.operation_id,
    receipt: { ok: true, may_have_changed: true, error: null, result: {} },
  });
  await done;
  await expect(
    bridge.dispatch(
      "create_object",
      {
        ...i,
        args: { name: "Changed", kind: "box", dimensions_mm: [50, 20, 10] },
      },
      randomUUID(),
    ),
  ).rejects.toThrow("different");
});
it("file roots, symlink escapes, formats and overwrite are enforced", async () => {
  const allowed = join(dir, "allowed"),
    outside = join(dir, "outside");
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(join(allowed, "test.c4d"), "fixture");
  await writeFile(join(outside, "test.c4d"), "fixture");
  await symlink(join(outside, "test.c4d"), join(allowed, "escape.c4d"));
  vi.stubEnv("ARY_DESIGN_ALLOWED_ROOTS", JSON.stringify([allowed]));
  await expect(
    validateDesignFiles("open_document", { path: join(allowed, "test.c4d") }),
  ).resolves.toBeUndefined();
  await expect(
    validateDesignFiles("open_document", { path: join(allowed, "escape.c4d") }),
  ).rejects.toThrow("outside");
  await expect(
    validateDesignFiles("save", { path: join(allowed, "test.c4d") }),
  ).rejects.toThrow("exists");
  await expect(
    validateDesignFiles("export", {
      path: join(allowed, "new.step"),
      format: "step",
    }),
  ).rejects.toThrow();
  await expect(
    validateDesignFiles("save", { path: join(allowed, "new.c4d") }),
  ).resolves.toBeUndefined();
});
it("unsupported STEP, arbitrary properties and missing objects fail", () => {
  expect(() =>
    validateDesignPlan("export", { format: "step", path: "/test.step" }, state),
  ).toThrow("does not support");
  expect(() =>
    validateDesignPlan(
      "change_property",
      { object_id: "object-1", property: "python", rgb: [1, 0, 0] },
      state,
    ),
  ).toThrow();
  expect(() =>
    validateDesignPlan("select_object", { object_id: "missing" }, state),
  ).toThrow("missing");
  expect(() =>
    validateDesignPlan("undo", { undo_token: "old" }, state),
  ).toThrow("latest");
  expect(() =>
    validateDesignPlan(
      "create_object",
      { kind: "box", name: "x", dimensions_mm: [50, 20, 10] },
      { ...state, mm_per_unit: null },
    ),
  ).toThrow("unit conversion");
});
it("bridge rejects missing flag, wrong token and browser origin", () => {
  vi.stubEnv("ARY_DESIGN_ENABLED", "false");
  expect(() =>
    authorizeDesignBridge(
      new Request("http://127.0.0.1:3000/api/design/bridge/poll", {
        method: "POST",
      }),
    ),
  ).toThrow("disabled");
  vi.stubEnv("ARY_DESIGN_ENABLED", "true");
  vi.stubEnv("ARY_STORAGE", "supabase");
  vi.stubEnv("ARY_DESIGN_USER_ID", repo.userId);
  vi.stubEnv("ARY_DESIGN_BRIDGE_TOKEN", "a".repeat(64));
  vi.stubEnv("ARY_INTEGRATION_ENCRYPTION_KEY", "b".repeat(64));
  expect(() =>
    authorizeDesignBridge(
      new Request("http://127.0.0.1:3000/api/design/bridge/poll", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          authorization: "Bearer " + "a".repeat(64),
          origin: "http://127.0.0.1:3000",
        },
      }),
    ),
  ).toThrow();
});
