"use client";
import { useState } from "react";
import type { ExecutionPlan } from "../../domain/orchestration";
import type { Json } from "../../domain/models";
export function MissionControls({
  plan,
  busy,
  submit,
}: {
  plan: ExecutionPlan;
  busy: boolean;
  submit: (tool: string, input: Json) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [payload, setPayload] = useState("{}"),
    [error, setError] = useState("");
  const m = plan.mission!;
  const control = (command: string) =>
    submit("mission.control", {
      mission_id: plan.id,
      revision: plan.revision,
      command,
    });
  const closed = ["COMPLETED", "CANCELLED"].includes(m.state);
  return (
    <section aria-label="Durable mission controls">
      <p role="status">
        <strong>{m.state.replaceAll("_", " ")}</strong> · {m.engine} ·
        checkpoint {plan.revision}
      </p>
      <p>
        {m.reason ??
          "Progress survives the browser and worker restarting. Tool approvals remain independent of mission start."}
      </p>
      <p>
        {m.wake_at
          ? `Next eligible checkpoint: ${new Date(m.wake_at).toLocaleString()}`
          : "No scheduled dispatch."}{" "}
        A configured mission worker processes eligible checkpoints; Process
        checkpoint can run one manually.
      </p>
      <div>
        <button
          disabled={busy || m.state !== "DRAFT"}
          onClick={() => void control("plan")}
        >
          Plan mission
        </button>
        <button
          disabled={
            busy ||
            !["READY", "PAUSED", "WAITING", "APPROVAL_REQUIRED"].includes(
              m.state,
            )
          }
          onClick={() => void control(m.state === "READY" ? "start" : "resume")}
        >
          Start / resume mission
        </button>
        <button disabled={closed} onClick={() => void control("pause")}>
          Pause mission
        </button>
        <button disabled={closed} onClick={() => void control("cancel")}>
          Cancel mission
        </button>
        <button
          disabled={busy || closed}
          onClick={() => void control("checkpoint")}
        >
          Save checkpoint
        </button>
        <button
          disabled={busy || closed}
          onClick={() => void submit("mission.tick", { mission_id: plan.id })}
        >
          Process checkpoint
        </button>
        <button
          disabled={busy || m.state !== "FAILED"}
          onClick={() => void control("retry")}
        >
          Prepare reviewed retry
        </button>
      </div>
      {plan.spec.steps.some((s) => s.wait_for) && (
        <details>
          <summary>Submit external event / evidence</summary>
          <p>
            Accepts only a declared wait name. This never grants action
            approval.
          </p>
          <select
            aria-label="Mission event name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          >
            <option value="">Select declared event</option>
            {[
              ...new Set(
                plan.spec.steps.flatMap((s) =>
                  s.wait_for ? [s.wait_for.name] : [],
                ),
              ),
            ].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <textarea
            aria-label="Mission submission JSON"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            maxLength={4096}
          />
          <button
            disabled={busy || closed || !name}
            onClick={() => {
              try {
                const parsed = JSON.parse(payload);
                setError("");
                void submit("mission.submit", {
                  mission_id: plan.id,
                  submission: {
                    id: crypto.randomUUID(),
                    name,
                    payload: parsed,
                  },
                });
              } catch {
                setError("Enter a valid JSON object.");
              }
            }}
          >
            Submit evidence
          </button>
          {error && <p role="alert">{error}</p>}
          <p>
            {m.submissions.length} accepted submissions. Payloads stay in the
            owner-scoped checkpoint, not ambient events.
          </p>
        </details>
      )}
    </section>
  );
}
