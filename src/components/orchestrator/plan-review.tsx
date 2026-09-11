"use client";
import { useState } from "react";
import type { ExecutionPlan } from "../../domain/orchestration";
import type { Json } from "../../domain/models";
export function PlanReview({
  plan,
  busy,
  submit,
}: {
  plan: ExecutionPlan;
  busy: boolean;
  submit: (tool: string, input: Json) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<string[]>([]),
    [draft, setDraft] = useState(""),
    [reason, setReason] = useState("");
  const pending = plan.pending_approvals ?? [];
  const items = pending.filter((i) => chosen.includes(i.action_id));
  return (
    <>
      {!!pending.length && (
        <details open>
          <summary>Review exact pending actions</summary>
          <p>
            Select up to three related, non-high-risk actions. Each retains its
            own permission check and approval record. Approval does not execute
            them.
          </p>
          {pending.map((i) => (
            <label key={i.action_id} style={{ display: "block" }}>
              <input
                type="checkbox"
                disabled={busy}
                checked={chosen.includes(i.action_id)}
                onChange={(e) =>
                  setChosen((c) =>
                    e.target.checked
                      ? [...c, i.action_id]
                      : c.filter((id) => id !== i.action_id),
                  )
                }
              />
              {i.step_id} · {i.tool}
              <pre>{JSON.stringify(i.input, null, 2)}</pre>
            </label>
          ))}
          {(["approved", "rejected"] as const).map((decision) => (
            <button
              key={decision}
              disabled={busy || !items.length || items.length > 3}
              onClick={() =>
                void submit("orchestrator.review_steps", {
                  plan_id: plan.id,
                  revision: plan.revision,
                  items,
                  decision,
                  reason: `Owner ${decision} the displayed exact action inputs`,
                })
              }
            >
              {decision === "approved" ? "Approve" : "Reject"} selected actions
            </button>
          ))}
        </details>
      )}
      {!plan.mission && (
        <details>
          <summary>Revise this plan / supply missing information</summary>
          <p>
            Completed and uncertain effects retain their original evidence.
            Changes stay paused and require fresh authorization. Use an existing
            tool for a safe alternative, or skip an optional branch.
          </p>
          <button
            disabled={busy}
            onClick={() => setDraft(JSON.stringify(plan.spec, null, 2))}
          >
            Load current plan for revision
          </button>
          <label>
            Revised plan JSON
            <textarea
              aria-label="Revised plan JSON"
              value={draft}
              rows={10}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Why this revision
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            disabled={busy || !draft || reason.trim().length < 3}
            onClick={() =>
              void submit("orchestrator.replan", {
                plan_id: plan.id,
                revision: plan.revision,
                spec: draft,
                reason,
              })
            }
          >
            Save visible revision
          </button>
        </details>
      )}
      {!!plan.replan_history?.length && (
        <details>
          <summary>
            Plan revision evidence ({plan.replan_history.length})
          </summary>
          {plan.replan_history.map((r) => (
            <article key={r.revision}>
              <strong>
                Revision {r.revision}: {r.reason}
              </strong>
              <pre>
                {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
              </pre>
            </article>
          ))}
        </details>
      )}
    </>
  );
}
