import { z } from "zod";

export const taskCreationInput = z
  .object({
    title: z.string().trim().min(1).max(2000),
    description: z.string().trim().max(10000).default(""),
    project_id: z.uuid(),
    status: z
      .enum(["pending", "in_progress", "completed", "cancelled"])
      .default("pending"),
    priority: z.number().int().min(0).max(3).default(1),
    // A calendar due date, represented as the end of that UTC date in the existing timestamptz column.
    due_date: z.iso.date().nullable().default(null),
  })
  .strict();

/** Explicit review snapshot. Full precision timestamps are opaque concurrency tokens. */
export const taskSnapshotSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: z.number().int().min(0).max(3),
    due_at: z.string().nullable(),
    entity_id: z.uuid().nullable(),
    related_entity_ids: z.array(z.uuid()).max(20),
  })
  .strict();
export const taskChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(2000).optional(),
    description: z.string().trim().max(10000).optional(),
    status: z
      .enum(["pending", "in_progress", "completed", "cancelled"])
      .optional(),
    priority: z.number().int().min(0).max(3).optional(),
    due_date: z.iso.date().nullable().optional(),
    project_id: z.uuid().nullable().optional(),
    related_entity_ids: z.array(z.uuid()).max(19).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one change",
  );
export const taskUpdateInput = z
  .object({
    task_id: z.uuid(),
    expected_updated_at: z.string().min(1).max(64),
    before: taskSnapshotSchema,
    changes: taskChangesSchema,
  })
  .strict();
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
export type TaskChanges = z.infer<typeof taskChangesSchema>;
export function taskSnapshot(task: import("./models").Task): TaskSnapshot {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_at: task.due_at,
    entity_id: task.entity_id,
    related_entity_ids: [
      ...new Set(
        (Array.isArray(task.metadata.related_entity_ids)
          ? task.metadata.related_entity_ids
          : []
        ).filter((id): id is string => typeof id === "string"),
      ),
    ].sort(),
  };
}
export function changedTask(
  before: TaskSnapshot,
  changes: TaskChanges,
): TaskSnapshot {
  const entity_id =
    changes.project_id !== undefined ? changes.project_id : before.entity_id;
  let links = changes.related_entity_ids ?? before.related_entity_ids;
  if (changes.project_id !== undefined && !changes.related_entity_ids)
    links = links.filter((id) => id !== before.entity_id);
  return {
    title: changes.title ?? before.title,
    description: changes.description ?? before.description,
    status: changes.status ?? before.status,
    priority: changes.priority ?? before.priority,
    due_at:
      changes.due_date === undefined
        ? before.due_at
        : changes.due_date
          ? `${changes.due_date}T23:59:59.000Z`
          : null,
    entity_id,
    related_entity_ids: [
      ...new Set([...links, ...(entity_id ? [entity_id] : [])]),
    ].sort(),
  };
}
export function taskDifferences(before: TaskSnapshot, after: TaskSnapshot) {
  return (Object.keys(before) as (keyof TaskSnapshot)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
