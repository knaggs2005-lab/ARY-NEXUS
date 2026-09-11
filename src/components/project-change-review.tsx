import {
  projectDifferences,
  type ProjectSnapshot,
} from "../domain/project-actions";
import styles from "./project-state.module.css";
export function ProjectChangeReview({
  before,
  after,
  names = {},
}: {
  before: ProjectSnapshot;
  after: ProjectSnapshot;
  names?: Record<string, string>;
}) {
  const label: Record<keyof ProjectSnapshot, string> = {
    status: "Status",
    priority: "Priority",
    health: "Health",
    notes: "Project notes",
    blocker_entity_ids: "Blockers",
    goal_ids: "Linked goals",
  };
  const format = (
    key: keyof ProjectSnapshot,
    value: ProjectSnapshot[keyof ProjectSnapshot],
  ) => {
    if (Array.isArray(value))
      return value.map((id) => names[id] ?? id).join(", ") || "None";
    if (value === null || value === "") return "Not set";
    if (key === "priority")
      return (
        ["Low", "Normal", "High", "Urgent"][Number(value)] ?? String(value)
      );
    return String(value).replaceAll("_", " ");
  };
  return (
    <section
      className={styles.review}
      aria-label="Project changes before approval"
    >
      <h3>Reviewed project changes</h3>
      {projectDifferences(before, after).map((key) => (
        <div className={styles.change} key={key}>
          <strong>{label[key]}</strong>
          <span>{format(key, before[key])}</span>
          <span aria-label="changes to">→</span>
          <span>{format(key, after[key])}</span>
        </div>
      ))}
    </section>
  );
}
