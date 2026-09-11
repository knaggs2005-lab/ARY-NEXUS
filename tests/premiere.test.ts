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
  PremiereBridge,
  authorizePremiereBridge,
  validatePremiereFiles,
} from "../src/infrastructure/premiere/bridge";
import {
  premiereArguments,
  premiereVerbs,
  validatePremierePlan,
  type PremiereState,
  type PremiereProvider,
} from "../src/domain/premiere";
import { PermissionService } from "../src/services/permission-service";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: PremiereProvider,
  bridge: PremiereBridge,
  vault: EncryptedCalendarVault;
const state: PremiereState = {
  revision: "fixture-1",
  project_id: "project-1",
  project_name: "Fixture",
  project_path: "/fixture.prproj",
  sequence_id: "sequence-1",
  sequences: [{ id: "sequence-1", name: "Interview" }],
  items: [
    { id: "root", name: "Root", parent_id: null, kind: "bin" },
    { id: "media-1", name: "Interview", parent_id: "root", kind: "media" },
  ],
  clips: [{ id: "video:0:0", name: "Interview", start: "0", end: "100" }],
  complete: true,
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-premiere-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  provider = {
    assertAvailable: () => {},
    inspect: vi.fn(async () => state),
    execute: vi.fn(async (verb, input) => ({
      verb,
      operation_id: input.operation_id,
      sequence_id: "created-sequence",
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
      provider,
    ),
  );
  vault = new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64));
  bridge = new PremiereBridge(repo.userId, vault);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
const input = () => ({
  operation_id: randomUUID(),
  expected_revision: state.revision,
  args: { parent_id: "root", name: "Selects" },
});
const request = () => ({
  tool: "premiere.create_bin",
  input: input(),
  request_key: randomUUID(),
  reason: "Create reviewed bin",
});
async function queued() {
  await vi.waitFor(async () =>
    expect(
      (await vault.read<unknown[]>(`premiere:${repo.userId}:jobs`))?.length,
    ).toBe(1),
  );
}
it("discovers every requested Premiere action in the existing registry", async () => {
  const catalog = await requests.catalog();
  for (const verb of premiereVerbs)
    expect(JSON.stringify(catalog)).toContain(`premiere.${verb}`);
});
it("inspects and plans without executing", async () => {
  const r = await requests.request({
    tool: "premiere.plan",
    input: { verb: "create_bin", args: { name: "Selects", parent_id: "root" } },
    request_key: randomUUID(),
  });
  expect(JSON.stringify(r)).toContain("fixture-1");
  expect(provider.execute).not.toHaveBeenCalled();
});
it("planning cannot bypass revoked inspection permission", async () => {
  await actions.permissions.savePolicy({
    tool: "premiere.inspect",
    level: 0,
    reason: "Denied",
  });
  await expect(
    requests.request({
      tool: "premiere.plan",
      input: { verb: "save_project", args: {} },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow();
  expect(provider.inspect).not.toHaveBeenCalled();
});
it("blocked action never reaches Premiere and retains audit", async () => {
  await actions.permissions.savePolicy({
    tool: "premiere.create_bin",
    level: 0,
    reason: "Denied",
  });
  await expect(requests.request(request())).rejects.toThrow();
  expect(provider.execute).not.toHaveBeenCalled();
  expect((await repo.list("actions")).at(-1)?.status).toBe("blocked");
});
it("requires explicit approval even at autonomous permission level", async () => {
  await actions.permissions.savePolicy({
    tool: "premiere.create_bin",
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
  vi.mocked(provider.execute).mockRejectedValue(Error("Premiere unavailable"));
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
it.each(["delete_sequence", "eval", "create_bin; rm -rf /", "shutdown"])(
  "rejects unregistered verb %s",
  async (verb) => {
    await expect(
      requests.request({
        tool: `premiere.${verb}`,
        input: {},
        request_key: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(provider.execute).not.toHaveBeenCalled();
  },
);
it("rejects caller-supplied script fields and nonexistent clip identifiers", () => {
  expect(
    premiereArguments.create_bin.safeParse({
      name: "x",
      parent_id: "root",
      script: "alert(1)",
    }).success,
  ).toBe(false);
  expect(() =>
    validatePremierePlan("select_clips", { clip_ids: ["not-found"] }, state),
  ).toThrow();
});
it("rejects missing projects, sequences and incomplete inventories", () => {
  expect(() =>
    validatePremierePlan("save_project", {}, { ...state, project_id: null }),
  ).toThrow();
  expect(() =>
    validatePremierePlan(
      "create_markers",
      { markers: [{ name: "x", seconds: 0 }] },
      { ...state, sequence_id: null },
    ),
  ).toThrow();
  expect(() =>
    validatePremierePlan("save_project", {}, { ...state, complete: false }),
  ).toThrow();
});
it("rejects stale state before queuing", async () => {
  await bridge.poll({ state });
  await expect(
    bridge.dispatch(
      "create_bin",
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
  const done = bridge.dispatch("create_bin", i, randomUUID());
  await queued();
  expect((await bridge.poll({ state }))?.operation_id).toBe(i.operation_id);
  expect(await bridge.poll({ state })).toBeNull();
  const receipt = {
    ok: true,
    may_have_changed: true,
    error: null,
    result: { bin_id: "new-bin" },
  };
  await bridge.complete({ operation_id: i.operation_id, receipt });
  await expect(done).resolves.toMatchObject({ bin_id: "new-bin" });
  await expect(
    bridge.dispatch("create_bin", i, randomUUID(), async () => {
      throw Error("must not revalidate completed export files");
    }),
  ).resolves.toMatchObject({ bin_id: "new-bin" });
  await bridge.complete({ operation_id: i.operation_id, receipt });
  await expect(
    bridge.complete({
      operation_id: i.operation_id,
      receipt: { ...receipt, result: { bin_id: "different" } },
    }),
  ).rejects.toThrow("immutable");
});
it("uncertain partial failure blocks new operation IDs", async () => {
  await bridge.poll({ state });
  const i = input();
  const done = bridge.dispatch("create_bin", i, randomUUID());
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
    bridge.dispatch("create_bin", input(), randomUUID()),
  ).rejects.toThrow("uncertain");
});
it("operation IDs cannot change meaning", async () => {
  await bridge.poll({ state });
  const i = input();
  const done = bridge.dispatch("create_bin", i, randomUUID());
  await queued();
  await bridge.poll({ state });
  await bridge.complete({
    operation_id: i.operation_id,
    receipt: { ok: true, may_have_changed: true, error: null, result: {} },
  });
  await done;
  await expect(
    bridge.dispatch(
      "create_bin",
      { ...i, args: { name: "Changed", parent_id: "root" } },
      randomUUID(),
    ),
  ).rejects.toThrow("different");
});
it("only configured folders and existing presets are accepted; symlinks cannot escape", async () => {
  const allowed = join(dir, "allowed"),
    outside = join(dir, "other");
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(join(allowed, "preset.epr"), "fixture");
  await writeFile(join(outside, "outside.mov"), "fixture");
  await symlink(join(outside, "outside.mov"), join(allowed, "escape.mov"));
  vi.stubEnv("ARY_PREMIERE_ALLOWED_ROOTS", JSON.stringify([allowed]));
  await expect(
    validatePremiereFiles("export_sequence", {
      preset_path: join(allowed, "preset.epr"),
      output_path: join(allowed, "new.mp4"),
    }),
  ).resolves.toBeUndefined();
  await expect(
    validatePremiereFiles("import_media", {
      paths: [join(allowed, "escape.mov")],
      bin_id: "root",
    }),
  ).rejects.toThrow("outside");
  await writeFile(join(allowed, "new.mp4"), "existing");
  await expect(
    validatePremiereFiles("export_sequence", {
      preset_path: join(allowed, "preset.epr"),
      output_path: join(allowed, "new.mp4"),
    }),
  ).rejects.toThrow("already exists");
});
it("command-looking paths are filenames, not executable strings", async () => {
  vi.stubEnv("ARY_PREMIERE_ALLOWED_ROOTS", JSON.stringify([dir]));
  await expect(
    validatePremiereFiles("open_project", {
      path: join(dir, "$(touch injected).prproj"),
    }),
  ).rejects.toThrow();
});
it("bridge transport rejects browser origins, wrong tokens and disabled configuration", () => {
  vi.stubEnv("ARY_PREMIERE_ENABLED", "false");
  expect(() =>
    authorizePremiereBridge(
      new Request("http://127.0.0.1:3000/api/premiere/bridge/poll", {
        method: "POST",
      }),
    ),
  ).toThrow("disabled");
  vi.stubEnv("ARY_PREMIERE_ENABLED", "true");
  vi.stubEnv("ARY_STORAGE", "supabase");
  vi.stubEnv("ARY_PREMIERE_USER_ID", repo.userId);
  vi.stubEnv("ARY_PREMIERE_BRIDGE_TOKEN", "a".repeat(64));
  vi.stubEnv("ARY_INTEGRATION_ENCRYPTION_KEY", "b".repeat(64));
  for (const headers of [
    { host: "127.0.0.1:3000", authorization: "Bearer " + "c".repeat(64) },
    {
      host: "127.0.0.1:3000",
      authorization: "Bearer " + "a".repeat(64),
      origin: "https://evil.test",
    },
  ])
    expect(() =>
      authorizePremiereBridge(
        new Request("http://127.0.0.1:3000/api/premiere/bridge/poll", {
          method: "POST",
          headers: headers as Record<string, string>,
        }),
      ),
    ).toThrow();
});
