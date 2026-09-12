import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  RealtimeVoiceAudioFrame,
  RealtimeVoiceEvent,
  RealtimeVoiceSession,
  RealtimeVoiceSessionConfig,
  RealtimeVoiceSessionProvider,
  RealtimeVoiceSessionState,
} from "../src/domain/realtime-voice";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  REALTIME_FRAME_BYTES,
  REALTIME_MAX_BATCH_BYTES,
  RealtimeVoiceRelayService,
} from "../src/services/realtime-voice-relay-service";
import { context } from "../src/server/context";
import { handle } from "../src/server/http";

vi.mock("../src/server/context", () => ({
  context: vi.fn(),
  isDemo: () => true,
}));

class FakeRealtimeSession implements RealtimeVoiceSession {
  readonly id = randomUUID();
  readonly nexus_conversation_id: string;
  readonly provider_session_id = "provider-session";
  state: RealtimeVoiceSessionState = "IDLE";
  readonly frames: Uint8Array[] = [];
  closeCalls = 0;
  private closed = false;
  private readonly listeners = new Set<(event: RealtimeVoiceEvent) => void>();

  constructor(conversationId: string) {
    this.nexus_conversation_id = conversationId;
  }

  sendAudio(frame: RealtimeVoiceAudioFrame) {
    if (this.closed) throw new Error("Realtime voice session is closed");
    this.frames.push(
      frame.data instanceof Uint8Array
        ? new Uint8Array(frame.data)
        : new Uint8Array(frame.data),
    );
  }

  interrupt() {}

  async close() {
    this.closeCalls += 1;
    this.closed = true;
  }

  onEvent(listener: (event: RealtimeVoiceEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RealtimeVoiceEvent) {
    if (event.type === "state") this.state = event.state;
    this.listeners.forEach((listener) => listener(event));
  }
}

class FakeRealtimeProvider implements RealtimeVoiceSessionProvider {
  readonly id = "fixture-realtime";
  readonly configs: RealtimeVoiceSessionConfig[] = [];
  readonly sessions: FakeRealtimeSession[] = [];
  readonly createSessionMock = vi.fn(
    async (config: RealtimeVoiceSessionConfig) => {
      this.configs.push(config);
      const session = new FakeRealtimeSession(config.conversation_id);
      this.sessions.push(session);
      return session;
    },
  );

  capabilities() {
    return ["audio_input"] as const;
  }

  availability() {
    return "AVAILABLE" as const;
  }

  async createSession(config: RealtimeVoiceSessionConfig) {
    return this.createSessionMock(config);
  }
}

let directory: string;
let repository: LocalRepository;
let conversationId: string;
let provider: FakeRealtimeProvider;
let relay: RealtimeVoiceRelayService;
let currentRepository: LocalRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ary-realtime-relay-"));
  repository = new LocalRepository(randomUUID(), join(directory, "repo.json"));
  currentRepository = repository;
  const conversation = await repository.insert("conversations", {
    title: "Realtime relay test",
    metadata: {},
  });
  conversationId = conversation.id;
  provider = new FakeRealtimeProvider();
  relay = new RealtimeVoiceRelayService(provider);
  vi.mocked(context).mockImplementation(
    async () =>
      ({
        repository: currentRepository,
        realtimeVoice: provider,
      }) as never,
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

function request(
  method: string,
  path: string,
  body?: BodyInit,
  contentType?: string,
) {
  return new Request(`http://127.0.0.1:3000/api/${path}`, {
    method,
    headers: {
      host: "127.0.0.1:3000",
      ...(method === "GET" ? {} : { origin: "http://127.0.0.1:3000" }),
      ...(contentType ? { "content-type": contentType } : {}),
    },
    ...(body === undefined ? {} : { body }),
  });
}

async function startSession() {
  return handle(
    request(
      "POST",
      "realtime/session/start",
      JSON.stringify({ conversation_id: conversationId }),
      "application/json",
    ),
    ["realtime", "session", "start"],
    undefined,
    { realtimeRelay: relay },
  );
}

async function relayRequest(
  method: string,
  relayId: string,
  operation: "audio" | "status" | "stop",
  body?: BodyInit,
) {
  return handle(
    request(
      method,
      `realtime/session/${relayId}/${operation}`,
      body,
      operation === "audio" ? "application/octet-stream" : undefined,
    ),
    ["realtime", "session", relayId, operation],
    undefined,
    { realtimeRelay: relay },
  );
}

describe("authenticated local realtime relay", () => {
  it("starts one owner-scoped canonical provider session without exposing provider identity", async () => {
    const response = await startSession();
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({
      relay_state: "ACTIVE",
      frame_bytes: REALTIME_FRAME_BYTES,
      max_batch_frames: 5,
      max_batch_bytes: REALTIME_MAX_BATCH_BYTES,
      batch_duration_ms: 100,
    });
    expect(result.provider_session_id).toBeUndefined();
    expect(provider.createSessionMock).toHaveBeenCalledOnce();
    expect(provider.configs[0]).toMatchObject({
      user_id: repository.userId,
      conversation_id: conversationId,
      classic_fallback_available: false,
    });
  });

  it("rejects a second active session for the same owner", async () => {
    const first = await startSession();
    expect(first.status).toBe(201);
    const second = await startSession();
    expect(second.status).toBe(409);
    expect(provider.createSessionMock).toHaveBeenCalledOnce();
  });

  it("locks concurrent starts while the canonical provider session is pending", async () => {
    let release!: () => void;
    provider.createSessionMock.mockImplementationOnce(
      (config) =>
        new Promise((resolve) => {
          release = () => {
            const session = new FakeRealtimeSession(config.conversation_id);
            provider.configs.push(config);
            provider.sessions.push(session);
            resolve(session);
          };
        }),
    );
    const first = relay.start(repository.userId, conversationId);
    await Promise.resolve();
    await expect(
      relay.start(repository.userId, conversationId),
    ).rejects.toMatchObject({
      status: 409,
    });
    release();
    await first;
    expect(provider.createSessionMock).toHaveBeenCalledOnce();
  });

  it("forwards five exact 960-byte frames and reports bounded counters", async () => {
    const started = await startSession();
    const relayId = (await started.json()).relay_id as string;
    const batch = Uint8Array.from(
      { length: REALTIME_MAX_BATCH_BYTES },
      (_, index) => index % 256,
    );
    const response = await relayRequest("POST", relayId, "audio", batch);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      relay_id: relayId,
      frames_forwarded: 5,
      bytes_forwarded: REALTIME_MAX_BATCH_BYTES,
    });
    expect(provider.sessions[0].frames).toHaveLength(5);
    provider.sessions[0].frames.forEach((frame, index) => {
      expect(frame).toHaveLength(REALTIME_FRAME_BYTES);
      expect(frame[0]).toBe((index * REALTIME_FRAME_BYTES) % 256);
      expect(frame[REALTIME_FRAME_BYTES - 1]).toBe(
        (index * REALTIME_FRAME_BYTES + REALTIME_FRAME_BYTES - 1) % 256,
      );
    });
    const status = await relayRequest("GET", relayId, "status");
    expect(await status.json()).toMatchObject({
      relay_state: "ACTIVE",
      frames_forwarded: 5,
      bytes_forwarded: REALTIME_MAX_BATCH_BYTES,
    });
  });

  it.each([
    { label: "empty", body: new Uint8Array(), status: 400 },
    { label: "partial frame", body: new Uint8Array(1), status: 400 },
    {
      label: "oversized",
      body: new Uint8Array(REALTIME_MAX_BATCH_BYTES + 1),
      status: 413,
    },
  ])(
    "rejects $label audio batches before forwarding",
    async ({ body, status }) => {
      const started = await startSession();
      const relayId = (await started.json()).relay_id as string;
      const response = await relayRequest("POST", relayId, "audio", body);
      expect(response.status).toBe(status);
      expect(provider.sessions[0].frames).toEqual([]);
    },
  );

  it("rejects unknown and foreign-owner relays", async () => {
    const started = await startSession();
    const relayId = (await started.json()).relay_id as string;
    expect((await relayRequest("GET", randomUUID(), "status")).status).toBe(
      404,
    );
    const foreignRepository = new LocalRepository(
      randomUUID(),
      join(directory, "foreign.json"),
    );
    currentRepository = foreignRepository;
    expect(
      (await relayRequest("POST", relayId, "audio", new Uint8Array(960)))
        .status,
    ).toBe(404);
    expect((await relayRequest("GET", relayId, "status")).status).toBe(404);
    expect((await relayRequest("POST", relayId, "stop")).status).toBe(404);
  });

  it("never exposes audio bytes in status metadata", async () => {
    const started = await startSession();
    const relayId = (await started.json()).relay_id as string;
    const secret = new TextEncoder().encode("private-pcm-fixture");
    const frame = new Uint8Array(REALTIME_FRAME_BYTES);
    frame.set(secret);
    await relayRequest("POST", relayId, "audio", frame);
    const status = await relayRequest("GET", relayId, "status");
    const serialized = JSON.stringify(await status.json());
    expect(serialized).not.toContain("private-pcm-fixture");
    expect(serialized).not.toContain("input_audio_buffer.append");
    expect(serialized).not.toContain("base64");
  });

  it("tracks bounded events and cleans up after provider failure", async () => {
    const started = await startSession();
    const relayId = (await started.json()).relay_id as string;
    const session = provider.sessions[0];
    session.emit({ type: "speech_start", turn_id: "turn" });
    session.emit({ type: "speech_end", turn_id: "turn" });
    expect(
      await (await relayRequest("GET", relayId, "status")).json(),
    ).toMatchObject({
      speech_start_seen: true,
      speech_end_seen: true,
    });
    session.emit({
      type: "failure",
      failure: {
        code: "provider_unavailable",
        message: "fixture failure",
        retryable: true,
      },
    });
    await Promise.resolve();
    expect(session.closeCalls).toBe(1);
    expect((await relayRequest("GET", relayId, "status")).status).toBe(404);
  });

  it("retains owner-only bounded terminal evidence for the live harness", async () => {
    const started = await startSession();
    const relayId = (await started.json()).relay_id as string;
    provider.sessions[0].emit({
      type: "failure",
      failure: {
        code: "invalid_audio",
        message: "private details",
        retryable: false,
      },
    });
    expect(relay.status(repository.userId, relayId)).toBeNull();
    expect(relay.status(repository.userId, relayId, true)).toMatchObject({
      relay_state: "CLOSED",
      realtime_state: "FAILED",
      failure_code: "invalid_audio",
    });
    expect(
      JSON.stringify(relay.status(repository.userId, relayId, true)),
    ).not.toContain("private details");
    expect(relay.status(randomUUID(), relayId, true)).toBeNull();
  });

  it("stops exactly once and makes repeated stop safe", async () => {
    const started = await startSession();
    const relayId = (await started.json()).relay_id as string;
    expect((await relayRequest("POST", relayId, "stop")).status).toBe(200);
    expect((await relayRequest("POST", relayId, "stop")).status).toBe(200);
    expect(provider.sessions[0].closeCalls).toBe(1);
  });

  it("expires abandoned sessions and closes the provider session", async () => {
    vi.useFakeTimers();
    const expiring = new RealtimeVoiceRelayService(provider, { ttlMs: 1000 });
    const started = await expiring.start(repository.userId, conversationId);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(provider.sessions[0].closeCalls).toBe(1);
    expect(expiring.status(repository.userId, started.relay_id)).toBeNull();
  });

  it("rejects cross-origin writes before the relay or provider runs", async () => {
    const response = await handle(
      new Request("http://127.0.0.1:3000/api/realtime/session/start", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://attacker.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }),
      ["realtime", "session", "start"],
      undefined,
      { realtimeRelay: relay },
    );
    expect(response.status).toBe(403);
    expect(provider.createSessionMock).not.toHaveBeenCalled();
  });
});
