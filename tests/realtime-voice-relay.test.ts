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
  resolveRealtimeRelay,
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
const capabilities = new Map<string, string>();
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
  for (const [id, capability] of capabilities) {
    try {
      const { manager, userId } = resolveRealtimeRelay(id, capability);
      await manager.stop(userId, id);
    } catch {}
  }
  capabilities.clear();
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
  const response = await handle(
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
  if (response.ok) {
    const started = await response.clone().json();
    capabilities.set(started.relay_id, started.relay_capability);
  }
  return response;
}

async function relayRequest(
  method: string,
  relayId: string,
  operation: "audio" | "status" | "stop" | "output",
  body?: BodyInit,
) {
  const req = request(
    method,
    `realtime/session/${relayId}/${operation}`,
    body,
    operation === "audio" ? "application/octet-stream" : undefined,
  );
  const capability = capabilities.get(relayId);
  if (capability) req.headers.set("X-Ary-Realtime-Relay", capability);
  return handle(req, ["realtime", "session", relayId, operation], undefined, {
    realtimeRelay: relay,
  });
}

describe("authenticated local realtime relay", () => {
  it("starts one owner-scoped canonical provider session without exposing provider identity", async () => {
    const response = await startSession();
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({
      relay_state: "ACTIVE",
      frame_bytes: REALTIME_FRAME_BYTES,
      max_batch_frames: 15,
      max_batch_bytes: REALTIME_MAX_BATCH_BYTES,
      batch_duration_ms: 300,
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

  it("forwards fifteen exact 960-byte frames and reports bounded counters", async () => {
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
      frames_forwarded: 15,
      bytes_forwarded: REALTIME_MAX_BATCH_BYTES,
    });
    expect(provider.sessions[0].frames).toHaveLength(15);
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
      frames_forwarded: 15,
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
    const foreign = await relay.start(foreignRepository.userId, randomUUID());
    capabilities.set(foreign.relay_id, foreign.relay_capability);
    // Another owner's capability cannot authorize this owner's relay, even with a valid login.
    capabilities.set(relayId, foreign.relay_capability);
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
    expect((await relayRequest("POST", relayId, "stop")).status).toBe(404);
    // Trusted internal stop remains idempotent, but revoked capabilities are rejected.
    await relay.stop(repository.userId, relayId);
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
    expect(() =>
      resolveRealtimeRelay(started.relay_id, started.relay_capability),
    ).toThrow();
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

describe("ephemeral relay capability hot path", () => {
  it("requires canonical authentication and an owned conversation at start", async () => {
    const { AppError } = await import("../src/domain/validation");
    vi.mocked(context).mockRejectedValueOnce(
      new AppError("Sign in to continue", 401),
    );
    expect((await startSession()).status).toBe(401);
    currentRepository = new LocalRepository(
      randomUUID(),
      join(directory, "other.json"),
    );
    expect((await startSession()).status).toBe(404);
    expect(provider.createSessionMock).not.toHaveBeenCalled();
  });

  it("issues distinct 256-bit capabilities only in start, not status, output, storage, or logs", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const first = await (await startSession()).json();
    expect(first.relay_capability).toMatch(/^[a-f0-9]{64}$/);
    const second = await relay.start(randomUUID(), randomUUID());
    capabilities.set(second.relay_id, second.relay_capability);
    expect(first.relay_capability).not.toBe(second.relay_capability);
    const status = await (
      await relayRequest("GET", first.relay_id, "status")
    ).text();
    const output = await relayRequest("POST", first.relay_id, "output");
    const reader = output.body!.getReader();
    const ready = new TextDecoder().decode((await reader.read()).value);
    await relayRequest("POST", first.relay_id, "audio", new Uint8Array(14400));
    await relayRequest("POST", first.relay_id, "stop");
    await reader.cancel();
    const { readFile } = await import("node:fs/promises");
    for (const text of [
      status,
      ready,
      await readFile(join(directory, "repo.json"), "utf8"),
      JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls]),
    ]) {
      expect(text).not.toContain(first.relay_capability);
      expect(text).not.toContain("capability_digest");
    }
    expect(status).not.toContain("user_id");
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it("audio, status, output and stop never invoke context or construct services", async () => {
    const started = await (await startSession()).json();
    expect(context).toHaveBeenCalledOnce();
    vi.mocked(context)
      .mockClear()
      .mockRejectedValue(new Error("Full context must never run"));
    expect(
      (
        await relayRequest(
          "POST",
          started.relay_id,
          "audio",
          new Uint8Array(14400),
        )
      ).status,
    ).toBe(200);
    expect((await relayRequest("GET", started.relay_id, "status")).status).toBe(
      200,
    );
    const output = await relayRequest("POST", started.relay_id, "output");
    expect(output.status).toBe(200);
    expect((await relayRequest("POST", started.relay_id, "stop")).status).toBe(
      200,
    );
    await output.body!.cancel();
    expect(context).not.toHaveBeenCalled();
    expect(provider.createSessionMock).toHaveBeenCalledOnce();
  });

  it.each(["audio", "status", "output", "stop"] as const)(
    "rejects missing/wrong/other-relay capability on %s without falling through to authentication",
    async (operation) => {
      const started = await (await startSession()).json();
      vi.mocked(context).mockClear();
      const second = await relay.start(randomUUID(), randomUUID());
      capabilities.set(second.relay_id, second.relay_capability);
      for (const invalid of [
        null,
        "bad",
        "0".repeat(64),
        second.relay_capability,
      ]) {
        const req = request(
          operation === "status" ? "GET" : "POST",
          `realtime/session/${started.relay_id}/${operation}`,
        );
        if (invalid) req.headers.set("X-Ary-Realtime-Relay", invalid);
        // Possession of a relay ID or a different owner's credential is not authority.
        req.headers.set("Authorization", "Bearer unrelated-owner-login");
        expect(
          (
            await handle(req, [
              "realtime",
              "session",
              started.relay_id,
              operation,
            ])
          ).status,
        ).toBe(404);
      }
      expect(context).not.toHaveBeenCalled();
      expect(provider.sessions[0].frames).toEqual([]);
    },
  );

  it("invalidates the locator immediately on stop, failure, remote close and clock expiry", async () => {
    let now = new Date();
    const manager = new RealtimeVoiceRelayService(provider, {
      now: () => now,
      ttlMs: 1000,
    });
    for (const mode of ["stop", "failure", "closed", "ttl"]) {
      const started = await manager.start(repository.userId, conversationId);
      expect(
        resolveRealtimeRelay(started.relay_id, started.relay_capability)
          .manager,
      ).toBe(manager);
      if (mode === "stop")
        await manager.stop(repository.userId, started.relay_id);
      if (mode === "failure")
        provider.sessions.at(-1)!.emit({
          type: "failure",
          failure: {
            code: "PROVIDER_FAILURE",
            message: "fixture",
            retryable: false,
          },
        });
      if (mode === "closed")
        provider.sessions.at(-1)!.emit({ type: "state", state: "CLOSED" });
      if (mode === "ttl") now = new Date(now.getTime() + 1000);
      expect(() =>
        resolveRealtimeRelay(started.relay_id, started.relay_capability),
      ).toThrow();
      expect(() =>
        resolveRealtimeRelay(started.relay_id, started.relay_capability),
      ).toThrow();
      expect(provider.sessions.at(-1)!.closeCalls).toBe(1);
    }
  });

  it("retains same-origin and production restrictions before capability resolution", async () => {
    const started = await (await startSession()).json();
    vi.mocked(context).mockClear();
    const req = request(
      "POST",
      `realtime/session/${started.relay_id}/audio`,
      new Uint8Array(960),
    );
    req.headers.set("X-Ary-Realtime-Relay", started.relay_capability);
    req.headers.set("origin", "https://attacker.example");
    expect(
      (await handle(req, ["realtime", "session", started.relay_id, "audio"]))
        .status,
    ).toBe(403);
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(
        (await relayRequest("GET", started.relay_id, "status")).status,
      ).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(context).not.toHaveBeenCalled();
  });
});

it("revokes capability after an uncertain provider append failure rather than leaving a retryable live relay", async () => {
  const started = await (await startSession()).json();
  vi.spyOn(provider.sessions[0], "sendAudio").mockImplementationOnce(() => {
    throw new Error("provider unavailable");
  });
  expect(
    (
      await relayRequest(
        "POST",
        started.relay_id,
        "audio",
        new Uint8Array(14400),
      )
    ).status,
  ).toBe(502);
  expect(() =>
    resolveRealtimeRelay(started.relay_id, started.relay_capability),
  ).toThrow();
  expect(
    (
      await relayRequest(
        "POST",
        started.relay_id,
        "audio",
        new Uint8Array(14400),
      )
    ).status,
  ).toBe(404);
  expect(provider.sessions[0].closeCalls).toBe(1);
});
