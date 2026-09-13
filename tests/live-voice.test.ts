import { liveTiming } from "../src/components/voice/live-timing";
import { afterEach, expect, it, vi } from "vitest";
import { OpenAILiveProvider } from "../src/infrastructure/providers/openai-live";
import {
  LiveVoiceService,
  startLiveSession,
  liveSession,
} from "../src/services/live-voice-service";
import type { LiveEvent } from "../src/domain/live-voice";
afterEach(() => vi.useRealTimers());
function fixture(
  respond: any = async function* () {
    yield { type: "response", message: { content: "Nexus result" } };
  },
) {
  let emit: (e: LiveEvent) => void = () => {};
  const send = vi.fn(),
    close = vi.fn();
  const provider = {
    model: "gpt-live-1",
    create: vi.fn(async () => ({ id: "opaque", sdp: "answer" })),
    attach: vi.fn(async (_id: string, e: any) => {
      emit = e;
      return { send, close };
    }),
  };
  const repository: any = {
    userId: crypto.randomUUID(),
    batch: vi.fn(async () => {}),
    insert: vi.fn(async (_t: string, v: any) => ({
      id: crypto.randomUUID(),
      ...v,
    })),
  };
  const actions: any = {
    run: vi.fn(async (_t: string, _c: string, f: any) => f()),
  };
  const brain = { respond: vi.fn(respond) },
    reconciliation = { runJob: vi.fn(async () => []) };
  const finished = vi.fn();
  const service = new LiveVoiceService(
    provider,
    repository,
    brain,
    actions,
    reconciliation,
    "conversation",
    finished,
  );
  return {
    provider,
    repository,
    actions,
    brain,
    reconciliation,
    finished,
    service,
    send,
    close,
    emit: (e: LiveEvent) => emit(e),
  };
}
const transcript = (text = "Remember Wag Trails", end = 100) => ({
  type: "session.input_transcript.delta",
  event_id: `t${end}`,
  delta: text,
  start_ms: 0,
  end_ms: end,
});
const delegation = (id = "d1", offset = 200) => ({
  type: "session.delegation.created",
  event_id: `e${id}`,
  offset_ms: offset,
  delegation: { id, target: "client" },
});
it("uses distinct Live WebRTC endpoint, no unsupported session.type or Responses backend", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          session: { id: "live_x" },
          transport: { type: "webrtc", sdp: "answer" },
        }),
      ),
  );
  expect(
    await new OpenAILiveProvider("secret", fetcher as any).create(
      "offer",
      new AbortController().signal,
    ),
  ).toEqual({ id: "live_x", sdp: "answer" });
  const [url, request] = fetcher.mock.calls[0] as any;
  expect(url).toBe("https://api.openai.com/v1/live/sessions");
  const body = JSON.parse(request.body);
  expect(body.session.delegation).toEqual({ type: "client" });
  expect(body.session.store).toBe(false);
  expect(body.session.type).toBeUndefined();
  expect(body.transport).toEqual({ type: "webrtc", sdp: "offer" });
});
it("provider error never exposes key or response body", async () => {
  const p = new OpenAILiveProvider(
    "secret",
    (async () => new Response("secret private SDP", { status: 401 })) as any,
  );
  await expect(p.create("offer", new AbortController().signal)).rejects.toThrow(
    /^LIVE_HTTP_401$/,
  );
});
it("ordinary transcripts do not invoke Brain", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.start("offer");
  f.emit(transcript("Hello"));
  expect(f.brain.respond).not.toHaveBeenCalled();
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
});
it("delegation calls canonical Brain with supplied conversation and returns same delegation id", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.start("offer");
  f.emit(transcript());
  f.emit(delegation());
  await Promise.resolve();
  await Promise.resolve();
  expect(f.brain.respond).toHaveBeenCalledWith(
    {
      input: "Remember Wag Trails",
      conversation_id: "conversation",
      modality: "voice",
    },
    expect.anything(),
  );
  expect(f.send).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "session.commentary.append",
      delegation_id: "d1",
      content: "Nexus result",
    }),
  );
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
});
it("duplicate delegation id cannot replay Brain, even under a different event id", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.start("offer");
  f.emit(transcript());
  f.emit(delegation());
  f.emit({ ...delegation(), event_id: "other" });
  expect(f.brain.respond).toHaveBeenCalledTimes(1);
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
});
it("later delegation excludes previously dispatched request", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.start("offer");
  f.emit(transcript("Open Premiere"));
  f.emit(delegation());
  f.emit(transcript("What do you remember?", 300));
  f.emit(delegation("d2", 400));
  expect(f.brain.respond.mock.calls[1][0]).toMatchObject({
    input: "What do you remember?",
  });
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
});
it("interruption fences late Brain result without restarting provider", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r));
  const f = fixture(async function* () {
    await pending;
    yield { type: "response", message: { content: "stale" } };
  });
  await f.service.start("offer");
  f.emit(transcript());
  f.emit(delegation());
  f.service.interrupt();
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(
    f.send.mock.calls.some(([e]) => e.type === "session.commentary.append"),
  ).toBe(false);
  expect(f.provider.create).toHaveBeenCalledTimes(1);
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
});
it("close is idempotent and retains evidence through existing extraction gate", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.start("offer");
  f.emit(transcript());
  f.service.stop();
  f.service.stop();
  expect(
    f.send.mock.calls.filter(([e]) => e.type === "session.close"),
  ).toHaveLength(1);
  f.emit({ type: "session.closed" });
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.repository.batch).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        table: "messages",
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            not_authoritative_turns: true,
            finalized: true,
          }),
        }),
      }),
      expect.objectContaining({ table: "extraction_jobs" }),
    ]),
  );
  expect(f.reconciliation.runJob).toHaveBeenCalledTimes(1);
});
it("unconfirmed closure does not extract incomplete evidence", async () => {
  vi.useFakeTimers();
  const f = fixture();
  await f.service.start("offer");
  f.emit(transcript());
  f.service.stop();
  await vi.advanceTimersByTimeAsync(5001);
  expect(f.reconciliation.runJob).not.toHaveBeenCalled();
});
it("one session in flight per owner, owner isolation", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>((r) => (release = r));
  f.provider.create.mockImplementationOnce(async () => {
    await pending;
    return { id: "remote", sdp: "answer" };
  });
  const input = { ...f, conversationId: "conversation", sdp: "offer" };
  const first = startLiveSession(input);
  await expect(startLiveSession(input)).rejects.toThrow("already active");
  release();
  const result = await first;
  expect(() => liveSession("other", result.id)).toThrow("not found");
  liveSession(f.repository.userId, result.id).stop();
  f.emit({ type: "session.closed" });
  await vi.runAllTimersAsync();
});

it("timing reports no invented sample when no actual output estimate exists", () => {
  expect(liveTiming([])).toMatchObject({
    samples: 0,
    p50_ms: null,
    p95_ms: null,
  });
});
it("timing excludes overlapping speech and uses observed nearest-rank percentiles", () => {
  const events: any = [
    { name: "user_speech_ended", ms: 100 },
    { name: "first_audio_played_estimate", ms: 800 },
    { name: "user_speech_ended", ms: 900 },
    { name: "user_speech_started", ms: 950 },
    { name: "first_audio_played_estimate", ms: 1000 },
  ];
  expect(liveTiming(events)).toMatchObject({
    samples: 1,
    p50_ms: 700,
    p95_ms: 700,
  });
});

it("command bridge uses registered requests, requires exact approval and never invokes a desktop adapter", async () => {
  const { liveCommandBridge } =
    await import("../src/services/live-command-bridge");
  const { ApprovalRequiredError } =
    await import("../src/services/action-service");
  const repo: any = { insert: vi.fn(async () => ({ id: "source" })) };
  const request = vi.fn(async (raw: any) => {
    if (raw.tool === "desktop.list_apps")
      return {
        result: {
          apps: [
            {
              id: "com.adobe.PremierePro",
              name: "Adobe Premiere Pro",
              path: "/Applications/Adobe Premiere Pro.app",
            },
          ],
        },
      };
    throw new ApprovalRequiredError("approval-id", raw.tool);
  });
  const result = await liveCommandBridge(repo, { request } as any)(
    "Open Premiere",
    "delegation-key",
    "conversation",
    new AbortController().signal,
  );
  expect(result).toContain("Approval is required");
  expect(request.mock.calls[1][0]).toMatchObject({
    tool: "desktop.launch_app",
    request_key: "delegation-key:launch",
    source_message_id: "source",
    input: { app_id: "com.adobe.PremierePro" },
  });
});
it("ambiguous installed apps do not dispatch a launch", async () => {
  const { liveCommandBridge } =
    await import("../src/services/live-command-bridge");
  const request = vi.fn(async () => ({
    result: {
      apps: [
        { id: "com.adobe.PremierePro", name: "Premiere 2025", path: "/a" },
        { id: "com.adobe.PremiereProBeta", name: "Premiere Beta", path: "/b" },
      ],
    },
  }));
  await liveCommandBridge(
    { insert: async () => ({ id: "source" }) } as any,
    { request } as any,
  )("Open Premiere", "key", "conversation", new AbortController().signal);
  expect(request).toHaveBeenCalledTimes(1);
});

it("Live wake activator does not report ACTIVE until session.started and prevents concurrent starts", async () => {
  const { LiveVoiceActivator } =
    await import("../src/components/voice/live-voice-activator");
  let emit!: (s: string) => void;
  const client = { start: vi.fn(async () => {}), dispose: vi.fn() };
  const factory = vi.fn((callback: any) => {
    emit = callback;
    return client;
  });
  const activator = new LiveVoiceActivator(() => {}, factory);
  const input: any = { conversation_id: "existing", wake: {} };
  let active = false;
  const first = activator.start(input).then(() => {
    active = true;
  });
  const second = activator.start(input);
  await Promise.resolve();
  expect(active).toBe(false);
  expect(factory).toHaveBeenCalledTimes(1);
  emit("Connected");
  await first;
  await second;
  expect(active).toBe(true);
  await activator.stop();
  expect(client.dispose).toHaveBeenCalledTimes(1);
});
it("Live wake stop cancels pending activation and is idempotent", async () => {
  const { LiveVoiceActivator } =
    await import("../src/components/voice/live-voice-activator");
  const client = { start: vi.fn(async () => {}), dispose: vi.fn() };
  const activator = new LiveVoiceActivator(
    () => {},
    () => client,
  );
  const start = activator.start({
    conversation_id: "existing",
    wake: {},
  } as any);
  const rejected = expect(start).rejects.toThrow("LIVE_ACTIVATION_CANCELLED");
  await activator.stop();
  await rejected;
  await activator.stop();
  expect(client.dispose).toHaveBeenCalledTimes(1);
});
