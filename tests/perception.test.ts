import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { PerceptionService } from "../src/services/perception-service";
import {
  FrameStore,
  FRAME_TTL,
  inspectImage,
} from "../src/infrastructure/perception/frame-store";
import {
  perceptionInput,
  type VisionProvider,
  type FrameReference,
  type VisionFinding,
} from "../src/domain/perception";
import { OpenAIVisionProvider } from "../src/infrastructure/providers/openai-vision";
import { handle } from "../src/server/http";
import { createRequire } from "node:module";
let dir: string,
  repo: LocalRepository,
  actions: ActionService,
  requests: ActionRequestService,
  service: PerceptionService,
  store: FrameStore,
  provider: VisionProvider,
  now: number;
const finding: VisionFinding = {
  summary: "Export dialog visible",
  observations: [{ frame: 1, evidence: "Export Media heading" }],
  differences: [],
  verification: {
    verdict: "supported",
    reason: "Visible dialog title",
    confidence: 0.8,
  },
  limitations: ["Dialog visibility does not prove export completed."],
};
const png = () => {
  const b = Buffer.alloc(64);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(b);
  b.write("IHDR", 12);
  b.writeUInt32BE(64, 16);
  b.writeUInt32BE(64, 20);
  return b;
};
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-perception-"));
  repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
  actions = new ActionService(repo);
  now = Date.now();
  store = new FrameStore(() => now);
  provider = {
    model: "fixture",
    analyze: vi.fn(async () => ({
      finding,
      model: "fixture",
      provider: "fixture",
      latency_ms: 1,
    })),
  };
  service = new PerceptionService(repo, actions, provider, store);
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
      undefined,
      undefined,
      service,
    ),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function approve(r: Record<string, unknown>) {
  await expect(requests.request(r)).rejects.toThrow("Approval required");
  const a = (await repo.list("actions"))
    .filter((a) => a.status === "approval_required")
    .at(-1)!;
  await actions.permissions.review(
    a.id,
    "approved",
    "Explicit fixture approval",
  );
  return a;
}
async function capture(source = "upload") {
  const r = {
    tool: `perception.capture_${source}`,
    input: { source_id: "fixture-source" },
    request_key: randomUUID(),
  };
  await approve(r);
  return (await requests.request(r)).result as { grant_id: string };
}
async function frame() {
  const g = await capture();
  return service.stage(g.grant_id, png());
}
const analyze = (frames: FrameReference[], extra = {}) => ({
  tool: "perception.analyze",
  input: {
    mode: "verify",
    question: "Is the export dialog visible?",
    frames,
    ...extra,
  },
  request_key: randomUUID(),
});
it("registers distinct source capabilities and analysis", async () => {
  const names = (await requests.catalog()).map((x) => x.name);
  for (const s of [
    "upload",
    "screenshot",
    "screen",
    "window",
    "studio_camera",
    "webcam",
  ])
    expect(names).toContain(`perception.capture_${s}`);
  expect(names).toContain("perception.analyze");
});
it.each([0, 1, 2, 3])(
  "source permission level %s cannot capture",
  async (level) => {
    await actions.permissions.savePolicy({
      tool: "perception.capture_webcam",
      level,
      reason: "Restrict",
    });
    await expect(
      requests.request({
        tool: "perception.capture_webcam",
        input: { source_id: "default" },
        request_key: randomUUID(),
      }),
    ).rejects.toThrow("not permitted");
    expect(provider.analyze).not.toHaveBeenCalled();
  },
);
it("autonomous policy still needs explicit source approval", async () => {
  await actions.permissions.savePolicy({
    tool: "perception.capture_screen",
    level: 5,
    reason: "Fixture",
  });
  await expect(
    requests.request({
      tool: "perception.capture_screen",
      input: { source_id: "selected" },
      request_key: randomUUID(),
    }),
  ).rejects.toThrow("Approval required");
});
it("rejected source produces no grant", async () => {
  const r = {
    tool: "perception.capture_upload",
    input: { source_id: "fixture" },
    request_key: randomUUID(),
  };
  await expect(requests.request(r)).rejects.toThrow();
  const pending = (await repo.list("actions")).at(-1)!;
  await actions.permissions.review(pending.id, "rejected", "No");
  await expect(requests.request(r)).rejects.toThrow();
  expect(() => store.getGrant(repo.userId, "invalid")).toThrow();
});
it("source grant is owner-bound, expiring and single use", async () => {
  const g = await capture();
  expect(() => store.getGrant(randomUUID(), g.grant_id)).toThrow();
  const f = await service.stage(g.grant_id, png());
  expect(f.source).toBe("upload");
  await expect(service.stage(g.grant_id, png())).rejects.toThrow("expired");
  const g2 = await capture();
  now += FRAME_TTL;
  expect(() => store.getGrant(repo.userId, g2.grant_id)).toThrow();
});
it("rejects unsupported bytes, oversized dimensions and caller URLs", () => {
  expect(() => inspectImage(Buffer.from("<svg>hello</svg>"))).toThrow();
  const b = png();
  b.writeUInt32BE(90000, 16);
  expect(() => inspectImage(b)).toThrow("dimensions");
  expect(
    perceptionInput.safeParse({
      mode: "inspect",
      question: "Read",
      frames: [{ url: "https://example.com/private" }],
    }).success,
  ).toBe(false);
});
it("stage checks source revocation before accepting bytes", async () => {
  const g = await capture();
  await actions.permissions.savePolicy({
    tool: "perception.capture_upload",
    level: 0,
    reason: "Revoke",
  });
  await expect(service.stage(g.grant_id, png())).rejects.toThrow(
    "Source permission changed",
  );
});
it("denied stage is audited without image bytes", async () => {
  const g = await capture();
  await actions.permissions.savePolicy({
    tool: "perception.stage",
    level: 0,
    reason: "Block",
  });
  await expect(service.stage(g.grant_id, png())).rejects.toThrow(
    "not permitted",
  );
  expect(JSON.stringify(await repo.list("actions"))).not.toContain(
    png().toString("base64"),
  );
});
it("analysis requires another approval and then consumes frames", async () => {
  const f = await frame(),
    r = analyze([f]);
  await approve(r);
  expect(provider.analyze).not.toHaveBeenCalled();
  const result = await requests.request(r);
  expect(result.result.images_retained).toBe(false);
  expect(() => store.get(repo.userId, f)).toThrow();
  const held = vi.mocked(provider.analyze).mock.calls[0][1][0].data;
  expect(held.every((x) => x === 0)).toBe(true);
  expect(JSON.stringify(await repo.list("actions"))).not.toContain(
    png().toString("base64"),
  );
  expect((await repo.list("memories")).length).toBe(0);
});
it("replaying successful analysis never calls the model again", async () => {
  const r = analyze([await frame()]);
  await approve(r);
  await requests.request(r);
  await requests.request(r);
  expect(provider.analyze).toHaveBeenCalledTimes(1);
});
it("failed analysis clears images and records failure", async () => {
  vi.mocked(provider.analyze).mockRejectedValue(
    Error("fixture provider failure"),
  );
  const f = await frame(),
    r = analyze([f]);
  await approve(r);
  await expect(requests.request(r)).rejects.toThrow();
  expect(() => store.get(repo.userId, f)).toThrow();
  expect(
    (await repo.list("actions")).some(
      (a) => a.tool_name === "perception.analyze" && a.status === "failed",
    ),
  ).toBe(true);
});
it("expiry zeroes staged buffers", async () => {
  const f = await frame(),
    data = store.get(repo.userId, f).data;
  now += FRAME_TTL;
  store.sweep();
  expect(data.every((x) => x === 0)).toBe(true);
  expect(() => store.get(repo.userId, f)).toThrow();
});
it("owner clear cannot erase another owner's image", async () => {
  const f = await frame();
  store.remove(randomUUID(), f.id);
  expect(store.get(repo.userId, f)).toBeTruthy();
  await service.clear([f.id]);
  expect(() => store.get(repo.userId, f)).toThrow();
});
it("rejects tampered frame hashes before provider invocation", async () => {
  const f = await frame();
  f.sha256 = "b".repeat(64);
  const r = analyze([f]);
  await approve(r);
  await expect(requests.request(r)).rejects.toThrow("does not match");
  expect(provider.analyze).not.toHaveBeenCalled();
});
it("comparison requires two unique ordered frames", async () => {
  const f = await frame();
  expect(
    perceptionInput.safeParse({ ...analyze([f]).input, mode: "compare" })
      .success,
  ).toBe(false);
  expect(
    perceptionInput.safeParse({ ...analyze([f, f]).input, mode: "compare" })
      .success,
  ).toBe(false);
  const f2 = await frame(),
    r = analyze([f, f2], { mode: "compare" });
  await approve(r);
  await requests.request(r);
  expect(
    vi.mocked(provider.analyze).mock.calls[0][0].frames.map((x) => x.id),
  ).toEqual([f.id, f2.id]);
});
it("source revocation blocks analysis even after its own approval", async () => {
  const f = await frame(),
    r = analyze([f]);
  await approve(r);
  await actions.permissions.savePolicy({
    tool: "perception.capture_upload",
    level: 0,
    reason: "Revoke",
  });
  await expect(requests.request(r)).rejects.toThrow(
    "Source permission changed",
  );
  expect(provider.analyze).not.toHaveBeenCalled();
});
it("rejects foreign action links", async () => {
  await expect(
    requests.request(
      analyze([await frame()], { related_action_id: randomUUID() }),
    ),
  ).rejects.toThrow("not found");
});
it("analysis evidence never overwrites the original action outcome", async () => {
  const original = await actions.run("mock.observe", null, async () => true);
  void original;
  const action = (await repo.list("actions")).at(-1)!;
  const f = await frame(),
    r = analyze([f], { related_action_id: action.id });
  await approve(r);
  await requests.request(r);
  expect(await repo.get("actions", action.id)).toEqual(action);
});
it("cross-origin staging is rejected before body handling", async () => {
  const r = await handle(
    new Request("http://127.0.0.1:3000/api/perception/frames", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: png(),
    }),
    ["perception", "frames"],
  );
  expect(r.status).toBe(403);
});
it("desktop screen permission stays origin-bound and unknown permissions stay denied", () => {
  const { allowPermission } = createRequire(import.meta.url)(
    "../desktop/security.cjs",
  );
  expect(allowPermission("display-capture", "http://127.0.0.1:3000")).toBe(
    true,
  );
  expect(allowPermission("display-capture", "https://evil.example")).toBe(
    false,
  );
  expect(allowPermission("geolocation", "http://127.0.0.1:3000")).toBe(false);
});
it("OpenAI sends only reviewed images/question, with storage disabled and no tools", async () => {
  const metrics: unknown[] = [];
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  const fetcher = vi.fn(async () =>
    Response.json({
      model: "fixture-vision",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(finding) }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const vision = new OpenAIVisionProvider(async (m) => {
    metrics.push(m);
  }, "fixture-vision");
  const f = await frame();
  await vision.analyze(analyze([f]).input as never, [
    { data: png(), mime: "image/png" },
  ]);
  const sent = JSON.parse(
    (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as string,
  );
  expect(sent.store).toBe(false);
  expect(sent.tools).toBeUndefined();
  expect(sent.input[0].content[2].type).toBe("input_image");
  expect(JSON.stringify(sent)).not.toContain(repo.userId);
  expect(JSON.stringify(metrics)).not.toContain("base64");
});
it("OpenAI rejects invalid visual evidence rather than reporting success", async () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture");
  vi.stubGlobal("fetch", async () =>
    Response.json({
      model: "fixture",
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...finding,
                observations: [{ frame: 2, evidence: "Not supplied" }],
              }),
            },
          ],
        },
      ],
    }),
  );
  const vision = new OpenAIVisionProvider(async () => {}, "fixture");
  await expect(
    vision.analyze(analyze([await frame()]).input as never, [
      { data: png(), mime: "image/png" },
    ]),
  ).rejects.toThrow("invalid_frame_reference");
});
