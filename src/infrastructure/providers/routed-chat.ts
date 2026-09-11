import { z } from "zod";
import type {
  BrainContext,
  ExtractionContext,
  LanguageModelProvider,
  ReasoningResult,
} from "../../domain/providers";
import type { ReasoningOptions } from "../../domain/voice";
import { extractionCandidate, AppError } from "../../domain/validation";
import {
  ARY_REASONING_INSTRUCTIONS,
  ARY_PLANNING_INSTRUCTIONS,
  ARY_EXTRACTION_INSTRUCTIONS,
  reasoningPayload,
  extractionPayload,
} from "./openai";
import type { Telemetry } from "../../domain/telemetry";
export interface ChatTransport {
  baseUrl: string;
  apiKey?: string;
  model: string;
  provider: string;
  protocol: "chat" | "anthropic";
  inputPrice: number | null;
  outputPrice: number | null;
}
const count = z.number().int().nonnegative().nullable();
/** Text-only transport adapter. Tool execution stays entirely outside model APIs. */
export class RoutedChatProvider implements LanguageModelProvider {
  readonly name: string;
  constructor(
    private config: ChatTransport,
    private telemetry: Telemetry = async () => {},
  ) {
    this.name = config.model;
  }
  private async complete(
    system: string,
    payload: unknown,
    operation: "reason" | "extract",
    retrieval: number,
    options: ReasoningOptions = {},
  ): Promise<ReasoningResult> {
    const c = this.config,
      start = performance.now();
    let input: number | null = null,
      output: number | null = null,
      status: "succeeded" | "failed" = "failed",
      errorCode: string | null = null;
    const cost = () =>
      input === null ||
      output === null ||
      c.inputPrice === null ||
      c.outputPrice === null
        ? null
        : (input * c.inputPrice + output * c.outputPrice) / 1e6;
    try {
      const anthropic = c.protocol === "anthropic",
        stream = !!options.onDelta;
      const response = await fetch(
        `${c.baseUrl.replace(/\/$/, "")}/${anthropic ? "messages" : "chat/completions"}`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            ...(anthropic
              ? {
                  "anthropic-version": "2023-06-01",
                  ...(c.apiKey ? { "x-api-key": c.apiKey } : {}),
                }
              : c.apiKey
                ? { Authorization: `Bearer ${c.apiKey}` }
                : {}),
          },
          body: JSON.stringify({
            model: c.model,
            max_tokens: 4000,
            ...(anthropic
              ? {
                  system,
                  messages: [
                    { role: "user", content: JSON.stringify(payload) },
                  ],
                }
              : {
                  messages: [
                    { role: "system", content: system },
                    { role: "user", content: JSON.stringify(payload) },
                  ],
                }),
            ...(stream
              ? {
                  stream: true,
                  ...(!anthropic
                    ? { stream_options: { include_usage: true } }
                    : {}),
                }
              : {}),
          }),
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
            : AbortSignal.timeout(60000),
        },
      );
      if (!response.ok)
        throw new AppError(
          `Model provider returned HTTP ${response.status}`,
          response.status,
        );
      let content = "",
        model = c.model;
      if (stream) {
        if (!response.body) throw new AppError("Model returned no stream", 502);
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "",
          doneEvent = false,
          received = 0;
        const frame = (line: string) => {
          if (!line.startsWith("data:")) return;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            doneEvent = true;
            return;
          }
          if (!data) return;
          const v = JSON.parse(data);
          if (v.error || v.type === "error")
            throw new AppError("Model stream failed", 502);
          let text = "";
          if (anthropic) {
            if (v.type === "message_start") {
              model = v.message?.model ?? model;
              input = v.message?.usage?.input_tokens ?? input;
            }
            if (v.type === "message_delta") {
              output = v.usage?.output_tokens ?? output;
              if (
                v.delta?.stop_reason &&
                !["end_turn", "stop_sequence"].includes(v.delta.stop_reason)
              )
                throw new AppError("Model stream did not complete", 502);
            }
            if (
              v.type === "content_block_delta" &&
              v.delta?.type === "text_delta"
            )
              text = v.delta.text;
            if (v.type === "message_stop") doneEvent = true;
          } else {
            model = v.model ?? model;
            text = v.choices?.[0]?.delta?.content ?? "";
            if (v.usage) {
              input = v.usage.prompt_tokens ?? null;
              output = v.usage.completion_tokens ?? null;
            }
            if (
              v.choices?.[0]?.finish_reason &&
              !["stop"].includes(v.choices[0].finish_reason)
            )
              throw new AppError("Model stream did not complete", 502);
          }
          if (typeof text !== "string")
            throw new AppError("Invalid model text", 502);
          content += text;
          if (text) options.onDelta!(text);
        };
        try {
          for (;;) {
            options.signal?.throwIfAborted();
            const part = await reader.read();
            received += part.value?.byteLength ?? 0;
            if (received > 2000000)
              throw new AppError("Model response too large", 502);
            buffer += decoder.decode(part.value, { stream: !part.done });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop()!;
            lines.forEach(frame);
            if (part.done) {
              frame(buffer);
              break;
            }
            if (doneEvent) break;
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (!doneEvent)
          throw new AppError("Model stream ended before completion", 502);
      } else {
        const v = await response.json();
        model = typeof v.model === "string" ? v.model : model;
        if (anthropic) {
          if (v.stop_reason !== "end_turn" && v.stop_reason !== "stop_sequence")
            throw new AppError("Model did not complete", 502);
          content = z
            .array(z.object({ type: z.string(), text: z.string().optional() }))
            .parse(v.content)
            .filter((t) => t.type === "text")
            .map((t) => t.text ?? "")
            .join("");
          input = v.usage?.input_tokens ?? null;
          output = v.usage?.output_tokens ?? null;
        } else {
          const choice = v.choices?.[0];
          if (choice?.finish_reason && choice.finish_reason !== "stop")
            throw new AppError("Model did not complete", 502);
          content = z.string().min(1).parse(choice?.message?.content);
          input = v.usage?.prompt_tokens ?? null;
          output = v.usage?.completion_tokens ?? null;
        }
      }
      if (!content.trim() || content.length > 100000)
        throw new AppError("Invalid model content", 502);
      input = count.parse(input);
      output = count.parse(output);
      status = "succeeded";
      return {
        content,
        model: z.string().min(1).max(200).parse(model),
        provider: c.provider,
        metrics: {
          input_tokens: input,
          cached_input_tokens: null,
          output_tokens: output,
          latency_ms: Math.round(performance.now() - start),
          estimated_cost_usd: cost(),
          retrieval_count: retrieval,
          pricing_version:
            c.inputPrice !== null ? "server-configured-v1" : "unavailable",
        },
      };
    } catch (e) {
      errorCode =
        e instanceof AppError
          ? `http_${e.status}`
          : "network_or_invalid_response";
      throw e;
    } finally {
      await this.telemetry({
        operation,
        model: c.model,
        input_tokens: input,
        cached_input_tokens: null,
        output_tokens: output,
        latency_ms: Math.round(performance.now() - start),
        estimated_cost_usd: cost(),
        retrieval_count: retrieval,
        memories_extracted: null,
        pricing_version:
          c.inputPrice !== null ? "server-configured-v1" : "unavailable",
        status,
        error_code: errorCode,
      }).catch(() => {});
    }
  }
  async identifyIntent(input: string) {
    return /^(remember|correction|update)\s*:/i.test(input)
      ? "store_memory"
      : "recall";
  }
  async reason(c: BrainContext) {
    return (await this.reasonWithUsage(c)).content;
  }
  reasonWithUsage(c: BrainContext, o?: ReasoningOptions) {
    return this.complete(
      ARY_REASONING_INSTRUCTIONS,
      reasoningPayload(c),
      "reason",
      c.memories.length,
      o,
    );
  }
  planWithUsage(
    c: BrainContext,
    capabilities: import("../../domain/models").Json[],
    o?: ReasoningOptions,
  ) {
    if (capabilities.length > 80 || JSON.stringify(capabilities).length > 90000)
      throw new AppError("Planning catalog too large");
    return this.complete(
      ARY_PLANNING_INSTRUCTIONS,
      { ...reasoningPayload(c), capabilities },
      "reason",
      c.memories.length,
      o,
    );
  }
  async extractCandidates(c: ExtractionContext, o?: ReasoningOptions) {
    const result = await this.complete(
      ARY_EXTRACTION_INSTRUCTIONS +
        ' Return ONLY JSON {"candidates":[{"memory":{"content":"self-contained fact","summary":"short summary","memory_type":"fact","importance_score":0.5,"confidence_score":0.8,"valid_from":null,"valid_to":null},"evidence_quote":"exact source substring","entity_ids":[],"disposition":"new","related_memory_id":null,"reason":"source rationale"}]}. Use an empty candidates array when no durable facts exist. No markdown.',
      extractionPayload(c),
      "extract",
      c.memories.length,
      { signal: o?.signal },
    );
    return z
      .object({ candidates: z.array(extractionCandidate).max(5) })
      .strict()
      .parse(JSON.parse(result.content)).candidates;
  }
  async extractMemories(input: string, o?: ReasoningOptions) {
    const now = new Date().toISOString();
    return (
      await this.extractCandidates(
        {
          source: {
            id: "",
            user_id: "",
            conversation_id: "",
            role: "user",
            content: input,
            metadata: {},
            created_at: now,
            updated_at: now,
          },
          history: [],
          entities: [],
          memories: [],
        },
        o,
      )
    ).map((c) => c.memory);
  }
}
