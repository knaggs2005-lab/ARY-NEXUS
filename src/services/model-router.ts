import type {
  BrainContext,
  ExtractionContext,
  LanguageModelProvider,
  ReasoningResult,
} from "../domain/providers";
import type { ReasoningOptions } from "../domain/voice";
import {
  routePolicy,
  type ModelTask,
  type ModelTarget,
  type RoutePolicy,
  type RoutingTrace,
} from "../domain/model-router";
import {
  reasoningPayload,
  extractionPayload,
} from "../infrastructure/providers/openai";
import { AppError } from "../domain/validation";
import { actionCancellation } from "./action-cancellation";
export class ModelUnavailableError extends AppError {
  constructor(public routing: RoutingTrace) {
    super(
      "Configured intelligence is unavailable. Retry when a permitted model is available.",
      503,
    );
  }
}
export interface ModelHealth {
  failures: number;
  until: number;
  latency: number | null;
}
// Operational aggregate state only. No users, prompts or results. Shared across request-scoped service instances.
export const modelHealth = new Map<string, ModelHealth>();
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");
export function modelErrorCode(error: unknown) {
  const e = error as { code?: string; name?: string; status?: number };
  if (e?.name === "TimeoutError") return "timeout";
  if (e?.name === "AbortError") return "cancelled";
  if (e?.code && /^[a-z_0-9]{1,60}$/.test(e.code)) return e.code;
  if (e?.status) return `http_${e.status}`;
  return "provider_unavailable";
}
export class ModelRouter implements LanguageModelProvider {
  readonly name: string;
  constructor(
    private targets: ModelTarget[],
    private policy: RoutePolicy = routePolicy.parse({}),
    private taskPolicies: Partial<Record<ModelTask, Partial<RoutePolicy>>> = {},
    private onRoute: (trace: RoutingTrace) => Promise<void> = async () => {},
    private health = modelHealth,
    private signal?: AbortSignal,
  ) {
    if (new Set(targets.map((t) => t.id)).size !== targets.length)
      throw new AppError("Duplicate model target IDs", 503);
    this.name = targets[0]?.adapter.name ?? "ModelRouter";
  }
  describe() {
    return this.targets.map(({ adapter: _, available, healthKey, ...t }) => ({
      ...t,
      available: available(),
      cooldown_until: this.health.get(healthKey)?.until ?? null,
      observed_latency_ms: this.health.get(healthKey)?.latency ?? null,
    }));
  }
  private async route<T>(
    task: ModelTask,
    input: unknown,
    invoke: (p: LanguageModelProvider, options: ReasoningOptions) => Promise<T>,
    options: ReasoningOptions = {},
  ) {
    const taskPolicy = this.taskPolicies[task] ?? {};
    const p = routePolicy.parse({
      ...this.policy,
      ...taskPolicy,
      privacy:
        this.policy.privacy === "local_only"
          ? "local_only"
          : (taskPolicy.privacy ?? this.policy.privacy),
    });
    const needed = new Set([
      ...p.required_capabilities,
      "reasoning",
      ...(task === "planning" || task === "extraction" ? ["structured"] : []),
    ]);
    // UTF-8 bytes are a deliberately conservative token upper bound, plus output/instruction reserve.
    const contextRequired = bytes(input) + 12000;
    const start = performance.now(),
      trace: RoutingTrace = {
        task,
        privacy: p.privacy,
        preference: p.preference,
        selected: null,
        reason: "",
        degraded: false,
        latency_ms: 0,
        candidates: [],
        attempts: [],
      };
    const ranked = this.targets
      .map((t) => {
        const h = this.health.get(t.healthKey),
          cost =
            t.input_usd_per_million === null ||
            t.output_usd_per_million === null
              ? null
              : ((contextRequired - 4000) * t.input_usd_per_million +
                  4000 * t.output_usd_per_million) /
                1e6;
        const reason = !t.enabled
          ? "disabled"
          : !t.available()
            ? "not configured"
            : p.privacy === "local_only" && t.location !== "local"
              ? "local-only privacy"
              : !t.tasks.includes(task) ||
                  (task === "planning" && !t.adapter.planWithUsage) ||
                  (task === "extraction" && !t.adapter.extractCandidates)
                ? "task unsupported"
                : [...needed].some((c) => !t.capabilities.includes(c as never))
                  ? "capability missing"
                  : t.context_tokens < contextRequired
                    ? "context capacity"
                    : h && h.until > Date.now()
                      ? "temporary cooldown"
                      : p.max_estimated_cost_usd !== undefined &&
                          (cost === null || cost > p.max_estimated_cost_usd)
                        ? "estimated cost budget"
                        : "eligible";
        trace.candidates.push({
          id: t.id,
          eligible: reason === "eligible",
          reason,
          estimated_cost_usd: cost,
        });
        const latency = h?.latency ?? t.expected_latency_ms ?? 60000;
        // Transparent ordering, no invented quality or benchmark score.
        const score =
          p.preference === "latency"
            ? latency
            : p.preference === "cost"
              ? (cost ?? 1e9)
              : t.priority * 100000 + latency;
        return { t, cost, score, eligible: reason === "eligible" };
      })
      .filter((x) => x.eligible)
      .sort((a, b) => a.score - b.score || a.t.id.localeCompare(b.t.id));
    let delivered = false,
      remaining = p.max_estimated_cost_usd ?? Infinity;
    const parentSignals = [
      this.signal,
      actionCancellation.getStore(),
      options.signal,
    ].filter((s): s is AbortSignal => !!s);
    const parent = parentSignals.length
      ? AbortSignal.any(parentSignals)
      : undefined;
    parent?.throwIfAborted();
    for (const { t, cost } of ranked.slice(0, 3)) {
      const left = p.total_timeout_ms - (performance.now() - start);
      if (left <= 0) break;
      if (cost !== null && cost > remaining) continue;
      if (cost !== null) remaining -= cost;
      const controller = new AbortController(),
        signal = parent
          ? AbortSignal.any([parent, controller.signal])
          : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined,
        active = true;
      const attemptStart = performance.now();
      try {
        const result = await Promise.race([
          invoke(t.adapter, {
            signal,
            onDelta: options.onDelta
              ? (text) => {
                  if (active && !signal.aborted && text) {
                    delivered = true;
                    options.onDelta!(text);
                  }
                }
              : undefined,
          }),
          new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
            timer = setTimeout(
              () =>
                controller.abort(
                  new DOMException("Model deadline exceeded", "TimeoutError"),
                ),
              Math.min(p.timeout_ms, left),
            );
          }),
        ]);
        signal.throwIfAborted();
        const latency = Math.round(performance.now() - attemptStart),
          old = this.health.get(t.healthKey);
        this.health.set(t.healthKey, {
          failures: 0,
          until: 0,
          latency: old?.latency ? old.latency * 0.7 + latency * 0.3 : latency,
        });
        trace.attempts.push({
          id: t.id,
          provider: t.provider,
          model: t.model,
          status: "succeeded",
          latency_ms: latency,
        });
        trace.selected = t.id;
        trace.degraded =
          trace.attempts.length > 1 ||
          ["temporary cooldown", "not configured"].includes(
            trace.candidates[0]?.reason ?? "",
          );
        trace.reason = `${task}: ${p.preference} ordering after privacy, capability, context, availability and cost checks${trace.degraded ? "; fallback succeeded" : ""}.`;
        trace.latency_ms = Math.round(performance.now() - start);
        await this.emit(trace);
        return { result, trace, target: t };
      } catch (error) {
        trace.attempts.push({
          id: t.id,
          provider: t.provider,
          model: t.model,
          status: "failed",
          error_code: modelErrorCode(error),
          latency_ms: Math.round(performance.now() - attemptStart),
        });
        if (parent?.aborted) {
          trace.reason = "Cancelled; no fallback";
          trace.latency_ms = Math.round(performance.now() - start);
          await this.emit(trace);
          parent.throwIfAborted();
        }
        const old = this.health.get(t.healthKey),
          failures = (old?.failures ?? 0) + 1;
        this.health.set(t.healthKey, {
          failures,
          until: Date.now() + Math.min(120000, 15000 * failures),
          latency: old?.latency ?? null,
        });
        if (delivered) {
          trace.reason =
            "Stream interrupted after output; no provider switch mid-answer";
          trace.degraded = true;
          trace.latency_ms = Math.round(performance.now() - start);
          await this.emit(trace);
          throw new ModelUnavailableError(trace);
        }
      } finally {
        active = false;
        if (timer) clearTimeout(timer);
        controller.abort();
      }
    }
    trace.degraded = true;
    trace.reason =
      task === "chat" || task === "analysis"
        ? "No permitted model completed; limited evidence mode only"
        : "No permitted model completed; no generated update or plan was accepted";
    trace.latency_ms = Math.round(performance.now() - start);
    await this.emit(trace);
    throw new ModelUnavailableError(trace);
  }
  private async emit(trace: RoutingTrace) {
    try {
      await this.onRoute(trace);
    } catch {
      /* Telemetry never replays a completed model request. */
    }
  }
  async identifyIntent(input: string) {
    return /^(remember|correction|update)\s*:/i.test(input)
      ? "store_memory"
      : /\b(plan|goal|next)\b/i.test(input)
        ? "planning"
        : "recall";
  }
  async reason(context: BrainContext) {
    return (await this.reasonWithUsage(context)).content;
  }
  async reasonWithUsage(
    context: BrainContext,
    options?: ReasoningOptions,
  ): Promise<ReasoningResult> {
    const task: ModelTask = /analysis|board|research/i.test(context.intent)
      ? "analysis"
      : "chat";
    try {
      const r = await this.route(
        task,
        reasoningPayload(context),
        async (p, o) =>
          p.reasonWithUsage
            ? p.reasonWithUsage(context, o)
            : this.unmetered(
                await p.reason(context),
                p,
                context.memories.length,
              ),
        options,
      );
      return { ...r.result, routing: r.trace };
    } catch (e) {
      if (
        !(e instanceof ModelUnavailableError) ||
        e.routing.reason.startsWith("Stream interrupted")
      )
        throw e;
      const records = context.memories.slice(0, 4);
      const content =
        "AI reasoning is unavailable right now. I can still show stored evidence; I have not verified or updated it." +
        (records.length
          ? "\n\n" +
            records
              .map(
                (m, i) =>
                  `[${i + 1}] ${m.content.slice(0, 800)}${m.unresolved_conflict_count ? " (contested — needs review)" : ""}`,
              )
              .join("\n\n")
          : " No relevant stored evidence was retrieved. Please retry when a permitted model is available.");
      options?.signal?.throwIfAborted();
      options?.onDelta?.(content);
      return {
        ...this.unmetered(
          content,
          { name: "Evidence-only fallback" } as LanguageModelProvider,
          records.length,
        ),
        provider: "local-evidence",
        routing: e.routing,
      };
    }
  }
  private unmetered(
    content: string,
    p: LanguageModelProvider,
    count: number,
  ): ReasoningResult {
    return {
      content,
      model: p.name,
      provider: "compatible",
      metrics: {
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: null,
        latency_ms: 0,
        estimated_cost_usd: null,
        retrieval_count: count,
        pricing_version: "unavailable",
      },
    };
  }
  async planWithUsage(
    context: BrainContext,
    capabilities: import("../domain/models").Json[],
    options: ReasoningOptions = {},
  ) {
    const r = await this.route(
      "planning",
      { ...reasoningPayload(context), capabilities },
      async (p, o) => {
        if (!p.planWithUsage)
          throw new AppError("Planning adapter unavailable");
        return p.planWithUsage(context, capabilities, o);
      },
      options,
    );
    return { ...r.result, routing: r.trace };
  }
  async extractCandidates(
    context: ExtractionContext,
    options: ReasoningOptions = {},
  ) {
    return (
      await this.route(
        "extraction",
        extractionPayload(context),
        async (p, o) => {
          if (!p.extractCandidates)
            throw new AppError("Extraction adapter unavailable");
          return p.extractCandidates(context, o);
        },
        options,
      )
    ).result;
  }
  async extractMemories(input: string, options: ReasoningOptions = {}) {
    return (
      await this.route(
        "extraction",
        input,
        (p, o) => p.extractMemories(input, o),
        options,
      )
    ).result;
  }
}
