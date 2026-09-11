"use client";
import { PermissionBrief } from "./permission-brief";
import styles from "./permission-engine.module.css";
import { presenceStore } from "./presence/store";
import { CallReview } from "./calls/call-review";
import { FinanceImportReview } from "./finance/finance-review";
import { MailReview, MailEvidenceReview } from "./gmail/mail-review";
import { CalendarReview } from "./calendar/calendar-review";
import { projectUpdateInput, changedProject } from "../domain/project-actions";
import { ProjectChangeReview } from "./project-change-review";
import { taskUpdateInput, changedTask } from "../domain/task-actions";
import { TaskChangeReview } from "./task-change-review";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Action } from "../domain/models";
export interface ApprovalPrompt {
  actionId: string;
  tool: string;
  signal?: AbortSignal | null;
  respond: (approved: boolean) => void;
}
export function ApprovalDialog() {
  const [prompt, setPrompt] = useState<ApprovalPrompt | null>(null),
    [action, setAction] = useState<Action | null>(null),
    [error, setError] = useState("");
  const current = useRef<ApprovalPrompt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    function receive(event: Event) {
      const next = (event as CustomEvent<ApprovalPrompt>).detail;
      if (current.current) {
        next.respond(false);
        return;
      }
      current.current = next;
      setPrompt(next);
      setAction(null);
      setError("");
      setSaving(false);
      void api(`permissions/attempts/${next.actionId}`)
        .then((r) => r.json())
        .then((action) => {
          if (current.current === next) setAction(action);
        })
        .catch((e) => {
          if (current.current === next) setError(e.message);
        });
    }
    window.addEventListener("ary:approval", receive);
    return () => {
      window.removeEventListener("ary:approval", receive);
      current.current?.respond(false);
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("ary:approval-state", { detail: !!prompt }),
    );
    if (prompt) {
      previousFocus.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
      heading.current?.focus();
      const abort = () => {
        if (current.current === prompt) finish(false);
      };
      prompt.signal?.addEventListener("abort", abort, { once: true });
      if (prompt.signal?.aborted) abort();
      return () => prompt.signal?.removeEventListener("abort", abort);
    } else if (dialog.current?.open) {
      dialog.current.close();
      previousFocus.current?.focus({ preventScroll: true });
    }
  }, [prompt]);
  useEffect(() => {
    if (!action || action.status !== "approval_required") return;
    const key = `approval:${action.id}`;
    presenceStore.set(key, {
      operation: action.id,
      state: "approval",
      label: `${action.tool_name}: awaiting your approval`,
    });
    return () => presenceStore.clear(key);
  }, [action]);
  function finish(approved: boolean) {
    current.current?.respond(approved);
    current.current = null;
    setPrompt(null);
    setAction(null);
  }
  async function review(approved: boolean) {
    if (!prompt) return;
    const reviewedPrompt = prompt;
    setSaving(true);
    try {
      await api(`permissions/attempts/${prompt.actionId}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision: approved ? "approved" : "rejected",
          reason: approved
            ? "User approved this exact action in the confirmation dialog."
            : "User rejected this action in the confirmation dialog.",
        }),
      });
      if (current.current === reviewedPrompt) finish(approved);
    } catch (e) {
      if (current.current === reviewedPrompt) setError((e as Error).message);
    } finally {
      if (!current.current || current.current === reviewedPrompt)
        setSaving(false);
    }
  }
  return (
    <dialog
      aria-labelledby="ary-approval-title"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) void review(false);
      }}
      className={styles.dialog}
    >
      <h2 ref={heading} tabIndex={-1} id="ary-approval-title">
        Review this action
      </h2>
      <p>
        <strong>{prompt?.tool}</strong> requires one-time approval.
      </p>
      <p>
        Approval is for this exact request, expires in 10 minutes, and can be
        used once. The current permission policy is checked again before
        execution.
      </p>
      {action && <PermissionBrief action={action} />}
      {action?.tool_name === "update_project_status" &&
        (() => {
          const parsed = projectUpdateInput.safeParse(
            (action.input.action_request as { input?: unknown } | undefined)
              ?.input,
          );
          return parsed.success ? (
            <ProjectChangeReview
              before={parsed.data.before}
              after={changedProject(parsed.data.before, parsed.data.changes)}
            />
          ) : null;
        })()}
      {action?.tool_name === "phone.initiate" && (
        <CallReview
          input={
            (action.metadata.request_envelope as { input?: unknown })?.input
          }
        />
      )}
      {action?.tool_name === "finance.import" && (
        <FinanceImportReview
          input={(action.input.action_request as { input?: unknown })?.input}
        />
      )}
      {action?.tool_name === "gmail.send" && (
        <MailReview
          input={(action.input.action_request as { input?: unknown })?.input}
        />
      )}
      {action?.tool_name === "gmail.evidence" && (
        <MailEvidenceReview
          input={(action.input.action_request as { input?: unknown })?.input}
        />
      )}
      {action?.tool_name.startsWith("google_calendar.") && (
        <CalendarReview
          input={(action.input.action_request as { input?: unknown })?.input}
        />
      )}
      {action?.tool_name === "update_task" &&
        (() => {
          const parsed = taskUpdateInput.safeParse(
            (action.input.action_request as { input?: unknown } | undefined)
              ?.input,
          );
          return parsed.success ? (
            <TaskChangeReview
              before={parsed.data.before}
              after={changedTask(parsed.data.before, parsed.data.changes)}
            />
          ) : null;
        })()}
      {action?.tool_name.startsWith("gmail.") ? (
        <details>
          <summary>Source and audit details</summary>
          <pre
            style={{
              maxHeight: 220,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 12,
            }}
          >
            {JSON.stringify(action.input, null, 2)}
          </pre>
        </details>
      ) : (
        action && (
          <pre
            style={{
              maxHeight: 220,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 12,
            }}
          >
            {JSON.stringify(action.input, null, 2)}
          </pre>
        )
      )}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button disabled={saving} onClick={() => void review(false)}>
          Reject
        </button>
        <button
          className="primary"
          disabled={saving || !action}
          onClick={() => void review(true)}
        >
          Approve once and continue
        </button>
      </div>
    </dialog>
  );
}
