import { agentExecution } from "./agent-context";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  captureMemoryInput,
  classifyMemoryInput,
  consolidateInput,
  forgetInput,
  knowledgeInput,
  policyFor,
  memoryInScope,
} from "../domain/nexus-memory";
import { required, AppError } from "../domain/validation";
import { withoutEmbedding } from "../domain/models";
import type { Repository, Mutation } from "../domain/repository";
import type { ToolExecutionContext } from "../domain/tool-registry";
import {
  MemoryService,
  isCurrentMemory,
  memoryContentHash,
} from "./memory-service";
/** Lifecycle additions to the canonical memory store. No independent brain or extraction pipeline. */
export class NexusMemoryService {
  constructor(
    private repo: Repository,
    private memories: MemoryService,
  ) {}
  private async commit(mutations: Mutation[], context: ToolExecutionContext) {
    if (!context.stage)
      throw new AppError(
        "Memory mutations require the transactional action pipeline",
        403,
      );
    context.stage(mutations);
  }
  async list() {
    return (await this.repo.list("memories")).map((m) => ({
      ...withoutEmbedding(m),
      policy: policyFor(m),
      current: isCurrentMemory(m),
      retrievable_without_conversation: memoryInScope(m),
    }));
  }
  async inspect(id: string) {
    if (agentExecution.getStore())
      throw new AppError(
        "Agent memory inspection must use existing mission-scoped retrieval",
        403,
      );
    const m = required(await this.repo.get("memories", id), "Memory");
    const [history, links, conflicts] = await Promise.all([
      this.memories.history(id),
      this.repo.list("memory_entities", { memory_id: id }),
      this.repo.list("memory_conflicts"),
    ]);
    const p = policyFor(m);
    return {
      memory: withoutEmbedding(m),
      policy: p,
      learned_at: m.created_at,
      confidence: m.confidence_score,
      confidence_basis:
        "Recorded estimate, not a calibrated probability. See source evidence and unresolved conflicts.",
      current: isCurrentMemory(m),
      history,
      entities: await Promise.all(
        links.map((l) => this.repo.get("entities", l.entity_id)),
      ),
      outcome: p.outcome_id
        ? await this.repo.get("outcomes", p.outcome_id)
        : null,
      conflicts: conflicts.filter(
        (c) => c.existing_memory_id === id || c.candidate_memory_id === id,
      ),
      consolidated_sources: await Promise.all(
        p.consolidated_from.map(async (s) => ({
          ...s,
          available: Boolean(await this.repo.get("memories", s.id)),
        })),
      ),
      retrieval:
        "Hybrid semantic, lexical and entity/graph rank fusion; a query is required to explain relevance. Importance and confidence are secondary.",
      deletion_scope:
        "Deletes this memory, its evidence, versions and entity links. Source conversations, past responses, action/approval records and backups remain. Dependent versions/relationships/consolidations block deletion; archive instead.",
    };
  }
  private async validateCapture(input: z.infer<typeof captureMemoryInput>) {
    if (input.class === "WORKING") {
      const end = Date.parse(input.expires_at ?? "");
      if (
        !input.conversation_id ||
        !Number.isFinite(end) ||
        end <= Date.now() ||
        end > Date.now() + 86400000
      )
        throw new AppError(
          "Working memory needs a conversation and expiry within 24 hours",
        );
    } else if (input.expires_at || input.conversation_id)
      throw new AppError(
        "Conversation scope and expiry are reserved for working memory",
      );
    if (input.class === "ENTITY" && !input.entity_ids.length)
      throw new AppError("Entity memory requires a linked entity");
    if (input.class === "OUTCOME" && !input.outcome_id)
      throw new AppError("Outcome memory requires an actual outcome");
    const guards: Mutation[] = [];
    for (const id of new Set(input.entity_ids)) {
      const e = required(await this.repo.get("entities", id), "Entity");
      guards.push({
        kind: "check",
        table: "entities",
        id,
        expected_updated_at: e.updated_at,
      });
    }
    if (input.outcome_id) {
      const o = required(
        await this.repo.get("outcomes", input.outcome_id),
        "Outcome",
      );
      guards.push({
        kind: "check",
        table: "outcomes",
        id: o.id,
        expected_updated_at: o.updated_at,
      });
    }
    if (input.conversation_id)
      required(
        await this.repo.get("conversations", input.conversation_id),
        "Conversation",
      );
    if (input.source_message_id) {
      const source = required(
        await this.repo.get("messages", input.source_message_id),
        "Source message",
      );
      if (
        source.role !== "user" ||
        !source.content.includes(input.content) ||
        (input.conversation_id &&
          source.conversation_id !== input.conversation_id)
      )
        throw new AppError(
          "Conversation evidence must quote the selected user message exactly",
        );
    }
    return guards;
  }
  async classify(
    raw: z.input<typeof classifyMemoryInput>,
    context: ToolExecutionContext,
  ) {
    const input = classifyMemoryInput.parse(raw),
      m = required(await this.repo.get("memories", input.id), "Memory");
    if (!isCurrentMemory(m))
      throw new AppError("Only current memories can be classified", 409);
    if (policyFor(m).consolidated_from.length)
      throw new AppError(
        "Consolidated memory retains its reviewed semantic classification",
        409,
      );
    const existing = await this.repo.list("memory_entities", {
      memory_id: m.id,
    });
    const ids = [
      ...new Set([...existing.map((l) => l.entity_id), ...input.entity_ids]),
    ];
    const { id: _id, expected_updated_at: _expected, ...policy } = input;
    const guards = await this.validateCapture(
      captureMemoryInput.parse({
        ...policy,
        content: m.content,
        summary: m.summary,
        entity_ids: ids,
      }),
    );
    await this.commit(
      [
        ...guards,
        {
          kind: "update",
          table: "memories",
          id: m.id,
          expected_updated_at: input.expected_updated_at,
          data: {
            metadata: {
              ...m.metadata,
              nexus_memory: {
                version: 1,
                class: input.class,
                conversation_id: input.conversation_id,
                expires_at: input.expires_at,
                outcome_id: input.outcome_id,
                consolidated_from: [],
              },
            },
          },
        },
        ...ids
          .filter((id) => !existing.some((l) => l.entity_id === id))
          .map((entity_id) => ({
            kind: "insert" as const,
            table: "memory_entities" as const,
            data: { memory_id: m.id, entity_id },
          })),
      ],
      context,
    );
    return {
      memory_id: m.id,
      class: input.class,
      content_and_embeddings_preserved: true,
    };
  }
  async capture(
    raw: z.input<typeof captureMemoryInput>,
    context: ToolExecutionContext,
  ) {
    const input = captureMemoryInput.parse(raw);
    const guards = await this.validateCapture(input);
    const prepared = await this.memories.prepare({
      content: input.content,
      summary: input.summary,
      memory_type:
        input.class === "EPISODIC"
          ? "episodic"
          : input.class === "PROCEDURAL"
            ? "procedural"
            : "fact",
      confidence_score: input.confidence,
      importance_score: input.importance,
      source_message_id: input.source_message_id,
      metadata: {
        origin: "manual",
        ...(input.source_message_id ? { evidence_quote: input.content } : {}),
      },
    });
    const id = randomUUID();
    prepared.metadata.nexus_memory = {
      version: 1,
      class: input.class,
      conversation_id: input.conversation_id,
      expires_at: input.expires_at,
      outcome_id: input.outcome_id,
      consolidated_from: [],
    };
    await this.commit(
      [
        ...guards,
        { kind: "insert", table: "memories", id, data: prepared },
        ...Array.from(new Set(input.entity_ids), (entity_id) => ({
          kind: "insert" as const,
          table: "memory_entities" as const,
          data: { memory_id: id, entity_id },
        })),
      ],
      context,
    );
    return { memory_id: id, class: input.class };
  }
  async consolidate(
    raw: z.input<typeof consolidateInput>,
    context: ToolExecutionContext,
  ) {
    const input = consolidateInput.parse(raw);
    if (new Set(input.sources.map((s) => s.id)).size !== input.sources.length)
      throw new AppError("Select distinct memories");
    const source = await Promise.all(
      input.sources.map(async (s) =>
        required(await this.repo.get("memories", s.id), "Source memory"),
      ),
    );
    const conflicts = await this.repo.list("memory_conflicts", {
      status: "pending",
    });
    if (
      source.some(
        (m) =>
          !isCurrentMemory(m) ||
          policyFor(m).class === "WORKING" ||
          conflicts.some(
            (c) =>
              c.existing_memory_id === m.id || c.candidate_memory_id === m.id,
          ),
      )
    )
      throw new AppError(
        "Consolidate only current durable memories without unresolved contradictions",
        409,
      );
    const prepared = await this.memories.prepare({
      content: input.summary,
      summary: input.summary.slice(0, 1000),
      confidence_score: Math.min(...source.map((m) => m.confidence_score)),
      importance_score: Math.max(...source.map((m) => m.importance_score)),
      metadata: {
        origin: "manual",
        source:
          "User-reviewed consolidation; inspect referenced source versions",
      },
    });
    prepared.metadata.nexus_memory = {
      version: 1,
      class: "SEMANTIC",
      conversation_id: null,
      expires_at: null,
      outcome_id: null,
      consolidated_from: input.sources.map((s, i) => ({
        ...s,
        content_hash: memoryContentHash(source[i]),
      })),
    };
    const id = randomUUID(),
      links = await this.repo.list("memory_entities");
    const entityIds = new Set(
      links
        .filter((l) => source.some((m) => m.id === l.memory_id))
        .map((l) => l.entity_id),
    );
    await this.commit(
      [
        ...input.sources.map((s) => ({
          kind: "check" as const,
          table: "memories" as const,
          id: s.id,
          expected_updated_at: s.updated_at,
        })),
        { kind: "insert", table: "memories", id, data: prepared },
        ...Array.from(entityIds, (entity_id) => ({
          kind: "insert" as const,
          table: "memory_entities" as const,
          data: { memory_id: id, entity_id },
        })),
      ],
      context,
    );
    return {
      memory_id: id,
      source_ids: source.map((m) => m.id),
      originals_preserved: true,
      confidence: prepared.confidence_score,
    };
  }
  async forget(
    raw: z.input<typeof forgetInput>,
    context: ToolExecutionContext,
    remove = false,
  ) {
    const input = forgetInput.parse(raw),
      m = required(await this.repo.get("memories", input.id), "Memory");
    await this.commit(
      [
        remove
          ? {
              kind: "delete_memory",
              table: "memories",
              id: m.id,
              expected_updated_at: input.expected_updated_at,
            }
          : {
              kind: "update",
              table: "memories",
              id: m.id,
              expected_updated_at: input.expected_updated_at,
              data: { archived_at: new Date().toISOString() },
            },
      ],
      context,
    );
    return {
      memory_id: m.id,
      operation: remove ? "delete_memory_record" : "archive",
      reason: input.reason,
      source_conversations_preserved: true,
    };
  }
  async knowledge(query = "") {
    const all = await this.repo.list("knowledge_documents");
    const superseded = new Set(all.map((k) => k.supersedes_id).filter(Boolean));
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return all
      .filter((k) => !k.archived_at && !superseded.has(k.id))
      .map((k) => ({
        ...k,
        score: words.reduce(
          (n, w) =>
            n + ((k.title + " " + k.content).toLowerCase().includes(w) ? 1 : 0),
          0,
        ),
      }))
      .filter((k) => !words.length || k.score > 0)
      .sort(
        (a, b) => b.score - a.score || b.created_at.localeCompare(a.created_at),
      )
      .slice(0, 100);
  }
  async inspectKnowledge(id: string) {
    const document = required(
      await this.repo.get("knowledge_documents", id),
      "Knowledge",
    );
    const all = await this.repo.list("knowledge_documents"),
      revisions = [document],
      seen = new Set([document.id]);
    let p = document;
    while (p.supersedes_id && revisions.length < 50) {
      const previous = all.find((k) => k.id === p.supersedes_id);
      if (!previous || seen.has(previous.id)) break;
      revisions.push(previous);
      seen.add(previous.id);
      p = previous;
    }
    return {
      document,
      revisions,
      current:
        !document.archived_at && !all.some((k) => k.supersedes_id === id),
      namespace: "KNOWLEDGE",
      learned_fact: false,
    };
  }
  async archiveKnowledge(
    raw: z.input<typeof forgetInput>,
    context: ToolExecutionContext,
  ) {
    const input = forgetInput.parse(raw);
    required(await this.repo.get("knowledge_documents", input.id), "Knowledge");
    await this.commit(
      [
        {
          kind: "update",
          table: "knowledge_documents",
          id: input.id,
          expected_updated_at: input.expected_updated_at,
          data: { archived_at: new Date().toISOString() },
        },
      ],
      context,
    );
    return { knowledge_id: input.id, archived: true };
  }
  async captureKnowledge(
    raw: z.input<typeof knowledgeInput>,
    context: ToolExecutionContext,
  ) {
    const input = knowledgeInput.parse(raw),
      guards: Mutation[] = [];
    if (input.supersedes_id) {
      const previous = required(
        await this.repo.get("knowledge_documents", input.supersedes_id),
        "Knowledge revision",
      );
      if (
        previous.archived_at ||
        (await this.repo.list("knowledge_documents")).some(
          (k) => k.supersedes_id === previous.id,
        )
      )
        throw new AppError("Knowledge revision is no longer current", 409);
      guards.push({
        kind: "check",
        table: "knowledge_documents",
        id: previous.id,
        expected_updated_at: previous.updated_at,
      });
    }
    for (const id of input.entity_ids)
      required(await this.repo.get("entities", id), "Entity");
    const id = randomUUID();
    await this.commit(
      [
        ...guards,
        {
          kind: "insert",
          table: "knowledge_documents",
          id,
          data: { ...input, archived_at: null },
        },
      ],
      context,
    );
    return { knowledge_id: id, namespace: "KNOWLEDGE", learned_fact: false };
  }
}
