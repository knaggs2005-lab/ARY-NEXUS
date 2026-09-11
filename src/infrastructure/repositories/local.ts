import { memoryInScope } from "../../domain/nexus-memory";
import {
  projectInspection,
  projectMapRecord,
  type MapRecordKind,
  type MapKind,
} from "../../domain/nexus-map";
import {
  createNexusEvent,
  eventQuery,
  nexusEvent,
  type NexusEvent,
  type StoredNexusEvent,
} from "../../domain/nexus-events";
import { recordEvent } from "../../domain/nexus-record-events";
import { validateFinanceSnapshot } from "../../domain/finance";
import { sourceRecord } from "../../domain/memory-source";
import { costEntrySchema, outcomeEntrySchema } from "../../domain/roi";
import type { GraphQuery } from "../../domain/brain-graph";
import { queryLocalGraph, type GraphSnapshot } from "./local-graph";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Repository, Mutation } from "../../domain/repository";
import type { Table, Tables, NewRecord, MemoryHit } from "../../domain/models";
import { withoutEmbedding } from "../../domain/models";
import { AppError, required } from "../../domain/validation";
import { lexicalTokens } from "../providers/local";
type Data = { [K in Table]: Tables[K][] } & {
  nexus_events: StoredNexusEvent[];
};
const tables: Table[] = [
  "knowledge_documents",
  "finance_snapshots",
  "memory_sources",
  "roi_cost_entries",
  "roi_outcome_entries",
  "permission_policies",
  "action_approvals",
  "reflection_jobs",
  "reflection_proposals",
  "outcome_versions",
  "model_calls",
  "entity_aliases",
  "memory_versions",
  "relationship_versions",
  "memory_evidence",
  "memory_conflicts",
  "extraction_jobs",
  "memories",
  "entities",
  "relationships",
  "memory_entities",
  "conversations",
  "messages",
  "goals",
  "decisions",
  "tasks",
  "actions",
  "outcomes",
];
const globalStore = globalThis as typeof globalThis & {
  aryFileLocks?: Map<string, Promise<unknown>>;
};
const locks = (globalStore.aryFileLocks ??= new Map());
/** Durable single-process development store. Supabase is required for multi-process/production use. */
export class LocalRepository implements Repository {
  constructor(
    readonly userId: string,
    private file: string,
  ) {}
  private appendTo(data: Data, raw: NexusEvent): StoredNexusEvent {
    const event = nexusEvent.parse(raw);
    const existing = data.nexus_events.find(
      (e) => e.user_id === this.userId && e.id === event.id,
    );
    if (existing) {
      const { sequence, user_id, timestamp, ...original } = existing;
      const { timestamp: _timestamp, ...incoming } = event;
      if (JSON.stringify(original) !== JSON.stringify(incoming))
        throw new AppError("Event id belongs to different data", 409);
      return existing;
    }
    const last =
      data.nexus_events.filter((e) => e.user_id === this.userId).at(-1)
        ?.sequence ?? "0";
    const stored = {
      ...event,
      user_id: this.userId,
      sequence: String(BigInt(last) + 1n),
    };
    data.nexus_events.push(stored);
    return stored;
  }
  async claimMission(id: string, token: string, ttlMs: number) {
    if (ttlMs < 100 || ttlMs > 360000)
      throw new AppError("Invalid lease duration");
    return this.change((data) => {
      const row = required(
        data.messages.find((r) => r.id === id && r.user_id === this.userId) ??
          null,
        "Mission",
      );
      const lease = row.metadata.mission_lease as
        { until?: string } | undefined;
      if (
        !(
          row.metadata
            .plan as unknown as import("../../domain/orchestration").ExecutionPlan
        )?.mission
      )
        throw new AppError("Not a durable mission");
      if (Date.parse(lease?.until ?? "") > Date.now()) return false;
      this.mutate(data, {
        kind: "update",
        table: "messages",
        id,
        data: {
          metadata: {
            ...row.metadata,
            mission_lease: {
              token,
              until: new Date(Date.now() + ttlMs).toISOString(),
            },
          },
        },
      });
      return true;
    });
  }
  async releaseMission(id: string, token: string) {
    await this.change((data) => {
      const row = data.messages.find(
        (r) => r.id === id && r.user_id === this.userId,
      );
      if ((row?.metadata.mission_lease as { token?: string })?.token !== token)
        return;
      this.mutate(data, {
        kind: "update",
        table: "messages",
        id,
        data: { metadata: { ...row!.metadata, mission_lease: null } },
      });
    });
  }
  async checkpointMission(
    id: string,
    token: string,
    expectedUpdatedAt: string,
    plan: import("../../domain/orchestration").ExecutionPlan,
  ) {
    await this.change((data) => {
      const row = required(
        data.messages.find((r) => r.id === id && r.user_id === this.userId) ??
          null,
        "Mission",
      );
      const lease = row.metadata.mission_lease as
        { token?: string; until?: string } | undefined;
      if (
        !plan.mission ||
        plan.id !== id ||
        lease?.token !== token ||
        !(Date.parse(lease.until ?? "") > Date.now())
      )
        throw new AppError("Mission lease expired", 409);
      this.mutate(data, {
        kind: "update",
        table: "messages",
        id,
        expected_updated_at: expectedUpdatedAt,
        data: { content: plan.summary, metadata: { ...row.metadata, plan } },
      });
    });
  }
  async dueMissions(limit: number) {
    return (await this.list("messages"))
      .filter((r) => {
        const m = (
          r.metadata
            .plan as unknown as import("../../domain/orchestration").ExecutionPlan
        )?.mission;
        return m?.wake_at && Date.parse(m.wake_at) <= Date.now();
      })
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
      .slice(0, Math.min(20, Math.max(1, limit)));
  }
  async readMapInspection(tool: "desktop.list_apps" | "studio.inspect") {
    const row = (
      await this.list("actions", { tool_name: tool, status: "succeeded" })
    ).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return row
      ? projectInspection(row as unknown as Record<string, unknown>)
      : [];
  }
  async readMapRecords(
    kind: MapRecordKind,
    q: string,
    after?: string,
    facet?: MapKind,
    scope?: { entityId?: string },
  ) {
    const table =
      kind === "memory"
        ? "memories"
        : kind === "mission"
          ? "messages"
          : "entities";
    const records = (await this.list(table))
      .filter((r) => !after || r.id > after)
      .filter(
        (r) =>
          kind !== "memory" ||
          ("status" in r &&
            r.status === "active" &&
            !("archived_at" in r && r.archived_at)),
      )
      .map((r) =>
        projectMapRecord(kind, r as unknown as Record<string, unknown>),
      )
      .filter((r) => r !== null)
      .filter((r) => !scope?.entityId || r.entityIds.includes(scope.entityId))
      .filter((r) => !facet || r.kind === facet)
      .filter((r) => r.label.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a!.id.localeCompare(b!.id));
    if (kind === "memory") {
      const links = (await this.list("memory_entities"))
        .filter((l) => records.slice(0, 24).some((r) => r.id === l.memory_id))
        .slice(0, 200);
      for (const record of records.slice(0, 24))
        record.entityIds = links
          .filter((l) => l.memory_id === record.id)
          .map((l) => l.entity_id);
    }
    return { records: records.slice(0, 24), more: records.length > 24 };
  }
  async appendEvent(event: NexusEvent) {
    return this.change((data) => this.appendTo(data, event));
  }
  async readEvents(raw: Parameters<Repository["readEvents"]>[0]) {
    const q = eventQuery.parse(raw);
    await locks.get(this.file)?.catch(() => {});
    const all = (await this.read()).nexus_events.filter(
      (e) => e.user_id === this.userId && e.visibility !== "internal",
    );
    const matching = all.filter(
      (e) =>
        (!q.after || BigInt(e.sequence) > BigInt(q.after)) &&
        (!q.before || BigInt(e.sequence) < BigInt(q.before)),
    );
    const ordered = q.after ? matching : matching.slice().reverse();
    const selected = ordered.slice(0, q.limit),
      events = q.after ? selected : selected.reverse();
    return {
      events,
      cursor: events.at(-1)?.sequence ?? q.after ?? "0",
      has_more: matching.length > q.limit,
    };
  }
  async consumeApproval(id: string, fingerprint: string, policyHash: string) {
    return this.change((data) => {
      const approval = data.action_approvals.find(
        (a) => a.id === id && a.user_id === this.userId,
      );
      if (
        !approval ||
        approval.decision !== "approved" ||
        approval.consumed_at ||
        Date.parse(approval.expires_at) <= Date.now() ||
        approval.fingerprint !== fingerprint ||
        approval.policy_hash !== policyHash
      )
        return false;
      approval.consumed_at = new Date().toISOString();
      approval.updated_at = approval.consumed_at;
      return true;
    });
  }
  async queryGraph(query: GraphQuery) {
    await locks.get(this.file)?.catch(() => {});
    const data = await this.read();
    const snapshot = Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [
        table,
        rows.filter((row) => row.user_id === this.userId),
      ]),
    ) as GraphSnapshot;
    return queryLocalGraph(snapshot, query);
  }
  private async read(): Promise<Data> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as Data;
      data.nexus_events ??= [];
      for (const table of tables) data[table] ??= [] as never;
      for (const action of data.actions) {
        const legacy: Record<string, number> = {
          read: 1,
          write: 5,
          approval_required: 4,
          forbidden: 0,
        };
        if (typeof action.permission_level === "string")
          action.permission_level = legacy[
            action.permission_level
          ] as import("../../domain/permissions").PermissionLevel;
      }
      for (const edge of data.relationships) {
        edge.valid_from ??= null;
        edge.valid_to ??= null;
        edge.memory_id ??= null;
      }
      for (const m of data.memories) {
        m.status ??= "active";
        m.embedding_version ??= "legacy-v1";
        m.embedding_dimensions ??= 384;
        m.embedding_input_hash ??= null;
        m.valid_from ??= null;
        m.valid_to ??= null;
        m.supersedes_id ??= null;
        if (!data.memory_versions.some((v) => v.record_id === m.id))
          data.memory_versions.push({
            id: randomUUID(),
            user_id: m.user_id,
            record_id: m.id,
            snapshot: structuredClone(m) as unknown as Record<string, unknown>,
            recorded_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
      }
      for (const memory of data.memories)
        if (!data.memory_sources.some((s) => s.memory_id === memory.id)) {
          const now = new Date().toISOString();
          data.memory_sources.push({
            ...sourceRecord(
              memory,
              data.messages.find((m) => m.id === memory.source_message_id),
              "backfill",
            ),
            id: randomUUID(),
            user_id: memory.user_id,
            created_at: now,
            updated_at: now,
          });
        }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        ...Object.fromEntries(tables.map((t) => [t, []])),
        nexus_events: [],
      } as unknown as Data;
    }
  }
  private async change<T>(operation: (data: Data) => T): Promise<T> {
    const prior = locks.get(this.file) ?? Promise.resolve();
    const next = prior
      .catch(() => {})
      .then(async () => {
        const data = await this.read();
        const result = operation(data);
        await mkdir(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${randomUUID()}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        await rename(tmp, this.file);
        return result;
      });
    locks.set(this.file, next);
    return next;
  }
  async list<K extends Table>(
    table: K,
    filter: Partial<Tables[K]> = {},
  ): Promise<Tables[K][]> {
    await locks.get(this.file)?.catch(() => {});
    const rows = (await this.read())[table] as Tables[K][];
    return rows.filter(
      (row) =>
        row.user_id === this.userId &&
        Object.entries(filter).every(
          ([key, value]) => row[key as keyof Tables[K]] === value,
        ),
    );
  }
  async get<K extends Table>(table: K, id: string) {
    return (await this.list(table)).find((x) => x.id === id) ?? null;
  }
  private mutate(data: Data, mutation: Mutation): Tables[Table] {
    const { table } = mutation;
    if (
      ["memory_versions", "relationship_versions", "outcome_versions"].includes(
        table,
      )
    )
      throw new AppError("History is read-only", 403);
    if (table === "memory_sources")
      throw new AppError("Source provenance is read-only", 403);
    const rows = data[table] as Tables[Table][];
    const previous =
      mutation.kind !== "insert"
        ? required(
            rows.find(
              (r) => r.id === mutation.id && r.user_id === this.userId,
            ) ?? null,
            table,
          )
        : null;
    if (
      mutation.kind !== "insert" &&
      mutation.expected_updated_at &&
      previous!.updated_at !== mutation.expected_updated_at
    )
      throw new AppError("Record changed; reload and retry", 409);
    if (mutation.kind === "check") return previous!;
    if (mutation.kind === "delete_memory") {
      const own = (r: { user_id: string }) => r.user_id === this.userId;
      // Do not break historical chains or derived conclusions. Archive first, or remove dependants explicitly.
      if (
        data.memories.some(
          (m) =>
            own(m) &&
            m.id !== mutation.id &&
            (m.supersedes_id === mutation.id ||
              (
                m.metadata.nexus_memory as
                  { consolidated_from?: { id: string }[] } | undefined
              )?.consolidated_from?.some((s) => s.id === mutation.id)),
        )
      )
        throw new AppError(
          "Memory has dependent versions or consolidations; archive it instead",
          409,
        );
      if (data.relationships.some((e) => own(e) && e.memory_id === mutation.id))
        throw new AppError(
          "Memory supports a relationship; archive it instead",
          409,
        );
      data.memory_conflicts = data.memory_conflicts.filter(
        (c) =>
          !own(c) ||
          (c.existing_memory_id !== mutation.id &&
            c.candidate_memory_id !== mutation.id),
      );
      data.memory_sources = data.memory_sources.filter(
        (s) => !own(s) || s.memory_id !== mutation.id,
      );
      data.memory_evidence = data.memory_evidence.filter(
        (s) => !own(s) || s.memory_id !== mutation.id,
      );
      data.memory_versions = data.memory_versions.filter(
        (s) => !own(s) || s.record_id !== mutation.id,
      );
      data.memory_entities = data.memory_entities.filter(
        (s) => !own(s) || s.memory_id !== mutation.id,
      );
      data.memories = data.memories.filter(
        (s) => !own(s) || s.id !== mutation.id,
      );
      return previous!;
    }
    if (table === "knowledge_documents") {
      if (
        previous &&
        Object.keys(mutation.data).some((k) => k !== "archived_at")
      )
        throw new AppError("Knowledge is versioned; create a revision", 403);
      const k = mutation.data as Partial<Tables["knowledge_documents"]>;
      if (
        k.supersedes_id &&
        data.knowledge_documents.some(
          (d) =>
            d.supersedes_id === k.supersedes_id && d.user_id === this.userId,
        )
      )
        throw new AppError("Knowledge already has a successor", 409);
      if (
        k.supersedes_id &&
        !data.knowledge_documents.some(
          (d) => d.id === k.supersedes_id && d.user_id === this.userId,
        )
      )
        throw new AppError("Knowledge source not found", 404);
    }
    if (table === "finance_snapshots") {
      if (previous)
        throw new AppError("Financial snapshots are append-only", 403);
      const entry = validateFinanceSnapshot(
        mutation.data,
        data.finance_snapshots.filter((r) => r.user_id === this.userId),
      );
      for (const id of [
        ...entry.payload.entity_ids,
        ...entry.payload.transactions.flatMap((t) =>
          t.entity_id ? [t.entity_id] : [],
        ),
      ])
        if (
          !data.entities.some((e) => e.id === id && e.user_id === this.userId)
        )
          throw new AppError("Invalid finance entity");
      for (const id of [
        ...entry.payload.goal_ids,
        ...entry.payload.transactions.flatMap((t) =>
          t.goal_id ? [t.goal_id] : [],
        ),
      ])
        if (!data.goals.some((g) => g.id === id && g.user_id === this.userId))
          throw new AppError("Invalid finance goal");
    }
    if (table === "roi_cost_entries" || table === "roi_outcome_entries") {
      if (previous)
        throw new AppError("ROI history is immutable; append a revision", 403);
      const entry =
        table === "roi_cost_entries"
          ? costEntrySchema.parse(mutation.data)
          : outcomeEntrySchema.parse(mutation.data);
      const target = "action_id" in entry ? "action_id" : "outcome_id";
      const targetId = (entry as unknown as Record<string, unknown>)[target];
      const ledger = data[table] as unknown as {
        id: string;
        user_id: string;
        parent_id: string | null;
        action_id?: string;
        outcome_id?: string;
      }[];
      const own = ledger.filter((r) => r.user_id === this.userId);
      if (
        entry.parent_id &&
        !own.some((r) => r.id === entry.parent_id && r[target] === targetId)
      )
        throw new AppError(
          "ROI parent must belong to the same action or outcome",
          409,
        );
      if (
        own.some((r) =>
          entry.parent_id
            ? r.parent_id === entry.parent_id
            : r[target] === targetId && r.parent_id === null,
        )
      )
        throw new AppError("ROI entry changed; reload and retry", 409);
      if (
        "outcome_id" in entry &&
        entry.status === "confirmed" &&
        data.outcomes.some(
          (o) => o.id === entry.outcome_id && o.status === "pending",
        )
      )
        throw new AppError("Pending outcomes cannot have confirmed impact");
    }
    if (table === "memory_evidence") {
      if (previous) throw new AppError("Source evidence is immutable", 403);
      const evidence = mutation.data as NewRecord<Tables["memory_evidence"]>;
      const source = data.messages.find(
        (m) => m.id === evidence.source_message_id && m.user_id === this.userId,
      );
      if (
        !source ||
        source.role !== "user" ||
        !evidence.quote.trim() ||
        !source.content.includes(evidence.quote)
      )
        throw new AppError("Evidence must quote an owned user message");
    }
    if (table === "actions" && !previous) {
      const key = (mutation.data as NewRecord<Tables["actions"]>).metadata
        ?.execution_key;
      if (
        key &&
        data.actions.some(
          (a) => a.user_id === this.userId && a.metadata.execution_key === key,
        )
      )
        throw new AppError("Action execution key already exists", 409);
    }
    if (table === "actions" && previous) {
      if (
        (previous as Tables["actions"]).status !== "requested" ||
        !["succeeded", "failed"].includes(
          String((mutation.data as { status?: string }).status),
        ) ||
        Object.keys(mutation.data).some(
          (k) => !["status", "output", "error"].includes(k),
        )
      )
        throw new AppError("Action audit is immutable", 403);
    }
    if (table === "action_approvals") {
      const a = mutation.data as NewRecord<Tables["action_approvals"]>;
      const action = data.actions.find(
        (r) => r.id === a.action_id && r.user_id === this.userId,
      );
      if (
        !action ||
        action.status !== "approval_required" ||
        action.metadata.fingerprint !== a.fingerprint ||
        action.metadata.policy_hash !== a.policy_hash ||
        a.consumed_at !== null
      )
        throw new AppError("Approval must match a pending action", 403);
    }
    if (["permission_policies", "action_approvals"].includes(table) && previous)
      throw new AppError("Permission history is immutable", 403);
    if (table === "permission_policies") {
      const p = mutation.data as NewRecord<Tables["permission_policies"]>;
      if (
        p.subject_agent_id &&
        !data.messages.some(
          (m) =>
            m.id === p.subject_agent_id &&
            m.user_id === this.userId &&
            m.metadata.agent_version === "agent-v1",
        )
      )
        throw new AppError("Foreign or invalid permission agent", 403);
      if (p.subject_user_id && p.subject_user_id !== this.userId)
        throw new AppError("Foreign permission subject", 403);
      if (
        p.product_entity_id &&
        !data.entities.some(
          (e) => e.user_id === this.userId && e.id === p.product_entity_id,
        )
      )
        throw new AppError("Scope not found", 404);
      if (
        data.permission_policies.some(
          (r) =>
            r.user_id === this.userId &&
            (p.parent_id
              ? r.parent_id === p.parent_id
              : r.scope_key === p.scope_key && r.parent_id === null),
        )
      )
        throw new AppError("Policy changed; reload and retry", 409);
      if (
        p.parent_id &&
        !data.permission_policies.some(
          (r) =>
            r.user_id === this.userId &&
            r.id === p.parent_id &&
            r.scope_key === p.scope_key,
        )
      )
        throw new AppError("Policy parent not found", 404);
    }
    if (table === "reflection_proposals" && previous) {
      const prior = previous as Tables["reflection_proposals"];
      if (
        prior.status !== "pending" ||
        Object.keys(mutation.data).some(
          (k) =>
            ![
              "status",
              "review_reason",
              "reviewed_at",
              "reviewed_by",
              "applied_changes",
            ].includes(k),
        )
      )
        throw new AppError("Reflection audit is immutable", 409);
    }
    const input = { ...previous, ...mutation.data } as unknown as Record<
      string,
      unknown
    >;
    const refs: Record<string, Table> = {
      job_id: "reflection_jobs",
      conversation_id: "conversations",
      source_entity_id: "entities",
      target_entity_id: "entities",
      entity_id: "entities",
      memory_id: "memories",
      supersedes_id:
        table === "knowledge_documents" ? "knowledge_documents" : "memories",
      existing_memory_id: "memories",
      candidate_memory_id: "memories",
      source_message_id: "messages",
      goal_id: "goals",
      action_id: "actions",
      outcome_id: "outcomes",
    };
    for (const [key, target] of Object.entries(refs)) {
      const id = input[key];
      if (
        id &&
        !data[target].some((r) => r.id === id && r.user_id === this.userId)
      )
        throw new AppError(`Referenced ${target} not found`, 404);
    }
    if (
      input.valid_from &&
      input.valid_to &&
      Date.parse(String(input.valid_from)) >= Date.parse(String(input.valid_to))
    )
      throw new AppError("Validity end must follow start");
    const unique: Partial<Record<Table, string[]>> = {
      action_approvals: ["action_id"],
      reflection_jobs: ["source_message_id"],
      reflection_proposals: ["fingerprint"],
      entity_aliases: ["alias"],
      extraction_jobs: ["source_message_id"],
      memory_entities: ["memory_id", "entity_id"],
      relationships: [
        "source_entity_id",
        "target_entity_id",
        "relationship_type",
      ],
      memory_evidence: ["memory_id", "source_message_id", "evidence_type"],
    };
    const keys = unique[table];
    const duplicate =
      keys &&
      rows.find(
        (r) =>
          r.user_id === this.userId &&
          r.id !== previous?.id &&
          keys.every(
            (k) => (r as unknown as Record<string, unknown>)[k] === input[k],
          ),
      );
    if (duplicate) {
      if (
        ["memory_entities", "relationships", "memory_evidence"].includes(
          table,
        ) &&
        mutation.kind === "insert"
      )
        return duplicate;
      throw new AppError("This record already exists", 409);
    }
    const now = new Date(
      Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0),
    ).toISOString();
    const row = {
      ...input,
      id: previous?.id ?? mutation.id ?? randomUUID(),
      user_id: this.userId,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    } as unknown as Tables[Table];
    if (rows.some((r) => r.id === row.id && r !== previous))
      throw new AppError("This record already exists", 409);
    if (
      table === "memories" &&
      (!previous ||
        (previous as Tables["memories"]).content !==
          (row as Tables["memories"]).content ||
        (previous as Tables["memories"]).summary !==
          (row as Tables["memories"]).summary)
    ) {
      const m = row as Tables["memories"];
      data.memory_sources.push({
        ...sourceRecord(
          m,
          data.messages.find((x) => x.id === m.source_message_id),
          previous ? "edit" : "create",
        ),
        id: randomUUID(),
        user_id: this.userId,
        created_at: now,
        updated_at: now,
      });
    }
    if (previous) rows[rows.indexOf(previous)] = row;
    else rows.push(row);
    if (
      table === "memories" ||
      table === "relationships" ||
      table === "outcomes"
    ) {
      const significant = (r: unknown) => {
        const {
          updated_at: _,
          last_accessed_at: __,
          ...rest
        } = r as Record<string, unknown>;
        return rest;
      };
      if (
        !previous ||
        JSON.stringify(significant(previous)) !==
          JSON.stringify(significant(row))
      ) {
        data[
          table === "memories"
            ? "memory_versions"
            : table === "relationships"
              ? "relationship_versions"
              : "outcome_versions"
        ].push({
          id: randomUUID(),
          user_id: this.userId,
          record_id: row.id,
          snapshot: structuredClone(row) as unknown as Record<string, unknown>,
          recorded_at: now,
          created_at: now,
          updated_at: now,
        });
      }
    }
    if (table === "messages") {
      const next = (
        (row as Tables["messages"]).metadata
          ?.plan as unknown as import("../../domain/orchestration").ExecutionPlan
      )?.mission;
      const prior = (
        (previous as Tables["messages"] | null)?.metadata
          ?.plan as unknown as import("../../domain/orchestration").ExecutionPlan
      )?.mission;
      if (next && next.state !== prior?.state)
        this.appendTo(
          data,
          createNexusEvent(
            {
              type: `mission.${next.state.toLowerCase()}`,
              source: { kind: "database", name: "MissionEngine" },
              mission_id: row.id,
              correlation_id: (row as Tables["messages"]).conversation_id,
              visibility: "ambient",
              severity: next.state === "FAILED" ? "warning" : "info",
              payload: {
                state: next.state,
                status: next.state,
                operation_id: row.id,
                terminal: [
                  "FAILED",
                  "CANCELLED",
                  "COMPLETED",
                  "PAUSED",
                  "WAITING",
                  "APPROVAL_REQUIRED",
                  "READY",
                  "DRAFT",
                ].includes(next.state),
              },
            },
            randomUUID(),
          ),
        );
    }
    const event = recordEvent(table, row, previous);
    if (event) this.appendTo(data, createNexusEvent(event, randomUUID()));
    return row;
  }
  async batch(mutations: Mutation[]) {
    await this.change((data) => {
      for (const mutation of mutations) this.mutate(data, mutation);
    });
  }
  async insert<K extends Table>(
    table: K,
    input: NewRecord<Tables[K]>,
  ): Promise<Tables[K]> {
    return this.change(
      (data) =>
        this.mutate(data, {
          kind: "insert",
          table,
          data: input,
        } as Mutation) as Tables[K],
    );
  }
  async update<K extends Table>(
    table: K,
    id: string,
    patch: Partial<NewRecord<Tables[K]>>,
  ): Promise<Tables[K]> {
    return this.change(
      (data) =>
        this.mutate(data, {
          kind: "update",
          table,
          id,
          data: patch,
        } as Mutation) as Tables[K],
    );
  }
  async search(
    query: string,
    embedding: number[],
    model: string,
    limit: number,
    version = "legacy-v1",
    minSimilarity = 0.2,
    scope?: { conversationId?: string },
  ): Promise<MemoryHit[]> {
    const queryTokens = new Set(lexicalTokens(query));
    const candidates = (await this.list("memories"))
      .filter((m) => !scope || memoryInScope(m, scope.conversationId))
      .filter(
        (m) =>
          !m.archived_at &&
          m.status === "active" &&
          (!m.valid_from || Date.parse(m.valid_from) <= Date.now()) &&
          (!m.valid_to || Date.parse(m.valid_to) > Date.now()),
      )
      .map((m) => {
        const norm = m.embedding
          ? Math.hypot(...m.embedding) * Math.hypot(...embedding)
          : 0;
        const similarity =
          m.embedding_model === model &&
          m.embedding_version === version &&
          m.embedding_input_hash !== null &&
          m.embedding &&
          norm
            ? Math.max(
                0,
                m.embedding.reduce(
                  (sum, x, i) => sum + x * (embedding[i] ?? 0),
                  0,
                ) / norm,
              )
            : 0;
        const words = new Set(lexicalTokens(`${m.content} ${m.summary}`));
        // Development approximation of plainto_tsquery AND semantics, without synonym expansion.
        const lexical =
          queryTokens.size && [...queryTokens].every((t) => words.has(t))
            ? queryTokens.size / Math.max(1, words.size)
            : 0;
        return {
          ...withoutEmbedding(m),
          similarity,
          score: 0,
          lexical,
        };
      });
    const semantic = candidates
      .filter((m) => m.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
      .slice(0, 100);
    const lexical = candidates
      .filter((m) => m.lexical > 0)
      .sort((a, b) => b.lexical - a.lexical || a.id.localeCompare(b.id))
      .slice(0, 100);
    const semanticRanks = new Map(semantic.map((m, i) => [m.id, i + 1]));
    const textRanks = new Map(lexical.map((m, i) => [m.id, i + 1]));
    return candidates
      .filter((m) => semanticRanks.has(m.id) || textRanks.has(m.id))
      .map(({ lexical, ...m }) => ({
        ...m,
        semantic_score: semanticRanks.has(m.id) ? m.similarity : null,
        text_score: textRanks.has(m.id) ? lexical : null,
        semantic_rank: semanticRanks.get(m.id) ?? null,
        text_rank: textRanks.get(m.id) ?? null,
        score:
          (semanticRanks.has(m.id) ? 1 / (60 + semanticRanks.get(m.id)!) : 0) +
          (textRanks.has(m.id) ? 1 / (60 + textRanks.get(m.id)!) : 0),
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, Math.max(1, Math.min(200, limit)));
  }
}
