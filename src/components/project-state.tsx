"use client";
import { useRef, useState } from "react";
import type { Entity, Goal, Relationship, Task } from "../domain/models";
import {
  projectSnapshot,
  projectTaskRollup,
  changedProject,
  projectChangesSchema,
  projectDifferences,
  projectStatuses,
  projectHealth,
  type ProjectChanges,
} from "../domain/project-actions";
import { ProjectChangeReview } from "./project-change-review";
import { api } from "./api";
import styles from "./project-state.module.css";

export function ProjectState({
  project,
  entities,
  edges,
  goals,
  tasks,
  onUpdated,
  onGraph,
}: {
  project: Entity;
  entities: Entity[];
  edges: Relationship[];
  goals: Goal[];
  tasks: Task[];
  onUpdated: () => Promise<unknown>;
  onGraph: (id: string) => void;
}) {
  const shown = projectSnapshot(project, edges, goals),
    rollup = projectTaskRollup(project.id, tasks);
  const [base, setBase] = useState({ project, snapshot: shown });
  const [editing, setEditing] = useState(false),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<ProjectChanges>({}),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState<string[]>([]);
  const lock = useRef(false),
    requestKey = useRef<string | null>(null);
  const names = Object.fromEntries([
    ...entities.map((e) => [e.id, e.name]),
    ...goals.map((g) => [g.id, g.title]),
  ]);
  const after = changedProject(base.snapshot, changes);
  const tone =
    shown.status === "completed"
      ? "complete"
      : shown.status === "blocked" ||
          ["at_risk", "off_track"].includes(shown.health ?? "")
        ? "risk"
        : shown.health === "on_track"
          ? "healthy"
          : "neutral";
  function edit(key: keyof ProjectChanges, value: unknown) {
    setChanges((v) => ({ ...v, [key]: value }));
    setReview(false);
    requestKey.current = null;
    setMessage("");
  }
  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("Checking permissions. Review approval when requested.");
    try {
      requestKey.current ??= crypto.randomUUID();
      const response = await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool: "update_project_status",
          input: {
            project_id: base.project.id,
            expected_updated_at: base.project.updated_at,
            before: base.snapshot,
            changes: projectChangesSchema.parse(changes),
          },
          reason: "Owner reviewed project changes in Entities",
          request_key: requestKey.current,
        }),
      });
      const result = await response.json();
      setSaved(result.result.changed_fields);
      setEditing(false);
      setMessage(`Project saved · action ${result.action_id}`);
      await onUpdated().catch(() =>
        setMessage("Project saved. Refresh to load the latest state."),
      );
    } catch (e) {
      setMessage(
        `${(e as Error).message} Refresh the project before a fresh proposal after a recorded failure.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.project}
      data-tone={tone}
      aria-label={`${project.name} project state`}
      aria-busy={busy}
    >
      <div className={styles.state}>
        {(["status", "priority", "health"] as const).map((key) => (
          <span
            className={saved.includes(key) ? styles.saved : undefined}
            key={`${key}:${shown[key]}`}
          >
            {key}:{" "}
            {key === "priority"
              ? (["low", "normal", "high", "urgent"][shown.priority ?? -1] ??
                "not set")
              : (shown[key]?.toString().replaceAll("_", " ") ?? "not set")}
          </span>
        ))}
      </div>
      <p>
        {rollup.total
          ? `${rollup.completed} of ${rollup.total} tasks completed · ${rollup.in_progress} in progress · ${rollup.pending} pending · ${rollup.cancelled} cancelled`
          : "No linked tasks yet."}
      </p>
      <p
        className={`${styles.notes} ${saved.includes("notes") ? styles.saved : ""}`}
        key={shown.notes}
      >
        {shown.notes || "No project notes yet."}
      </p>
      <details>
        <summary>
          {shown.blocker_entity_ids.length} recorded blockers ·{" "}
          {shown.goal_ids.length} directly linked goals
        </summary>
        <div className={styles.links}>
          {shown.blocker_entity_ids.map((id) => (
            <button key={id} onClick={() => onGraph(id)}>
              Blocker · {names[id]} ↗
            </button>
          ))}
          {goals
            .filter((g) => shown.goal_ids.includes(g.id))
            .map((g) => (
              <span key={g.id}>
                {g.title} · {g.status} · {Math.round(g.progress * 100)}%
              </span>
            ))}
          {goals
            .filter(
              (g) =>
                !shown.goal_ids.includes(g.id) &&
                tasks.some(
                  (t) => t.entity_id === project.id && t.goal_id === g.id,
                ),
            )
            .map((g) => (
              <span key={g.id}>{g.title} · via linked task (read only)</span>
            ))}
        </div>
      </details>
      <button onClick={() => onGraph(project.id)}>
        Explore project connections ↗
      </button>
      {!editing && (
        <button
          onClick={() => {
            setBase({ project, snapshot: shown });
            setChanges({});
            setEditing(true);
            setReview(false);
            setMessage("");
            requestKey.current = null;
          }}
        >
          Edit project
        </button>
      )}
      {editing && (
        <>
          <fieldset disabled={busy} className={styles.editor}>
            <label>
              Project status
              <select
                value={after.status ?? ""}
                onChange={(e) => edit("status", e.target.value)}
              >
                <option value="" disabled>
                  Not set
                </option>
                {projectStatuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Project priority
              <select
                value={after.priority ?? ""}
                onChange={(e) =>
                  edit(
                    "priority",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              >
                <option value="">Not set</option>
                {["Low", "Normal", "High", "Urgent"].map((s, i) => (
                  <option key={s} value={i}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project health
              <select
                value={after.health ?? ""}
                onChange={(e) => edit("health", e.target.value)}
              >
                <option value="" disabled>
                  Not set
                </option>
                {projectHealth.map((s) => (
                  <option value={s} key={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project notes
              <textarea
                value={after.notes}
                maxLength={10000}
                onChange={(e) => edit("notes", e.target.value)}
              />
            </label>
            <label>
              Blocker entities
              <select
                multiple
                value={after.blocker_entity_ids}
                onChange={(e) =>
                  edit(
                    "blocker_entity_ids",
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  )
                }
              >
                {entities
                  .filter((e) => e.id !== project.id)
                  .map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Linked goals
              <select
                multiple
                value={after.goal_ids}
                onChange={(e) =>
                  edit(
                    "goal_ids",
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  )
                }
              >
                {goals
                  .filter((g) => !g.entity_id || g.entity_id === project.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
              </select>
            </label>
            <small>
              Use Command/Ctrl to select multiple links. Goals assigned
              elsewhere cannot be moved here.
            </small>
          </fieldset>
          {review ? (
            <>
              <ProjectChangeReview
                before={base.snapshot}
                after={after}
                names={names}
              />
              <button disabled={busy} onClick={() => void submit()}>
                Request project update
              </button>
            </>
          ) : (
            <button
              disabled={
                busy ||
                !projectChangesSchema.safeParse(changes).success ||
                !projectDifferences(base.snapshot, after).length
              }
              onClick={() => {
                setChanges(projectChangesSchema.parse(changes));
                setReview(true);
              }}
            >
              Review project changes
            </button>
          )}
          <button disabled={busy} onClick={() => setEditing(false)}>
            Cancel project edit
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void onUpdated()
                .then(() => {
                  setEditing(false);
                  setMessage(
                    "Refreshed. Open Edit project for a fresh review.",
                  );
                })
                .catch((e) => setMessage(e.message))
            }
          >
            Refresh project
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
