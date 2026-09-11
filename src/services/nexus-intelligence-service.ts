import { z } from "zod";
import type { Repository } from "../domain/repository";
import type { MemoryHit } from "../domain/models";
import type { ExecutionPlan } from "../domain/orchestration";
import {
  intelligenceQuery,
  type NexusIntelligence,
} from "../domain/nexus-intelligence";
import { mapNode, mapEdge, mapKinds, type MapKind } from "../domain/nexus-map";
import { policyFor, memoryInScope, explainHit } from "../domain/nexus-memory";
import { AppError, required } from "../domain/validation";
import { agentExecution } from "./agent-context";
import { ActionService } from "./action-service";
import { MemoryService, isCurrentMemory } from "./memory-service";
import { GraphQueryService } from "./graph-query-service";
/** Read-only lenses over canonical records. Source references are connections, never inferred identity. */
export class NexusIntelligenceService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private memories: MemoryService,
  ) {}
  async query(raw: unknown): Promise<NexusIntelligence> {
    const q = intelligenceQuery.parse(raw);
    if (agentExecution.getStore())
      throw new AppError("Use existing mission-scoped agent retrieval", 403);
    const result: NexusIntelligence = {
      map: {
        nodes: [],
        edges: [],
        meta: {
          generatedAt: new Date().toISOString(),
          more: false,
          cursor: null,
          warnings: [],
        },
      },
      focus: q.focus ?? null,
      memories: [],
      timeline: [],
      query: q.q,
      explanation: q.q
        ? "Current, scoped memories ranked by the existing semantic / text / entity / graph retrieval service. Confidence is a recorded estimate, not a probability."
        : "Recorded links and source evidence. Timeline dates are when records were learned or recorded; validity is shown separately. No missing relationship or event is inferred.",
    };
    const seenEntities = new Set<string>(),
      seenMemories = new Set<string>(),
      seenMissions = new Set<string>();
    // One aggregate read authorization/audit per family + scope in this request.
    // No authorization is cached across requests or users.
    const authorized = new Set<string>();
    const read = async <T>(
      tool: string,
      ids: string[],
      fn: () => Promise<T>,
    ): Promise<T> => {
      const key = JSON.stringify([tool, [...new Set(ids)].sort()]);
      if (authorized.has(key)) return fn();
      const value = await this.actions.run(
        tool,
        null,
        fn,
        { surface: "nexus-intelligence" },
        { productIds: ids },
      );
      authorized.add(key);
      return value;
    };
    const optional = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        result.map.meta.warnings.push(
          `${label}: ${e instanceof AppError && e.status === 403 ? "access restricted" : "source unavailable"}.`,
        );
      }
    };
    const entity = async (id: string) => {
      if (seenEntities.has(id)) return;
      seenEntities.add(id);
      const e = await read("entity.read", [id], () =>
        this.repo.get("entities", id),
      );
      if (!e) return;
      const facet = e.metadata.nexus_kind;
      const kind =
        typeof facet === "string" &&
        mapKinds.includes(facet as MapKind) &&
        [
          "location",
          "device",
          "application",
          "organization",
          "object",
        ].includes(facet)
          ? (facet as MapKind)
          : e.entity_type;
      result.map.nodes.push(
        mapNode(
          e.id,
          e.name,
          kind,
          "Canonical entity",
          e.description,
          "Entities",
          { recordId: e.id, recency: e.updated_at },
        ),
      );
    };
    const addMemory = async (id: string, hit?: MemoryHit) => {
      if (seenMemories.has(id)) return;
      seenMemories.add(id);
      if (seenMemories.size > 32) {
        result.map.meta.more = true;
        return;
      }
      const links = await read("memory.read", [], () =>
        this.repo.list("memory_entities", { memory_id: id }),
      );
      const scope = links.map((l) => l.entity_id);
      await read("memory.read", scope, async () => {
        const m = await this.repo.get("memories", id);
        if (
          !m ||
          !memoryInScope(m) ||
          (q.history === "current" && !isCurrentMemory(m))
        )
          return;
        const policy = policyFor(m);
        const [sources, versions, conflicts] = await Promise.all([
          this.repo.list("memory_sources", { memory_id: id }),
          this.repo.list("memory_versions", { record_id: id }),
          this.repo.list("memory_conflicts", { status: "pending" }),
        ]);
        const title = (m.summary || m.content).slice(0, 160),
          nodeId = `memory:${id}`;
        result.memories.push({
          id,
          title,
          content: m.content.slice(0, 4000),
          class: policy.class,
          status: m.archived_at
            ? "archived"
            : isCurrentMemory(m)
              ? "current"
              : m.status === "active"
                ? "historical / inactive"
                : m.status,
          confidence: m.confidence_score,
          learnedAt: m.created_at,
          validFrom: m.valid_from,
          validTo: m.valid_to,
          sources: sources.slice(-8).map((s) => ({
            id: s.id,
            kind: s.kind,
            reference: s.reference.slice(0, 500),
            quote: s.quote?.slice(0, 1000) ?? null,
            at: s.created_at,
          })),
          conflicts: conflicts.filter(
            (c) => c.existing_memory_id === id || c.candidate_memory_id === id,
          ).length,
          relevance: hit ? (hit.explanation ?? explainHit(hit)) : undefined,
        });
        result.map.nodes.push(
          mapNode(
            nodeId,
            isCurrentMemory(m)
              ? title
              : `${title} · ${m.archived_at ? "archived" : m.status}`,
            "memory",
            "Canonical memory",
            m.content,
            "Memories",
            {
              recordId: id,
              recency: m.created_at,
              status: result.memories.at(-1)!.status,
              importance: m.importance_score,
            },
          ),
        );
        result.timeline.push({
          id: `learned:${id}`,
          nodeId,
          at: m.created_at,
          kind: policy.class === "EPISODIC" ? "episode" : "learned",
          title,
          source: sources[0]?.reference ?? "Original source unavailable",
        });
        const ordered = versions.toSorted((a, b) =>
          a.recorded_at.localeCompare(b.recorded_at),
        );
        for (let i = 1; i < ordered.length; i++) {
          const a = ordered[i - 1].snapshot,
            b = ordered[i].snapshot;
          const fields = [
            "content",
            "summary",
            "status",
            "confidence_score",
            "valid_from",
            "valid_to",
            "archived_at",
          ].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
          if (fields.length)
            result.timeline.push({
              id: `revision:${ordered[i].id}`,
              nodeId,
              at: ordered[i].recorded_at,
              kind: "revision",
              title: `Changed ${fields.join(", ")}`,
              before: fields
                .map((k) => `${k}: ${String(a[k] ?? "—")}`)
                .join("\n")
                .slice(0, 2000),
              after: fields
                .map((k) => `${k}: ${String(b[k] ?? "—")}`)
                .join("\n")
                .slice(0, 2000),
              source: `memory_versions:${ordered[i].id}`,
            });
        }
        for (const link of links.slice(0, 16))
          await optional("Linked entity", async () => {
            await entity(link.entity_id);
            const edge = mapEdge(
              nodeId,
              link.entity_id,
              "known_about",
              "reference",
              `memory-link:${link.id}`,
            );
            edge.evidence = [`memory_entities:${link.id}`];
            result.map.edges.push(edge);
          });
        if (m.supersedes_id) {
          result.timeline.push({
            id: `supersession:${id}`,
            nodeId,
            at: m.created_at,
            kind: "supersession",
            title: "Replaces an earlier recorded fact",
            source: `memories:${id}.supersedes_id`,
          });
          if (q.history === "all") {
            await addMemory(m.supersedes_id);
            const edge = mapEdge(
              nodeId,
              `memory:${m.supersedes_id}`,
              "supersedes",
              "reference",
            );
            edge.evidence = [`memories:${id}.supersedes_id`];
            result.map.edges.push(edge);
          }
        }
      });
    };
    const addOutcome = async (id: string, missionId?: string) => {
      const o = await read("activity.read", [], () =>
        this.repo.get("outcomes", id),
      );
      if (!o) return;
      const a = await this.repo.get("actions", o.action_id);
      if (!a) return;
      await read("activity.read", a.product_entity_ids ?? [], async () => {
        const nodeId = `outcome:${id}`;
        if (result.map.nodes.some((n) => n.id === nodeId)) return;
        result.map.nodes.push(
          mapNode(
            nodeId,
            o.summary,
            "outcome",
            "Canonical outcome",
            `Action ${a.tool_name} · ${a.id}`,
            "Action history",
            { recordId: id, status: o.status, recency: o.created_at },
          ),
        );
        result.timeline.push({
          id: nodeId,
          nodeId,
          at: o.created_at,
          kind: "outcome",
          title: o.summary.slice(0, 500),
          source: `outcomes:${id} → actions:${a.id}`,
        });
        if (missionId) {
          const edge = mapEdge(
            `mission:${missionId}`,
            nodeId,
            "resulted_in",
            "reference",
          );
          edge.evidence = [`actions:${a.id}`, `outcomes:${id}`];
          result.map.edges.push(edge);
        }
        for (const e of (a.product_entity_ids ?? []).slice(0, 12))
          await optional("Outcome entity", async () => {
            await entity(e);
            const edge = mapEdge(nodeId, e, "action_scope", "reference");
            edge.evidence = [`actions:${a.id}.product_entity_ids`];
            result.map.edges.push(edge);
          });
      });
    };
    const addMission = async (id: string) => {
      if (seenMissions.has(id)) return;
      seenMissions.add(id);
      const m = await read("conversation.read", [], () =>
        this.repo.get("messages", id),
      );
      const p = m?.metadata.plan as ExecutionPlan | undefined;
      if (!m || !p || p.version !== "orchestrator-v1" || p.id !== id) return;
      await read("conversation.read", p.entity_ids ?? [], async () => {
        result.map.nodes.push(
          mapNode(
            `mission:${id}`,
            p.goal,
            "mission",
            "Canonical mission",
            p.summary || "Saved execution plan",
            "Execution Plans",
            {
              recordId: id,
              status: p.mission?.state ?? p.status,
              recency: m.updated_at,
            },
          ),
        );
        result.timeline.push({
          id: `mission:${id}`,
          nodeId: `mission:${id}`,
          at: m.updated_at,
          kind: "mission",
          title: p.goal.slice(0, 500),
          source: `messages:${id}.metadata.plan`,
        });
        for (const e of (p.entity_ids ?? []).slice(0, 16))
          await optional("Mission entity", async () => {
            await entity(e);
            const edge = mapEdge(`mission:${id}`, e, "references", "reference");
            edge.evidence = [`messages:${id}.metadata.plan.entity_ids`];
            result.map.edges.push(edge);
          });
        for (const memory of (p.memory_ids ?? []).slice(0, 8))
          await optional("Mission memory", async () => {
            await addMemory(memory);
            const edge = mapEdge(
              `mission:${id}`,
              `memory:${memory}`,
              "uses_memory",
              "reference",
            );
            edge.evidence = [`messages:${id}.metadata.plan.memory_ids`];
            result.map.edges.push(edge);
          });
        const receipts = [
          ...new Set(
            Object.values(p.states ?? {})
              .flatMap((s) => [s.action_id, s.verification_action_id])
              .filter((v): v is string => !!v),
          ),
        ].slice(0, 24);
        for (const actionId of receipts)
          await optional("Mission outcomes", async () => {
            const outcomes = await read(
              "activity.read",
              p.entity_ids ?? [],
              () => this.repo.list("outcomes", { action_id: actionId }),
            );
            for (const o of outcomes.slice(0, 3)) await addOutcome(o.id, id);
          });
      });
    };
    if (q.focus) {
      const [prefix, tail] = q.focus.includes(":")
        ? q.focus.split(":")
        : ["entity", q.focus];
      const id = z.uuid().parse(tail);
      if (prefix === "entity") {
        const e = await read("entity.read", [id], () =>
          this.repo.get("entities", id),
        );
        required(e, "Entity");
        const graph = await read("entity.read", [id], () =>
          new GraphQueryService(this.repo).query({
            root: id,
            depth: 1,
            relationships: q.history,
            limit: 32,
            edge_limit: 80,
          }),
        );
        for (const n of graph.nodes)
          await optional("Entity", () => entity(n.id));
        result.map.edges.push(
          ...graph.edges.map((edge) => ({
            ...edge,
            provenance: "stored" as const,
            evidence: [
              `relationships:${edge.id}`,
              ...(edge.evidenceMemoryId
                ? [`memory:${edge.evidenceMemoryId}`]
                : []),
            ],
          })),
        );
        result.map.meta.more ||=
          graph.meta.nodesTruncated || graph.meta.edgesTruncated;
        await optional("Linked memories", async () => {
          const links = await read("memory.read", [id], () =>
            this.repo.list("memory_entities", { entity_id: id }),
          );
          if (links.length > 32) result.map.meta.more = true;
          for (const l of links
            .toSorted((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 32))
            await optional("Memory", () => addMemory(l.memory_id));
        });
        await optional("Linked missions", async () => {
          const page = await read("conversation.read", [id], () =>
            this.repo.readMapRecords("mission", "", undefined, undefined, {
              entityId: id,
            }),
          );
          result.map.meta.more ||= page.more || page.records.length > 8;
          for (const m of page.records.slice(0, 8))
            await optional("Mission", () => addMission(m.id));
        });
      } else if (prefix === "memory") await addMemory(id);
      else if (prefix === "mission") await addMission(id);
      else await addOutcome(id);
    }
    if (q.q) {
      const hits = await read("memory.read", [], () =>
        this.memories.searchMemories(q.q, 12),
      );
      // Query evidence remains current even when the surrounding map is in historical mode.
      for (const h of hits)
        await optional("Search result", () => addMemory(h.id, h));
      for (const h of hits) {
        const m = result.memories.find((m) => m.id === h.id);
        if (m) m.relevance = h.explanation ?? explainHit(h);
      }
      if (!hits.length)
        result.explanation =
          "No relevant current memory was retrieved. No answer or connection has been invented.";
    }
    if (
      result.map.nodes.length > 120 ||
      result.map.edges.length > 240 ||
      result.timeline.length > 100
    )
      result.map.meta.more = true;
    result.map.nodes = [
      ...new Map(result.map.nodes.map((n) => [n.id, n])).values(),
    ].slice(0, 120);
    const ids = new Set(result.map.nodes.map((n) => n.id));
    result.map.edges = [
      ...new Map(
        result.map.edges
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e) => [e.id, e]),
      ).values(),
    ].slice(0, 240);
    result.map.meta.warnings = [...new Set(result.map.meta.warnings)];
    if (result.map.meta.more)
      result.map.meta.warnings.push(
        "Showing a bounded context window. Older or additional records may exist; open the original source for deeper inspection.",
      );
    result.timeline = result.timeline
      .toSorted((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
      .slice(0, 100);
    return result;
  }
}
