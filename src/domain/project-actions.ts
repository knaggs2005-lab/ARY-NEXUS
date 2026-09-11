import { z } from "zod";
import type { Entity, Goal, Relationship, Task } from "./models";
import { isCurrentRelationship } from "../services/relationship-validity";

export const projectStatuses = [
  "active",
  "blocked",
  "paused",
  "completed",
  "cancelled",
  "archived",
] as const;
export const projectHealth = [
  "on_track",
  "at_risk",
  "off_track",
  "unknown",
] as const;
const ids = z
  .array(z.uuid())
  .max(50)
  .refine((v) => new Set(v).size === v.length, "Duplicate links");
export const projectSnapshotSchema = z
  .object({
    status: z.string().nullable(),
    priority: z.number().nullable(),
    health: z.string().nullable(),
    notes: z.string(),
    blocker_entity_ids: ids,
    goal_ids: ids,
  })
  .strict();
export const projectChangesSchema = z
  .object({
    status: z.enum(projectStatuses).optional(),
    priority: z.number().int().min(0).max(3).nullable().optional(),
    health: z.enum(projectHealth).optional(),
    notes: z.string().trim().max(10000).optional(),
    blocker_entity_ids: ids.optional(),
    goal_ids: ids.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one change");
export const projectUpdateInput = z
  .object({
    project_id: z.uuid(),
    expected_updated_at: z.string().min(1).max(64),
    before: projectSnapshotSchema,
    changes: projectChangesSchema,
  })
  .strict();
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;
export type ProjectChanges = z.infer<typeof projectChangesSchema>;
export function projectBlockers(id: string, edges: Relationship[]) {
  return edges.filter(
    (e) =>
      e.target_entity_id === id &&
      e.relationship_type === "blocks" &&
      isCurrentRelationship(e),
  );
}
export function projectSnapshot(
  project: Entity,
  edges: Relationship[],
  goals: Goal[],
): ProjectSnapshot {
  const m = project.metadata;
  return {
    status: typeof m.status === "string" ? m.status : null,
    priority: typeof m.priority === "number" ? m.priority : null,
    health: typeof m.health === "string" ? m.health : null,
    notes: typeof m.project_notes === "string" ? m.project_notes : "",
    blocker_entity_ids: [
      ...new Set(
        projectBlockers(project.id, edges).map((e) => e.source_entity_id),
      ),
    ].sort(),
    goal_ids: goals
      .filter((g) => g.entity_id === project.id)
      .map((g) => g.id)
      .sort(),
  };
}
export function changedProject(
  before: ProjectSnapshot,
  changes: ProjectChanges,
): ProjectSnapshot {
  return {
    ...before,
    ...changes,
    blocker_entity_ids: [
      ...(changes.blocker_entity_ids ?? before.blocker_entity_ids),
    ].sort(),
    goal_ids: [...(changes.goal_ids ?? before.goal_ids)].sort(),
  };
}
export function projectDifferences(
  before: ProjectSnapshot,
  after: ProjectSnapshot,
) {
  return (Object.keys(before) as (keyof ProjectSnapshot)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  );
}
/** Read-only rollups: task state never implicitly changes project state or health. */
export function projectTaskRollup(projectId: string, tasks: Task[]) {
  const linked = tasks.filter((t) => t.entity_id === projectId);
  return {
    total: linked.length,
    pending: linked.filter((t) => t.status === "pending").length,
    in_progress: linked.filter((t) => t.status === "in_progress").length,
    completed: linked.filter((t) => t.status === "completed").length,
    cancelled: linked.filter((t) => t.status === "cancelled").length,
  };
}
