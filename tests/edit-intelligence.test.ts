import { measureEditAudio } from "../src/domain/edit-audio";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EditIntelligenceService } from "../src/services/edit-intelligence-service";
import {
  parseSrt,
  sourceTimecode,
  type EditPlan,
} from "../src/domain/edit-plan";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { PermissionService } from "../src/services/permission-service";
import type { PremiereProvider } from "../src/domain/premiere";
const sample = () => ({
  brief: "Lesson: surprising launch mistake saved time",
  destination: "Reviewed interview",
  target_seconds: 30,
  clips: [
    {
      id: "clip-1",
      name: "Interview",
      source_ref: "transcript://interview/v1",
      duration: 40,
      fps: 30,
      segments: [
        {
          id: "q",
          start: 0,
          end: 3,
          text: "What surprising lesson did you learn?",
          speaker: "Host",
          confidence: 0.9,
        },
        {
          id: "a",
          start: 4,
          end: 14,
          text: "The surprising lesson was our launch mistake cost 20 days of work.",
          speaker: "Guest",
          confidence: 0.95,
        },
        {
          id: "b",
          start: 20,
          end: 30,
          text: "We changed our launch process and saved time by checking the work together.",
          confidence: 0.9,
        },
      ],
    },
  ],
});
const service = new EditIntelligenceService();
it("ingests timed SRT and preserves cue quotes and precise source time", () => {
  const data = sample();
  const clip = {
    ...data.clips[0],
    segments: [],
    srt: "1\n00:00:01,250 --> 00:00:04,500\nThe surprising launch lesson changed everything.",
  };
  const p = service.createPlan({ ...data, clips: [clip] });
  expect(p.recommendations[0].start).toBe(1.25);
  expect(p.recommendations[0].evidence.quotes[0]).toContain(
    "changed everything",
  );
});
it("rejects malformed timing, conflicting input forms, repeated IDs and out-of-range cues", () => {
  expect(() => parseSrt("broken")).toThrow();
  const d = sample();
  expect(() =>
    service.createPlan({ ...d, clips: [d.clips[0], d.clips[0]] }),
  ).toThrow("unique");
  expect(() =>
    service.createPlan({ ...d, clips: [{ ...d.clips[0], srt: "invalid" }] }),
  ).toThrow();
  d.clips[0].segments[1].end = 41;
  expect(() => service.createPlan(d)).toThrow("outside");
});
it("question/answer linkage, hooks, ranking and provenance remain explainable", () => {
  const p = service.createPlan(sample());
  const a = p.recommendations.find((r) => r.kind === "answer")!;
  expect(a.related_recommendation_ids).toHaveLength(2);
  expect(p.recommendations.some((r) => r.kind === "hook")).toBe(true);
  for (const r of p.recommendations) {
    expect(r.source_clip).toBe("clip-1");
    expect(r.evidence.source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.reason.length).toBeGreaterThan(15);
    expect(r.intended_destination).toBe("Reviewed interview");
    expect(r.confidence).toBeLessThanOrEqual(1);
  }
  expect(p.rough_cut.length).toBeGreaterThan(0);
});
it("transcript gaps do not masquerade as measured silence", () => {
  const p = service.createPlan(sample());
  expect(p.recommendations.some((r) => r.kind === "dead_space")).toBe(true);
  expect(p.recommendations.some((r) => r.kind === "silence")).toBe(false);
});
it("measured silence needs provenance, continuous windows and threshold duration", () => {
  const d = sample();
  const clip = {
    ...d.clips[0],
    audio_source_ref: "audio://rms/v1",
    audio_windows: [
      { start: 14, end: 15, rms_dbfs: -60 },
      { start: 15, end: 16, rms_dbfs: -50 },
      { start: 17, end: 17.3, rms_dbfs: -60 },
    ],
  };
  const p = service.createPlan({ ...d, clips: [clip] });
  const quiet = p.recommendations.filter((r) => r.kind === "silence");
  expect(quiet).toHaveLength(1);
  expect(quiet[0]).toMatchObject({ start: 14, end: 16 });
  expect(quiet[0].evidence.source_ref).toBe(clip.audio_source_ref);
  expect(() =>
    service.createPlan({
      ...d,
      clips: [{ ...clip, audio_source_ref: undefined }],
    }),
  ).toThrow("source reference");
});
it("overlapping speech uses union coverage and invalid audio overlaps fail", () => {
  const d = sample();
  d.clips[0].segments[0].end = 25;
  const p = service.createPlan(d);
  expect(
    p.recommendations.some((r) => r.kind === "dead_space" && r.start < 30),
  ).toBe(false);
  expect(() =>
    service.createPlan({
      ...d,
      clips: [
        {
          ...d.clips[0],
          audio_source_ref: "rms",
          audio_windows: [
            { start: 0, end: 2, rms_dbfs: -50 },
            { start: 1, end: 3, rms_dbfs: -60 },
          ],
        },
      ],
    }),
  ).toThrow("overlap");
});
it("duplicate wording is flagged without destructive take deletion or numeric/polarity merging", () => {
  const d = sample();
  const text = d.clips[0].segments[1].text;
  d.clips[0].segments.push({
    id: "dup",
    start: 30,
    end: 35,
    text,
    confidence: 0.9,
  });
  let p = service.createPlan(d);
  expect(
    p.recommendations.filter((r) => r.kind === "duplicate_take"),
  ).toHaveLength(1);
  expect(
    p.rough_cut.some(
      (c) =>
        p.recommendations.find((r) => r.id === c.recommendation_id)?.start ===
        30,
    ),
  ).toBe(false);
  d.clips[0].segments[3].text = text.replace("20", "30");
  p = service.createPlan(d);
  expect(p.recommendations.some((r) => r.kind === "duplicate_take")).toBe(
    false,
  );
});
it("cut budget does not truncate a sentence and nothing relevant invents nothing", () => {
  const p = service.createPlan({ ...sample(), target_seconds: 1 });
  expect(p.rough_cut).toEqual([]);
  expect(p.planned_seconds).toBe(0);
  const d = sample();
  d.clips[0].segments = [];
  expect(service.createPlan(d).recommendations).toEqual([]);
});
it("source input hashes change on correction; analysis never mutates caller input", () => {
  const d = sample(),
    saved = JSON.stringify(d);
  const p = service.createPlan(d);
  expect(JSON.stringify(d)).toBe(saved);
  expect(service.createPlan(d).input_hash).toBe(p.input_hash);
  d.clips[0].segments[1].text += " Corrected.";
  expect(service.createPlan(d).input_hash).not.toBe(p.input_hash);
});
it("instructions never fabricate range execution or source/sequence timing equivalence", () => {
  const p = service.createPlan(sample());
  expect(
    p.instructions.some(
      (i) => i.status === "manual_range_edit_required" && i.tool === null,
    ),
  ).toBe(true);
  expect(
    p.instructions
      .filter((i) => i.tool === "premiere.create_markers")
      .every((i) => i.status === "mapping_required"),
  ).toBe(true);
  expect(
    p.instructions.find((i) => i.tool === "premiere.export_sequence")?.status,
  ).toBe("preset_required");
  expect(sourceTimecode(1.25, 24)).toBe("00:00:01:06");
});
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  provider: PremiereProvider;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-edit-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  provider = {
    assertAvailable: vi.fn(),
    inspect: vi.fn(async () => ({
      revision: "rev-1",
      project_id: "p-1",
      project_name: "Disposable",
      project_path: "/test.prproj",
      sequence_id: "s-1",
      sequences: [{ id: "s-1", name: "Review" }],
      items: [],
      clips: [],
      complete: true,
    })),
    execute: vi.fn(async () => ({ marker_id: "m1" })),
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
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const analyze = () =>
  requests.request({
    tool: "edit.plan",
    input: sample(),
    request_key: randomUUID(),
  });
it("real action pipeline persists plans and evidence idempotently without calling Premiere", async () => {
  const req = { tool: "edit.plan", input: sample(), request_key: randomUUID() };
  const a = await requests.request(req),
    b = await requests.request(req);
  expect(b.result).toEqual(a.result);
  await expect(requests.remember(a.action_id)).rejects.toThrow(
    "action history",
  );
  expect(provider.inspect).not.toHaveBeenCalled();
  expect(provider.execute).not.toHaveBeenCalled();
  expect((await repo.get("actions", a.action_id))?.output.result).toMatchObject(
    { version: "edit-rules-v1" },
  );
  expect(
    (await repo.list("outcomes")).some((o) => o.action_id === a.action_id),
  ).toBe(true);
});
it("observe-only blocks edit recommendation", async () => {
  await new PermissionService(repo).savePolicy({
    tool: "edit.plan",
    reason: "Test recommendation boundary",
    level: 1,
  });
  await expect(analyze()).rejects.toThrow();
  expect(provider.execute).not.toHaveBeenCalled();
});
async function markerRequest() {
  const r = await analyze(),
    plan = r.result as unknown as EditPlan;
  return {
    tool: "edit.prepare_marker",
    source_action_id: r.action_id,
    input: {
      plan_action_id: r.action_id,
      recommendation_id: plan.recommendations.find((r) => r.kind === "marker")!
        .id,
      premiere_project_id: "p-1",
      sequence_id: "s-1",
      sequence_seconds: 12,
      mapping_note: "Verified source range at sequence 12 seconds",
    },
    request_key: randomUUID(),
  };
}
it("prepares exact executable markers from stored evidence; approval still required", async () => {
  const req = await markerRequest();
  const prepared = await requests.request(req);
  const r = prepared.result as any;
  expect(r.request.tool).toBe("premiere.create_markers");
  expect(r.request.input.args.markers[0].seconds).toBe(12);
  expect(r.request.input.args.markers[0].comments).toContain(
    req.source_action_id,
  );
  expect(provider.execute).not.toHaveBeenCalled();
  await expect(
    requests.request({
      ...r.request,
      source_action_id: req.source_action_id,
      request_key: randomUUID(),
    }),
  ).rejects.toThrow("Approval required");
  expect(provider.execute).not.toHaveBeenCalled();
});
it("source history permission and destination mismatch cannot be bypassed", async () => {
  const req = await markerRequest();
  await expect(
    requests.request({ ...req, input: { ...req.input, sequence_id: "wrong" } }),
  ).rejects.toThrow("destination");
  await new PermissionService(repo).savePolicy({
    tool: "activity.read",
    reason: "Test source boundary",
    level: 0,
  });
  await expect(
    requests.request({ ...req, request_key: randomUUID() }),
  ).rejects.toThrow();
});
it("missing/foreign source actions and invented recommendation IDs fail closed", async () => {
  const req = await markerRequest();
  await expect(
    requests.request({
      ...req,
      input: { ...req.input, recommendation_id: "invented" },
    }),
  ).rejects.toThrow("recommendation");
  await expect(
    requests.request({
      ...req,
      source_action_id: randomUUID(),
      request_key: randomUUID(),
    }),
  ).rejects.toThrow();
});

it("PCM silence analysis measures actual amplitude and all channels", () => {
  const quiet = new Float32Array(8000),
    loud = new Float32Array(8000).fill(0.5);
  expect(measureEditAudio([quiet], 8000).windows[0].rms_dbfs).toBe(-160);
  expect(measureEditAudio([loud], 8000).windows[0].rms_dbfs).toBeCloseTo(
    -6.0206,
  );
  expect(
    measureEditAudio([quiet, loud], 8000).windows[0].rms_dbfs,
  ).toBeGreaterThan(-10);
});
it("invalid and unbounded PCM inputs fail instead of fabricating silence", () => {
  expect(() => measureEditAudio([], 8000)).toThrow();
  expect(() => measureEditAudio([new Float32Array([NaN])], 8000)).toThrow();
  expect(() => measureEditAudio([new Float32Array(8000 * 251)], 8000)).toThrow(
    "250 seconds",
  );
});
