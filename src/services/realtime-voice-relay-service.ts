import { RealtimeOutputStream } from "./realtime-output-stream";
import type {
  RealtimeVoiceAudioFrame,
  RealtimeVoiceEvent,
  RealtimeVoiceSession,
  RealtimeVoiceSessionConfig,
  RealtimeVoiceSessionProvider,
  RealtimeVoiceSessionState,
} from "../domain/realtime-voice";
import { AppError } from "../domain/validation";

export const REALTIME_FRAME_BYTES = 960;
export const REALTIME_MAX_BATCH_FRAMES = 15;
export const REALTIME_MAX_BATCH_BYTES =
  REALTIME_FRAME_BYTES * REALTIME_MAX_BATCH_FRAMES;
export const REALTIME_BATCH_DURATION_MS = 300;
const DEFAULT_RELAY_TTL_MS = 5 * 60 * 1000;

export type RealtimeRelayStatus = {
  relay_id: string;
  relay_state: "ACTIVE" | "CLOSED";
  realtime_state: RealtimeVoiceSessionState;
  frames_forwarded: number;
  bytes_forwarded: number;
  speech_start_seen: boolean;
  speech_end_seen: boolean;
  failure_code: string | null;
  created_at: string;
  last_event_at: string | null;
  usage_seen: boolean;
  assistant_audio_events: number;
  last_event_type: string | null;
};

export type RealtimeRelayStart = {
  relay_id: string;
  relay_state: "ACTIVE";
  realtime_state: RealtimeVoiceSessionState;
  created_at: string;
  frame_bytes: number;
  max_batch_frames: number;
  max_batch_bytes: number;
  batch_duration_ms: number;
};

export type RealtimeRelayAppend = {
  relay_id: string;
  frames_forwarded: number;
  bytes_forwarded: number;
};

type RelayEntry = {
  relay_id: string;
  user_id: string;
  session: RealtimeVoiceSession;
  status: RealtimeRelayStatus;
  unsubscribe: () => void;
  expiry_timer: ReturnType<typeof setTimeout>;
  finalized: boolean;
  output: RealtimeOutputStream;
  close_promise: Promise<void> | null;
};

type Clock = () => Date;

/**
 * Bounded, in-process relay for local realtime acceptance. The provider
 * session remains server-side and relay entries are deliberately ephemeral.
 */
export class RealtimeVoiceRelayService {
  private readonly entries = new Map<string, RelayEntry>();
  private readonly activeByUser = new Map<string, string>();
  private readonly startingUsers = new Set<string>();
  private readonly closedByUser = new Map<
    string,
    Map<string, RealtimeRelayStatus>
  >();
  private readonly ttlMs: number;
  private readonly now: Clock;

  constructor(
    private readonly provider: RealtimeVoiceSessionProvider,
    options: { ttlMs?: number; now?: Clock } = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_RELAY_TTL_MS;
    this.now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.ttlMs) || this.ttlMs < 1000)
      throw new Error("Realtime relay TTL must be at least one second");
  }

  async start(
    userId: string,
    conversationId: string,
  ): Promise<RealtimeRelayStart> {
    if (!userId.trim())
      throw new AppError("Authenticated user is required", 401);
    if (!conversationId.trim())
      throw new AppError("A Nexus conversation_id is required", 400);
    this.expireEntries();
    if (this.startingUsers.has(userId) || this.activeByUser.has(userId))
      throw new AppError("A realtime voice session is already active", 409);

    this.startingUsers.add(userId);
    try {
      const config: RealtimeVoiceSessionConfig = {
        user_id: userId,
        conversation_id: conversationId,
        classic_fallback_available: false,
      };
      const session = await this.provider.createSession(config);
      const relayId = crypto.randomUUID();
      const createdAt = this.now().toISOString();
      const status: RealtimeRelayStatus = {
        relay_id: relayId,
        relay_state: "ACTIVE",
        realtime_state: session.state,
        frames_forwarded: 0,
        bytes_forwarded: 0,
        speech_start_seen: false,
        speech_end_seen: false,
        failure_code: null,
        created_at: createdAt,
        last_event_at: null,
        usage_seen: false,
        assistant_audio_events: 0,
        last_event_type: null,
      };
      const entry = {} as RelayEntry;
      entry.relay_id = relayId;
      entry.user_id = userId;
      entry.session = session;
      entry.status = status;
      entry.finalized = false;
      entry.output = new RealtimeOutputStream(() => {
        entry.status.failure_code = "OUTPUT_DISCONNECTED_OR_OVERFLOW";
        this.detach(entry);
        void this.closeEntry(entry).catch(() => {});
      });
      entry.close_promise = null;
      entry.unsubscribe = session.onEvent((event) =>
        this.observe(entry, event),
      );
      entry.expiry_timer = this.scheduleExpiry(relayId);
      this.entries.set(relayId, entry);
      this.activeByUser.set(userId, relayId);
      return {
        relay_id: relayId,
        relay_state: "ACTIVE",
        realtime_state: session.state,
        created_at: createdAt,
        frame_bytes: REALTIME_FRAME_BYTES,
        max_batch_frames: REALTIME_MAX_BATCH_FRAMES,
        max_batch_bytes: REALTIME_MAX_BATCH_BYTES,
        batch_duration_ms: REALTIME_BATCH_DURATION_MS,
      };
    } finally {
      this.startingUsers.delete(userId);
    }
  }

  output(userId: string, relayId: string, signal: AbortSignal) {
    return this.requireEntry(userId, relayId).output.open(signal);
  }

  async append(
    userId: string,
    relayId: string,
    body: Uint8Array,
  ): Promise<RealtimeRelayAppend> {
    const entry = this.requireEntry(userId, relayId);
    if (body.byteLength === 0)
      throw new AppError("Realtime audio batch is empty", 400);
    if (body.byteLength > REALTIME_MAX_BATCH_BYTES)
      throw new AppError("Realtime audio batch exceeds 14,400 bytes", 413);
    if (body.byteLength % REALTIME_FRAME_BYTES !== 0)
      throw new AppError(
        "Realtime audio batch must contain complete 960-byte frames",
        400,
      );

    for (
      let offset = 0;
      offset < body.byteLength;
      offset += REALTIME_FRAME_BYTES
    ) {
      const data = body.slice(offset, offset + REALTIME_FRAME_BYTES);
      const frame: RealtimeVoiceAudioFrame = {
        encoding: "pcm16",
        sample_rate_hz: 24000,
        channels: 1,
        data,
      };
      try {
        entry.session.sendAudio(frame);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Realtime audio forwarding failed";
        const status = /closed|not ready/i.test(message) ? 409 : 502;
        throw new AppError(message, status);
      }
      entry.status.frames_forwarded += 1;
      entry.status.bytes_forwarded += data.byteLength;
    }
    return {
      relay_id: relayId,
      frames_forwarded: entry.status.frames_forwarded,
      bytes_forwarded: entry.status.bytes_forwarded,
    };
  }

  status(
    userId: string,
    relayId: string,
    includeClosed = false,
  ): RealtimeRelayStatus | null {
    this.expireEntries();
    const entry = this.entries.get(relayId);
    if (!entry || entry.user_id !== userId || entry.finalized) {
      const closed = includeClosed
        ? this.closedByUser.get(userId)?.get(relayId)
        : undefined;
      return closed ? { ...closed } : null;
    }
    return { ...entry.status };
  }

  async stop(
    userId: string,
    relayId: string,
  ): Promise<{ relay_id: string; relay_state: "CLOSED"; stopped: true }> {
    const entry = this.entries.get(relayId);
    if (!entry) {
      if (!this.closedByUser.get(userId)?.has(relayId))
        throw new AppError("Realtime relay not found", 404);
      return { relay_id: relayId, relay_state: "CLOSED", stopped: true };
    }
    if (entry.user_id !== userId)
      throw new AppError("Realtime relay not found", 404);
    this.detach(entry);
    await this.closeEntry(entry);
    return { relay_id: relayId, relay_state: "CLOSED", stopped: true };
  }

  private requireEntry(userId: string, relayId: string) {
    this.expireEntries();
    const entry = this.entries.get(relayId);
    if (!entry || entry.user_id !== userId || entry.finalized)
      throw new AppError("Realtime relay not found", 404);
    return entry;
  }

  private observe(entry: RelayEntry, event: RealtimeVoiceEvent) {
    if (entry.finalized) return;
    entry.output.publish(event);
    if (entry.finalized) return;
    entry.status.last_event_at = this.now().toISOString();
    entry.status.last_event_type = event.type;
    if (event.type === "state") {
      entry.status.realtime_state = event.state;
      if (event.state === "CLOSED" || event.state === "FAILED") {
        this.detach(entry);
        void this.closeEntry(entry).catch(() => {});
      }
      return;
    }
    if (event.type === "speech_start") {
      entry.status.speech_start_seen = true;
      return;
    }
    if (event.type === "speech_end") {
      entry.status.speech_end_seen = true;
      return;
    }
    if (event.type === "failure") {
      entry.status.failure_code = /^[A-Za-z0-9_.-]{1,120}$/.test(
        event.failure.code,
      )
        ? event.failure.code
        : "PROVIDER_FAILURE";
      this.detach(entry);
      void this.closeEntry(entry).catch(() => {});
      return;
    }
    if (event.type === "usage") {
      entry.status.usage_seen = true;
      return;
    }
    if (event.type === "assistant_audio_delta")
      entry.status.assistant_audio_events += 1;
  }

  private scheduleExpiry(relayId: string) {
    const timer = setTimeout(() => {
      const entry = this.entries.get(relayId);
      if (!entry || entry.finalized) return;
      entry.status.failure_code = "RELAY_EXPIRED";
      this.detach(entry);
      void this.closeEntry(entry).catch(() => {});
    }, this.ttlMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  }

  private expireEntries() {
    for (const entry of this.entries.values()) {
      if (
        Date.parse(entry.status.created_at) + this.ttlMs <=
        this.now().getTime()
      ) {
        entry.status.failure_code = "RELAY_EXPIRED";
        this.detach(entry);
        void this.closeEntry(entry).catch(() => {});
      }
    }
  }

  private detach(entry: RelayEntry) {
    if (entry.finalized) return;
    entry.finalized = true;
    entry.output.close();
    clearTimeout(entry.expiry_timer);
    entry.unsubscribe();
    this.entries.delete(entry.relay_id);
    if (this.activeByUser.get(entry.user_id) === entry.relay_id)
      this.activeByUser.delete(entry.user_id);
    const closed =
      this.closedByUser.get(entry.user_id) ??
      new Map<string, RealtimeRelayStatus>();
    closed.set(entry.relay_id, {
      ...entry.status,
      relay_state: "CLOSED",
      realtime_state: entry.status.failure_code ? "FAILED" : "CLOSED",
    });
    if (closed.size > 1000) closed.delete(closed.keys().next().value!);
    this.closedByUser.set(entry.user_id, closed);
  }

  private closeEntry(entry: RelayEntry) {
    entry.close_promise ??= entry.session.close();
    return entry.close_promise;
  }
}

const globalState = globalThis as typeof globalThis & {
  aryRealtimeRelayManagers?: Map<string, RealtimeVoiceRelayService>;
};

/** Returns the one in-process manager for an authenticated owner. */
export function realtimeVoiceRelayFor(
  userId: string,
  provider: RealtimeVoiceSessionProvider,
) {
  const managers = (globalState.aryRealtimeRelayManagers ??= new Map());
  let manager = managers.get(userId);
  if (!manager) {
    manager = new RealtimeVoiceRelayService(provider);
    managers.set(userId, manager);
  }
  return manager;
}
