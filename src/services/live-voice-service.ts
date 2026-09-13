import { randomUUID } from "node:crypto";
import type {
  LiveProvider,
  LiveControl,
  LiveEvent,
} from "../domain/live-voice";
import type { Repository, Mutation } from "../domain/repository";
import type { AryBrainService } from "./ary-brain-service";
import type { ActionService } from "./action-service";
import type { MemoryReconciliationService } from "./memory-reconciliation-service";
import { AppError } from "../domain/validation";

type Fragment = {
  role: "user" | "assistant";
  text: string;
  start: number;
  end: number;
};
/** Owns only a voice session. Brain, ActionService and canonical repository own durable intelligence. */
export class LiveVoiceService {
  private control?: LiveControl;
  private closed = false;
  private stopping = false;
  private generation = 0;
  private active?: AbortController;
  private seen = new Set<string>();
  private fragments: Fragment[] = [];
  private transcriptCharacters = 0;
  private timings: { name: string; at: number }[] = [];
  private mark(name: string) {
    if (this.timings.length < 128) this.timings.push({ name, at: Date.now() });
  }
  snapshot() {
    return { active: !this.closed && !this.stopping, timings: this.timings };
  }
  private idle?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private started = Date.now();
  private finalize?: Promise<void>;
  private providerSeconds: number | null = null;
  private providerId: string | null = null;
  private delegatedThrough = -1;
  private delegated = new Set<string>();
  readonly id = randomUUID();
  constructor(
    private provider: LiveProvider,
    private repository: Repository,
    private brain: Pick<AryBrainService, "respond">,
    private actions: Pick<ActionService, "run">,
    private reconciliation: Pick<MemoryReconciliationService, "runJob">,
    readonly conversationId: string,
    private finished: () => void,
    private command?: (
      text: string,
      key: string,
      conversationId: string,
      signal: AbortSignal,
      report?: (name: string) => void,
    ) => Promise<string | null>,
  ) {}
  async start(sdp: string, signal?: AbortSignal) {
    const session = await this.provider.create(
      sdp,
      signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    );
    this.providerId = session.id;
    this.control = await this.provider.attach(
      session.id,
      (e) => this.accept(e),
      () => void this.finish(false),
    );
    if (signal?.aborted) {
      this.stop();
      throw new AppError("Live startup cancelled", 409);
    }
    this.deadline = setTimeout(() => this.stop(), 10 * 60_000);
    this.touch();
    return { id: this.id, sdp: session.sdp, model: this.provider.model };
  }
  private touch() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), 120_000);
  }
  private accept(event: LiveEvent) {
    if (this.closed) return;
    if (event.type === "session.closed") {
      const seconds = (event.usage as { seconds?: unknown } | undefined)
        ?.seconds;
      if (
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
      )
        this.providerSeconds = seconds;
      void this.finish(true);
      return;
    }
    if (event.type === "error") {
      void this.stop();
      return;
    }
    if (this.stopping) return;
    const id = typeof event.event_id === "string" ? event.event_id : undefined;
    if (id) {
      if (this.seen.has(id)) return;
      if (this.seen.size >= 1024) {
        void this.stop();
        return;
      }
      this.seen.add(id);
    }
    if (
      [
        "session.input_transcript.delta",
        "session.output_transcript.delta",
      ].includes(event.type)
    ) {
      if (
        typeof event.delta !== "string" ||
        event.delta.length > 4000 ||
        typeof event.start_ms !== "number" ||
        typeof event.end_ms !== "number"
      )
        return;
      if (
        this.fragments.length >= 256 ||
        this.transcriptCharacters + event.delta.length > 32000
      ) {
        void this.stop();
        return;
      }
      const role =
        event.type === "session.input_transcript.delta" ? "user" : "assistant";
      this.transcriptCharacters += event.delta.length;
      this.fragments.push({
        role,
        text: event.delta,
        start: event.start_ms,
        end: event.end_ms,
      });
      if (role === "user") this.touch();
    }
    if (event.type === "session.delegation.created") {
      const d = event.delegation as
        { id?: unknown; target?: unknown } | undefined;
      if (
        d?.target !== "client" ||
        typeof d.id !== "string" ||
        d.id.length > 200
      )
        return;
      if (this.delegated.has(d.id)) return;
      this.delegated.add(d.id);
      if (
        typeof event.offset_ms !== "number" ||
        !Number.isFinite(event.offset_ms)
      )
        return;
      const offset = event.offset_ms;
      const text = this.fragments
        .filter(
          (f) =>
            f.role === "user" &&
            f.end <= offset &&
            f.end > this.delegatedThrough,
        )
        .slice(-16)
        .map((f) => f.text)
        .join(" ")
        .slice(-8000)
        .trim();
      if (!text) {
        this.append(
          d.id,
          "I could not establish the request from the transcript. Please repeat it.",
        );
        return;
      }
      this.delegatedThrough = offset;
      void this.delegate(d.id, text);
    }
  }
  private append(id: string, content: string) {
    // Conservative UTF-8 bound below 500 tokens; never silently truncate a qualification.
    const chunks: string[] = [];
    let chunk = "";
    const text =
      Buffer.byteLength(content, "utf8") > 16000
        ? "The Nexus result is too long for this voice update. Open the conversation to inspect the complete result and any required approval."
        : content;
    for (const point of text) {
      if (Buffer.byteLength(chunk + point, "utf8") > 400) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk += point;
    }
    if (chunk) chunks.push(chunk);
    for (const content of chunks)
      this.control?.send({
        type: "session.commentary.append",
        event_id: randomUUID(),
        delegation_id: id,
        content,
      });
  }

  private async delegate(id: string, text: string) {
    this.active?.abort();
    const generation = ++this.generation;
    const abort = new AbortController();
    this.mark("delegation_started");
    this.active = abort;
    const timer = setTimeout(() => abort.abort(), 45000);
    try {
      const commandResult = this.command
        ? await this.command(
            text,
            `live:${this.id}:${id}`,
            this.conversationId,
            abort.signal,
            (name) => this.mark(name),
          )
        : null;
      if (
        this.closed ||
        this.stopping ||
        abort.signal.aborted ||
        generation !== this.generation
      )
        return;
      if (commandResult !== undefined && commandResult !== null) {
        if (
          !this.closed &&
          !this.stopping &&
          !abort.signal.aborted &&
          generation === this.generation
        ) {
          this.mark("delegation_completed");
          this.append(id, commandResult);
        }
        return;
      }
      for await (const event of this.brain.respond(
        {
          input: text,
          conversation_id: this.conversationId,
          modality: "voice",
        },
        { signal: abort.signal },
      )) {
        if (
          event.type === "response" &&
          !this.closed &&
          !this.stopping &&
          !abort.signal.aborted &&
          generation === this.generation
        ) {
          this.mark("delegation_completed");
          this.append(id, event.message.content);
        }
      }
    } catch {
      if (
        !this.closed &&
        !this.stopping &&
        !abort.signal.aborted &&
        generation === this.generation
      )
        this.append(
          id,
          "Nexus could not complete that request. Check Activity; no success is confirmed.",
        );
    } finally {
      clearTimeout(timer);
      if (this.active === abort) this.active = undefined;
    }
  }
  interrupt() {
    if (this.closed || this.stopping) return;
    this.generation++;
    this.active?.abort();
    this.control?.send({
      type: "session.instructions.append",
      event_id: randomUUID(),
      delegation_id: null,
      content:
        "The user interrupted. Stop the previous answer and listen. Do not announce previous unfinished work as successful.",
    });
  }
  stop() {
    if (this.closed || this.stopping) return;
    this.stopping = true;
    this.generation++;
    this.active?.abort();
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    this.closeTimer = setTimeout(() => void this.finish(false), 5000);
    try {
      this.control?.send({ type: "session.close" });
    } catch {
      void this.finish(false);
    }
  }
  private finish(finalized: boolean) {
    if (this.finalize) return this.finalize;
    this.closed = true;
    this.active?.abort();
    clearTimeout(this.idle);
    clearTimeout(this.deadline);
    clearTimeout(this.closeTimer);
    this.control?.close();
    this.finalize = this.persist(finalized)
      .catch(() => {
        /* Durable failures remain visible via failed action; never throw from socket callback. */
      })
      .finally(this.finished);
    return this.finalize;
  }
  private async persist(finalized: boolean) {
    const jobs: string[] = [];
    // Preserve fragments as attributed, non-final transcript evidence, not claimed verbatim turns.
    await this.actions.run("voice.speak", this.conversationId, async () => {
      for (const role of ["user", "assistant"] as const) {
        const fragments = this.fragments.filter((f) => f.role === role);
        if (!fragments.length) continue;
        const messageId = randomUUID();
        const mutations: Mutation[] = [
          {
            kind: "insert",
            table: "messages",
            id: messageId,
            data: {
              conversation_id: this.conversationId,
              role,
              content: fragments
                .map((f) => f.text)
                .join(" ")
                .slice(0, 16000),
              metadata: {
                modality: "voice",
                provider: "openai",
                model: this.provider.model,
                live_session_id: this.id,
                provider_session_id: this.providerId,
                provider_usage_seconds: this.providerSeconds,
                transcript_fragments: fragments.map((f) => ({
                  start_ms: f.start,
                  end_ms: f.end,
                  text: f.text,
                })),
                not_authoritative_turns: true,
                finalized,
              },
            },
          },
        ];
        if (role === "user" && finalized) {
          const jobId = randomUUID();
          mutations.push({
            kind: "insert",
            table: "extraction_jobs",
            id: jobId,
            data: {
              source_message_id: messageId,
              status: "pending",
              attempts: 0,
              lease_until: null,
              error: null,
              saved_memory_ids: [],
            },
          });
          jobs.push(jobId);
        }
        await this.repository.batch(mutations);
      }
      await this.repository.insert("model_calls", {
        operation: "live.conversation",
        model: this.provider.model,
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        latency_ms: Date.now() - this.started,
        estimated_cost_usd: null,
        pricing_version: "live-duration-unverified",
        retrieval_count: 0,
        memories_extracted: null,
        status: finalized ? "succeeded" : "failed",
        error_code: finalized ? null : "LIVE_FINALIZATION_UNCONFIRMED",
      });
    });
    for (const job of jobs) {
      // The durable pending job is committed above. Extraction must not keep the voice-session lock held.
      void this.actions
        .run("memory.extract", this.conversationId, () =>
          this.reconciliation.runJob(job),
        )
        .catch(() => {});
    }
  }
}
const sessions = new Map<
  string,
  { owner: string; service: LiveVoiceService }
>();
const starting = new Set<string>();
export async function startLiveSession(input: {
  provider: LiveProvider;
  repository: Repository;
  brain: Pick<AryBrainService, "respond">;
  actions: Pick<ActionService, "run">;
  reconciliation: Pick<MemoryReconciliationService, "runJob">;
  conversationId: string;
  sdp: string;
  signal?: AbortSignal;
  command?: (
    text: string,
    key: string,
    conversationId: string,
    signal: AbortSignal,
    report?: (name: string) => void,
  ) => Promise<string | null>;
}) {
  const owner = input.repository.userId;
  if (
    starting.has(owner) ||
    [...sessions.values()].some((s) => s.owner === owner)
  )
    throw new AppError("Live session already active", 409);
  starting.add(owner);
  const service = new LiveVoiceService(
    input.provider,
    input.repository,
    input.brain,
    input.actions,
    input.reconciliation,
    input.conversationId,
    () => sessions.delete(service.id),
    input.command,
  );
  try {
    const result = await service.start(input.sdp, input.signal);
    sessions.set(service.id, { owner, service });
    return result;
  } finally {
    starting.delete(owner);
  }
}
export function liveSession(owner: string, id: string) {
  const entry = sessions.get(id);
  if (!entry || entry.owner !== owner)
    throw new AppError("Live session not found", 404);
  return entry.service;
}
