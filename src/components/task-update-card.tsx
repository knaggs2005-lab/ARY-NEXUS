"use client";
import { useRef, useState } from "react";
import type { Task, Entity } from "../domain/models";
import {
  taskSnapshot,
  changedTask,
  taskChangesSchema,
  taskDifferences,
  type TaskChanges,
} from "../domain/task-actions";
import { TaskChangeReview } from "./task-change-review";
import { TaskProgress, type TaskPhase } from "./task-experience";
import { api } from "./api";
import styles from "./task-experience.module.css";

export function TaskUpdateCard({
  task,
  entities,
  onUpdated,
}: {
  task: Task;
  entities: Entity[];
  onUpdated: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState(task);
  const [changes, setChanges] = useState<TaskChanges>({});
  const [phase, setPhase] = useState<TaskPhase | null>(null);
  const [message, setMessage] = useState("");
  const [highlight, setHighlight] = useState<string[]>([]);
  const [review, setReview] = useState(false);
  const inFlight = useRef(false),
    requestKey = useRef<string | null>(null);
  const busy = phase === "checking" || phase === "executing";
  const before = taskSnapshot(base),
    after = changedTask(before, changes);
  const shown = taskSnapshot(task);
  function edit(key: keyof TaskChanges, value: unknown) {
    setChanges((old) => ({ ...old, [key]: value }));
    requestKey.current = null;
    setReview(false);
    setPhase(null);
    setMessage("");
  }
  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("checking");
    setMessage("");
    try {
      const validated = taskChangesSchema.parse(changes);
      requestKey.current ??= crypto.randomUUID();
      const response = await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool: "update_task",
          input: {
            task_id: base.id,
            expected_updated_at: base.updated_at,
            before,
            changes: validated,
          },
          reason: "Owner reviewed task changes in Activity",
          request_key: requestKey.current,
        }),
      });
      const result = (await response.json()).result;
      setPhase("succeeded");
      setHighlight(result.changed_fields);
      setEditing(false);
      setMessage(
        "Task updated. Changes and their evidence are in Action history.",
      );
      await onUpdated().catch(() =>
        setMessage("Update saved. Refresh Activity to load the latest task."),
      );
    } catch (error) {
      setPhase("error");
      setMessage(
        `${(error as Error).message} Refresh this task before submitting a fresh proposal after a recorded failure.`,
      );
    } finally {
      inFlight.current = false;
    }
  }
  const fieldClass = (name: string) =>
    highlight.includes(name) ? styles.changedField : undefined;
  return (
    <article
      id={`task-${task.id}`}
      tabIndex={-1}
      className={`${styles.taskCard} ${task.metadata.action_id ? styles.taskEntrance : ""}`}
      data-completed={task.status === "completed"}
    >
      <span key={`status:${task.status}`} className={fieldClass("status")}>
        {task.status.replaceAll("_", " ")}
      </span>
      <h3 key={`title:${task.title}`} className={fieldClass("title")}>
        {task.title}
      </h3>
      <p key={`priority:${task.priority}`} className={fieldClass("priority")}>
        Priority: {["low", "normal", "high", "urgent"][task.priority]}
      </p>
      <p key={`due:${task.due_at}`} className={fieldClass("due_at")}>
        Due: {task.due_at?.slice(0, 10) ?? "No due date"}
      </p>
      <p key={`project:${task.entity_id}`} className={fieldClass("entity_id")}>
        Project:{" "}
        {entities.find((e) => e.id === task.entity_id)?.name ?? "Unlinked"}
      </p>
      <p
        key={`links:${shown.related_entity_ids.join()}`}
        className={fieldClass("related_entity_ids")}
      >
        Linked entities:{" "}
        {shown.related_entity_ids
          .map((id) => entities.find((e) => e.id === id)?.name ?? id)
          .join(", ") || "None"}
      </p>
      <p
        key={`description:${task.description}`}
        className={fieldClass("description")}
      >
        {task.description}
      </p>
      <small>Task ID: {task.id}</small>
      {!editing && (
        <button
          onClick={() => {
            setBase(task);
            setChanges({});
            setReview(false);
            setEditing(true);
            setPhase(null);
            setMessage("");
            requestKey.current = null;
          }}
        >
          Edit task
        </button>
      )}
      {editing && (
        <section className={styles.surface} aria-label={`Update ${task.title}`}>
          <span className={styles.eyebrow}>Review a task update</span>
          <fieldset disabled={busy} className={styles.editor}>
            <label>
              Title
              <input
                value={after.title}
                maxLength={2000}
                onChange={(e) => edit("title", e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                value={after.description}
                maxLength={10000}
                onChange={(e) => edit("description", e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={after.status}
                onChange={(e) => edit("status", e.target.value)}
              >
                {["pending", "in_progress", "completed", "cancelled"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Priority
              <select
                value={after.priority}
                onChange={(e) => edit("priority", Number(e.target.value))}
              >
                {["Low", "Normal", "High", "Urgent"].map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={after.due_at?.slice(0, 10) ?? ""}
                onChange={(e) => edit("due_date", e.target.value || null)}
              />
            </label>
            <label>
              Project
              <select
                value={after.entity_id ?? ""}
                onChange={(e) => edit("project_id", e.target.value || null)}
              >
                <option value="">Unlinked</option>
                {entities
                  .filter((e) =>
                    ["project", "company", "product"].includes(e.entity_type),
                  )
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Linked entities
              <select
                multiple
                value={after.related_entity_ids}
                onChange={(e) =>
                  edit(
                    "related_entity_ids",
                    Array.from(e.target.selectedOptions, (o) => o.value).filter(
                      (id) => id !== after.entity_id,
                    ),
                  )
                }
              >
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {!review ? (
            <button
              disabled={
                busy ||
                !taskDifferences(before, after).length ||
                !taskChangesSchema.safeParse(changes).success
              }
              onClick={() => {
                setChanges(taskChangesSchema.parse(changes));
                setReview(true);
              }}
            >
              Review changes
            </button>
          ) : (
            <>
              <TaskChangeReview
                before={before}
                after={after}
                entities={entities}
              />
              <button disabled={busy} onClick={() => void submit()}>
                Request task update
              </button>
            </>
          )}
          <button disabled={busy} onClick={() => setEditing(false)}>
            Cancel edit
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void onUpdated()
                .then(() => {
                  setEditing(false);
                  setMessage(
                    "Task refreshed. Open Edit task for a fresh review.",
                  );
                })
                .catch((e) => setMessage(e.message))
            }
          >
            Refresh task
          </button>
        </section>
      )}
      {phase && <TaskProgress phase={phase} operation="update" />}
      {message && (
        <p role={phase === "error" ? "alert" : "status"}>{message}</p>
      )}
    </article>
  );
}
