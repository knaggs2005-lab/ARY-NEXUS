import {
  projectInspection,
  projectMapRecord,
  type MapRecordKind,
  type MapKind,
} from "../../domain/nexus-map";
import {
  eventQuery,
  nexusEvent,
  type NexusEvent,
  type EventPage,
  type PersistedNexusEvent,
} from "../../domain/nexus-events";
import type { BrainGraph, GraphQuery } from "../../domain/brain-graph";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repository, Mutation } from "../../domain/repository";
import type { Table, Tables, NewRecord, MemoryHit } from "../../domain/models";
import { withoutEmbedding } from "../../domain/models";
import { AppError, required } from "../../domain/validation";
function check(error: { message: string; code?: string } | null) {
  if (error)
    throw new AppError(
      ["23505", "40001"].includes(error.code ?? "")
        ? "This record already exists"
        : "Database operation failed",
      ["23505", "40001"].includes(error.code ?? "") ? 409 : 500,
    );
}
export class SupabaseRepository implements Repository {
  constructor(
    readonly userId: string,
    private client: SupabaseClient,
  ) {}
  async claimMission(id: string, token: string, ttlMs: number) {
    const { data, error } = await this.client.rpc("nexus_claim_mission_v1", {
      p_id: id,
      p_token: token,
      p_ttl_ms: ttlMs,
    });
    check(error);
    return data === true;
  }
  async releaseMission(id: string, token: string) {
    const { error } = await this.client.rpc("nexus_release_mission_v1", {
      p_id: id,
      p_token: token,
    });
    check(error);
  }
  async checkpointMission(
    id: string,
    token: string,
    expectedUpdatedAt: string,
    plan: import("../../domain/orchestration").ExecutionPlan,
  ) {
    const { error } = await this.client.rpc("nexus_checkpoint_mission_v1", {
      p_id: id,
      p_token: token,
      p_expected: expectedUpdatedAt,
      p_plan: plan,
    });
    check(error);
  }
  async dueMissions(limit: number) {
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("user_id", this.userId)
      .not("metadata->plan->mission->>wake_at", "is", null)
      .lte("metadata->plan->mission->>wake_at", new Date().toISOString())
      .order("updated_at")
      .limit(Math.min(20, Math.max(1, limit)));
    check(error);
    return (data ?? []) as import("../../domain/models").Message[];
  }
  async readMapInspection(tool: "desktop.list_apps" | "studio.inspect") {
    const { data, error } = await this.client
      .from("actions")
      .select("id,tool_name,updated_at,output")
      .eq("user_id", this.userId)
      .eq("tool_name", tool)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1);
    check(error);
    return data?.[0] ? projectInspection(data[0]) : [];
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
    const fields =
      kind === "memory"
        ? "id,summary,content,memory_type,status,updated_at,metadata,valid_from,valid_to"
        : kind === "mission"
          ? "id,updated_at,plan:metadata->plan"
          : "id,name,metadata,updated_at";
    let query = this.client
      .from(table)
      .select(fields)
      .eq("user_id", this.userId)
      .order("id")
      .limit(25);
    if (after) query = query.gt("id", after);
    if (kind === "memory")
      query = query.eq("status", "active").is("archived_at", null);
    if (kind === "mission") query = query.not("metadata->plan", "is", null);
    if (scope?.entityId)
      query = query.contains("metadata->plan->entity_ids", [scope.entityId]);
    if (kind === "facets")
      query = query.in("metadata->>nexus_kind", [
        "location",
        "application",
        "device",
        "skill",
        "automation",
        "organization",
        "object",
      ]);
    if (kind === "facets" && facet)
      query = query.eq("metadata->>nexus_kind", facet);
    if (q && kind !== "memory")
      query = query.ilike(
        kind === "mission" ? "metadata->plan->>goal" : "name",
        `%${q.replace(/[\\%_]/g, "\\$&")}%`,
      );
    if (q && kind === "memory") {
      const term = JSON.stringify(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
      query = query.or(`summary.ilike.${term},content.ilike.${term}`);
    }
    const { data, error } = await query;
    check(error);
    const records = (data ?? [])
      .map((r) =>
        projectMapRecord(kind, r as unknown as Record<string, unknown>),
      )
      .filter((r) => r !== null);
    if (kind === "memory" && records.length) {
      const { data: links, error: linkError } = await this.client
        .from("memory_entities")
        .select("memory_id,entity_id")
        .eq("user_id", this.userId)
        .in(
          "memory_id",
          records.slice(0, 24).map((r) => r.id),
        )
        .limit(200);
      check(linkError);
      for (const record of records.slice(0, 24))
        record.entityIds = (links ?? [])
          .filter((l) => l.memory_id === record.id)
          .map((l) => l.entity_id);
    }
    return { records: records.slice(0, 24), more: records.length > 24 };
  }
  async appendEvent(event: NexusEvent): Promise<PersistedNexusEvent> {
    const { data, error } = await this.client.rpc("nexus_append_event_v1", {
      p_event: nexusEvent.parse(event),
    });
    check(error);
    return data as PersistedNexusEvent;
  }
  async readEvents(
    raw: Parameters<Repository["readEvents"]>[0],
  ): Promise<EventPage> {
    const q = eventQuery.parse(raw);
    const { data, error } = await this.client.rpc("nexus_read_events_v1", {
      p_after: q.after ?? null,
      p_before: q.before ?? null,
      p_limit: q.limit,
    });
    if (error)
      throw new AppError(
        "Nexus event storage unavailable. Apply migration 014 and check database access.",
        503,
      );
    return data as EventPage;
  }
  async consumeApproval(id: string, fingerprint: string, policyHash: string) {
    const { data, error } = await this.client.rpc(
      "consume_action_approval_v1",
      { p_id: id, p_fingerprint: fingerprint, p_policy_hash: policyHash },
    );
    check(error);
    return data === true;
  }
  async ensureActionExecutionKeys() {
    const { data, error } = await this.client.rpc("action_execution_ready_v1");
    if (error || data !== true)
      throw new AppError(
        "Apply Ary action migration 010 before submitting keyed actions",
        503,
      );
  }
  async queryGraph(query: GraphQuery): Promise<BrainGraph> {
    const { data, error } = await this.client.rpc("query_brain_graph_v1", {
      p_query: query,
    });
    if (error?.code === "P0002")
      throw new AppError("Entity or scope not found", 404);
    check(error);
    return data as BrainGraph;
  }
  async batch(mutations: Mutation[]) {
    const { error } = await this.client.rpc("apply_memory_batch", {
      mutations,
    });
    check(error);
  }
  async list<K extends Table>(
    table: K,
    filter: Partial<Tables[K]> = {},
  ): Promise<Tables[K][]> {
    const result: Tables[K][] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = this.client
        .from(table)
        .select("*")
        .eq("user_id", this.userId)
        .order("created_at")
        .order("id")
        .range(offset, offset + 999);
      for (const [key, value] of Object.entries(filter))
        query = value === null ? query.is(key, null) : query.eq(key, value);
      const { data, error } = await query;
      check(error);
      result.push(...((data ?? []) as Tables[K][]));
      if ((data?.length ?? 0) < 1000) return result;
    }
  }
  async get<K extends Table>(table: K, id: string): Promise<Tables[K] | null> {
    const { data, error } = await this.client
      .from(table)
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .maybeSingle();
    check(error);
    return data as Tables[K] | null;
  }
  async insert<K extends Table>(
    table: K,
    input: NewRecord<Tables[K]>,
  ): Promise<Tables[K]> {
    const { data, error } = await this.client
      .from(table)
      .insert({ ...input, user_id: this.userId })
      .select()
      .single();
    if (
      table === "permission_policies" &&
      error &&
      ["PGRST204", "42703"].includes(error.code ?? "") &&
      /permission_class|subject_agent_id|behavior/.test(error.message)
    )
      throw new AppError(
        "Extended permission rules require Supabase migration 017 (permission_engine). Existing numeric rules and emergency stop remain available.",
        503,
      );
    check(error);
    return data as Tables[K];
  }
  async update<K extends Table>(
    table: K,
    id: string,
    patch: Partial<NewRecord<Tables[K]>>,
  ): Promise<Tables[K]> {
    const { data, error } = await this.client
      .from(table)
      .update(patch as Record<string, unknown>)
      .eq("user_id", this.userId)
      .eq("id", id)
      .select()
      .maybeSingle();
    check(error);
    return required(data, table) as Tables[K];
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
    const args = {
      query_text: query,
      query_embedding: JSON.stringify(embedding),
      model_id: model,
      version_id: version,
      min_similarity: minSimilarity,
      match_count: limit,
    };
    let { data, error } = await this.client.rpc(
      scope ? "search_memories_v5" : "search_memories_v4",
      scope
        ? { ...args, conversation_scope: scope.conversationId ?? null }
        : args,
    );
    // Older hosted schemas stay usable until additive migration 016 is installed.
    // MemoryService still applies all scope filters before context construction.
    if (scope && (error?.code === "PGRST202" || error?.code === "42883"))
      ({ data, error } = await this.client.rpc("search_memories_v4", args));
    check(error);
    const hits = (data ?? []) as {
      id: string;
      score: number;
      similarity: number;
      semantic_score: number | null;
      text_score: number | null;
      semantic_rank: number | null;
      text_rank: number | null;
      candidate_updated_at: string;
    }[];
    if (!hits.length) return [];
    const { data: rows, error: rowError } = await this.client
      .from("memories")
      .select("*")
      .eq("user_id", this.userId)
      .is("archived_at", null)
      .in(
        "id",
        hits.map((x) => x.id),
      );
    check(rowError);
    return hits.flatMap((hit) => {
      const memory = rows?.find((m) => m.id === hit.id);
      // Never attach scores from a previous fact/version to freshly edited content.
      return memory &&
        memory.updated_at === hit.candidate_updated_at &&
        memory.status === "active" &&
        (!memory.valid_from || Date.parse(memory.valid_from) <= Date.now()) &&
        (!memory.valid_to || Date.parse(memory.valid_to) > Date.now())
        ? [
            {
              ...withoutEmbedding(memory as Tables["memories"]),
              score: hit.score,
              similarity: hit.similarity,
              semantic_score: hit.semantic_score,
              text_score: hit.text_score,
              semantic_rank: hit.semantic_rank,
              text_rank: hit.text_rank,
            },
          ]
        : [];
    });
  }
}
