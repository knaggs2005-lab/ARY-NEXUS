import type {
  Entity,
  Memory,
  MemoryHit,
  Relationship,
  Tables,
} from "../domain/models";
import { withoutEmbedding } from "../domain/models";
import { isCurrentRelationship } from "./relationship-validity";

type Path = { labels: string[]; steps: NonNullable<MemoryHit["graph_steps"]> };
/** Undirected, deterministic breadth-first traversal; stored direction is retained as evidence. */
export function graphCandidates(
  roots: string[],
  nodes: Entity[],
  edges: Relationship[],
  memories: Memory[],
  links: Tables["memory_entities"][],
): MemoryHit[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const currentIds = new Set(memories.map((m) => m.id));
  const paths = new Map<string, Path>(
    [...new Set(roots)]
      .filter((id) => byId.has(id))
      .sort()
      .slice(0, 100)
      .map((id) => [id, { labels: [byId.get(id)!.name], steps: [] }]),
  );
  const eligibleEdges = edges
    .filter(
      (e) =>
        isCurrentRelationship(e) &&
        e.strength > 0 &&
        byId.has(e.source_entity_id) &&
        byId.has(e.target_entity_id) &&
        (!e.memory_id || currentIds.has(e.memory_id)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  let frontier = [...paths.keys()];
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next: string[] = [];
    for (const from of frontier) {
      for (const edge of eligibleEdges) {
        const forward = edge.source_entity_id === from;
        if (!forward && edge.target_entity_id !== from) continue;
        const to = forward ? edge.target_entity_id : edge.source_entity_id;
        if (paths.has(to) || paths.size >= 100) continue;
        const prior = paths.get(from)!;
        paths.set(to, {
          labels: [
            ...prior.labels,
            edge.relationship_type + (forward ? "" : " (reverse)"),
            byId.get(to)!.name,
          ],
          steps: [
            ...prior.steps,
            {
              relationship_id: edge.id,
              source_entity_id: edge.source_entity_id,
              target_entity_id: edge.target_entity_id,
              relationship_type: edge.relationship_type,
              traversal: forward ? "forward" : "reverse",
            },
          ],
        });
        next.push(to);
      }
    }
    frontier = next;
  }
  return memories
    .flatMap((m) => {
      const path = links
        .filter((l) => l.memory_id === m.id && paths.has(l.entity_id))
        .map((l) => paths.get(l.entity_id)!)
        .sort(
          (a, b) =>
            a.steps.length - b.steps.length ||
            a.labels.join("/").localeCompare(b.labels.join("/")),
        )[0];
      return path
        ? [
            {
              ...withoutEmbedding(m),
              similarity: 0,
              score: 0,
              graph_path: path.labels,
              graph_steps: path.steps,
              graph_hops: path.steps.length,
            },
          ]
        : [];
    })
    .sort((a, b) => a.graph_hops - b.graph_hops || a.id.localeCompare(b.id))
    .slice(0, 100);
}
