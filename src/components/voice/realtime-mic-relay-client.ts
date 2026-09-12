import type {
  AudioCaptureFrame,
  AudioCaptureProvider,
  AudioCaptureSession,
} from "../../domain/audio-capture";
import type {
  RealtimeRelayStart,
  RealtimeRelayStatus,
} from "../../services/realtime-voice-relay-service";

export const MIC_RELAY_MAX_FRAMES = 30; // 600 ms, including the batch in flight.
const FRAME_BYTES = 960;
const BATCH_FRAMES = 15;
export type RelayRequest = (
  path: string,
  options?: RequestInit,
) => Promise<Response>;
export type MicRelayHealth = {
  client_capture_state:
    "STOPPED" | "STARTING" | "CAPTURING" | "STOPPING" | "FAILED";
  microphone_active: boolean;
  sample_rate_hz: number;
  channels: number;
  last_frame_bytes: number;
  frames_captured: number;
  frames_forwarded: number;
  bytes_forwarded: number;
  batches_sent: number;
  relay_state: string;
  realtime_state: string;
  speech_start_seen: boolean;
  speech_end_seen: boolean;
  provider_failure_code: string | null;
  failure_code: string | null;
  queue_depth_frames: number;
  test_duration_ms: number;
  cleanup_confirmed: boolean;
};

/** Owns only capture → ordered bounded batches → the authenticated Nexus relay. */
export class RealtimeMicRelayClient {
  private health: MicRelayHealth = {
    client_capture_state: "STOPPED",
    microphone_active: false,
    sample_rate_hz: 0,
    channels: 0,
    last_frame_bytes: 0,
    frames_captured: 0,
    frames_forwarded: 0,
    bytes_forwarded: 0,
    batches_sent: 0,
    relay_state: "NOT_STARTED",
    realtime_state: "UNKNOWN",
    speech_start_seen: false,
    speech_end_seen: false,
    provider_failure_code: null,
    failure_code: null,
    queue_depth_frames: 0,
    test_duration_ms: 0,
    cleanup_confirmed: false,
  };
  private capture?: AudioCaptureSession;
  private captureAbort = new AbortController();
  private relayId?: string;
  private queue: Uint8Array[] = [];
  private inFlightFrames = 0;
  private sending?: Promise<void>;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private accepting = false;
  private stopRequested = false;
  private used = false;
  private startedAt = 0;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private lastFrame = -1;

  constructor(
    private readonly provider: AudioCaptureProvider,
    private readonly request: RelayRequest,
    private readonly output?: {
      open(id: string): Promise<void>;
      close(): Promise<void>;
    },
  ) {}

  snapshot(): MicRelayHealth {
    return {
      ...this.health,
      microphone_active: this.capture?.health.microphone_active ?? false,
      queue_depth_frames: this.queue.length + this.inFlightFrames,
      test_duration_ms:
        this.startedAt && !this.health.cleanup_confirmed
          ? Date.now() - this.startedAt
          : this.health.test_duration_ms,
    };
  }

  start(conversationId: string, brain = false): Promise<void> {
    if (this.used) return this.starting ?? Promise.resolve();
    this.used = true;
    this.startedAt = Date.now();
    this.health.client_capture_state = "STARTING";
    this.starting = this.begin(conversationId, brain);
    return this.starting;
  }

  private async begin(conversationId: string, brain: boolean) {
    try {
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conversationId))
        throw new Error("CONVERSATION_REQUIRED");
      const result = await this.json<RealtimeRelayStart>(
        "realtime/session/start",
        {
          method: "POST",
          body: JSON.stringify({
            conversation_id: conversationId,
            ...(brain ? { brain: true } : {}),
          }),
          keepalive: true,
        },
        15000,
      );
      this.relayId = result.relay_id;
      this.health.relay_state = result.relay_state;
      this.health.realtime_state = result.realtime_state;
      if (this.stopRequested) return;
      await this.output?.open(this.relayId);
      if (this.stopRequested) return;
      this.accepting = true;
      this.capture = await this.provider.start(
        {
          signal: this.captureAbort.signal,
          targetSampleRateHz: 24000,
          frameDurationMs: 20,
        },
        (frame) => this.receive(frame),
        (failure) =>
          this.fail(
            /^[A-Z_]{1,60}$/.test(failure.code)
              ? failure.code
              : "MICROPHONE_FAILURE",
          ),
      );
      if (this.stopRequested) {
        await this.capture.stop();
        return;
      }
      this.health.client_capture_state = "CAPTURING";
      this.pollTimer = setTimeout(() => void this.poll(), 400);
    } catch (error) {
      if (!this.stopRequested) this.fail(this.safeCode(error, "START_FAILED"));
    }
  }

  private receive(frame: AudioCaptureFrame) {
    if (!this.accepting || this.stopRequested) return;
    this.health.frames_captured++;
    if (
      frame.encoding !== "pcm16" ||
      frame.sample_rate_hz !== 24000 ||
      frame.channels !== 1 ||
      frame.data.byteLength !== FRAME_BYTES
    ) {
      this.fail("UNSUPPORTED_AUDIO_FRAME");
      return;
    }
    if (frame.frame_index !== this.lastFrame + 1) {
      this.fail("FRAME_ORDER_FAILURE");
      return;
    }
    this.lastFrame = frame.frame_index;
    this.health.sample_rate_hz = frame.sample_rate_hz;
    this.health.channels = frame.channels;
    this.health.last_frame_bytes = frame.data.byteLength;
    if (this.queue.length + this.inFlightFrames >= MIC_RELAY_MAX_FRAMES) {
      this.fail("BACKPRESSURE_LIMIT");
      return;
    }
    this.queue.push(
      new Uint8Array(
        frame.data instanceof Uint8Array
          ? frame.data
          : new Uint8Array(frame.data),
      ),
    );
    this.pump();
  }

  private pump(flush = false) {
    if (this.sending || !this.relayId || this.health.failure_code) return;
    if (!this.queue.length || (!flush && this.queue.length < BATCH_FRAMES))
      return;
    const frames = this.queue.splice(0, BATCH_FRAMES);
    const batch = new Uint8Array(frames.length * FRAME_BYTES);
    frames.forEach((frame, i) => batch.set(frame, i * FRAME_BYTES));
    this.inFlightFrames = frames.length;
    this.sending = this.json<{
      frames_forwarded: number;
      bytes_forwarded: number;
    }>(
      `realtime/session/${this.relayId}/audio`,
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: batch,
      },
      800,
    )
      .then((result) => {
        if (
          result.frames_forwarded !==
            this.health.frames_forwarded + frames.length ||
          result.bytes_forwarded !== result.frames_forwarded * FRAME_BYTES
        )
          throw new Error("RELAY_COUNTER_MISMATCH");
        this.health.frames_forwarded = result.frames_forwarded;
        this.health.bytes_forwarded = result.bytes_forwarded;
        this.health.batches_sent++;
      })
      .catch((error) => {
        this.fail(this.safeCode(error, "AUDIO_POST_FAILED"));
      })
      .finally(() => {
        this.inFlightFrames = 0;
        this.sending = undefined;
        if (!this.stopRequested) this.pump();
      });
  }

  private async refreshStatus() {
    if (!this.relayId) return;
    const status = await this.json<RealtimeRelayStatus>(
      `realtime/session/${this.relayId}/status?include_closed=1`,
      {},
      1500,
    );
    if (this.health.cleanup_confirmed) return;
    this.health.realtime_state = status.realtime_state;
    this.health.relay_state = status.relay_state;
    this.health.speech_start_seen ||= status.speech_start_seen;
    this.health.speech_end_seen ||= status.speech_end_seen;
    this.health.provider_failure_code =
      status.failure_code && /^[A-Za-z0-9_.-]{1,120}$/.test(status.failure_code)
        ? status.failure_code
        : status.failure_code
          ? "PROVIDER_FAILURE"
          : null;
    if (
      status.failure_code ||
      status.realtime_state === "FAILED" ||
      status.realtime_state === "CLOSED"
    )
      throw new Error("PROVIDER_SESSION_ENDED");
  }
  private async poll() {
    if (this.stopRequested) return;
    try {
      await this.refreshStatus();
    } catch (error) {
      if (!this.stopRequested)
        this.fail(this.safeCode(error, "RELAY_STATUS_FAILED"));
    }
    if (!this.stopRequested)
      this.pollTimer = setTimeout(() => void this.poll(), 400);
  }

  fail(code: string) {
    this.health.failure_code ??= code;
    this.accepting = false;
    this.captureAbort.abort();
    void this.stop();
  }
  /** pagehide/offline cannot guarantee delivery; keepalive stop + server TTL bound cleanup. */
  unload() {
    this.fail("PAGE_UNLOAD");
  }
  offline() {
    this.fail("NETWORK_OFFLINE");
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopRequested = true;
    this.accepting = false;
    this.health.client_capture_state = "STOPPING";
    clearTimeout(this.pollTimer);
    this.captureAbort.abort();
    this.stopping = this.finish();
    return this.stopping;
  }
  private async finish() {
    await this.starting;
    try {
      await this.capture?.stop();
    } catch {
      this.health.failure_code ??= "MICROPHONE_STOP_FAILED";
    }
    await this.sending;
    if (!this.health.failure_code) {
      while (this.queue.length && !this.health.failure_code) {
        this.pump(true);
        await this.sending;
      }
      if (this.relayId) {
        try {
          await this.refreshStatus();
        } catch (error) {
          this.health.failure_code ??= this.safeCode(
            error,
            "FINAL_STATUS_FAILED",
          );
        }
      }
    }
    this.queue = []; // On failure, unsent frames are discarded only with a visible failed test.
    let closed = !this.relayId;
    if (this.relayId) {
      try {
        await this.json(
          `realtime/session/${this.relayId}/stop`,
          { method: "POST", keepalive: true },
          2000,
        );
        this.health.relay_state = "CLOSED";
        closed = true;
      } catch {
        this.health.relay_state = "CLOSE_UNCONFIRMED";
        this.health.failure_code ??= "RELAY_STOP_FAILED";
      }
    }
    await this.output?.close();
    this.health.cleanup_confirmed =
      closed && !this.capture?.health.microphone_active;
    this.health.test_duration_ms = Date.now() - this.startedAt;
    this.health.client_capture_state = this.health.failure_code
      ? "FAILED"
      : "STOPPED";
  }

  private safeCode(error: unknown, fallback: string) {
    const value = error instanceof Error ? error.message : "";
    if (
      value === "Sign in to continue" ||
      value === "Invalid or expired session"
    )
      return "AUTHENTICATION_FAILED";
    if (value === "Conversation not found") return "CONVERSATION_NOT_FOUND";
    return /^[A-Z_]{1,60}$/.test(value) ? value : fallback;
  }
  private async json<T>(
    path: string,
    options: RequestInit,
    timeout: number,
  ): Promise<T> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.request(path, { ...options, signal: abort.signal }).then(
          async (response) => {
            if (!response.ok)
              throw new Error(
                response.status === 401
                  ? "AUTHENTICATION_FAILED"
                  : response.status === 404
                    ? "RELAY_OR_CONVERSATION_NOT_FOUND"
                    : "RELAY_REQUEST_FAILED",
              );
            return (await response.json()) as T;
          },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error("RELAY_REQUEST_TIMEOUT"));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
