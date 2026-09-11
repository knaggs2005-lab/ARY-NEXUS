import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  studioConfig,
  type StudioAdapter,
  type Observation,
} from "../src/domain/studio";
import { DeviceRegistry } from "../src/services/device-registry";
import { StudioService } from "../src/services/studio-service";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import { HomeAssistantAdapter } from "../src/infrastructure/studio/home-assistant";
import { studioMissionSpec } from "../src/domain/studio-mission";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { projectInspection } from "../src/domain/nexus-map";
import type { ExecutionPlan } from "../src/domain/orchestration";
const config = () =>
  studioConfig.parse({
    devices: ["light", "camera", "audio"].map((id, i) => ({
      id,
      name: id,
      kind: id === "light" ? "light" : id,
      adapter: "unconfigured",
      location_id: "studio",
      position: { x: 20 + i * 25, y: 50 },
    })),
    scenes: [
      {
        id: "podcast",
        name: "Podcast mode",
        aliases: ["podcast mode"],
        steps: [
          {
            id: "light",
            device_id: "light",
            command: { verb: "intensity", value: 450 },
          },
          ...["camera", "audio"].map((id) => ({
            id,
            device_id: id,
            command: { verb: "preset", value: "podcast" },
            verify: { preset: "podcast" },
          })),
        ],
      },
    ],
  });
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-physical-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
function fixture() {
  const user = randomUUID();
  const states: Record<string, Record<string, string | number>> = {
    light: { intensity: 0 },
    camera: { preset: "idle" },
    audio: { preset: "idle" },
  };
  const adapter: StudioAdapter = {
    inspect: vi.fn<StudioAdapter["inspect"]>(async (d) => ({
      device_id: d.id,
      observed_at: new Date().toISOString(),
      status: "available",
      state: { ...states[d.id] },
      capabilities: ["intensity", "preset"],
      detail: "Isolated device simulator",
    })),
    execute: vi.fn<StudioAdapter["execute"]>(async (d, c) => {
      states[d.id][c.verb] = c.value as string | number;
      return {
        confirmation: "provider_acknowledged",
        detail: "Simulator accepted",
      };
    }),
  };
  const c = config();
  const service = new StudioService(
    user,
    () => true,
    async () => c,
    { unconfigured: adapter },
    new EncryptedCalendarVault(join(dir, "vault"), "a".repeat(64)),
    () => {},
  );
  return {
    ...missionFixture(join(dir, "repo.json"), user, false, service),
    service,
    adapter,
    states,
    config: c,
  };
}
it("keeps legacy inventory stable and provides studio/home/office locations", () => {
  const c = config(),
    r = new DeviceRegistry(c, {});
  expect(r.devices.map((d) => d.id)).toEqual(c.devices.map((d) => d.id));
  expect(r.locations.map((l) => l.kind)).toEqual(["studio", "home", "office"]);
});
it("validates future locations, unique bindings and rejects command injection", () => {
  const c = config();
  c.locations = [{ id: "studio", name: "Remote set", kind: "other" }];
  expect(studioConfig.safeParse(c).success).toBe(true);
  c.devices[0].location_id = "unknown";
  expect(studioConfig.safeParse(c).success).toBe(false);
  c.devices[0].location_id = "studio";
  c.devices[0].adapter = "home_assistant";
  c.devices[0].ha_entity_id = "light.key;shutdown";
  expect(studioConfig.safeParse(c).success).toBe(false);
});
it("disabled inspection never contacts an adapter or claims readiness", async () => {
  const f = fixture(),
    registry = new DeviceRegistry(f.config, { unconfigured: f.adapter });
  expect(
    registry.readiness("podcast", await registry.observe(false)).status,
  ).toBe("not_ready");
  expect(f.adapter.inspect).not.toHaveBeenCalled();
});
it("safe recovery retries only a failed read, once, and records evidence", async () => {
  const f = fixture();
  vi.mocked(f.adapter.inspect).mockRejectedValueOnce(Error("Disconnected"));
  const result = await f.service.inspect();
  expect(result.observations[0].recovery).toBe("inspection_retried");
  expect(result.observations[0].status).toBe("available");
  expect(f.adapter.inspect).toHaveBeenCalledTimes(4);
  expect(f.adapter.execute).not.toHaveBeenCalled();
});
it("stale or mismatched observations never establish current readiness", async () => {
  const f = fixture(),
    r = new DeviceRegistry(f.config, {});
  const observations = (await f.service.inspect()).observations;
  for (const o of observations)
    o.observed_at = new Date(Date.now() - 31000).toISOString();
  expect(
    r
      .readiness("podcast", observations)
      .checks.every((c) => c.status === "unavailable"),
  ).toBe(true);
});
it("preset acknowledgement without an explicit readable target is unverified", async () => {
  const f = fixture();
  delete f.config.scenes[0].steps[1].verify;
  f.states.light.intensity = 450;
  f.states.camera.preset = "podcast";
  f.states.audio.preset = "podcast";
  expect((await f.service.inspect("podcast")).readiness?.status).toBe(
    "unverified",
  );
});
it("readiness checks actual post-action state, not the accepted command", async () => {
  const f = fixture();
  vi.mocked(f.adapter.execute).mockResolvedValue({
    confirmation: "provider_acknowledged",
    detail: "Accepted but not applied",
  });
  const report = await f.service.execute(
    await f.service.plan("podcast"),
    randomUUID(),
    async () => {},
  );
  expect(report.status).toBe("success");
  expect(report.readiness?.status).toBe("not_ready");
  expect(report.readiness?.checks[0].observation?.state.intensity).toBe(0);
});
it("records complete readiness evidence when all required equipment matches", async () => {
  const f = fixture(),
    plan = await f.service.plan("podcast");
  const report = await f.service.execute(plan, randomUUID(), async () => {});
  expect(report.readiness?.status).toBe("ready");
  expect(report.readiness?.checks).toHaveLength(3);
  await f.service.execute(plan, randomUUID(), async () => {});
  expect(f.adapter.execute).toHaveBeenCalledTimes(3);
});
it("compares Home Assistant's quantized brightness without treating off as a tiny positive target", async () => {
  const f = fixture();
  f.config.devices[0].adapter = "home_assistant";
  f.config.devices[0].ha_entity_id = "light.key";
  f.config.scenes[0].steps[0].command = { verb: "intensity", value: 1 };
  f.states.light.intensity = 4;
  f.states.camera.preset = "podcast";
  f.states.audio.preset = "podcast";
  const observations = await Promise.all(
    f.config.devices.map((d) => f.adapter.inspect(d)),
  );
  const registry = new DeviceRegistry(f.config, {});
  expect(registry.readiness("podcast", observations).status).toBe("ready");
  observations[0].state.intensity = 0;
  expect(registry.readiness("podcast", observations).status).toBe("not_ready");
});
it("uncertain physical delivery is not retried even when the target appears to match", async () => {
  const f = fixture();
  vi.mocked(f.adapter.execute).mockImplementationOnce(async (d) => {
    f.states[d.id].intensity = 450;
    throw Error("Lost receipt");
  });
  const report = await f.service.execute(
    await f.service.plan("podcast"),
    randomUUID(),
    async () => {},
  );
  expect(report.status).toBe("uncertain");
  expect(report.readiness?.status).toBe("unverified");
  expect(f.adapter.execute).toHaveBeenCalledTimes(1);
});
it("projects configured locations and device links from saved receipts without hardware reads", async () => {
  const f = fixture(),
    result = await f.service.inspect();
  const rows = projectInspection({
    id: randomUUID(),
    tool_name: "studio.inspect",
    updated_at: new Date().toISOString(),
    output: { result },
  });
  expect(rows.filter((r) => r.kind === "location")).toHaveLength(3);
  expect(rows.find((r) => r.id === "device:light")?.locationId).toBe(
    "location:studio",
  );
  expect(rows.find((r) => r.id === "device:light")?.status).toBe(
    "previously_observed",
  );
});
async function start(f: ReturnType<typeof fixture>) {
  const created = await f.coordinator.requests.request({
    tool: "mission.create",
    input: {
      goal: "Prepare podcast mode and verify readiness",
      spec: studioMissionSpec("podcast"),
    },
    request_key: randomUUID(),
  });
  let p = await f.engine.inspect(String(created.result.id));
  expect(p.mission?.state).toBe("DRAFT");
  p = await f.engine.control(p.id, "plan", p.revision);
  p = await f.engine.tick(p.id);
  p = await f.engine.control(p.id, "start", p.revision);
  for (let i = 0; i < 5 && p.mission?.state !== "APPROVAL_REQUIRED"; i++)
    p = await f.engine.tick(p.id);
  return p;
}
async function finish(f: ReturnType<typeof fixture>, p: ExecutionPlan) {
  for (
    let i = 0;
    i < 8 && !["COMPLETED", "FAILED", "WAITING"].includes(p.mission!.state);
    i++
  )
    p = await f.engine.tick(p.id);
  return p;
}
it("PODCAST MODE uses durable missions, approval, safe read recovery, outcomes and telemetry", async () => {
  const f = fixture();
  vi.mocked(f.adapter.inspect).mockRejectedValueOnce(
    Error("Temporary disconnect"),
  );
  let p = await start(f);
  expect(p.mission?.state).toBe("APPROVAL_REQUIRED");
  expect(f.adapter.execute).not.toHaveBeenCalled();
  await f.actions.permissions.review(
    p.states.prepare.approval_action_id!,
    "approved",
    "Prepare the isolated studio",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await finish(f, p);
  expect(p.mission?.state).toBe("COMPLETED");
  expect(p.states.prepare.status).toBe("verified");
  expect(f.adapter.execute).toHaveBeenCalledTimes(3);
  expect(
    (await f.repo.list("outcomes")).some(
      (o) => o.metadata.studio_status === "success",
    ),
  ).toBe(true);
  const events = await f.repo.readEvents({ limit: 100 });
  expect(
    events.events.some(
      (e) =>
        e.type === "device.readiness" &&
        e.mission_id === p.id &&
        e.payload.status === "ready",
    ),
  ).toBe(true);
  expect(
    events.events.some(
      (e) => e.type === "device.observed" && e.payload.device_id === "camera",
    ),
  ).toBe(true);
});
it("declining a podcast mission equipment approval makes no physical change", async () => {
  const f = fixture();
  let p = await start(f);
  await f.actions.permissions.review(
    p.states.prepare.approval_action_id!,
    "rejected",
    "Do not prepare",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  await finish(f, p);
  expect(f.adapter.execute).not.toHaveBeenCalled();
});
it("permission-denied inspection prevents mission hardware access", async () => {
  const f = fixture();
  await f.actions.permissions.savePolicy({
    tool: "studio.inspect",
    level: 0,
    reason: "Deny physical reads",
  });
  await expect(
    f.coordinator.requests.request({
      tool: "studio.inspect",
      input: {},
      request_key: randomUUID(),
    }),
  ).rejects.toThrow();
  expect(f.adapter.inspect).not.toHaveBeenCalled();
});
it("a mission cannot complete on acknowledgement with mismatched device state", async () => {
  const f = fixture();
  vi.mocked(f.adapter.execute).mockResolvedValue({
    confirmation: "provider_acknowledged",
    detail: "Acknowledged only",
  });
  let p = await start(f);
  await f.actions.permissions.review(
    p.states.prepare.approval_action_id!,
    "approved",
    "Try fixture",
  );
  p = await f.engine.control(p.id, "resume", p.revision);
  p = await finish(f, p);
  expect(p.mission?.state).not.toBe("COMPLETED");
  expect(p.states.prepare.status).not.toBe("verified");
  expect(f.adapter.execute).toHaveBeenCalledTimes(3);
});
const haDevice = {
  id: "key",
  name: "Key",
  kind: "light" as const,
  adapter: "home_assistant" as const,
  ha_entity_id: "light.key",
};
it.each(["brightness", "onoff"])(
  "Home Assistant handles a powered-off %s light with null brightness",
  async (mode) => {
    const a = ha(
      async () =>
        new Response(
          JSON.stringify({
            entity_id: "light.key",
            state: "off",
            attributes: { brightness: null, supported_color_modes: [mode] },
          }),
        ),
    );
    const o = await a.inspect(haDevice);
    expect(o.status).toBe("available");
    expect(o.state.sleep).toBe(true);
    expect(o.capabilities.includes("intensity")).toBe(mode === "brightness");
  },
);
function ha(transport: typeof fetch) {
  vi.stubEnv("ARY_HOME_ASSISTANT_URL", "http://127.0.0.1:8123");
  vi.stubEnv("ARY_HOME_ASSISTANT_TOKEN", "isolated-fixture-token");
  return new HomeAssistantAdapter(transport);
}
it("Home Assistant uses fixed service paths and reads provider state", async () => {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          entity_id: "light.key",
          state: "on",
          attributes: { brightness: 115 },
        }),
      ),
  );
  const a = ha(transport as typeof fetch);
  expect((await a.inspect(haDevice)).state.intensity).toBe(451);
  await a.execute(haDevice, { verb: "intensity", value: 450 });
  expect(String(transport.mock.calls[1][0])).toBe(
    "http://127.0.0.1:8123/api/services/light/turn_on",
  );
  expect(JSON.parse(transport.mock.calls[1][1]!.body as string)).toEqual({
    entity_id: "light.key",
    brightness: 115,
  });
  expect(transport.mock.calls[1][1]!.redirect).toBe("error");
});
it("Home Assistant rejects unbound entities and unsupported verbs before dispatch", async () => {
  const transport = vi.fn();
  const a = ha(transport);
  await expect(
    a.inspect({ ...haDevice, ha_entity_id: "light.key/../../services/script" }),
  ).rejects.toThrow();
  await expect(
    a.execute(haDevice, { verb: "preset", value: "shutdown" }),
  ).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it("Home Assistant unknown/offline state is never available", async () => {
  const a = ha(
    async () =>
      new Response(
        JSON.stringify({
          entity_id: "light.key",
          state: "unavailable",
          attributes: {},
        }),
      ),
  );
  expect((await a.inspect(haDevice)).status).toBe("unavailable");
});
it("Home Assistant failed write has uncertain delivery and never exposes raw errors or secrets", async () => {
  const transport = vi.fn(async () => {
    throw Error("private token response");
  });
  const a = ha(transport);
  await expect(
    a.execute(haDevice, { verb: "sleep", value: true }),
  ).rejects.toThrow("delivery uncertain");
  expect(transport).toHaveBeenCalledTimes(1);
});
