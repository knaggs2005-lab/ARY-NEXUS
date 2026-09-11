import React from "react";
import styles from "./task-experience.module.css";

export type TaskPhase =
  | "checking"
  | "review"
  | "approving"
  | "executing"
  | "succeeded"
  | "rejected"
  | "error";
const labels: Record<TaskPhase, string> = {
  checking: "Checking task permissions",
  review: "Awaiting your approval",
  approving: "Recording your decision",
  executing: "Creating your task",
  succeeded: "Task saved",
  rejected: "Request declined",
  error: "Task not confirmed",
};
/** Reflect actual request boundaries; never advance on an animation timer. */
export function TaskProgress({
  phase,
  operation = "create",
}: {
  phase: TaskPhase;
  operation?: "create" | "update";
}) {
  const active =
    phase === "checking" || phase === "approving" || phase === "executing";
  return (
    <div className={styles.progress} data-phase={phase} aria-busy={active}>
      <div
        className={styles.status}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={styles.light} aria-hidden="true" />
        {operation === "update" && phase === "executing"
          ? "Updating your task"
          : labels[phase]}
      </div>
      <ol
        className={styles.steps}
        aria-label={
          operation === "update"
            ? "Task update progress"
            : "Task creation progress"
        }
      >
        {["Approval", "Execution", "Saved"].map((label, i) => {
          const current =
            phase === "checking" || phase === "review" || phase === "approving"
              ? 0
              : phase === "executing"
                ? 1
                : phase === "succeeded"
                  ? 2
                  : -1;
          return (
            <li
              key={label}
              data-reached={current >= i}
              aria-current={current === i ? "step" : undefined}
            >
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
export function TaskReceipt({
  title,
  taskId,
  project,
  actionId,
  replay = false,
  operation = "create",
}: {
  title: string;
  taskId: string;
  project: string;
  actionId?: string;
  replay?: boolean;
  operation?: "create" | "update";
}) {
  return (
    <div className={styles.receipt}>
      <div className={styles.connection} aria-hidden="true">
        <span>✓</span>
        <i />
        <span>▤</span>
      </div>
      <div className={styles.receiptBody}>
        <span className={styles.eyebrow}>
          {replay
            ? "Existing task returned"
            : operation === "update"
              ? "Action → updated task"
              : "Action → saved task"}
        </span>
        <strong>{title}</strong>
        <span>{project}</span>
        <small>
          Task ID: <code>{taskId}</code>
        </small>
        {actionId && (
          <small>
            Action ID: <code>{actionId}</code>
          </small>
        )}
      </div>
    </div>
  );
}
