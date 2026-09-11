import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PremiereMediaAnalysis,
  encodeWav,
  wavPcm,
  LocalMediaDecoder,
  executionAnalysisInput,
} from "../src/infrastructure/premiere/media-analysis";
import type { PremiereAdapter, PremiereState } from "../src/domain/premiere";
import {
  validatePremierePlan,
  premiereArguments,
} from "../src/domain/premiere";
import { actionCancellation } from "../src/services/action-cancellation";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import { registerPremiereTools } from "../src/infrastructure/tools/premiere-tools";
let dir: string, path: string, state: PremiereState, adapter: PremiereAdapter;
let service: PremiereMediaAnalysis;
const speech = {
  id: "fixture-local",
  model: "fixture",
  transcribe: vi.fn(async () => ({
    text: "The surprising mistake changed how we work with every client.",
  })),
};
const params = () => ({
  media_id: "media",
  expected_revision: "v1",
  start_seconds: 0,
  duration_seconds: 3,
  transcribe: false,
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-premiere-media-"));
  path = join(dir, "interview.wav");
  const samples = new Float32Array(48000);
  samples.fill(0.3, 16000, 32000);
  await writeFile(path, encodeWav(samples, 16000));
  vi.stubEnv("ARY_PREMIERE_ALLOWED_ROOTS", JSON.stringify([dir]));
  vi.stubEnv("ARY_PREMIERE_FFMPEG_PATH", "");
  speech.transcribe.mockClear();
  state = {
    revision: "v1",
    project_id: "project",
    project_name: "Fixture",
    project_path: join(dir, "fixture.prproj"),
    sequence_id: "seq",
    sequences: [{ id: "seq", name: "Interview" }],
    items: [
      {
        id: "media",
        name: "Interview",
        kind: "media",
        parent_id: null,
        media_path: path,
        offline: false,
      },
    ],
    clips: [
      {
        id: "video:0:0",
        name: "Interview",
        start: "0",
        end: "100",
        locked: false,
      },
    ],
    complete: true,
    supported_verbs: ["set_clips_enabled", "remove_clips"],
  };
  adapter = {
    assertAvailable() {},
    inspect: async () => structuredClone(state),
    execute: vi.fn(async () => ({ done: true })),
  };
  service = new PremiereMediaAnalysis(adapter, new LocalMediaDecoder(), speech);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
it("pins real WAV evidence and measures silence without calling speech", async () => {
  const p = await service.prepare(params()),
    r = await service.analyze(p.request.input);
  expect(r.source.excerpt_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(
    r.plan.recommendations.filter((x) => x.kind === "silence"),
  ).toHaveLength(2);
  expect(r.transcript).toBeNull();
  expect(speech.transcribe).not.toHaveBeenCalled();
  expect(r.audio_retained).toBe(false);
});
it("transcribes only the decoded excerpt and returns sourced heuristic hooks", async () => {
  const p = await service.prepare({ ...params(), transcribe: true }),
    r = await service.analyze(p.request.input);
  expect(r.transcript).toContain("surprising");
  expect(r.plan.recommendations.some((x) => x.kind === "hook")).toBe(true);
  expect(r.transcription?.timing).toContain("not word aligned");
  expect(speech.transcribe).toHaveBeenCalledOnce();
  const blob = (speech.transcribe.mock.calls[0] as unknown as [Blob])[0];
  expect(blob.size).toBe(96044);
  expect(r.estimated_cost_usd).toBeNull();
});
it("rejects a changed file after approval before sending audio", async () => {
  const p = await service.prepare({ ...params(), transcribe: true });
  await writeFile(path, "changed");
  await expect(service.analyze(p.request.input)).rejects.toThrow(
    "changed after review",
  );
  expect(speech.transcribe).not.toHaveBeenCalled();
});
it.each(["revision", "offline", "missing"])(
  "rejects stale/unavailable source %s",
  async (kind) => {
    const p = await service.prepare(params());
    if (kind === "revision") state.revision = "v2";
    if (kind === "offline") state.items[0].offline = true;
    if (kind === "missing") state.items = [];
    await expect(service.analyze(p.request.input)).rejects.toThrow();
  },
);
it("blocks symlink escape from configured roots", async () => {
  const outside = join(tmpdir(), randomUUID() + ".wav");
  await writeFile(outside, "private");
  try {
    await rm(path);
    await symlink(outside, path);
    await expect(service.prepare(params())).rejects.toThrow("outside");
  } finally {
    await rm(outside);
  }
});
it("never accepts command or arbitrary path fields", () => {
  expect(() =>
    executionAnalysisInput.parse({
      ...params(),
      source_fingerprint: "a".repeat(64),
      command: "touch /tmp/escape",
    }),
  ).toThrow();
  expect(() =>
    executionAnalysisInput.parse({
      ...params(),
      source_fingerprint: "a".repeat(64),
      path: "/etc/passwd",
    }),
  ).toThrow();
  expect(() =>
    premiereArguments.remove_clips.parse({
      clip_ids: ["video:0:0"],
      ripple: true,
    }),
  ).toThrow();
});
it("retains exact source offsets without suggesting unobserved leading silence", async () => {
  const p = await service.prepare({
      ...params(),
      start_seconds: 1,
      duration_seconds: 2,
      transcribe: true,
    }),
    r = await service.analyze(p.request.input);
  expect(
    r.plan.recommendations.every((rec) => rec.start >= 1 && rec.end <= 3),
  ).toBe(true);
  expect(r.source.start_seconds).toBe(1);
});
it("rejects missing decoder rather than inventing transcript", async () => {
  const video = join(dir, "interview.mov");
  await writeFile(video, "fixture");
  state.items[0].media_path = video;
  const p = await service.prepare({ ...params(), transcribe: true });
  await expect(service.analyze(p.request.input)).rejects.toThrow("FFmpeg");
  expect(speech.transcribe).not.toHaveBeenCalled();
});
it("honors cancellation before decoding/transcription", async () => {
  const p = await service.prepare({ ...params(), transcribe: true }),
    c = new AbortController();
  c.abort();
  await expect(
    actionCancellation.run(c.signal, () => service.analyze(p.request.input)),
  ).rejects.toThrow();
  expect(speech.transcribe).not.toHaveBeenCalled();
});
it("rejects truncated/malformed WAV", () => {
  expect(() => wavPcm(Buffer.from("not wav"))).toThrow();
  const b = encodeWav(new Float32Array(10), 16000);
  expect(() => wavPcm(b.subarray(0, 50))).toThrow();
});
it("old plugin cannot silently enable destructive native verbs", () => {
  const old = { ...state, supported_verbs: undefined };
  expect(() =>
    validatePremierePlan(
      "remove_clips",
      { clip_ids: ["video:0:0"], ripple: false },
      old,
    ),
  ).toThrow("reconnect");
});
it("real analysis uses approval, rejection, audit/outcome and replay safety", async () => {
  const repo = new LocalRepository(randomUUID(), join(dir, "repo.json")),
    actions = new ActionService(repo);
  const registry = registerPremiereTools(
      new ToolRegistry(),
      adapter,
      actions,
      service,
    ),
    requests = new ActionRequestService(repo, actions, registry);
  const p = await service.prepare({ ...params(), transcribe: true });
  const req = {
    tool: "premiere.analyze_media",
    input: p.request.input,
    request_key: randomUUID(),
    reason: "Analyze approved source excerpt",
  };
  await expect(requests.request(req)).rejects.toThrow("Approval required");
  expect(speech.transcribe).not.toHaveBeenCalled();
  await actions.permissions.review(
    (await repo.list("actions")).at(-1)!.id,
    "rejected",
    "Declined excerpt analysis",
  );
  await expect(requests.request(req)).rejects.toThrow();
  const second = { ...req, request_key: randomUUID() };
  await requests.request(second).catch(() => {});
  await actions.permissions.review(
    (await repo.list("actions")).at(-1)!.id,
    "approved",
    "Reviewed source and destination",
  );
  await requests.request(second);
  await requests.request(second);
  expect(speech.transcribe).toHaveBeenCalledOnce();
  const rows = await repo.list("actions");
  expect(
    rows.some(
      (a) =>
        a.tool_name === "premiere.analyze_media" && a.status === "succeeded",
    ),
  ).toBe(true);
  expect((await repo.list("outcomes")).length).toBeGreaterThan(0);
});
