"use client";
import { useEffect, useRef, useState } from "react";
import { MissionControl } from "./mission-control";
import { MissionControls } from "./mission-controls";
import { PlanReview } from "./plan-review";
import {
  executionStatus,
  type ExecutionPlan,
} from "../../domain/orchestration";
import type { Json } from "../../domain/models";
import { api } from "../api";
import glass from "../gmail/gmail.module.css";
import styles from "./orchestrator.module.css";
export function OrchestratorPanel({
  initialMissionId,
}: { initialMissionId?: string } = {}) {
  const [plans, setPlans] = useState<ExecutionPlan[]>([]),
    [selected, setSelected] = useState(initialMissionId ?? ""),
    [goal, setGoal] = useState(""),
    [spec, setSpec] = useState(""),
    [missionId, setMissionId] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const working = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const halt = useRef(false),
    mounted = useRef(true);
  const plan = plans.find((p) => p.id === selected);
  async function reload() {
    const all = await (await api("orchestrator/plans")).json();
    if (
      selectedRef.current &&
      !all.some((p: ExecutionPlan) => p.id === selectedRef.current)
    ) {
      const detail = await (
        await api(`orchestrator/plans/${selectedRef.current}`)
      ).json();
      all.push(detail.plan);
    }
    if (mounted.current) setPlans(all);
    return all as ExecutionPlan[];
  }
  useEffect(() => {
    mounted.current = true;
    void reload().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void reload().catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      mounted.current = false;
      halt.current = true;
    };
  }, []);
  async function request(tool: string, input: Json, key = crypto.randomUUID()) {
    const response = await api("actions/request", {
      method: "POST",
      body: JSON.stringify({
        tool,
        input,
        request_key: key,
        reason: "Owner requested this reviewed execution plan operation",
      }),
    });
    return (await response.json()).result;
  }
  async function work(label: string, fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      working.current = false;
      if (mounted.current) {
        setBusy("");
        await reload().catch(() => {});
      }
    }
  }
  async function control(p: ExecutionPlan, command: string) {
    const result = (await request(
      "orchestrator.advance",
      { plan_id: p.id, revision: p.revision, command },
      `control:${p.id}:${p.revision}:${command}`,
    )) as ExecutionPlan;
    await reload();
    return result;
  }
  async function run(p: ExecutionPlan) {
    halt.current = false;
    let current = p;
    for (let n = 0; n < 26 && !halt.current && mounted.current; n++) {
      current = await control(current, n === 0 ? "resume" : "advance");
      if (current.status !== "active") break;
    }
    if (halt.current && mounted.current && current.status === "active")
      await control(current, "pause");
  }
  async function interrupt(command: "pause" | "cancel") {
    halt.current = true;
    try {
      const latest = (await reload()).find((p) => p.id === selected);
      if (latest) await control(latest, command);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function review(p: ExecutionPlan) {
    const step = p.spec.steps.find(
      (s) => p.states[s.id].status === "waiting_approval",
    );
    if (!step) return;
    const state = p.states[step.id];
    await new Promise<boolean>((respond) =>
      window.dispatchEvent(
        new CustomEvent("ary:approval", {
          detail: {
            actionId: state.approval_action_id,
            tool:
              state.phase === "verify" ? step.verification!.tool : step.tool,
            respond,
          },
        }),
      ),
    );
    await control(p, "advance");
  }
  return (
    <section className={glass.mail} aria-label="Ary execution plans">
      <span className={glass.eyebrow}>
        ARY / EXECUTION PLANS / REVIEWED EXECUTION
      </span>
      <h2>One goal. A visible path.</h2>
      <p>
        Plan first. Each tool keeps its own permissions and approvals. External
        receipts need explicit read-back evidence before dependent work
        continues.
      </p>
      <details open={!plan}>
        <summary>Create a mission</summary>
        <label>
          Goal
          <textarea
            value={goal}
            maxLength={2000}
            onChange={(e) => setGoal(e.target.value)}
            disabled={!!busy}
            placeholder="Get the studio ready, prepare interview selects, and reserve editing time…"
          />
        </label>
        <details>
          <summary>Advanced: reviewed structured plan</summary>
          <p>
            Optional JSON using the registered tool schemas. Missing IDs, dates,
            timezone or source files require clarification. Creating a revised
            plan preserves previous history.
          </p>
          <textarea
            aria-label="Structured plan JSON"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            disabled={!!busy}
            rows={8}
          />
        </details>
        <button
          disabled={!!busy || goal.trim().length < 3}
          onClick={() =>
            void work("Planning with shared context", async () => {
              const p = (await request("orchestrator.plan", {
                goal,
                ...(spec.trim() ? { spec: JSON.parse(spec) } : {}),
              })) as ExecutionPlan;
              setSelected(p.id);
            })
          }
        >
          Build execution plan
        </button>
        <button
          disabled={!!busy || goal.trim().length < 3}
          onClick={() =>
            void work("Saving durable objective", async () => {
              const p = (await request("mission.create", {
                goal,
                ...(spec.trim() ? { spec: JSON.parse(spec) } : {}),
              })) as ExecutionPlan;
              setSelected(p.id);
            })
          }
        >
          Save durable mission
        </button>
      </details>
      <details>
        <summary>Open a mission by ID</summary>
        <label>
          Mission ID
          <input
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
          />
        </label>
        <button
          disabled={!!busy || !missionId.trim()}
          onClick={() =>
            void work("Opening mission", async () => {
              const data = await (
                await api(
                  `orchestrator/plans/${encodeURIComponent(missionId.trim())}`,
                )
              ).json();
              setPlans((all) => [
                ...all.filter((p) => p.id !== data.plan.id),
                data.plan,
              ]);
              selectedRef.current = data.plan.id;
              setSelected(data.plan.id);
            })
          }
        >
          Open mission
        </button>
      </details>
      {busy && (
        <p role="status" className={styles.live}>
          {busy}{" "}
          <button
            onClick={() => {
              halt.current = true;
              setBusy("Pausing after the current request");
              void interrupt("pause");
            }}
          >
            Pause after current step
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <nav className={styles.history} aria-label="Saved plans">
        {plans.map((p) => (
          <button
            key={p.id}
            disabled={!!busy}
            aria-pressed={p.id === selected}
            onClick={() => setSelected(p.id)}
          >
            {p.spec.title} · {p.mission?.state ?? p.status}
          </button>
        ))}
      </nav>
      {plan && (
        <article>
          <h3>{plan.spec.title}</h3>
          <p>{plan.goal}</p>
          <p>
            Planner: {plan.model} · revision {plan.revision} · {plan.status}
          </p>
          {!!plan.spec.questions.length && (
            <aside>
              <strong>Clarification needed</strong>
              <ul>
                {plan.spec.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </aside>
          )}
          {plan.mission && (
            <MissionControls
              plan={plan}
              busy={!!busy}
              submit={(tool, input) =>
                work("Updating durable mission", async () => {
                  await request(tool, input);
                })
              }
            />
          )}
          <MissionControl
            key={`mission-control:${plan.id}`}
            plan={plan}
            busy={!!busy}
            onRefresh={reload}
          />
          <details>
            <summary>Detailed step list</summary>
            <ol className={styles.steps}>
              {plan.spec.steps.map((s) => {
                const state = plan.states[s.id];
                return (
                  <li
                    key={s.id}
                    className={styles.step}
                    data-state={state.status}
                  >
                    <header>
                      <strong>{s.title}</strong>
                      <span>
                        {(
                          plan.step_details?.[s.id]?.execution_status ??
                          executionStatus(plan, s)
                        ).replaceAll("_", " ")}
                        {state.phase === "verify" ? " · read-back" : ""}
                      </span>
                    </header>
                    <p>
                      {s.tool} ·{" "}
                      {s.critical ? "Critical" : "Independent failure allowed"}
                    </p>
                    <p>
                      {s.depends_on.length
                        ? `After verified: ${s.depends_on.join(" → ")}`
                        : "Ready without dependencies"}
                    </p>
                    {s.missing.length > 0 && (
                      <p>Missing: {s.missing.join("; ")}</p>
                    )}
                    {state.error && <p role="status">{state.error}</p>}
                    {plan.step_details?.[s.id]?.failure && (
                      <p>
                        {plan.step_details[s.id].failure!.kind.replaceAll(
                          "_",
                          " ",
                        )}
                        : {plan.step_details[s.id].failure!.next_action}
                      </p>
                    )}
                    <p>
                      {plan.step_details?.[s.id]?.risk_level} risk ·{" "}
                      {plan.step_details?.[s.id]?.approval_status?.replaceAll(
                        "_",
                        " ",
                      )}{" "}
                      · attempt {state.attempt + 1}
                      {plan.step_details?.[s.id]?.parallel_safe
                        ? " · independent observation"
                        : ""}
                    </p>
                    {state.evidence && <p>{state.evidence}</p>}
                    <details>
                      <summary>Inputs and verification</summary>
                      <pre>
                        {JSON.stringify(
                          {
                            input: s.input,
                            verification: s.verification,
                            permission:
                              plan.step_details?.[s.id]?.permission_requirement,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                    {["planned", "waiting_approval"].includes(state.status) &&
                      state.phase !== "verify" &&
                      !plan.mission && (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            void work("Skipping selected branch", async () => {
                              await request("orchestrator.advance", {
                                plan_id: plan.id,
                                revision: plan.revision,
                                command: "skip",
                                step_id: s.id,
                              });
                            })
                          }
                        >
                          Skip {s.title}
                        </button>
                      )}
                    {state.action_id && (
                      <p>
                        Execution action <code>{state.action_id}</code>
                      </p>
                    )}
                    {state.approval_action_id && (
                      <p>
                        Approval <code>{state.approval_action_id}</code>
                      </p>
                    )}
                    {state.verification_action_id && (
                      <p>
                        Observation <code>{state.verification_action_id}</code>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
          <PlanReview
            key={plan.id}
            plan={plan}
            busy={!!busy}
            submit={(tool, input) =>
              work("Saving reviewed decision", async () => {
                if (tool === "orchestrator.replan")
                  input = { ...input, spec: JSON.parse(String(input.spec)) };
                await request(tool, input);
              })
            }
          />
          {!plan.mission && (
            <div className={glass.toolbar}>
              <button
                disabled={
                  !!busy || ["stopped", "complete"].includes(plan.status)
                }
                onClick={() =>
                  void work("Executing reviewed plan", () => run(plan))
                }
              >
                Run / resume plan
              </button>
              <button
                disabled={
                  !!busy ||
                  !Object.values(plan.states).some(
                    (s) => s.status === "waiting_approval",
                  )
                }
                onClick={() =>
                  void work("Reviewing one exact step", () => review(plan))
                }
              >
                Review step approval
              </button>
              <button
                disabled={["complete", "stopped"].includes(plan.status)}
                onClick={() => void interrupt("pause")}
              >
                Pause plan
              </button>
              <button
                disabled={["complete", "stopped"].includes(plan.status)}
                onClick={() => void interrupt("cancel")}
              >
                Cancel remaining steps
              </button>
              <button
                disabled={
                  !!busy ||
                  !Object.values(plan.states).some((s) => s.status === "failed")
                }
                onClick={() =>
                  void work("Preparing safe retry", async () => {
                    await control(plan, "retry");
                  })
                }
              >
                Review safe retry
              </button>
              <button
                disabled={
                  !!busy ||
                  !Object.values(plan.states).some(
                    (s) => s.status === "running",
                  )
                }
                onClick={() =>
                  void work("Recovering recorded receipt", async () => {
                    await control(plan, "recover");
                  })
                }
              >
                Recover checkpoint
              </button>
            </div>
          )}
          <div className={styles.brief} aria-label="Execution summary">
            <h3>Execution brief</h3>
            <p>{plan.summary}</p>
            <p>
              Recorded tool results remain in Action history. Pausing stops
              future dispatch; it cannot undo an in-flight external effect.
            </p>
            <button
              disabled={
                !!busy ||
                Object.values(plan.states).some((s) =>
                  ["planned", "running", "waiting_approval"].includes(s.status),
                )
              }
              onClick={() =>
                void work("Reviewing outcome memory", async () => {
                  await request("orchestrator.remember", {
                    plan_id: plan.id,
                    revision: plan.revision,
                    summary: plan.summary,
                  });
                })
              }
            >
              Review and save outcome memory
            </button>
          </div>
          <details>
            <summary>Checkpoint history</summary>
            <ol>
              {plan.events.map((e, i) => (
                <li key={i}>
                  {new Date(e.at).toLocaleTimeString()} · {e.step ?? "Plan"} ·{" "}
                  {e.text}
                </li>
              ))}
            </ol>
          </details>
        </article>
      )}
    </section>
  );
}
