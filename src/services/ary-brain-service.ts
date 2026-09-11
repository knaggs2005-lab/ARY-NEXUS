import { actionCancellation } from "./action-cancellation";
import { NexusEventBus } from "./nexus-event-bus";
import type { OrchestrationConversationService } from "./orchestration-conversation-service";
import type { StudioConversationService } from "./studio-conversation-service";
import { FinanceConversationService } from "./finance-conversation-service";
import { CalendarConversationService } from "./calendar-conversation-service";
import { TaskConversationService } from "./task-conversation-service";
import type { ReflectionService } from "./reflection-service";
import { randomUUID } from "node:crypto";
import { MemoryReconciliationService } from "./memory-reconciliation-service";
import type { Repository } from "../domain/repository";
import type { LanguageModelProvider } from "../domain/providers";
import type { MemoryHit, Message } from "../domain/models";
import { AppError, chatInput, required } from "../domain/validation";
import { MemoryService } from "./memory-service";
import { EntityService } from "./entity-service";
import { ActionService } from "./action-service";
export type BrainEvent =
  | { type: "presence"; event: import("../domain/presence").PresenceEvent }
  | { type: "delta"; text: string }
  | { type: "cancelled" }
  | { type: "entities"; message: Message }
  | {
      type: "response";
      conversation_id: string;
      message: Message;
      retrieved_memories: MemoryHit[];
      intent: string;
      provider: string;
    }
  | { type: "complete"; saved_memory_ids: string[]; warnings: string[] }
  | { type: "error"; error: string };
/** Explicit orchestration with a durable extraction job, processed after delivering the answer. */
export class AryBrainService {
  constructor(
    private repository: Repository,
    private memories: MemoryService,
    private entities: EntityService,
    private llm: LanguageModelProvider,
    private actions: ActionService,
    private reflection?: ReflectionService,
    private studio?: StudioConversationService,
    private orchestration?: OrchestrationConversationService,
    private discoverCapabilities?: (
      query: string,
    ) => Promise<import("../domain/models").Json[]>,
  ) {}
  async *respond(
    raw: {
      input: string;
      conversation_id?: string;
      modality?: "text" | "voice";
      time_zone?: string;
    },
    options: import("../domain/voice").ReasoningOptions & {
      onPresence?: (event: import("../domain/presence").PresenceEvent) => void;
    } = {},
  ): AsyncGenerator<BrainEvent> {
    const responseStarted = performance.now();
    const input = chatInput.parse(raw);
    const conversation = input.conversation_id
      ? required(
          await this.repository.get("conversations", input.conversation_id),
          "Conversation",
        )
      : await this.repository.insert("conversations", {
          title: input.input.slice(0, 80),
          metadata: { modality: input.modality },
        });
    const history = (
      await this.repository.list("messages", {
        conversation_id: conversation.id,
      })
    ).slice(-20);
    const sourceId = randomUUID(),
      jobId = randomUUID();
    await this.repository.batch([
      {
        kind: "insert",
        table: "messages",
        id: sourceId,
        data: {
          conversation_id: conversation.id,
          role: "user",
          content: input.input,
          metadata: { modality: input.modality },
        },
      },
      {
        kind: "insert",
        table: "extraction_jobs",
        id: jobId,
        data: {
          source_message_id: sourceId,
          status: "pending",
          attempts: 0,
          lease_until: null,
          error: null,
          saved_memory_ids: [],
        },
      },
    ]);
    const bus = new NexusEventBus(this.repository);
    const phase = async (
      state: import("../domain/presence").PresenceState,
      label: string,
      count?: number,
    ) => {
      await bus.presence(
        { operation: sourceId, state, label, count },
        conversation.id,
      );
      try {
        options.onPresence?.({ operation: sourceId, state, label, count });
      } catch {
        /* Presentation is non-authoritative. */
      }
    };
    await phase("understanding", "Resolving entities");
    const resolution = await this.entities.resolveMentions(input.input);
    const source = await this.repository.update("messages", sourceId, {
      metadata: {
        modality: input.modality,
        entity_resolutions: resolution.resolutions,
        entity_resolution_version: "rules-v1",
      },
    });
    console.info(
      JSON.stringify({
        event: "ary.entity_resolution",
        message_id: sourceId,
        resolutions: resolution.resolutions.map((r) => ({
          start: r.start,
          end: r.end,
          status: r.status,
          method: r.method,
          canonical_entity_id: r.canonical_entity_id,
          confidence: r.confidence,
          reason: r.reason,
          evidence_relationship_ids: r.evidence_relationship_ids,
        })),
      }),
    );
    yield { type: "entities", message: source };
    let response: Extract<BrainEvent, { type: "response" }> | undefined;
    let responseError: unknown;
    try {
      response = await this.actions.run(
        "brain.respond",
        conversation.id,
        async () => {
          // input → identify intent → resolve entities → retrieve memories → construct context → reason
          options.signal?.throwIfAborted();
          const orchestrationReply = await this.orchestration?.handle(
            input.input,
            source,
          );
          const studioReply = orchestrationReply
            ? null
            : await this.studio?.handle(input.input, source);
          const financeReply =
            orchestrationReply || studioReply
              ? null
              : await new FinanceConversationService(
                  this.repository,
                  this.actions,
                ).handle(input.input, source);
          const calendarReply =
            orchestrationReply || studioReply || financeReply
              ? null
              : await new CalendarConversationService(
                  this.repository,
                  this.actions,
                ).handle(input.input, source, input.time_zone);
          const taskReply =
            orchestrationReply ??
            studioReply ??
            financeReply ??
            calendarReply ??
            (await new TaskConversationService(
              this.repository,
              this.actions,
            ).handle(
              input.input,
              source,
              resolution.entities,
              resolution.resolutions.some((r) => r.status === "ambiguous"),
              input.time_zone,
            ));
          if (taskReply) {
            const message = await this.repository.insert("messages", {
              conversation_id: conversation.id,
              role: "assistant",
              content: taskReply.content,
              metadata: {
                ...taskReply.metadata,
                intent: orchestrationReply
                  ? "orchestration"
                  : studioReply
                    ? "studio_scene"
                    : financeReply
                      ? "finance_context"
                      : calendarReply
                        ? "calendar_context"
                        : "internal_task",
                modality: input.modality,
                entity_resolutions: resolution.resolutions,
                entity_resolution_version: "rules-v1",
                retrieved_memories: [],
                provider: orchestrationReply
                  ? "Ary execution plans"
                  : studioReply
                    ? "Studio control"
                    : financeReply
                      ? "Financial source records"
                      : calendarReply
                        ? "Google Calendar"
                        : "Internal task records",
                provider_id: orchestrationReply
                  ? "orchestration"
                  : studioReply
                    ? "studio"
                    : financeReply
                      ? "finance_records"
                      : calendarReply
                        ? "google_calendar"
                        : "internal",
                response_latency_ms: Math.round(
                  performance.now() - responseStarted,
                ),
                extraction_job_id: jobId,
                extraction_status: "pending",
              },
            });
            return {
              type: "response" as const,
              conversation_id: conversation.id,
              message,
              retrieved_memories: [],
              intent: orchestrationReply
                ? "orchestration"
                : studioReply
                  ? "studio_scene"
                  : financeReply
                    ? "finance_context"
                    : calendarReply
                      ? "calendar_context"
                      : "internal_task",
              provider: orchestrationReply
                ? "Ary execution plans"
                : studioReply
                  ? "Studio control"
                  : financeReply
                    ? "Financial source records"
                    : calendarReply
                      ? "Google Calendar"
                      : "Internal task records",
            };
          }
          await phase("understanding", "Identifying intent");
          const intent = await this.llm.identifyIntent(input.input);
          const resolved = resolution.entities;
          const ambiguousIds = new Set(
            resolution.resolutions
              .filter((r) => r.status === "ambiguous")
              .flatMap((r) => r.candidates.map((c) => c.id)),
          );
          await phase("retrieving", "Retrieving relevant memory");
          let retrievalDegraded = false;
          const retrieved = await this.memories.getRelevantMemories(
            input.input,
            8,
            resolved.map((entity) => entity.id),
            [...ambiguousIds],
            {
              conversationId: conversation.id,
              onDegraded: () => {
                retrievalDegraded = true;
              },
            },
          );
          const capabilities =
            this.discoverCapabilities &&
            /can you|can ary|which tool|capabilit|how (?:can|do)|help me/i.test(
              input.input,
            )
              ? await this.discoverCapabilities(input.input).catch(() => [])
              : [];
          const context = {
            capabilities,
            entity_resolutions: resolution.resolutions,
            input: input.input,
            intent,
            entities: resolved,
            memories: retrieved,
            history,
          };
          await phase(
            "thinking",
            `Reasoning with ${retrieved.length} retrieved memories`,
            retrieved.length,
          );
          const modelStarted = performance.now();
          const result = this.llm.reasonWithUsage
            ? await this.llm.reasonWithUsage(context, {
                ...options,
                signal: actionCancellation.getStore()
                  ? AbortSignal.any([
                      actionCancellation.getStore()!,
                      ...(options.signal ? [options.signal] : []),
                    ])
                  : options.signal,
              })
            : {
                content: await this.llm.reason(context),
                model: this.llm.name,
                provider:
                  this.llm.name === "Development stub"
                    ? "development"
                    : "compatible",
                metrics: {
                  input_tokens: null,
                  cached_input_tokens: null,
                  output_tokens: null,
                  estimated_cost_usd: null,
                  latency_ms: Math.round(performance.now() - modelStarted),
                  retrieval_count: retrieved.length,
                  pricing_version: "unavailable",
                },
              };
          options.signal?.throwIfAborted();
          const responseLatency = Math.round(
            performance.now() - responseStarted,
          );
          const content = result.content;
          const message = await this.repository.insert("messages", {
            conversation_id: conversation.id,
            role: "assistant",
            content,
            metadata: {
              modality: input.modality,
              entity_resolutions: resolution.resolutions,
              entity_resolution_version: "rules-v1",
              retrieved_memories: retrieved,
              intent,
              entity_ids: resolved.map((e) => e.id),
              provider: result.model,
              provider_id: result.provider,
              model_usage: { ...result.metrics },
              ...("routing" in result && result.routing
                ? { model_routing: result.routing }
                : {}),
              retrieval_mode: retrievalDegraded
                ? "lexical_graph_only"
                : "hybrid",
              response_latency_ms: responseLatency,
              extraction_status: "pending",
              extraction_job_id: jobId,
            },
          });
          console.info(
            JSON.stringify({
              event: "ary.response",
              message_id: message.id,
              provider: result.provider,
              model: result.model,
              ...result.metrics,
              response_latency_ms: responseLatency,
            }),
          );
          return {
            type: "response" as const,
            conversation_id: conversation.id,
            message,
            retrieved_memories: retrieved,
            intent,
            provider: result.model,
          };
        },
        {},
        {
          productIds: resolution.entities
            .filter((e) =>
              ["company", "project", "product"].includes(e.entity_type),
            )
            .map((e) => e.id),
        },
      );
    } catch (error) {
      responseError = error;
    }
    // Deliver the answer before extraction. The API continues consuming this generator.
    if (response) yield response;
    else if (options.signal?.aborted) yield { type: "cancelled" };
    const saved: string[] = [];
    const warnings: string[] = [];
    try {
      await this.repository.update("messages", sourceId, {
        metadata: {
          ...source.metadata,
          response_status: response
            ? "completed"
            : options.signal?.aborted
              ? "cancelled"
              : "failed",
          extraction_job_id: jobId,
        },
      });
    } catch {
      warnings.push(
        "Could not persist response status; memory extraction will still be attempted.",
      );
    }
    try {
      await this.actions.run(
        "memory.extract",
        conversation.id,
        async () => {
          await phase("remembering", "Checking durable memory updates");
          const reconciliation = new MemoryReconciliationService(
            this.repository,
            this.memories,
            this.entities,
            this.llm,
          );
          saved.push(...(await reconciliation.runJob(jobId)));
        },
        {},
        { productIds: resolution.entities.map((e) => e.id) },
      );
    } catch (error) {
      console.error("Memory extraction failed", error);
      warnings.push(
        "Your message was saved. Memory extraction failed without partial memory changes; retry the extraction job in Memory review.",
      );
    }
    try {
      if (response)
        await this.repository.update("messages", response.message.id, {
          metadata: {
            ...response.message.metadata,
            extraction_status: warnings.length ? "failed" : "completed",
            saved_memory_ids: saved,
            warnings,
          },
        });
    } catch (error) {
      console.error("Extraction status update failed", error);
      warnings.push("Could not persist the extraction status.");
    }
    if (this.reflection) {
      try {
        await this.reflection.enqueue(sourceId);
      } catch {
        warnings.push(
          "Reflection could not be queued; retry it from the Reflection panel.",
        );
      }
    }
    if (responseError && !options.signal?.aborted)
      yield {
        type: "error",
        error:
          responseError instanceof AppError
            ? responseError.message
            : "Response failed. Your message was saved; check Memory review for extraction status.",
      };
    await bus.presence(
      {
        operation: sourceId,
        state: responseError || warnings.length ? "error" : "complete",
        label: responseError
          ? "Response failed"
          : warnings.length
            ? "Memory check needs attention"
            : "Conversation and memory check saved",
        terminal: true,
        count: saved.length,
      },
      conversation.id,
    );
    yield { type: "complete", saved_memory_ids: saved, warnings };
  }
}
