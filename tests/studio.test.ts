import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createDecipheriv } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { StudioService } from "../src/services/studio-service";
import { StudioConversationService } from "../src/services/studio-conversation-service";
import {
  StudioNotSent,
  studioConfig,
  defaultStudioConfig,
  type StudioConfig,
  type StudioAdapter,
  type StudioPlan,
} from "../src/domain/studio";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import {
  AmaranAdapter,
  amaranToken,
} from "../src/infrastructure/studio/amaran";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  studio: StudioService,
  adapter: StudioAdapter,
  config: StudioConfig,
  vault: EncryptedCalendarVault,
  levels: Record<string, number>,
  registry: ReturnType<typeof createActionToolRegistry>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-studio-test-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  vault = new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64));
  levels = { key: 100, fill: 100, back: 100 };
  config = studioConfig.parse({
    devices: ["key", "fill", "back"].map((id) => ({
      id,
      name: id,
      kind: "light",
      adapter: "amaran",
      node_id: id,
    })),
    scenes: [
      {
        id: "podcast",
        name: "Podcast mode",
        aliases: ["podcast"],
        steps: ["key", "fill", "back"].map((id) => ({
          id,
          device_id: id,
          command: { verb: "intensity", value: 400 },
          depends_on: id === "back" ? ["fill"] : [],
        })),
      },
    ],
  });
  adapter = {
    inspect: vi.fn(async (d) => ({
      device_id: d.id,
      observed_at: new Date().toISOString(),
      status: "available" as const,
      state: { intensity: levels[d.id] },
      capabilities: ["intensity"],
      detail: "Fixture",
    })),
    execute: vi.fn(async (d, c) => {
      levels[d.id] = Number(c.value);
      return { confirmation: "observed" as const, detail: "Fixture applied" };
    }),
  };
  studio = new StudioService(
    repo.userId,
    () => true,
    async () => config,
    { amaran: adapter },
    vault,
    () => {},
  );
  registry = createActionToolRegistry(
    repo,
    undefined,
    actions,
    undefined,
    undefined,
    undefined,
    undefined,
    studio,
  );
  requests = new ActionRequestService(repo, actions, registry);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function planned() {
  return (
    await requests.request({
      tool: "studio.plan_scene",
      input: { scene: "podcast" },
      request_key: randomUUID(),
    })
  ).result as { plan: StudioPlan; request: Record<string, unknown> };
}
async function approve(request: Record<string, unknown>) {
  await expect(requests.request(request)).rejects.toThrow("Approval required");
  const pending = (await repo.list("actions"))
    .filter(
      (a) =>
        a.tool_name === "studio.execute_scene" &&
        a.status === "approval_required",
    )
    .at(-1)!;
  await actions.permissions.review(pending.id, "approved", "Fixture reviewed");
  return pending;
}
it("discovers scene tools through the existing registry", async () => {
  expect(
    (await requests.catalog())
      .filter((t) => t.name.startsWith("studio."))
      .map((t) => t.name),
  ).toEqual(["studio.inspect", "studio.plan_scene", "studio.execute_scene"]);
});
it("resolves aliases and never executes during planning", async () => {
  expect((await planned()).plan.scene_id).toBe("podcast");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("rejects injected and ambiguous scene names", async () => {
  await expect(studio.plan("podcast; touch /tmp/pwned")).rejects.toThrow(
    "Unknown",
  );
  config.scenes.push({ ...config.scenes[0], id: "two", name: "Second" });
  await expect(studio.plan("podcast")).resolves.toHaveProperty(
    "scene_id",
    "podcast",
  );
  config.scenes[0].aliases.push("session");
  config.scenes[1].aliases.push("session");
  await expect(studio.plan("session")).rejects.toThrow("ambiguous");
});
it("rejects cycles, duplicate nodes and unknown verbs", () => {
  const bad = structuredClone(config);
  bad.scenes[0].steps[0].depends_on = ["back"];
  expect(studioConfig.safeParse(bad).success).toBe(false);
  bad.scenes[0].steps[0].depends_on = [];
  bad.devices[1].node_id = "key";
  expect(studioConfig.safeParse(bad).success).toBe(false);
  expect(
    studioConfig.safeParse({
      ...config,
      scenes: [
        {
          ...config.scenes[0],
          steps: [
            {
              id: "a",
              device_id: "key",
              command: { verb: "shell", value: "ls" },
            },
          ],
        },
      ],
    }).success,
  ).toBe(false);
});
it("disabled inventory is truthful and never contacts hardware", async () => {
  const disabled = new StudioService(
    repo.userId,
    () => false,
    async () => config,
    { amaran: adapter },
    vault,
  );
  const r = await disabled.inspect();
  expect(r.enabled).toBe(false);
  expect(r.observations.every((o) => o.status === "unavailable")).toBe(true);
  expect(adapter.inspect).not.toHaveBeenCalled();
});
it("default scenes are non-executable templates", async () => {
  config = defaultStudioConfig;
  expect((await studio.plan("podcast")).executable).toBe(false);
});
it("denied observe prevents planning and hardware inspection", async () => {
  await actions.permissions.savePolicy({
    tool: "studio.inspect",
    level: 0,
    reason: "Block",
  });
  await expect(planned()).rejects.toThrow("not permitted");
  expect(adapter.inspect).not.toHaveBeenCalled();
});
it.each([0, 1, 2, 3])("level %s blocks scene execution", async (level) => {
  const p = await planned();
  await actions.permissions.savePolicy({
    tool: "studio.execute_scene",
    level,
    reason: "Restrict",
  });
  await expect(
    requests.request({ ...p.request, request_key: randomUUID() }),
  ).rejects.toThrow("not permitted");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("level 5 still requires approval", async () => {
  await actions.permissions.savePolicy({
    tool: "studio.execute_scene",
    level: 5,
    reason: "Fixture",
  });
  const p = await planned();
  await expect(
    requests.request({ ...p.request, request_key: randomUUID() }),
  ).rejects.toThrow("Approval required");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("rejected approval produces no device effects", async () => {
  const p = await planned(),
    r = { ...p.request, request_key: randomUUID() };
  await expect(requests.request(r)).rejects.toThrow();
  const pending = (await repo.list("actions"))
    .filter((a) => a.status === "approval_required")
    .at(-1)!;
  await actions.permissions.review(pending.id, "rejected", "Do not apply");
  await expect(requests.request(r)).rejects.toThrow();
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("approved scene records output/outcome and duplicate replay has no effects", async () => {
  const p = await planned(),
    r = { ...p.request, request_key: randomUUID() };
  await approve(r);
  const result = await requests.request(r);
  expect(result.result.status).toBe("success");
  expect(adapter.execute).toHaveBeenCalledTimes(3);
  await requests.request(r);
  expect(adapter.execute).toHaveBeenCalledTimes(3);
  expect(
    (await repo.list("outcomes")).some(
      (o) => o.action_id === result.action_id && o.status === "success",
    ),
  ).toBe(true);
  expect((await studio.inspect()).last_execution?.action_id).toBe(
    result.action_id,
  );
});
it("new request key on same plan reuses the durable receipt", async () => {
  const p = await planned();
  let r = { ...p.request, request_key: randomUUID() };
  await approve(r);
  await requests.request(r);
  r = { ...p.request, request_key: randomUUID() };
  await approve(r);
  await requests.request(r);
  expect(adapter.execute).toHaveBeenCalledTimes(3);
});
it("rejects tampered plan after approval without device effects", async () => {
  const p = await planned();
  p.plan.steps[0].command.value = 999;
  const r = {
    ...p.request,
    input: { plan_action_id: p.request.source_action_id, plan: p.plan },
    request_key: randomUUID(),
  };
  await approve(r);
  await expect(requests.request(r)).rejects.toThrow("unchanged owned");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("rejects foreign plan owners and missing source binding", async () => {
  const p = await planned();
  await expect(
    requests.request({
      ...p.request,
      source_action_id: randomUUID(),
      request_key: randomUUID(),
    }),
  ).rejects.toThrow();
  const otherRepo = new LocalRepository(randomUUID(), join(dir, "other.json"));
  const other = new ActionRequestService(
    otherRepo,
    new ActionService(otherRepo),
  );
  await expect(
    other.request({ ...p.request, request_key: randomUUID() }),
  ).rejects.toThrow();
});
it("stale observed state or configuration requires a new plan", async () => {
  const p = await planned();
  levels.key = 200;
  await expect(
    studio.execute(p.plan, randomUUID(), async () => {}),
  ).rejects.toThrow("state changed");
  levels.key = 100;
  config.scenes[0].steps[0].command.value = 500;
  await expect(
    studio.execute(p.plan, randomUUID(), async () => {}),
  ).rejects.toThrow("stale");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("known failure preserves earlier success and skips dependencies; outcome is not success", async () => {
  vi.mocked(adapter.execute).mockImplementation(async (d, c) => {
    if (d.id === "fill") throw new StudioNotSent("Fixture offline before send");
    levels[d.id] = Number(c.value);
    return { confirmation: "observed" as const, detail: "Fixture" };
  });
  const p = await planned(),
    r = { ...p.request, request_key: randomUUID() };
  await approve(r);
  const result = await requests.request(r);
  expect(result.result.status).toBe("partial");
  expect(JSON.stringify(result.result)).toContain('"status":"skipped"');
  expect(
    (await repo.list("outcomes")).find((o) => o.action_id === result.action_id)
      ?.status,
  ).toBe("failure");
  expect(levels.key).toBe(400);
});
it("uncertain transport stops subsequent steps and blocks future plans from executing", async () => {
  vi.mocked(adapter.execute).mockRejectedValueOnce(
    Error("timeout after dispatch"),
  );
  const p = await planned();
  const report = await studio.execute(p.plan, randomUUID(), async () => {});
  expect(report.status).toBe("uncertain");
  expect(adapter.execute).toHaveBeenCalledTimes(1);
  expect(report.steps[1].status).toBe("skipped");
  await expect(
    studio.execute(await studio.plan("podcast"), randomUUID(), async () => {}),
  ).rejects.toThrow("reconciliation");
});
it("durable write-ahead guard stops replay after crash", async () => {
  const p = await planned();
  await vault.write(`${repo.userId}:studio:active`, { plan_id: p.plan.id });
  await expect(
    studio.execute(p.plan, randomUUID(), async () => {}),
  ).rejects.toThrow("reconciliation");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("checks permission before each device", async () => {
  const p = await planned();
  let checks = 0;
  const r = await studio.execute(p.plan, randomUUID(), async () => {
    if (++checks > 2) throw new StudioNotSent("Permission revoked");
  });
  expect(r.status).toBe("partial");
  expect(adapter.execute).toHaveBeenCalledTimes(1);
});
it("chat podcast intent queues the same scene approval with conversation evidence", async () => {
  const conv = await repo.insert("conversations", {
    title: "Studio fixture",
    metadata: {},
  });
  const source = await repo.insert("messages", {
    conversation_id: conv.id,
    role: "user",
    content: "Ary, podcast mode.",
    metadata: {},
  });
  const result = await new StudioConversationService(
    repo,
    actions,
    registry,
  ).handle(source.content, source);
  expect(result?.content).toContain("Approvals");
  expect(result?.metadata.studio_approval_action_id).toBeTruthy();
  expect(adapter.execute).not.toHaveBeenCalled();
  const action = await repo.get(
    "actions",
    String(result!.metadata.studio_approval_action_id),
  );
  expect(action?.conversation_id).toBe(conv.id);
  expect(JSON.stringify(action?.input)).toContain(source.id);
});
it("does not hijack ordinary task or recording requests", async () => {
  const service = new StudioConversationService(repo, actions, registry);
  expect(
    await service.handle("Create a task to plan podcast mode", {} as never),
  ).toBeNull();
  expect(await service.handle("Start recording", {} as never)).toBeNull();
});
it("Amaran token matches documented AES-GCM timestamp layout", () => {
  const key = Buffer.alloc(32, 4),
    raw = Buffer.from(amaranToken(key.toString("base64")), "base64");
  const dec = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  dec.setAuthTag(raw.subarray(12, 28));
  const timestamp = Number(
    Buffer.concat([dec.update(raw.subarray(28)), dec.final()]).toString(),
  );
  expect(Math.abs(Date.now() / 1000 - timestamp)).toBeLessThan(2);
  expect(() => amaranToken("bad")).toThrow();
});
it("Amaran maps individual node state and fixed commands without pretending physical confirmation", async () => {
  const rpc = vi.fn(
    async (action: string) =>
      ({
        get_fixture_list: [{ node_id: "key" }],
        get_node_config: { cct_support: true, cct_min: 2700, cct_max: 6500 },
        get_intensity: 100,
        get_sleep: false,
        get_cct: { cct: 3200 },
        set_intensity: 400,
      })[action as "get_sleep"],
  );
  const a = new AmaranAdapter(rpc);
  const o = await a.inspect(config.devices[0]);
  expect(o.state.cct).toBe(3200);
  expect(
    await a.execute(config.devices[0], { verb: "intensity", value: 400 }),
  ).toHaveProperty("confirmation", "provider_acknowledged");
  expect(rpc).toHaveBeenLastCalledWith("set_intensity", "key", {
    intensity: 400,
  });
  await expect(
    a.execute(config.devices[0], { verb: "preset", value: "x" }),
  ).rejects.toThrow("Unsupported");
});
it("required dependency on an unavailable optional device blocks the plan", async () => {
  config.devices[1].adapter = "unconfigured";
  config.devices[1].node_id = undefined;
  config.scenes[0].steps[1].required = false;
  const plan = await studio.plan("podcast");
  expect(plan.executable).toBe(false);
  expect(plan.steps[2].blocked_reason).toContain("Dependency");
});
it("expired plan fails before any dispatch", async () => {
  const p = await planned();
  p.plan.created_at = new Date(Date.now() - 700000).toISOString();
  await expect(
    studio.execute(p.plan, randomUUID(), async () => {}),
  ).rejects.toThrow("stale");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("receipt write failure before dispatch leaves no device effect", async () => {
  const p = await planned();
  vi.spyOn(vault, "write").mockRejectedValueOnce(Error("Disk unavailable"));
  await expect(
    studio.execute(p.plan, randomUUID(), async () => {}),
  ).rejects.toThrow("Disk");
  expect(adapter.execute).not.toHaveBeenCalled();
});
it("database failure after device execution recovers from its receipt, without repeating effects", async () => {
  const p = await planned(),
    r = { ...p.request, request_key: randomUUID() };
  await approve(r);
  const original = repo.batch.bind(repo);
  vi.spyOn(repo, "batch").mockImplementationOnce(async () => {
    throw Error("Transient DB failure");
  });
  await expect(requests.request(r)).rejects.toThrow();
  expect(adapter.execute).toHaveBeenCalledTimes(3);
  vi.mocked(repo.batch).mockImplementation(original);
  const retry = { ...p.request, request_key: randomUUID() };
  await approve(retry);
  const result = await requests.request(retry);
  expect(result.result.status).toBe("success");
  expect(adapter.execute).toHaveBeenCalledTimes(3);
});
it("unknown failure after a physical effect never claims rollback", async () => {
  vi.mocked(adapter.execute).mockImplementationOnce(async (d) => {
    levels[d.id] = 400;
    throw Error("Lost completion receipt");
  });
  const p = await planned(),
    report = await studio.execute(p.plan, randomUUID(), async () => {});
  expect(levels.key).toBe(400);
  expect(report.status).toBe("uncertain");
  expect(report.steps[0].confirmation).toBeNull();
});
it("Amaran transport correlates responses and ignores unrelated events", async () => {
  const { amaranRequest } = await import("../src/infrastructure/studio/amaran");
  vi.stubEnv("ARY_AMARAN_API_KEY", Buffer.alloc(32, 5).toString("base64"));
  class Socket extends EventTarget {
    constructor(url: string) {
      super();
      expect(url).toBe("ws://127.0.0.1:12345");
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    close() {}
    send(raw: string) {
      const r = JSON.parse(raw);
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "event", event: "intensity_changed" }),
        }),
      );
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            version: 2,
            type: "response",
            request_id: r.request_id,
            client_id: r.client_id,
            action: r.action,
            node_id: r.node_id,
            code: 0,
            data: 450,
          }),
        }),
      );
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  try {
    expect(await amaranRequest("get_intensity", "key")).toBe(450);
    await expect(amaranRequest("exec" as never)).rejects.toThrow("Invalid");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("Amaran response mismatch is uncertain and never echoes provider payload", async () => {
  const { amaranRequest } = await import("../src/infrastructure/studio/amaran");
  vi.stubEnv("ARY_AMARAN_API_KEY", Buffer.alloc(32, 5).toString("base64"));
  class Socket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event("open")));
    }
    close() {}
    send(raw: string) {
      const r = JSON.parse(raw);
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            version: 2,
            type: "response",
            request_id: r.request_id,
            client_id: r.client_id,
            action: "wrong",
            code: 0,
            data: "private device data",
          }),
        }),
      );
    }
  }
  vi.stubGlobal("WebSocket", Socket);
  try {
    await expect(
      amaranRequest("set_intensity", "key", { intensity: 450 }),
    ).rejects.toThrow("could not confirm");
  } finally {
    vi.unstubAllGlobals();
  }
});
