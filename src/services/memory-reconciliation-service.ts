import { contradictionReason, safeDuplicate } from "./contradiction-guard";
import { policyFor } from "../domain/nexus-memory";
import { isCurrentMemory } from "./memory-service";
import { randomUUID } from "node:crypto";
import type { Repository, Mutation } from "../domain/repository";
import type { LanguageModelProvider } from "../domain/providers";
import { AppError, extractionCandidate, required } from "../domain/validation";
import { MemoryService } from "./memory-service";
import { EntityService } from "./entity-service";
import type { Memory } from "../domain/models";

const normalize = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");
/** Extraction proposes; this service validates evidence and commits one atomic unit. */
export class MemoryReconciliationService {
  constructor(
    private repository: Repository,
    private memories: MemoryService,
    private entities: EntityService,
    private llm: LanguageModelProvider,
  ) {}

  async runJob(id: string) {
    const job = required(
      await this.repository.get("extraction_jobs", id),
      "Extraction job",
    );
    if (job.status === "completed") return job.saved_memory_ids;
    if (job.attempts >= 5)
      throw new AppError("Extraction reached its retry limit", 409);
    if (
      job.status === "running" &&
      job.lease_until &&
      Date.parse(job.lease_until) > Date.now()
    )
      throw new AppError("Extraction is already running", 409);
    await this.repository.batch([
      {
        kind: "update",
        table: "extraction_jobs",
        id,
        expected_updated_at: job.updated_at,
        data: {
          status: "running",
          attempts: job.attempts + 1,
          error: null,
          lease_until: new Date(Date.now() + 600000).toISOString(),
        },
      },
    ]);
    const claimed = required(
      await this.repository.get("extraction_jobs", id),
      "Extraction job",
    );
    try {
      const source = required(
        await this.repository.get("messages", job.source_message_id),
        "Source message",
      );
      if (source.role !== "user")
        throw new AppError("Only user statements can establish user facts");
      const [messages, entities, retrieved] = await Promise.all([
        this.repository.list("messages", {
          conversation_id: source.conversation_id,
        }),
        this.repository.list("entities"),
        this.memories.searchMemories(source.content, 12),
      ]);
      const resolution = await this.entities.resolveMentions(source.content);
      const mentioned = resolution.entities;
      const ambiguousIds = new Set(
        resolution.resolutions
          .filter((r) => r.status === "ambiguous")
          .flatMap((r) => r.candidates.map((c) => c.id)),
      );
      const links = await this.repository.list("memory_entities");
      const existing = retrieved.filter(
        (m) =>
          !links.some(
            (l) => l.memory_id === m.id && ambiguousIds.has(l.entity_id),
          ),
      );
      const relevantEntityIds = new Set([
        ...mentioned.map((e) => e.id),
        ...links
          .filter((l) => existing.some((m) => m.id === l.memory_id))
          .map((l) => l.entity_id),
      ]);
      const scopedEntities = entities
        .filter((e) => relevantEntityIds.has(e.id) && !ambiguousIds.has(e.id))
        .slice(0, 20);
      const sourceIndex = messages.findIndex((m) => m.id === source.id);
      const context = {
        source,
        entities: scopedEntities,
        memories: existing,
        history: messages.slice(Math.max(0, sourceIndex - 10), sourceIndex),
      };
      const raw = this.llm.extractCandidates
        ? await this.llm.extractCandidates(context)
        : (await this.llm.extractMemories(source.content)).map((memory) => ({
            memory,
            evidence_quote: source.content,
            disposition: "new" as const,
          }));
      if (raw.length > 5)
        throw new AppError("Extraction exceeded candidate limit");
      const candidates = raw.map((c) => extractionCandidate.parse(c));
      const active = (await this.repository.list("memories")).filter(
        (m) => isCurrentMemory(m) && policyFor(m).class !== "WORKING",
      );
      const mutations: Mutation[] = [];
      const saved: string[] = [];
      // PostgreSQL enforces unique(memory_id, entity_id). Include staged links
      // as well as persisted links when several candidates repeat one fact.
      const linked = new Set(links.map((l) => `${l.memory_id}:${l.entity_id}`));
      const link = (memoryId: string, entityId: string) => {
        const key = `${memoryId}:${entityId}`;
        if (linked.has(key)) return;
        linked.add(key);
        mutations.push({
          kind: "insert",
          table: "memory_entities",
          data: { memory_id: memoryId, entity_id: entityId },
        });
      };
      const pendingEvidence = new Set<string>();
      const oldEvidence = await this.repository.list("memory_evidence");
      const evidence = (
        memoryId: string,
        quote: string,
        kind: "supports" | "contradicts",
      ) => {
        const key = `${memoryId}:${kind}`;
        if (
          pendingEvidence.has(key) ||
          oldEvidence.some(
            (e) =>
              e.memory_id === memoryId &&
              e.source_message_id === source.id &&
              e.evidence_type === kind,
          )
        )
          return;
        pendingEvidence.add(key);
        mutations.push({
          kind: "insert",
          table: "memory_evidence",
          data: {
            memory_id: memoryId,
            source_message_id: source.id,
            quote,
            evidence_type: kind,
          },
        });
      };
      for (const candidate of candidates) {
        if (candidate.memory.confidence_score < 0.65) continue;
        // Require an exact quote from THIS user message, never from retrieved text or assistant output.
        if (!source.content.includes(candidate.evidence_quote))
          throw new AppError(
            "Extracted evidence is not present in the source message",
          );
        if (
          candidate.entity_ids.some(
            (id) => !scopedEntities.some((e) => e.id === id),
          )
        )
          throw new AppError("Unknown extracted entity");
        let related = candidate.related_memory_id
          ? existing.find((m) => m.id === candidate.related_memory_id)
          : undefined;
        if (candidate.disposition !== "new" && !related)
          throw new AppError(
            "Reconciliation target was not supplied in context",
          );
        const exact = active.find(
          (m) => normalize(m.content) === normalize(candidate.memory.content),
        );
        const detected = !related
          ? existing.find((m) =>
              contradictionReason(m.content, candidate.memory.content),
            )
          : undefined;
        if (detected) related = detected;
        const guardReason = related
          ? contradictionReason(related.content, candidate.memory.content)
          : null;
        const duplicate =
          exact ??
          (candidate.disposition === "duplicate" &&
          related &&
          safeDuplicate(related.content, candidate.memory.content)
            ? related
            : undefined);
        const resolvedCandidate = await this.entities.resolveEntities(
          candidate.memory.content,
        );
        if (resolvedCandidate.some((e) => ambiguousIds.has(e.id)))
          throw new AppError(
            "Extracted identity is ambiguous in the source; clarify the entity first",
          );
        if (duplicate) {
          const snapshot = active.find((m) => m.id === duplicate.id);
          if (snapshot)
            mutations.push({
              kind: "check",
              table: "memories",
              id: snapshot.id,
              expected_updated_at: snapshot.updated_at,
            });
          evidence(duplicate.id, candidate.evidence_quote, "supports");
          for (const entityId of new Set([
            ...candidate.entity_ids,
            ...resolvedCandidate.map((e) => e.id),
          ]))
            link(duplicate.id, entityId);
          continue;
        }
        const contested = Boolean(
          related && (candidate.disposition !== "new" || guardReason),
        );
        const memoryId = randomUUID();
        const record = await this.memories.prepare({
          ...candidate.memory,
          source_message_id: source.id,
          metadata: {
            ...candidate.memory.metadata,
            origin: "conversation",
            extraction_provider: this.llm.name,
            extraction_job_id: job.id,
            proposed_disposition: candidate.disposition,
            evidence_quote: candidate.evidence_quote,
          },
        });
        const status = contested ? ("disputed" as const) : ("active" as const);
        mutations.push({
          kind: "insert",
          table: "memories",
          id: memoryId,
          data: { ...record, status },
        });
        saved.push(memoryId);
        if (!contested) active.push({ ...record, id: memoryId } as Memory);
        evidence(memoryId, candidate.evidence_quote, "supports");
        const resolved = resolvedCandidate;
        for (const entityId of new Set([
          ...candidate.entity_ids,
          ...resolved.filter((e) => !ambiguousIds.has(e.id)).map((e) => e.id),
        ]))
          link(memoryId, entityId);
        if (contested && related) {
          const snapshot = active.find((m) => m.id === related.id);
          if (!snapshot)
            throw new AppError(
              "Reconciliation target is no longer current",
              409,
            );
          mutations.push({
            kind: "check",
            table: "memories",
            id: snapshot.id,
            expected_updated_at: snapshot.updated_at,
          });
          // Do not silently choose truth based on model confidence.
          evidence(related.id, candidate.evidence_quote, "contradicts");
          mutations.push({
            kind: "insert",
            table: "memory_conflicts",
            data: {
              existing_memory_id: related.id,
              candidate_memory_id: memoryId,
              reason:
                guardReason ||
                candidate.reason ||
                "New statement may revise existing knowledge",
              status: "pending",
            },
          });
        }
      }
      mutations.push({
        kind: "update",
        table: "extraction_jobs",
        id,
        expected_updated_at: claimed.updated_at,
        data: {
          status: "completed",
          lease_until: null,
          saved_memory_ids: saved,
          error: null,
        },
      });
      await this.repository.batch(mutations);
      return saved;
    } catch (error) {
      // A failed commit has no partial memories. A process crash leaves a recoverable lease.
      await this.repository
        .batch([
          {
            kind: "update",
            table: "extraction_jobs",
            id,
            expected_updated_at: claimed.updated_at,
            data: {
              status: "failed",
              lease_until: null,
              error:
                error instanceof AppError
                  ? error.message
                  : "Extraction failed; verify provider settings and retry",
            },
          },
        ])
        .catch(() => {});
      throw error;
    }
  }

  async resolveConflict(
    id: string,
    resolution: "replaced" | "kept_existing" | "kept_both",
    effectiveAt: string | null = null,
  ) {
    const conflict = required(
      await this.repository.get("memory_conflicts", id),
      "Conflict",
    );
    if (conflict.status !== "pending")
      throw new AppError("Conflict already resolved", 409);
    const previous = required(
      await this.repository.get("memories", conflict.existing_memory_id),
      "Existing memory",
    );
    const candidate = required(
      await this.repository.get("memories", conflict.candidate_memory_id),
      "Candidate memory",
    );
    if (
      previous.status !== "active" ||
      previous.archived_at ||
      candidate.status !== "disputed" ||
      candidate.archived_at
    )
      throw new AppError(
        "Conflict facts changed; inspect history before resolving",
        409,
      );
    const validity =
      effectiveAt ?? candidate.valid_from ?? new Date().toISOString();
    if (resolution === "replaced" && Date.parse(validity) > Date.now())
      throw new AppError(
        "Future-dated replacement cannot retire current truth yet; review when effective",
      );
    if (
      resolution === "replaced" &&
      candidate.valid_to &&
      Date.parse(validity) >= Date.parse(candidate.valid_to)
    )
      throw new AppError("Replacement must begin before the candidate expires");
    if (
      resolution === "replaced" &&
      validity &&
      previous.valid_from &&
      Date.parse(validity) <= Date.parse(previous.valid_from)
    )
      throw new AppError(
        "Replacement date must follow the existing fact's start; use an edit for a historical correction",
      );
    const mutations: Mutation[] = [
      {
        kind: "update",
        table: "memory_conflicts",
        id,
        expected_updated_at: conflict.updated_at,
        data: { status: resolution },
      },
      {
        kind: "update",
        table: "memories",
        id: candidate.id,
        expected_updated_at: candidate.updated_at,
        data:
          resolution === "kept_existing"
            ? { archived_at: new Date().toISOString() }
            : {
                status: "active",
                ...(resolution === "replaced"
                  ? { supersedes_id: previous.id, valid_from: validity }
                  : {}),
              },
      },
    ];
    if (resolution === "replaced")
      mutations.push({
        kind: "update",
        table: "memories",
        id: previous.id,
        expected_updated_at: previous.updated_at,
        data: { status: "superseded", valid_to: validity },
      });
    await this.repository.batch(mutations);
    return this.repository.get("memory_conflicts", id);
  }
}
