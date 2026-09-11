"use client";
import { useState, useRef } from "react";
import { TaskProgress, TaskReceipt, type TaskPhase } from "./task-experience";
import styles from "./task-experience.module.css";
import { api } from "./api";
import type { Json, Task } from "../domain/models";

export function TaskProposal({
  proposal,
  tasks,
  onCreated,
}: {
  proposal: unknown;
  tasks: Task[];
  onCreated?: () => Promise<unknown>;
}) {
  const value = proposal as {
    action_id: string;
    request: Json;
    project_name: string;
  };
  const committed = tasks.find(
    (task) =>
      task.metadata.source_message_id === value.request.source_message_id,
  );
  const inFlight = useRef(false);
  const [phase, setPhase] = useState<TaskPhase>("review");
  const [receipt, setReceipt] = useState<{
    title: string;
    taskId: string;
  } | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function review(approved: boolean) {
    if (inFlight.current || committed || done) return;
    inFlight.current = true;
    setPhase(reviewed ? "executing" : "approving");
    setBusy(true);
    setMessage("");
    try {
      if (!reviewed)
        await api(`permissions/attempts/${value.action_id}/review`, {
          method: "POST",
          body: JSON.stringify({
            decision: approved ? "approved" : "rejected",
            reason: approved
              ? "Owner approved this real task proposal in Chat."
              : "Owner rejected this task proposal in Chat.",
          }),
        });
      setReviewed(true);
      if (approved) {
        setPhase("executing");
        const response = await api("actions/request", {
          method: "POST",
          body: JSON.stringify(value.request),
        });
        const created = await response.json();
        setReceipt({
          title: created.result.title,
          taskId: created.result.task_id,
        });
        setPhase("succeeded");
        setDone(true);
        void onCreated?.().catch(() => {});
        setMessage("View it in Activity or ask what task I just created.");
      } else {
        setPhase("rejected");
        setMessage("Rejected. No task was created.");
      }
      setDone(true);
    } catch (e) {
      setPhase("error");
      setMessage((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Real task approval"
      className={styles.surface}
      data-active={busy}
    >
      <span className={styles.eyebrow}>
        Internal action · {value.project_name}
      </span>
      <h4>{String((value.request.input as Json).title)}</h4>
      <p>
        {committed || receipt
          ? "Saved to your workspace with its source and approval evidence."
          : "Real task · Review the details before Ary saves it to your workspace."}
      </p>
      <TaskProgress phase={committed ? "succeeded" : phase} />
      <details>
        <summary>Review exact inputs and source</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {JSON.stringify(value.request, null, 2)}
        </pre>
      </details>
      {!done && !committed && (
        <div className={styles.controls}>
          {!reviewed && (
            <button disabled={busy} onClick={() => void review(false)}>
              Reject task
            </button>
          )}
          <button
            disabled={busy}
            className={styles.approve}
            onClick={() => void review(true)}
          >
            {busy
              ? "Working…"
              : reviewed
                ? "Retry same approved request"
                : "Approve and create task"}
          </button>
        </div>
      )}
      {(committed || receipt) && (
        <TaskReceipt
          title={committed?.title ?? receipt!.title}
          taskId={committed?.id ?? receipt!.taskId}
          project={value.project_name}
          actionId={committed?.metadata.action_id as string | undefined}
        />
      )}
      {message && (
        <p role={phase === "error" ? "alert" : undefined}>{message}</p>
      )}
      {reviewed && !done && !busy && (
        <p>
          For a recorded failure, use Approvals to submit a fresh request and
          approval. A retry here only recovers this exact execution.
        </p>
      )}
    </section>
  );
}
