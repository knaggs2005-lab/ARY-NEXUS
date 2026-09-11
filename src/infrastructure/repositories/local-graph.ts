import type {
  BrainGraph,
  BrainNode,
  GraphQuery,
} from "../../domain/brain-graph";
import type { Entity, Tables, Relationship } from "../../domain/models";
import { AppError } from "../../domain/validation";

type GraphData = Pick<
  Tables,
  | "entities"
  | "relationships"
  | "memories"
  | "memory_entities"
  | "goals"
  | "tasks"
  | "entity_aliases"
>;
export type GraphSnapshot = { [K in keyof GraphData]: GraphData[K][] };
const statuses = new Set([
  "active",
  "blocked",
  "completed",
  "cancelled",
  "paused",
  "archived",
  "unknown",
]);
const status = (e: Entity) =>
  typeof e.metadata.status === "string" && statuses.has(e.metadata.status)
    ? e.metadata.status
    : "unknown";
/** Development adapter only. The JSON store is already a whole-file snapshot. */
export function queryLocalGraph(
  data: GraphSnapshot,
  q: GraphQuery,
  now = new Date().toISOString(),
): BrainGraph {
  const time = Date.parse(now);
  const currentMemory = (m: Tables["memories"]) =>
    m.status === "active" &&
    !m.archived_at &&
    (!m.valid_from || Date.parse(m.valid_from) <= time) &&
    (!m.valid_to || Date.parse(m.valid_to) > time);
  const entities = new Map(data.entities.map((e) => [e.id, e]));
  const edgeState = (
    r: Relationship,
  ): "current" | "historical" | "scheduled" | "inactive" => {
    if (r.valid_to && Date.parse(r.valid_to) <= time) return "historical";
    if (r.valid_from && Date.parse(r.valid_from) > time) return "scheduled";
    if (
      r.strength <= 0 ||
      (r.memory_id &&
        !data.memories.some((m) => m.id === r.memory_id && currentMemory(m)))
    )
      return "inactive";
    return "current";
  };
  for (const [id, type] of [
    [q.project_id, "project"],
    [q.company_id, "company"],
  ]) {
    if (id && entities.get(id)?.entity_type !== type)
      throw new AppError(`Invalid ${type} scope`, 404);
  }
  if (q.root && !entities.has(q.root))
    throw new AppError("Entity not found", 404);
  const completedTask = (id: string) => {
    const tasks = data.tasks.filter((t) => t.entity_id === id);
    return (
      entities.get(id)?.entity_type === "task" &&
      tasks.length > 0 &&
      tasks.every((t) => ["completed", "cancelled"].includes(t.status))
    );
  };
  const currentEdges = data.relationships.filter(
    (r) => edgeState(r) === "current",
  );
  const inScope = (id: string, scope?: string) =>
    !scope ||
    id === scope ||
    currentEdges.some(
      (r) =>
        r.relationship_type === "part_of" &&
        r.source_entity_id === id &&
        (r.target_entity_id === scope ||
          currentEdges.some(
            (s) =>
              s.relationship_type === "part_of" &&
              s.source_entity_id === r.target_entity_id &&
              s.target_entity_id === scope,
          )),
    );
  const terms = q.q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const eligible = (e: Entity) =>
    (!q.types.length || q.types.includes(e.entity_type)) &&
    inScope(e.id, q.project_id) &&
    inScope(e.id, q.company_id) &&
    (!q.q ||
      e.name.toLowerCase() === q.q.toLowerCase() ||
      data.entity_aliases.some(
        (a) =>
          a.entity_id === e.id && a.alias.toLowerCase() === q.q.toLowerCase(),
      ) ||
      (terms.length > 0 &&
        terms.every((t) =>
          new Set(
            `${e.name} ${e.description}`
              .toLowerCase()
              .match(/[\p{L}\p{N}_]+/gu) ?? [],
          ).has(t),
        )));
  const edges = data.relationships.filter(
    (r) =>
      q.relationships === "all" ||
      (q.relationships === "historical"
        ? ["historical", "inactive"].includes(edgeState(r))
        : edgeState(r) === "current"),
  );
  let ids: string[] = [];
  let nodesTruncated = false;
  if (q.root) {
    if (inScope(q.root, q.project_id) && inScope(q.root, q.company_id))
      ids = [q.root];
    let frontier = [...ids];
    for (let depth = 0; depth < q.depth && frontier.length; depth++) {
      const candidates = new Set<string>();
      for (const id of frontier) {
        const adjacent = edges
          .filter((r) => r.source_entity_id === id || r.target_entity_id === id)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, 501);
        if (adjacent.length > 500) nodesTruncated = true;
        for (const r of adjacent.slice(0, 500)) {
          const next =
            r.source_entity_id === id ? r.target_entity_id : r.source_entity_id;
          if (
            !ids.includes(next) &&
            entities.has(next) &&
            eligible(entities.get(next)!)
          )
            candidates.add(next);
        }
      }
      const next = [...candidates].sort();
      if (next.length > q.limit - ids.length) nodesTruncated = true;
      frontier = next.slice(0, q.limit - ids.length);
      ids.push(...frontier);
    }
  } else {
    ids = data.entities
      .filter((e) => eligible(e) && (!q.after || e.id > q.after))
      .map((e) => e.id)
      .sort()
      .slice(0, q.limit + 1);
    nodesTruncated = ids.length > q.limit;
    ids = ids.slice(0, q.limit);
  }
  const nodes: BrainNode[] = ids.map((id) => {
    const e = entities.get(id)!;
    const linked = new Set(
      data.memory_entities
        .filter((l) => l.entity_id === id)
        .map((l) => l.memory_id),
    );
    const memories = data.memories.filter(
      (m) => linked.has(m.id) && currentMemory(m),
    );
    const blockers = currentEdges
      .filter(
        (r) =>
          r.relationship_type === "blocks" &&
          !completedTask(r.source_entity_id) &&
          r.target_entity_id === id &&
          entities.has(r.source_entity_id) &&
          !["completed", "cancelled", "archived"].includes(
            status(entities.get(r.source_entity_id)!),
          ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const goalIds = new Set(
      data.tasks.filter((t) => t.entity_id === id).map((t) => t.goal_id),
    );
    const goals = data.goals
      .filter((g) => g.entity_id === id || goalIds.has(g.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      id,
      label: e.name,
      type: e.entity_type,
      status: status(e),
      importance: memories.length
        ? Math.max(...memories.map((m) => m.importance_score))
        : null,
      recency: [e.updated_at, ...memories.map((m) => m.updated_at)]
        .sort()
        .at(-1)!,
      connectedMemoryCount: memories.length,
      activeBlockerCount: blockers.length,
      activeBlockers: blockers.slice(0, 10).map((r) => ({
        id: r.source_entity_id,
        label: entities.get(r.source_entity_id)!.name,
        relationshipId: r.id,
      })),
      relatedGoalCount: goals.length,
      relatedGoals: goals.slice(0, 10).map((g) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        progress: g.progress,
      })),
    };
  });
  const selectedEdges = edges
    .filter(
      (r) =>
        ids.includes(r.source_entity_id) && ids.includes(r.target_entity_id),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, q.edge_limit + 1);
  return {
    version: "brain-graph-v1",
    nodes,
    edges: selectedEdges.slice(0, q.edge_limit).map((r) => ({
      id: r.id,
      source: r.source_entity_id,
      target: r.target_entity_id,
      type: r.relationship_type,
      strength: r.strength,
      status: edgeState(r),
      validFrom: r.valid_from,
      validTo: r.valid_to,
      updatedAt: r.updated_at,
      evidenceMemoryId: r.memory_id,
    })),
    meta: {
      root: q.root ?? null,
      depth: q.depth,
      generatedAt: now,
      nodesTruncated,
      edgesTruncated: selectedEdges.length > q.edge_limit,
      nextCursor: !q.root && nodesTruncated ? ids.at(-1)! : null,
    },
  };
}
