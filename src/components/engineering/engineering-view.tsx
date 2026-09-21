"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DevelopmentRun,
  CommandReceipt,
} from "../../domain/self-development";
import { protectedPath } from "../../domain/self-development";
import { api } from "../api";
import { NexusState, NexusSurface } from "../nexus/primitives";
import { EmergencyControl } from "../emergency-control";
import styles from "./engineering.module.css";

type Item = {
  run: DevelopmentRun;
  mission: { id: string; revision: number; state: string } | null;
  snapshot: { candidate: string; diff: string; files: string[] } | null;
  commands: { command: string; status: string; result?: CommandReceipt }[];
  warning: string;
  actions: {
    id: string;
    tool: string;
    status: string;
    at: string;
    error: string | null;
    pending: boolean;
    approval?: string | null;
  }[];
};
type Snapshot = { enabled: boolean; items: Item[]; observed_at: string };
const stages = [
  "Observer",
  "Architect",
  "Owner approval",
  "Dev",
  "Test",
  "Security Review",
  "Release Candidate",
  "Owner merge decision",
];
const phaseStage: Record<string, number> = {
  OBSERVATION: 0,
  PROPOSAL: 1,
  ARCHITECTURE_PLAN: 2,
  APPROVED: 3,
  WORKSPACE: 3,
  IMPLEMENTATION: 4,
  TEST: 5,
  REVIEW: 6,
  RELEASE_CANDIDATE: 7,
  COMPLETED: 7,
  REJECTED: 7,
};
const show = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
export function EngineeringView() {
  const [data, setData] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState("");
  const keys = useRef(new Map<string, string>()),
    active = useRef(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (active.current) return;
      active.current = true;
      try {
        const value = await (
          await api(`engineering${selected ? `?run_id=${selected}` : ""}`, {
            method: "POST",
            body: "{}",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
              : AbortSignal.timeout(10000),
          })
        ).json();
        if (!signal?.aborted) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (!signal?.aborted) setError((e as Error).message);
      } finally {
        active.current = false;
      }
    },
    [selected],
  );
  useEffect(() => {
    const c = new AbortController();
    void refresh(c.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(c.signal);
    }, 3000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  const item = data?.items.find((i) => i.run.id === selected),
    run = item?.run;
  async function send(
    tool: string,
    input: unknown,
    override?: Record<string, unknown>,
  ) {
    const signature = JSON.stringify({ tool, input });
    if (!keys.current.has(signature))
      keys.current.set(signature, crypto.randomUUID());
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await api("actions/request", {
        method: "POST",
        body: JSON.stringify(
          override ?? {
            tool,
            input,
            reason:
              reason.trim() ||
              "Owner engineering review of exact scope and evidence",
            request_key: keys.current.get(signature),
            conversation_id: run?.conversation_id,
          },
        ),
      });
      setNotice("Decision recorded. No code was merged.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const terminal =
    !!run &&
    (["COMPLETED", "REJECTED"].includes(run.phase) ||
      ["CANCELLED", "FAILED"].includes(item?.mission?.state ?? ""));
  const currentStage = run
    ? (phaseStage[
        run.phase === "REJECTED"
          ? ([...run.history].reverse().find((h) => h.phase !== "REJECTED")
              ?.phase ?? "OBSERVATION")
          : run.phase
      ] ?? 0)
    : 0;
  const releaseReady = !!(
    run?.release &&
    run.review?.ready &&
    run.validation?.passed &&
    item?.snapshot?.candidate === run.review.candidate &&
    !item.warning
  );
  const commandResults = item?.commands.length
    ? item.commands
    : (run?.validation?.commands.map((result) => ({
        command: result.command,
        status: "done",
        result,
      })) ?? []);
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <small>SYSTEM / SUPERVISED ENGINEERING</small>
          <h1>Self Development</h1>
          <p>Evidence → isolated change → owner decision.</p>
        </div>
        <div>
          <a href="/">Back to Nexus</a>
          <EmergencyControl />
        </div>
      </header>
      {error && (
        <NexusState
          title="Engineering needs attention"
          error
          action={<button onClick={() => void refresh()}>Retry refresh</button>}
        >
          {error}
        </NexusState>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <NexusState title="Loading engineering evidence" />}
      {data && !data.enabled && (
        <NexusState title="Self-development is disabled">
          Enable the existing supervised-development configuration on the
          authorized Mac. No execution authority is granted by this screen.
        </NexusState>
      )}
      {data?.enabled && (
        <div className={styles.workspace}>
          <aside aria-label="Development runs">
            <h2>Development runs</h2>
            <p>{data.items.length} recent runs · up to 50</p>
            {!data.items.length && (
              <NexusState title="No development runs">
                Evidence-backed proposals will appear here. No demo activity is
                generated.
              </NexusState>
            )}
            {data.items.map((i) => (
              <button
                key={i.run.id}
                aria-pressed={selected === i.run.id}
                onClick={() => {
                  setSelected(i.run.id);
                  setReason("");
                  setNotice("");
                }}
              >
                <strong>{i.run.observation}</strong>
                <span>
                  {i.mission?.state ?? i.run.phase} ·{" "}
                  {i.run.history.at(-1)?.role ?? "Observer"}
                </span>
                <small>
                  {i.run.plan?.paths.some(protectedPath)
                    ? "Elevated / protected scope"
                    : "Standard bounded scope"}
                </small>
              </button>
            ))}
          </aside>
          <main>
            {!run || !item ? (
              <NexusState title="Select a development run">
                Inspect its evidence, scope and review before deciding.
              </NexusState>
            ) : (
              <>
                <div className={styles.header}>
                  <div>
                    <h2>{run.observation}</h2>
                    <p>
                      {item.mission?.state ?? run.phase} · {run.phase} ·{" "}
                      {run.history.at(-1)?.role ?? "Observer"}
                    </p>
                    <small>
                      Observed {data.observed_at} · Run {run.id}
                    </small>
                  </div>
                  <button
                    className={styles.stop}
                    disabled={!item.mission || terminal}
                    onClick={() =>
                      void send("mission.control", {
                        mission_id: item.mission!.id,
                        revision: item.mission!.revision,
                        command: "cancel",
                      })
                    }
                  >
                    STOP run
                  </button>
                </div>
                <p>
                  Stop requests cancel this mission; in-flight work may take
                  time to stop. STOP CONTROL above applies the existing global
                  emergency stop.
                </p>
                <ol
                  className={styles.pipeline}
                  aria-label="Development pipeline"
                >
                  {stages.map((stage, index) => (
                    <li
                      key={stage}
                      aria-current={index === currentStage ? "step" : undefined}
                      data-complete={index < currentStage}
                    >
                      {stage}
                    </li>
                  ))}
                </ol>
                {item.warning && <p role="alert">{item.warning}</p>}
                <NexusSurface label="Proposal">
                  <h3>Proposal</h3>
                  <p>{run.proposal ?? "Proposal not recorded"}</p>
                  <dl>
                    <dt>Origin / why it matters</dt>
                    <dd>{run.observation}</dd>
                    <dt>Expected measurable result</dt>
                    <dd>
                      {run.plan?.acceptance.join(" · ") ?? "Not recorded"}
                    </dd>
                    <dt>Risk</dt>
                    <dd>{run.plan?.risks.join(" · ") ?? "Not assessed"}</dd>
                    <dt>Estimated work</dt>
                    <dd>Not recorded</dd>
                  </dl>
                  <details>
                    <summary>Source evidence ({run.evidence.length})</summary>
                    {run.evidence.map((e) => (
                      <div key={e.id}>
                        <p>
                          {e.table} · {e.id} · {e.hash}
                        </p>
                        <pre>{show(e.snapshot)}</pre>
                      </div>
                    ))}
                  </details>
                </NexusSurface>
                <NexusSurface label="Plan review">
                  <h3>Plan review</h3>
                  <dl>
                    <dt>Implementation / acceptance</dt>
                    <dd>
                      {run.plan?.acceptance.join(" · ") ??
                        "Awaiting architecture plan"}
                    </dd>
                    <dt>Allowed files / affected systems</dt>
                    <dd>
                      {run.plan?.paths.map((p) => (
                        <div key={p}>
                          <code>{p}</code>
                          {protectedPath(p) &&
                            " — protected; ADMIN approval required"}
                        </div>
                      )) ?? "Not recorded"}
                    </dd>
                    <dt>Expected focused tests</dt>
                    <dd>
                      {run.plan?.focused_tests.join(", ") ?? "Not recorded"}
                    </dd>
                    <dt>Scope fingerprint</dt>
                    <dd>
                      <code>{run.plan_hash ?? "Not recorded"}</code>
                    </dd>
                    <dt>Rollback</dt>
                    <dd>{run.plan?.rollback ?? "Not recorded"}</dd>
                  </dl>
                  {run.phase === "ARCHITECTURE_PLAN" && !terminal && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void send(
                          run.plan?.paths.some(protectedPath)
                            ? "development.build_protected"
                            : "development.build",
                          { run_id: run.id, plan_hash: run.plan_hash },
                        )
                      }
                    >
                      Approve plan scope
                    </button>
                  )}
                  {item.mission &&
                    ["DRAFT", "READY"].includes(item.mission.state) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void send("mission.control", {
                            mission_id: item.mission!.id,
                            revision: item.mission!.revision,
                            command:
                              item.mission!.state === "DRAFT"
                                ? "plan"
                                : "start",
                          })
                        }
                      >
                        {item.mission.state === "DRAFT"
                          ? "Prepare mission"
                          : "Start approved mission"}
                      </button>
                    )}
                </NexusSurface>
                {item.mission && !terminal && (
                  <div aria-label="Mission controls">
                    {["PAUSED", "APPROVAL_REQUIRED"].includes(
                      item.mission.state,
                    ) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void send("mission.control", {
                            mission_id: item.mission!.id,
                            revision: item.mission!.revision,
                            command: "resume",
                          })
                        }
                      >
                        Resume mission
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void send("mission.tick", {
                          mission_id: item.mission!.id,
                        })
                      }
                    >
                      Advance approved mission
                    </button>
                    <p>
                      Advances the existing mission checkpoint. Every
                      development step retains its own approvals and lease; this
                      does not approve a step.
                    </p>
                  </div>
                )}
                <NexusSurface label="Development activity">
                  <h3>Development</h3>
                  <dl>
                    <dt>Branch / worktree</dt>
                    <dd>
                      {run.workspace?.branch ?? "Not created"}
                      <br />
                      {run.workspace
                        ? `~/.ary-development/workspaces/${run.id}/worktree`
                        : ""}
                    </dd>
                    <dt>Base commit SHA</dt>
                    <dd>
                      {run.workspace?.base ??
                        run.plan?.base_commit ??
                        "Not recorded"}
                    </dd>
                    <dt>Implementation commit SHA</dt>
                    <dd>
                      Not created by this workflow; candidate is an uncommitted
                      isolated diff.
                    </dd>
                    <dt>Recorded transition span</dt>
                    <dd>
                      {run.history[0]
                        ? `${Math.max(0, Math.round((Date.parse(run.history.at(-1)!.at) - Date.parse(run.history[0].at)) / 1000))}s to last recorded transition`
                        : "Not recorded"}
                    </dd>
                    <dt>Recorded review model cost</dt>
                    <dd>
                      {run.review?.metrics.estimated_cost_usd == null
                        ? "Not recorded"
                        : `$${run.review.metrics.estimated_cost_usd.toFixed(6)} (review only)`}
                    </dd>
                    <dt>Current command</dt>
                    <dd>
                      {item.commands.find((c) => c.status === "started")
                        ?.command ?? "None observed"}
                    </dd>
                    <dt>Files changed</dt>
                    <dd>
                      {item.snapshot?.files.join(", ") ??
                        "Live snapshot unavailable"}
                    </dd>
                  </dl>
                  <details>
                    <summary>Role transitions / durable activity</summary>
                    {run.history.map((h, i) => (
                      <p key={i}>
                        {h.at} · {h.role} · {h.phase} · action {h.action_id}
                      </p>
                    ))}
                  </details>
                  <h4>Approvals & action receipts</h4>
                  {item.actions.map((a) => (
                    <div key={a.id}>
                      <p>
                        {a.tool} · {a.status} · {a.at}
                        {a.approval && ` · approval ${a.approval}`}
                        {a.error && ` · ${a.error}`}
                      </p>
                      {a.pending && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            window.dispatchEvent(
                              new CustomEvent("ary:approval", {
                                detail: {
                                  actionId: a.id,
                                  tool: a.tool,
                                  respond: (approved: boolean) => {
                                    setNotice(
                                      approved
                                        ? "Approval recorded. Resume and advance the mission to execute under its lease."
                                        : "Approval rejected. No execution requested.",
                                    );
                                    void refresh();
                                  },
                                },
                              }),
                            );
                          }}
                        >
                          Review {a.tool}
                        </button>
                      )}
                    </div>
                  ))}
                </NexusSurface>
                <NexusSurface label="Test and security review">
                  <h3>Test + Security Review</h3>
                  {["focused", "test", "typecheck", "build", "format"].map(
                    (name) => {
                      const c = commandResults.find((c) => c.command === name);
                      return (
                        <details key={name}>
                          <summary>
                            {name}:{" "}
                            {c
                              ? c.status === "started"
                                ? "running"
                                : c.result?.exit_code === 0 &&
                                    !c.result.signal &&
                                    !c.result.truncated
                                  ? "passed"
                                  : "failed / incomplete"
                              : "not run"}
                          </summary>
                          <pre>{c ? show(c) : "No command evidence"}</pre>
                        </details>
                      );
                    },
                  )}
                  <h4>Security findings</h4>
                  {run.review ? (
                    Object.entries(run.review.result.checks).map(
                      ([name, result]) => (
                        <p key={name}>
                          {name}: {result.verdict} — {result.reason}
                        </p>
                      ),
                    )
                  ) : (
                    <p>Independent security review not recorded.</p>
                  )}
                  <p>
                    Scope findings:{" "}
                    {item.warning ||
                      (item.snapshot
                        ? "Current snapshot passed scope inspection"
                        : "Not currently verified")}
                  </p>
                </NexusSurface>
                <NexusSurface label="Release candidate">
                  <h3>
                    Release candidate · {releaseReady ? "READY" : "NOT READY"}
                  </h3>
                  <p>
                    Approval records merge intent only. This backend has no
                    merge capability.
                  </p>
                  <p>
                    {run.review?.result.summary ?? "No reviewed change summary"}
                  </p>
                  <details>
                    <summary>Exact release package / tests / rollback</summary>
                    <pre>
                      {run.release
                        ? show(run.release.manifest)
                        : "No release package"}
                    </pre>
                  </details>
                  <details>
                    <summary>Current Git diff</summary>
                    <pre>
                      {item.snapshot?.diff ??
                        "Unavailable — inspect the workspace warning"}
                    </pre>
                  </details>
                  {run.phase === "RELEASE_CANDIDATE" &&
                    !terminal &&
                    !run.decision && (
                      <>
                        <button
                          disabled={
                            busy || !releaseReady || reason.trim().length < 5
                          }
                          onClick={() =>
                            void send("development.decide", {
                              run_id: run.id,
                              release_hash: run.release?.hash,
                              accept: true,
                              reason,
                            })
                          }
                        >
                          Approve release intent — no merge
                        </button>
                        <button
                          disabled={busy || reason.trim().length < 5}
                          onClick={() =>
                            void send("development.decide", {
                              run_id: run.id,
                              release_hash: run.release?.hash,
                              accept: false,
                              reason,
                            })
                          }
                        >
                          Reject release
                        </button>
                      </>
                    )}
                  {run.decision && item.mission && !terminal && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        const key = `submission:${run.id}:${run.decision!.release_hash}`;
                        if (!keys.current.has(key))
                          keys.current.set(key, crypto.randomUUID());
                        void send("mission.submit", {
                          mission_id: item.mission!.id,
                          submission: {
                            id: keys.current.get(key),
                            name: "owner_decision",
                            payload: {
                              release_hash: run.decision!.release_hash,
                            },
                          },
                        });
                      }}
                    >
                      Submit recorded decision to mission
                    </button>
                  )}
                  {run.decision && (
                    <p>
                      Owner decision:{" "}
                      {run.decision.accept ? "accepted intent" : "rejected"} —{" "}
                      {run.decision.reason}. Not merged.
                    </p>
                  )}
                </NexusSurface>
                {!terminal && (
                  <NexusSurface label="Owner feedback">
                    <h3>Owner feedback</h3>
                    <label htmlFor="engineering-reason">
                      Decision / revision reason (at least 5 characters)
                    </label>
                    <textarea
                      id="engineering-reason"
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button
                      disabled={busy || reason.trim().length < 5}
                      onClick={() =>
                        void send("development.feedback", {
                          run_id: run.id,
                          revision: run.revision,
                          decision: "revision",
                          reason,
                        })
                      }
                    >
                      Request revision
                    </button>
                    <button
                      disabled={busy || reason.trim().length < 5}
                      onClick={() =>
                        void send("development.feedback", {
                          run_id: run.id,
                          revision: run.revision,
                          decision: "reject",
                          reason,
                        })
                      }
                    >
                      Reject run
                    </button>
                    <p>
                      Revision requests pause an existing mission and record
                      feedback. They do not expand approved scope or
                      automatically implement a new plan.
                    </p>
                  </NexusSurface>
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
