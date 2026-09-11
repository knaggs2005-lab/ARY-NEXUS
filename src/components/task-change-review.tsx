import React from "react";
import { taskDifferences, type TaskSnapshot } from "../domain/task-actions";
import styles from "./task-experience.module.css";
const names: Record<keyof TaskSnapshot, string> = {
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  due_at: "Due date",
  entity_id: "Project",
  related_entity_ids: "Linked entities",
};
export function TaskChangeReview({
  before,
  after,
  entities = [],
}: {
  before: TaskSnapshot;
  after: TaskSnapshot;
  entities?: { id: string; name: string }[];
}) {
  function show(
    key: keyof TaskSnapshot,
    value: TaskSnapshot[keyof TaskSnapshot],
  ) {
    if (key === "priority")
      return ["Low", "Normal", "High", "Urgent"][Number(value)];
    if (value === null || value === "") return "None";
    if (key === "due_at") return String(value).slice(0, 10);
    if (key === "entity_id")
      return entities.find((e) => e.id === value)?.name ?? String(value);
    if (Array.isArray(value))
      return (
        value
          .map((id) => entities.find((e) => e.id === id)?.name ?? id)
          .join(", ") || "None"
      );
    return String(value).replaceAll("_", " ");
  }
  return (
    <div className={styles.changes} aria-label="Proposed task changes">
      {taskDifferences(before, after).map((key) => (
        <div key={key}>
          <strong>{names[key]}</strong>
          <span>{show(key, before[key])}</span>
          <span aria-label="changes to">→</span>
          <span>{show(key, after[key])}</span>
        </div>
      ))}
    </div>
  );
}
