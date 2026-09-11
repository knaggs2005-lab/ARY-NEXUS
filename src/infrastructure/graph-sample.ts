import type { GraphSnapshot } from "./repositories/local-graph";
import type { Entity, Relationship } from "../domain/models";

/** Synthetic layout/query fixture. Never inserted into the authenticated user's facts. */
export const graphSampleId = (n: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function graphSample(userId = graphSampleId(999)): GraphSnapshot {
  const base = (n: number) => ({
    id: graphSampleId(n),
    user_id: userId,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  const entity = (
    n: number,
    name: string,
    type: Entity["entity_type"],
    status = "active",
  ): Entity => ({
    ...base(n),
    name,
    entity_type: type,
    description:
      "Synthetic brain graph sample; not a confirmed workspace fact.",
    metadata: { sample: true, status },
  });
  const edge = (
    n: number,
    source: number,
    target: number,
    type: string,
    extra: Partial<Relationship> = {},
  ): Relationship => ({
    ...base(n),
    source_entity_id: graphSampleId(source),
    target_entity_id: graphSampleId(target),
    relationship_type: type,
    strength: 0.8,
    valid_from: null,
    valid_to: null,
    memory_id: null,
    metadata: { sample: true },
    ...extra,
  });
  return {
    entities: [
      entity(1, "Clevaryn", "company"),
      entity(2, "Wag Trails", "project"),
      entity(3, "Ary Nexus", "project"),
      entity(4, "Sample trail import", "task", "blocked"),
      entity(5, "Sample dataset review", "task"),
      entity(6, "Sample graph release", "goal"),
      entity(7, "Sample retired renderer", "product", "archived"),
    ],
    relationships: [
      edge(101, 2, 1, "part_of"),
      edge(102, 3, 1, "part_of"),
      edge(103, 4, 2, "part_of"),
      edge(104, 5, 2, "part_of"),
      edge(105, 5, 4, "blocks"),
      edge(106, 6, 3, "part_of"),
      edge(107, 3, 2, "tracks"),
      edge(108, 7, 3, "supports", { valid_to: "2020-01-01T00:00:00.000Z" }),
      edge(109, 7, 2, "supports", { valid_from: "2099-01-01T00:00:00.000Z" }),
      edge(110, 7, 1, "tracks", { strength: 0 }),
    ],
    memories: [1, 2, 3].map((n) => ({
      ...base(200 + n),
      memory_type: "fact",
      content: `Synthetic sample fact for entity ${n}.`,
      summary: "Graph sample only",
      importance_score: n / 4,
      confidence_score: 0.5,
      last_accessed_at: null,
      embedding: null,
      embedding_model: "sample-none",
      embedding_version: "sample-v1",
      embedding_dimensions: 384,
      embedding_input_hash: null,
      metadata: { sample: true },
      archived_at: null,
      source_message_id: null,
      status: "active",
      valid_from: null,
      valid_to: null,
      supersedes_id: null,
    })),
    memory_entities: [1, 2, 3].map((n) => ({
      ...base(300 + n),
      memory_id: graphSampleId(200 + n),
      entity_id: graphSampleId(n),
    })),
    goals: [
      {
        ...base(401),
        entity_id: graphSampleId(3),
        title: "Sample graph release",
        description: "Synthetic goal",
        status: "active",
        progress: 0.25,
        target_date: null,
        metadata: { sample: true },
      },
    ],
    tasks: [
      {
        ...base(501),
        entity_id: graphSampleId(4),
        goal_id: graphSampleId(401),
        title: "Sample trail import",
        description: "Synthetic task",
        status: "pending",
        priority: 1,
        due_at: null,
        metadata: { sample: true },
      },
    ],
    entity_aliases: [
      { ...base(602), entity_id: graphSampleId(3), alias: "memory hq" },
      { ...base(601), entity_id: graphSampleId(3), alias: "nexus" },
    ],
  };
}
