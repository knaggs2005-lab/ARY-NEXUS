import { actionCancellation } from "./action-cancellation";
import { createHash } from "node:crypto";
import { memoryInScope, explainHit, policyFor } from "../domain/nexus-memory";
import { embedRecord, embeddingIdentity } from "./embedding-record";
import { EntityResolutionService } from "./entity-resolution-service";
import { graphCandidates } from "./graph-retrieval";
import { rankHybridCandidates } from "./hybrid-ranking";
import {
  withoutEmbedding,
  type Memory,
  type MemoryHit,
} from "../domain/models";
import type { z } from "zod";
import type { Repository, Mutation } from "../domain/repository";
import type { EmbeddingProvider } from "../domain/providers";
import {
  memoryInput,
  memoryUpdate,
  required,
  AppError,
} from "../domain/validation";
export class MemoryService {
  constructor(
    private repository: Repository,
    private embeddings: EmbeddingProvider,
  ) {}
  async createMemory(
    input: z.input<typeof memoryInput>,
    commit?: { id: string; mutations: Mutation[] },
  ) {
    const data = memoryInput.parse(input);
    if (data.metadata.nexus_memory !== undefined)
      throw new AppError(
        "Use the scoped memory capture tool for lifecycle metadata",
      );
    if (
      data.valid_from &&
      data.valid_to &&
      Date.parse(data.valid_from) >= Date.parse(data.valid_to)
    )
      throw new AppError("Validity end must follow start");
    if (data.source_message_id) {
      const source = required(
        await this.repository.get("messages", data.source_message_id),
        "Source message",
      );
      if (source.role !== "user")
        throw new AppError("Only user messages can establish user facts");
    }
    const record = {
      ...data,
      metadata: { ...data.metadata, origin: data.metadata.origin ?? "manual" },
      ...(await embedRecord(this.embeddings, data.content, data.summary)),
      last_accessed_at: null,
      archived_at: null,
      status: "active",
      supersedes_id: null,
    } satisfies import("../domain/models").NewRecord<Memory>;
    if (commit) {
      await this.repository.batch([
        ...commit.mutations,
        { kind: "insert", table: "memories", id: commit.id, data: record },
      ]);
      return required(
        await this.repository.get("memories", commit.id),
        "Committed memory",
      );
    }
    return this.repository.insert("memories", record);
  }
  async updateMemory(id: string, input: z.input<typeof memoryUpdate>) {
    const patch = memoryUpdate.parse(input);
    if (patch.metadata?.nexus_memory !== undefined)
      throw new AppError(
        "Lifecycle metadata cannot be changed through generic memory updates",
      );
    const previous = required(
      await this.repository.get("memories", id),
      "Memory",
    );
    if (previous.archived_at || previous.status !== "active")
      throw new AppError("Archived memories cannot be edited", 409);
    const textChanged =
      patch.content !== undefined || patch.summary !== undefined;
    return this.repository.update("memories", id, {
      ...patch,
      ...(patch.metadata
        ? {
            metadata: {
              ...patch.metadata,
              ...(previous.metadata.nexus_memory
                ? { nexus_memory: previous.metadata.nexus_memory }
                : {}),
            },
          }
        : {}),
      ...(textChanged
        ? await embedRecord(
            this.embeddings,
            patch.content ?? previous.content,
            patch.summary ?? previous.summary,
          )
        : {}),
    });
  }
  async searchMemories(query: string, limit = 8) {
    return this.getRelevantMemories(query, limit);
  }
  async getRelevantMemories(
    query: string,
    limit = 8,
    entityIds?: string[],
    excludedEntityIds: string[] = [],
    scope: { conversationId?: string; onDegraded?: () => void } = {},
  ) {
    if (!query.trim()) return [];
    // Chat may pass its already-resolved IDs. API/manual search resolves before candidate generation.
    const resolution =
      entityIds === undefined
        ? await new EntityResolutionService(this.repository).resolve(query)
        : null;
    const roots = entityIds ?? resolution!.entities.map((e) => e.id);
    const ambiguous = new Set([
      ...excludedEntityIds,
      ...(resolution?.resolutions
        .filter((r) => r.status === "ambiguous")
        .flatMap((r) => r.candidates.map((c) => c.id)) ?? []),
    ]);
    const [base, links, nodes, edges, all] = await Promise.all([
      this.embeddings
        .embed(query)
        .catch(() => {
          actionCancellation.getStore()?.throwIfAborted();
          scope.onDegraded?.();
          return Array(this.embeddings.dimensions ?? 384).fill(0) as number[];
        })
        .then((vector) =>
          this.repository.search(
            query,
            vector,
            this.embeddings.modelId,
            200,
            embeddingIdentity(this.embeddings).embedding_version,
            this.embeddings.modelId === "text-embedding-3-large" ? 0.4 : 0.2,
            scope,
          ),
        ),
      roots.length || ambiguous.size
        ? this.repository.list("memory_entities")
        : Promise.resolve([]),
      roots.length ? this.repository.list("entities") : Promise.resolve([]),
      roots.length
        ? this.repository.list("relationships")
        : Promise.resolve([]),
      roots.length ? this.repository.list("memories") : Promise.resolve([]),
    ]);
    const excludedMemories = new Set(
      links.filter((l) => ambiguous.has(l.entity_id)).map((l) => l.memory_id),
    );
    const now = Date.now();
    const dependencyRows = all.length
      ? all
      : base.some((m) => policyFor(m).consolidated_from.length)
        ? await this.repository.list("memories")
        : [];
    const dependencyMap = new Map(dependencyRows.map((m) => [m.id, m]));
    const validDependencies = (
      m: Omit<Memory, "embedding">,
      seen = new Set<string>(),
    ): boolean => {
      if (seen.has(m.id) || seen.size > 16) return false;
      const next = new Set([...seen, m.id]);
      return policyFor(m).consolidated_from.every((s) => {
        const source = dependencyMap.get(s.id);
        return Boolean(
          source &&
          isCurrentMemory(source, now) &&
          memoryInScope(source, scope.conversationId, now) &&
          s.content_hash === memoryContentHash(source) &&
          validDependencies(source, next),
        );
      });
    };
    const eligible = (m: Omit<Memory, "embedding">) =>
      m.user_id === this.repository.userId &&
      isCurrentMemory(m, now) &&
      memoryInScope(m, scope.conversationId, now) &&
      !excludedMemories.has(m.id) &&
      validDependencies(m);
    const ranked = new Map<string, MemoryHit>(
      base.filter(eligible).map((m) => [m.id, m]),
    );
    const safeNodes = nodes.filter(
      (n) => n.user_id === this.repository.userId && !ambiguous.has(n.id),
    );
    const safeEdges = edges.filter((e) => e.user_id === this.repository.userId);
    const safeLinks = links.filter((l) => l.user_id === this.repository.userId);
    for (const graph of graphCandidates(
      roots,
      safeNodes,
      safeEdges,
      all.filter(eligible),
      safeLinks,
    )) {
      const existing = ranked.get(graph.id);
      ranked.set(graph.id, {
        ...graph,
        ...existing,
        graph_path: graph.graph_path,
        graph_steps: graph.graph_steps,
        graph_hops: graph.graph_hops,
      });
    }
    // All filters precede source re-ranking and the single RRF merge.
    const hits = rankHybridCandidates([...ranked.values()], limit);
    const accessedAt = new Date().toISOString();
    await Promise.all(
      hits.map((m) =>
        this.repository.update("memories", m.id, {
          last_accessed_at: accessedAt,
        }),
      ),
    );
    const [sources, conflicts] = await Promise.all([
      Promise.all(
        hits.map((m) =>
          this.repository.list("memory_sources", { memory_id: m.id }),
        ),
      ),
      this.repository.list("memory_conflicts", { status: "pending" }),
    ]);
    return hits.map((m, index) => {
      const pending = conflicts.filter(
        (c) => c.existing_memory_id === m.id,
      ).length;
      const hit = {
        ...m,
        last_accessed_at: accessedAt,
        source_evidence: sources[index].slice(-1),
        unresolved_conflict_count: pending,
        retrieval_reasons: [
          ...(m.retrieval_reasons ?? []),
          ...(pending
            ? [
                "This current memory has an unresolved contradiction; do not present it as settled truth.",
              ]
            : []),
        ],
      };
      const sourceHistory = sources[index];
      return {
        ...hit,
        explanation: explainHit({
          ...hit,
          source_evidence:
            sourceHistory.length > 1
              ? [sourceHistory[0], sourceHistory.at(-1)!]
              : sourceHistory,
        }),
      };
    });
  }
  async linkMemoryToEntity(memoryId: string, entityId: string) {
    required(await this.repository.get("memories", memoryId), "Memory");
    required(await this.repository.get("entities", entityId), "Entity");
    const existing = (
      await this.repository.list("memory_entities", {
        memory_id: memoryId,
        entity_id: entityId,
      })
    )[0];
    return (
      existing ??
      this.repository.insert("memory_entities", {
        memory_id: memoryId,
        entity_id: entityId,
      })
    );
  }
  async history(id: string) {
    required(await this.repository.get("memories", id), "Memory");
    const [versions, evidence, sources] = await Promise.all([
      this.repository.list("memory_versions", { record_id: id }),
      this.repository.list("memory_evidence", { memory_id: id }),
      this.repository.list("memory_sources", { memory_id: id }),
    ]);
    return {
      versions: versions
        .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
        .map((v) => {
          const { embedding: _, ...snapshot } = v.snapshot;
          return { ...v, snapshot };
        }),
      evidence,
      sources,
    };
  }
  /** Knowledge as recorded at a time; validity is a separate, optional filter. */
  async atTime(knownAt: string, validAt?: string) {
    const versions = (await this.repository.list("memory_versions"))
      .filter((v) => Date.parse(v.recorded_at) <= Date.parse(knownAt))
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    const latest = new Map<string, Memory>();
    for (const v of versions)
      if (!latest.has(v.record_id))
        latest.set(v.record_id, v.snapshot as unknown as Memory);
    return [...latest.values()]
      .filter(
        (m) =>
          !m.archived_at &&
          m.status !== "disputed" &&
          (validAt
            ? (!m.valid_from ||
                Date.parse(m.valid_from) <= Date.parse(validAt)) &&
              (!m.valid_to || Date.parse(m.valid_to) > Date.parse(validAt)) &&
              (m.status !== "superseded" || m.valid_to !== null)
            : m.status === "active"),
      )
      .map(withoutEmbedding);
  }
  async prepare(input: z.input<typeof memoryInput>) {
    const data = memoryInput.parse(input);
    if (data.metadata.nexus_memory !== undefined)
      throw new AppError("Lifecycle metadata requires the scoped capture tool");
    if (
      data.valid_from &&
      data.valid_to &&
      Date.parse(data.valid_from) >= Date.parse(data.valid_to)
    )
      throw new AppError("Validity end must follow start");
    return {
      ...data,
      ...(await embedRecord(this.embeddings, data.content, data.summary)),
      last_accessed_at: null,
      archived_at: null,
      status: "active" as const,
      supersedes_id: null,
    };
  }
  async archiveMemory(id: string) {
    required(await this.repository.get("memories", id), "Memory");
    return this.repository.update("memories", id, {
      archived_at: new Date().toISOString(),
    });
  }
}

export function isCurrentMemory(m: Omit<Memory, "embedding">, at = Date.now()) {
  return (
    !m.archived_at &&
    (!policyFor(m).expires_at || Date.parse(policyFor(m).expires_at!) > at) &&
    m.status === "active" &&
    (!m.valid_from || Date.parse(m.valid_from) <= at) &&
    (!m.valid_to || Date.parse(m.valid_to) > at)
  );
}

export function memoryContentHash(
  m: Pick<
    Memory,
    "content" | "summary" | "confidence_score" | "valid_from" | "valid_to"
  >,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        m.content,
        m.summary,
        m.confidence_score,
        m.valid_from,
        m.valid_to,
      ]),
    )
    .digest("hex");
}
