import { memoryInScope } from "../domain/nexus-memory";
import { createHash, randomUUID } from "node:crypto";
import type { Repository, Mutation } from "../domain/repository";
import type { Json, RecordBase, Table, Tables } from "../domain/models";
import {
  reflectionChange,
  type ReflectionChange,
  type ReflectionEvidence,
  type ReflectionObservation,
} from "../domain/reflection";
import { AppError, required } from "../domain/validation";
import { MemoryService, isCurrentMemory } from "./memory-service";
const VERSION = "reflection-rules-v1";
// Ignore access/vector maintenance; preserve all meaningful fields in the evidence snapshot.
export function reflectionSnapshot(record: RecordBase): Json {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([k]) =>
        ![
          "updated_at",
          "last_accessed_at",
          "embedding",
          "embedding_model",
          "embedding_version",
          "embedding_dimensions",
          "embedding_input_hash",
        ].includes(k),
    ),
  );
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (v: unknown) =>
  createHash("sha256").update(stable(v)).digest("hex");
const ref = <K extends Table>(
  table: K,
  row: Tables[K],
): ReflectionEvidence => ({
  table,
  id: row.id,
  snapshot: reflectionSnapshot(row),
});
/** Deterministic v1: observations and reviewable proposals, never autonomous truth edits. */
export class ReflectionService {
  constructor(
    private repository: Repository,
    private memories: MemoryService,
  ) {}
  async enqueue(sourceId: string) {
    const source = required(
      await this.repository.get("messages", sourceId),
      "Source message",
    );
    if (source.role !== "user")
      throw new AppError("Reflection requires a user turn");
    const existing = (
      await this.repository.list("reflection_jobs", {
        source_message_id: sourceId,
      })
    )[0];
    if (existing) return existing;
    try {
      return await this.repository.insert("reflection_jobs", {
        conversation_id: source.conversation_id,
        source_message_id: sourceId,
        status: "pending",
        attempts: 0,
        lease_until: null,
        error: null,
        version: VERSION,
        observations: [],
      });
    } catch (error) {
      const raced = (
        await this.repository.list("reflection_jobs", {
          source_message_id: sourceId,
        })
      )[0];
      if (raced) return raced;
      throw error;
    }
  }
  async enqueueConversation(id: string) {
    required(await this.repository.get("conversations", id), "Conversation");
    const source = (
      await this.repository.list("messages", { conversation_id: id })
    )
      .filter((m) => m.role === "user")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!source) throw new AppError("Conversation has no user messages");
    return this.enqueue(source.id);
  }
  async drain(limit = 2) {
    const jobs = (await this.repository.list("reflection_jobs"))
      .filter(
        (j) =>
          j.attempts < 5 &&
          (j.status === "pending" ||
            (j.status === "running" &&
              Date.parse(j.lease_until ?? "1970") < Date.now())),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, limit);
    for (const job of jobs) await this.runJob(job.id).catch(() => {});
  }
  async runJob(id: string) {
    const job = required(
      await this.repository.get("reflection_jobs", id),
      "Reflection job",
    );
    if (job.status === "completed") return job;
    if (job.attempts >= 5)
      throw new AppError("Reflection retry limit reached", 409);
    if (
      job.status === "running" &&
      Date.parse(job.lease_until ?? "1970") > Date.now()
    )
      throw new AppError("Reflection is already running", 409);
    const extraction = (
      await this.repository.list("extraction_jobs", {
        source_message_id: job.source_message_id,
      })
    )[0];
    if (extraction && extraction.status !== "completed") {
      await this.repository.batch([
        {
          kind: "update",
          table: "reflection_jobs",
          id,
          expected_updated_at: job.updated_at,
          data: {
            error:
              "Waiting for completed memory extraction. Retry the extraction job in Memory review first.",
          },
        },
      ]);
      throw new AppError(
        "Finish or retry memory extraction before reflection",
        409,
      );
    }
    await this.repository.batch([
      {
        kind: "update",
        table: "reflection_jobs",
        id,
        expected_updated_at: job.updated_at,
        data: {
          status: "running",
          attempts: job.attempts + 1,
          lease_until: new Date(Date.now() + 120000).toISOString(),
          error: null,
        },
      },
    ]);
    const claimed = required(
      await this.repository.get("reflection_jobs", id),
      "Reflection job",
    );
    try {
      const [
        messages,
        memories,
        conflicts,
        decisions,
        tasks,
        actions,
        outcomes,
        evidence,
        edges,
        goals,
        previous,
      ] = await Promise.all([
        this.repository.list("messages", {
          conversation_id: job.conversation_id,
        }),
        this.repository.list("memories"),
        this.repository.list("memory_conflicts"),
        this.repository.list("decisions"),
        this.repository.list("tasks"),
        this.repository.list("actions"),
        this.repository.list("outcomes"),
        this.repository.list("memory_evidence"),
        this.repository.list("relationships"),
        this.repository.list("goals"),
        this.repository.list("reflection_proposals"),
      ]);
      const source = required(
        messages.find((m) => m.id === job.source_message_id) ?? null,
        "Source message",
      );
      const windowStart = Date.now() - 7 * 86400000;
      const recent = (r: RecordBase) =>
        Date.parse(r.created_at) >= windowStart ||
        Date.parse(r.updated_at) >= windowStart;
      const bounded = <T extends RecordBase>(rows: T[]) =>
        rows
          .sort(
            (a, b) =>
              b.created_at.localeCompare(a.created_at) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, 50);
      const messageIds = new Set(
        messages
          .filter((m) => m.role === "user" && m.created_at <= source.created_at)
          .map((m) => m.id),
      );
      const relatedMemories = bounded(
        memories
          .filter((m) => memoryInScope(m, source.conversation_id))
          .filter(
            (m) =>
              Date.parse(m.created_at) >= windowStart ||
              (m.source_message_id && messageIds.has(m.source_message_id)) ||
              evidence.some(
                (e) =>
                  e.memory_id === m.id && messageIds.has(e.source_message_id),
              ),
          ),
      );
      const inspectedMemoryIds = new Set(relatedMemories.map((m) => m.id));
      const relevantConflicts = bounded(
        conflicts.filter(
          (c) =>
            recent(c) ||
            inspectedMemoryIds.has(c.existing_memory_id) ||
            inspectedMemoryIds.has(c.candidate_memory_id),
        ),
      );
      const relevantDecisions = bounded(decisions.filter(recent));
      const completedTasks = bounded(
        tasks.filter((t) => t.status === "completed" && recent(t)),
      );
      const relatedActions = actions.filter(
        (a) =>
          a.conversation_id === job.conversation_id ||
          completedTasks.some((t) => a.input.task_id === t.id),
      );
      const relatedOutcomes = bounded(
        outcomes.filter((o) =>
          relatedActions.some((a) => a.id === o.action_id),
        ),
      );
      const observations: ReflectionObservation[] = [];
      const proposals: Mutation[] = [];
      const fingerprints = new Set(previous.map((p) => p.fingerprint));
      const notice = (
        category: string,
        noticed: string,
        refs: ReflectionEvidence[],
      ) => {
        observations.push({ category, noticed, evidence: refs });
      };
      const propose = (
        change: ReflectionChange,
        noticed: string,
        reason: string,
        refs: ReflectionEvidence[],
      ) => {
        const parsed = reflectionChange.parse(change);
        const unique = [
          ...new Map(refs.map((r) => [`${r.table}:${r.id}`, r])).values(),
        ];
        const fingerprint = hash({
          version: VERSION,
          change: parsed,
          evidence: unique
            .map((r) => ({ table: r.table, id: r.id, snapshot: r.snapshot }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        });
        if (fingerprints.has(fingerprint) || proposals.length >= 20) return;
        fingerprints.add(fingerprint);
        proposals.push({
          kind: "insert",
          table: "reflection_proposals",
          data: {
            job_id: id,
            fingerprint,
            kind: parsed.kind,
            status: "pending",
            noticed,
            reason,
            change: parsed,
            evidence: unique,
            review_reason: null,
            reviewed_at: null,
            reviewed_by: null,
            applied_changes: [],
          },
        });
      };
      notice(
        "inspection",
        `Inspected ${relatedMemories.length} new or conversation-linked memories, ${relevantDecisions.length} recent decisions, ${relevantConflicts.length} conflicts/corrections, ${completedTasks.length} completed tasks and ${relatedOutcomes.length} related outcomes. Recent workspace decisions/tasks use a 7-day window; each category is capped at 50.`,
        [ref("messages", source)],
      );
      for (const m of relatedMemories) {
        const refs = [ref("memories", m)];
        notice("memory", `${m.status}: ${m.content.slice(0, 240)}`, refs);
        if (isCurrentMemory(m) && !m.summary.trim())
          propose(
            {
              kind: "memory_update",
              memory_id: m.id,
              summary: m.content.slice(0, 500),
            },
            "A conversation-linked memory has no summary.",
            "Add a literal excerpt for inspection. The original fact content remains unchanged.",
            refs,
          );
        const supports = evidence.filter(
          (e) => e.memory_id === m.id && e.evidence_type === "supports",
        );
        const distinct = new Set(supports.map((e) => e.source_message_id));
        if (
          isCurrentMemory(m) &&
          distinct.size >= 3 &&
          m.importance_score < 0.8
        ) {
          const repeated = [
            ...refs,
            ...supports.slice(0, 20).map((e) => ref("memory_evidence", e)),
          ];
          notice(
            "pattern",
            `The same memory has support from ${distinct.size} distinct user messages. Repetition is not independent corroboration.`,
            repeated,
          );
          propose(
            {
              kind: "importance_adjustment",
              memory_id: m.id,
              importance_score: Math.min(
                0.8,
                Math.round((m.importance_score + 0.1) * 100) / 100,
              ),
            },
            "A memory repeatedly appears in user evidence.",
            "Increase importance by at most 0.10 for review priority; confidence and factual truth are unchanged.",
            repeated,
          );
        }
      }
      for (const c of relevantConflicts)
        notice(
          c.status === "pending" ? "unresolved_conflict" : "correction",
          `Conflict ${c.status}: ${c.reason}. ${c.status === "pending" ? "Resolve this explicitly in Memory review; reflection will not select a winner." : "The recorded human resolution is retained."}`,
          [
            ref("memory_conflicts", c),
            ...memories
              .filter((m) =>
                [c.existing_memory_id, c.candidate_memory_id].includes(m.id),
              )
              .map((m) => ref("memories", m)),
          ],
        );
      for (const edge of edges) {
        const backing = memories.find((m) => m.id === edge.memory_id);
        if (
          backing &&
          edge.strength > 0 &&
          !isCurrentMemory(backing) &&
          (inspectedMemoryIds.has(backing.id) ||
            relevantConflicts.some((c) => c.existing_memory_id === backing.id))
        )
          propose(
            {
              kind: "relationship_update",
              relationship_id: edge.id,
              strength: 0,
            },
            "A relationship depends on a non-current memory.",
            "Mark this edge inactive explicitly; retrieval already excludes its non-current provenance. Preserve its direction, endpoints and version history.",
            [ref("relationships", edge), ref("memories", backing)],
          );
      }
      for (const decision of relevantDecisions)
        notice(
          "decision",
          `${decision.status} decision: ${decision.title}. ${decision.rationale}`,
          [ref("decisions", decision)],
        );
      for (const task of completedTasks) {
        const matching = relatedOutcomes.filter((o) =>
          relatedActions.some(
            (a) => a.id === o.action_id && a.input.task_id === task.id,
          ),
        );
        notice(
          "completed_task",
          `Completed task: ${task.title}. ${matching.length ? `${matching.length} explicitly linked outcome(s).` : "No explicit outcome link; completion alone does not establish success."}`,
          [ref("tasks", task)],
        );
        for (const outcome of matching.filter((o) => o.status !== "pending")) {
          const action = relatedActions.find(
            (a) => a.id === outcome.action_id,
          )!;
          const refs = [
            ref("tasks", task),
            ref("actions", action),
            ref("outcomes", outcome),
          ];
          propose(
            {
              kind: "lesson_learned",
              content: `Observed outcome for completed task “${task.title}”: ${outcome.status}. ${outcome.summary}. This is an observed result, not evidence of a general causal rule.`,
            },
            "A completed task has a recorded outcome.",
            "Retain an evidence-backed lesson as a new procedural memory only after review; do not infer that completion means success.",
            refs,
          );
          const goal = goals.find((g) => g.id === task.goal_id);
          if (!outcome.goal_id && goal)
            propose(
              {
                kind: "outcome_link",
                outcome_id: outcome.id,
                goal_id: goal.id,
              },
              "A task's outcome is missing its existing goal link.",
              "Use the explicit action → task → goal chain, never name similarity.",
              [...refs, ref("goals", goal)],
            );
        }
      }
      for (const outcome of relatedOutcomes)
        notice("outcome", `${outcome.status}: ${outcome.summary}`, [
          ref("outcomes", outcome),
        ]);
      const groups = new Map<string, typeof relatedOutcomes>();
      for (const outcome of relatedOutcomes) {
        const action = relatedActions.find((a) => a.id === outcome.action_id)!;
        const key = `${action.tool_name}:${outcome.status}`;
        groups.set(key, [...(groups.get(key) ?? []), outcome]);
      }
      for (const [pattern, rows] of groups)
        if (rows.length >= 3)
          notice(
            "pattern",
            `${rows.length} recorded outcomes share ${pattern}. This is an operational repetition, not a user fact or proof of causality.`,
            rows.map((o) => ref("outcomes", o)),
          );
      // Guard the lease and deduped proposal insertions in one transaction.
      await this.repository.batch([
        ...proposals,
        {
          kind: "update",
          table: "reflection_jobs",
          id,
          expected_updated_at: claimed.updated_at,
          data: {
            status: "completed",
            lease_until: null,
            observations,
            error: null,
          },
        },
      ]);
      console.info(
        JSON.stringify({
          event: "ary.reflection",
          job_id: id,
          version: VERSION,
          observations: observations.length,
          proposals: proposals.length,
        }),
      );
      return this.repository.get("reflection_jobs", id);
    } catch (error) {
      await this.repository
        .batch([
          {
            kind: "update",
            table: "reflection_jobs",
            id,
            expected_updated_at: claimed.updated_at,
            data: {
              status: "failed",
              lease_until: null,
              error:
                "Reflection failed without partial proposals; retry after checking the source records.",
            },
          },
        ])
        .catch(() => {});
      throw error;
    }
  }
  async review(id: string, decision: "accepted" | "rejected", reason: string) {
    if (!reason.trim() || reason.length > 2000)
      throw new AppError(
        "A review reason is required (maximum 2000 characters)",
      );
    const proposal = required(
      await this.repository.get("reflection_proposals", id),
      "Reflection proposal",
    );
    if (proposal.status !== "pending") {
      if (proposal.status === decision) return proposal;
      throw new AppError("Proposal already reviewed", 409);
    }
    const mutations: Mutation[] = [];
    const applied: Json[] = [];
    if (decision === "accepted") {
      // Evidence snapshots act as preconditions; changes after generation force a fresh review.
      for (const evidence of proposal.evidence) {
        const row = required(
          await this.repository.get(evidence.table, evidence.id),
          "Reflection evidence",
        );
        if (hash(reflectionSnapshot(row)) !== hash(evidence.snapshot))
          throw new AppError(
            "Evidence changed; reject this stale proposal and reflect on a new turn",
            409,
          );
        mutations.push({
          kind: "check",
          table: evidence.table,
          id: row.id,
          expected_updated_at: row.updated_at,
        });
      }
      const change = reflectionChange.parse(proposal.change);
      const update = async <
        K extends "memories" | "relationships" | "outcomes",
      >(
        table: K,
        targetId: string,
        patch: Partial<Tables[K]>,
      ) => {
        if (
          !proposal.evidence.some((e) => e.table === table && e.id === targetId)
        )
          throw new AppError("Proposal lacks target evidence", 409);
        const before = required(
          await this.repository.get(table, targetId),
          "Target",
        );
        mutations.push({
          kind: "update",
          table,
          id: targetId,
          expected_updated_at: before.updated_at,
          data: patch,
        } as Mutation);
        applied.push({
          table,
          id: targetId,
          before: reflectionSnapshot(before),
          after: reflectionSnapshot({ ...before, ...patch }),
        });
      };
      if (change.kind === "memory_update") {
        const memory = required(
          await this.repository.get("memories", change.memory_id),
          "Memory",
        );
        if (!isCurrentMemory(memory))
          throw new AppError("Memory is not current", 409);
        const prepared = await this.memories.prepare({
          content: memory.content,
          summary: change.summary,
        });
        await update("memories", memory.id, {
          summary: change.summary,
          embedding: prepared.embedding,
          embedding_model: prepared.embedding_model,
          embedding_version: prepared.embedding_version,
          embedding_dimensions: prepared.embedding_dimensions,
          embedding_input_hash: prepared.embedding_input_hash,
        });
      } else if (change.kind === "importance_adjustment") {
        const memory = required(
          await this.repository.get("memories", change.memory_id),
          "Memory",
        );
        if (!isCurrentMemory(memory))
          throw new AppError("Memory is not current", 409);
        await update("memories", change.memory_id, {
          importance_score: change.importance_score,
        });
      } else if (change.kind === "relationship_update")
        await update("relationships", change.relationship_id, {
          strength: change.strength,
        });
      else if (change.kind === "outcome_link") {
        required(await this.repository.get("goals", change.goal_id), "Goal");
        await update("outcomes", change.outcome_id, {
          goal_id: change.goal_id,
        });
      } else {
        const memoryId = randomUUID();
        const record = await this.memories.prepare({
          content: change.content,
          memory_type: "procedural",
          importance_score: 0.5,
          confidence_score: 0.65,
          metadata: {
            origin: "reflection",
            reflection_proposal_id: id,
            reviewed_by: this.repository.userId,
            evidence: proposal.evidence,
          },
        });
        mutations.push({
          kind: "insert",
          table: "memories",
          id: memoryId,
          data: record,
        });
        applied.push({
          table: "memories",
          id: memoryId,
          before: null,
          after: {
            ...reflectionSnapshot({
              ...record,
              id: memoryId,
              user_id: this.repository.userId,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }),
          },
        });
      }
    }
    mutations.push({
      kind: "update",
      table: "reflection_proposals",
      id,
      expected_updated_at: proposal.updated_at,
      data: {
        status: decision,
        review_reason: reason.trim(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: this.repository.userId,
        applied_changes: applied,
      },
    });
    await this.repository.batch(mutations);
    console.info(
      JSON.stringify({
        event: "ary.reflection_review",
        proposal_id: id,
        decision,
        changes: applied.length,
      }),
    );
    return this.repository.get("reflection_proposals", id);
  }
}
