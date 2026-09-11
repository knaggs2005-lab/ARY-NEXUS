"use client";
import { useState } from "react";
import { api } from "./api";
import {
  diagnosticObjective,
  type DelegatedJob,
  type WorkerHealth,
} from "../domain/agent-provider";
import styles from "./permissions.module.css";
type Snapshot = {
  health: WorkerHealth;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  lastSuccessfulRequest: string | null;
  mostRecentError: string | null;
  jobs: DelegatedJob[];
};
/** Dev-only mount and server endpoint. Credentials and endpoint never enter this component. */
export function HermesDiagnostics() {
  const [data, setData] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setData(await (await api("workers/hermes/diagnostics")).json());
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function request(tool: string, input: object) {
    await api("actions/request", {
      method: "POST",
      body: JSON.stringify({
        tool,
        input,
        reason:
          tool === "worker.submit"
            ? "Explicit harmless Hermes diagnostic. Share only this diagnostic instruction."
            : "Inspect or stop the selected delegated job",
        request_key: crypto.randomUUID(),
      }),
    });
    await load();
  }
  return (
    <details className={styles.card}>
      <summary>Hermes · subordinate cloud worker</summary>
      <p>
        Ary owns permissions, approvals and memory. Only explicitly selected
        context leaves Nexus.
      </p>
      <button disabled={busy} onClick={() => void perform(load)}>
        Check connection
      </button>{" "}
      <button
        disabled={busy}
        onClick={() =>
          void perform(() =>
            request("worker.submit", {
              provider: "hermes",
              agentRole: "diagnostic",
              objective: diagnosticObjective,
            }),
          )
        }
      >
        Test Hermes Worker
      </button>
      {busy && <p role="status">Checking the worker through Ary…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <dl>
            <dt>Connection</dt>
            <dd>
              {data.health.connected ? "Connected" : "Disconnected"} ·{" "}
              {data.health.status}
            </dd>
            <dt>Endpoint configured</dt>
            <dd>{data.health.endpointConfigured ? "Yes" : "No"}</dd>
            <dt>Credentials configured</dt>
            <dd>{data.health.credentialsConfigured ? "Yes" : "No"}</dd>
            <dt>Restricted worker confirmed</dt>
            <dd>{data.health.restrictedWorkerConfirmed ? "Yes" : "No"}</dd>
            <dt>Health latency</dt>
            <dd>
              {data.health.latencyMs === null
                ? "Not measured"
                : `${data.health.latencyMs} ms`}
            </dd>
            <dt>Jobs</dt>
            <dd>
              {data.activeJobs} active · {data.completedJobs} completed ·{" "}
              {data.failedJobs} failed/timed out
            </dd>
            <dt>Last successful job request</dt>
            <dd>{data.lastSuccessfulRequest ?? "None"}</dd>
            <dt>Most recent error</dt>
            <dd>{data.mostRecentError ?? "None"}</dd>
          </dl>
          <p>
            Refresh reconciles remote work. Cancelling requests a stop; it
            cannot undo effects. A worker response alone does not independently
            prove absence of remote side effects.
          </p>
          {data.jobs.map((job) => (
            <section key={job.id} className={styles.card}>
              <strong>
                {job.agentRole} · {job.status}
              </strong>
              <p>{job.objective}</p>
              <small>
                Job {job.id} · source action {job.sourceActionId}
              </small>
              <p>{job.result?.summary ?? "No result received"}</p>
              {job.result?.proposals.map((p, i) => (
                <p key={i}>Proposal: {p}</p>
              ))}
              {job.approvalActionId && (
                <p>
                  Review queued in Ary approvals: {job.approvalActionId}.
                  Acceptance does not execute a proposed action.
                </p>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    request("worker.refresh", { job_id: job.id }),
                  )
                }
              >
                Refresh job
              </button>{" "}
              <button
                disabled={
                  busy ||
                  !job.remoteId ||
                  ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)
                }
                onClick={() =>
                  void perform(() =>
                    request("worker.cancel", { job_id: job.id }),
                  )
                }
              >
                Request stop
              </button>
              {job.status === "QUEUED" && !job.remoteId && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      request("worker.recover", { job_id: job.id }),
                    )
                  }
                >
                  Recover original submission
                </button>
              )}
              <p>
                Meaningful completed results can be reviewed into episodic
                memory from Action History.
              </p>
            </section>
          ))}
        </>
      )}
    </details>
  );
}
