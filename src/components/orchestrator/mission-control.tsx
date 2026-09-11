"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  missionAttention,
  missionGraph,
  type MissionControlSnapshot,
} from "../../domain/mission-control";
import type { ExecutionPlan } from "../../domain/orchestration";
import { useNexusEvents } from "../events/event-store";
import { api } from "../api";
import styles from "./mission-control.module.css";
const ExecutionGraph = dynamic(() => import("./mission-execution-graph"), {
  ssr: false,
  loading: () => <p role="status">Preparing execution map…</p>,
});
const money = (amount: number | null) =>
  amount === null
    ? "Not recorded"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }).format(amount);
const asText = (value: unknown, fallback: string) =>
  typeof value === "string" && value ? value : fallback;

export function MissionControl({
  plan: current,
  busy,
  onRefresh,
}: {
  plan: ExecutionPlan;
  busy: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const [snapshot, setSnapshot] = useState<MissionControlSnapshot | null>(null),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(""),
    [motion, setMotion] = useState(true);
  const { events, connection } = useNexusEvents();
  const inFlight = useRef(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const next = (await (
          await api(`orchestrator/plans/${current.id}`, {
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
              : AbortSignal.timeout(8000),
          })
        ).json()) as MissionControlSnapshot;
        if (!signal?.aborted) {
          setSnapshot(next);
          setError("");
        }
      } catch (e) {
        if (!signal?.aborted) setError((e as Error).message);
      } finally {
        inFlight.current = false;
      }
    },
    [current.id],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(controller.signal);
    }, 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  const latestEvent = events
    .filter(
      (e) =>
        e.source.kind !== "client" &&
        (e.mission_id === current.id || e.correlation_id === current.id),
    )
    .at(-1)?.id;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void refresh(controller.signal), 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [latestEvent, current.revision, refresh]);
  const plan =
    snapshot && snapshot.plan.revision >= current.revision
      ? snapshot.plan
      : current;
  const graph = useMemo(() => missionGraph(plan), [plan]);
  const attention = missionAttention(plan);
  const selectedNode =
    graph.nodes.find((n) => n.id === selected) ??
    graph.nodes.find((n) => n.active) ??
    graph.nodes[0];
  const step = plan.spec.steps.find((s) => s.id === selectedNode?.step_id);
  const state = step && plan.states[step.id];
  const receipts =
    snapshot?.receipts.filter(
      (r) =>
        step &&
        ([
          state?.action_id,
          state?.approval_action_id,
          state?.verification_action_id,
        ].includes(r.action.id) ||
          asText(
            (
              r.action.metadata.request_envelope as
                { request_key?: unknown } | undefined
            )?.request_key,
            "",
          ).startsWith(`plan:${plan.id}:${step.id}:`)),
    ) ?? [];
  const costRows = snapshot?.costs?.filter((c) => !c.excluded) ?? [];
  const knownCosts = costRows.filter((c) => c.amount !== null);
  const amount = knownCosts.length
    ? knownCosts.reduce((n, c) => n + c.amount!, 0)
    : null;
  const pending =
    plan.pending_approvals?.filter((a) => a.step_id === step?.id) ?? [];
  async function review(actionId: string, tool: string) {
    await new Promise((resolve) =>
      window.dispatchEvent(
        new CustomEvent("ary:approval", {
          detail: { actionId, tool, respond: resolve },
        }),
      ),
    );
    await refresh();
    await onRefresh();
  }
  return (
    <section className={styles.control} aria-label="Mission Control">
      <header className={styles.head}>
        <div>
          <span className={styles.eyebrow}>MISSION CONTROL</span>
          <h3>{plan.spec.title}</h3>
          <p>{plan.goal}</p>
        </div>
        <div className={styles.identity}>
          <strong>
            {(plan.mission?.state ?? plan.status).replaceAll("_", " ")}
          </strong>
          <span>Checkpoint {plan.revision}</span>
          {snapshot && (
            <small>
              Checked {new Date(snapshot.observed_at).toLocaleTimeString()}
            </small>
          )}
          <small>
            {connection === "live"
              ? "Nexus events + checkpoint polling"
              : "Checkpoint polling · 3 seconds"}
          </small>
        </div>
      </header>
      {error && (
        <p role="alert" className={styles.warning}>
          Mission detail refresh failed: {error}. Displayed receipts may be
          stale.<button onClick={() => void refresh()}>Retry details</button>
        </p>
      )}
      <div className={styles.brief}>
        <div>
          <span>EXPECTED OUTCOME</span>
          <p>
            {plan.spec.steps.at(-1)?.verification?.description ??
              "Complete the declared steps; inspect each tool receipt for its outcome."}
          </p>
          <small>Planned criterion, not a claim of success</small>
        </div>
        <div>
          <span>WORKING NOW</span>
          <p>
            {attention.running
              .map(
                (i) =>
                  `${i.step.title}${i.state.phase === "verify" ? " · verifying" : ""}`,
              )
              .join(" · ") ||
              (plan.mission?.state === "PLANNING"
                ? "ARY · planning checkpoint"
                : "No step currently executing")}
          </p>
          <small>
            {plan.mission?.agent_id
              ? `Assigned worker ${plan.mission.agent_id} · ARY orchestrates`
              : attention.agents.length
                ? attention.agents
                    .map(
                      (i) =>
                        `${asText(i.step.input.role, "Agent")} · ${i.state.status.replaceAll("_", " ")}`,
                    )
                    .join(" / ")
                : "ARY coordinator · registered tools; no delegated agent"}
          </small>
        </div>
        <div>
          <span>RECORDED COST</span>
          <p className={styles.amount}>
            {error ? "Unavailable" : !snapshot ? "Loading…" : money(amount)}
          </p>
          <small>
            {snapshot?.costs === null
              ? "Economics access is unavailable"
              : `${knownCosts.length}/${costRows.length} action amounts known · estimates / reported costs; incomplete coverage`}
          </small>
        </div>
      </div>
      <div className={styles.statusRail} aria-live="polite">
        <span>
          {attention.completed.length}/{plan.spec.steps.length} verified
        </span>
        <span>{attention.waiting.length} waiting</span>
        <span>{plan.pending_approvals?.length ?? 0} need approval</span>
        <span data-failed={attention.failed.length > 0}>
          {attention.failed.length} failed
        </span>
        {plan.mission?.retry && (
          <span>
            Retry: {plan.mission.retry.step} ·{" "}
            {new Date(plan.mission.retry.at).toLocaleTimeString()}
          </span>
        )}
      </div>
      {plan.mission?.reason && (
        <p className={styles.warning}>{plan.mission.reason}</p>
      )}
      {(attention.waiting.length > 0 || attention.failed.length > 0) && (
        <nav className={styles.nodeNav} aria-label="Mission attention">
          {[...attention.failed, ...attention.waiting].map(
            ({ step, state }) => (
              <button
                key={step.id}
                onClick={() =>
                  setSelected(
                    graph.nodes.find(
                      (n) =>
                        n.step_id === step.id &&
                        (n.kind === "approval" || n.kind === "wait"),
                    )?.id ??
                      `${step.id}:${step.tool === "mission.agent" ? "agent" : "tool"}`,
                  )
                }
              >
                {state.status.replaceAll("_", " ")} · {step.title}
              </button>
            ),
          )}
        </nav>
      )}
      <div className={styles.workspace}>
        <div className={styles.mapColumn}>
          <ExecutionGraph
            graph={graph}
            selected={selectedNode?.id ?? ""}
            onSelect={setSelected}
            reducedMotion={motion}
            stale={!!error || !snapshot}
          />
          <nav aria-label="Mission nodes" className={styles.nodeNav}>
            {graph.nodes.map((n) => (
              <button
                key={n.id}
                aria-pressed={selectedNode?.id === n.id}
                onClick={() => setSelected(n.id)}
              >
                {n.kind} · {n.title}
              </button>
            ))}
          </nav>
          <small>
            Pan or zoom to explore. Select a node to inspect evidence.
            Independent paths show dependencies, not promised concurrency.
          </small>
        </div>
        <aside className={styles.inspector} aria-label="Mission node inspector">
          {step && state ? (
            <>
              <span className={styles.eyebrow}>
                {selectedNode?.kind} /{" "}
                {selectedNode?.status.replaceAll("_", " ")}
              </span>
              <h4>{step.title}</h4>
              <p>{step.tool}</p>
              <dl>
                <dt>Why this step</dt>
                <dd>
                  {step.title} — part of “{plan.goal}”
                </dd>
                <dt>Responsible</dt>
                <dd>
                  {step.tool === "mission.agent"
                    ? asText(step.input.role, "Assigned role")
                    : "ARY coordinator → registered tool"}
                </dd>
                <dt>Dependencies</dt>
                <dd>
                  {step.depends_on
                    .map(
                      (id) =>
                        plan.spec.steps.find((s) => s.id === id)?.title ?? id,
                    )
                    .join(" → ") || "No predecessor required"}
                </dd>
                <dt>Expected evidence</dt>
                <dd>
                  {step.verification?.description ?? "Recorded tool result"}
                </dd>
              </dl>
              {state.error && <p className={styles.warning}>{state.error}</p>}
              {plan.step_details?.[step.id]?.failure && (
                <p>{plan.step_details[step.id].failure!.next_action}</p>
              )}
              {state.evidence && (
                <p className={styles.evidence}>{state.evidence}</p>
              )}
              {step.missing.length > 0 && (
                <p>Missing: {step.missing.join("; ")}</p>
              )}
              {step.wait_for && (
                <p>
                  Waiting condition: {step.wait_for.name} ·{" "}
                  {plan.mission?.wait_deadlines[step.id]
                    ? `deadline ${new Date(plan.mission.wait_deadlines[step.id]).toLocaleString()}`
                    : "timer not started"}
                </p>
              )}
              {step.when && (
                <p>
                  Condition: {step.when.step}.{step.when.path.join(".")} ={" "}
                  {String(step.when.equals)}. See checkpoint evidence for its
                  disposition.
                </p>
              )}
              {pending.map((a) => (
                <button
                  key={a.action_id}
                  disabled={busy}
                  onClick={() =>
                    void review(a.action_id, a.tool).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  Review exact approval
                </button>
              ))}
              <details>
                <summary>Planned inputs and verification</summary>
                <pre>
                  {JSON.stringify(
                    {
                      input: step.input,
                      verification: step.verification,
                      permission:
                        plan.step_details?.[step.id]?.permission_requirement,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {step.wait_for && (
                <details>
                  <summary>Submitted evidence</summary>
                  <pre>
                    {JSON.stringify(
                      plan.mission?.submissions.filter(
                        (s) => s.name === step.wait_for?.name,
                      ) ?? [],
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
              <h4>Calls & results</h4>
              {!snapshot ? (
                <p role="status">Loading recorded receipts…</p>
              ) : !receipts.length ? (
                <p>No action receipt for this step yet.</p>
              ) : (
                receipts.map((r) => (
                  <details key={r.action.id} className={styles.receipt}>
                    <summary>
                      {r.action.tool_name} · {r.action.status}
                      {r.action.metadata.replay_of ? " · replay" : ""}
                    </summary>
                    <p>
                      {asText(
                        r.action.metadata.requesting_agent,
                        "Requester not recorded",
                      )}{" "}
                      · {new Date(r.action.created_at).toLocaleString()}
                    </p>
                    <p>
                      {asText(
                        r.action.metadata.reason,
                        "No additional reason recorded",
                      )}
                    </p>
                    <code>{r.action.id}</code>
                    {r.action.error && (
                      <p className={styles.warning}>{r.action.error}</p>
                    )}
                    <p>
                      Recorded cost:{" "}
                      {money(
                        snapshot.costs?.find((c) => c.action_id === r.action.id)
                          ?.amount ?? null,
                      )}
                    </p>
                    {snapshot.costs
                      ?.filter((c) => c.action_id === r.action.id)
                      .map((c) => (
                        <p key={c.action_id}>
                          {c.basis.replaceAll("_", " ")} · model{" "}
                          {money(c.model_amount)} / compute{" "}
                          {money(c.compute_amount)} / tool{" "}
                          {money(c.tool_amount)}
                          <br />
                          {c.notes}
                        </p>
                      ))}
                    {r.calls.map((c) => (
                      <p key={c.id}>
                        {c.model} · {c.latency_ms} ms · {c.input_tokens ?? "?"}{" "}
                        in / {c.output_tokens ?? "?"} out ·{" "}
                        {money(c.estimated_cost_usd)} estimate
                      </p>
                    ))}
                    <pre>
                      {JSON.stringify(
                        {
                          input: r.action.input,
                          result: r.action.output,
                          approvals: r.approvals,
                          outcomes: r.outcomes,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                ))
              )}
              <small>
                Attempt {state.attempt + 1}.{" "}
                {snapshot && snapshot.receipt_count > snapshot.receipts.length
                  ? "Most recent 200 mission receipts shown; older records remain in Action history."
                  : "Receipts are read from Action history."}
              </small>
            </>
          ) : (
            <p>Select an execution node to inspect it.</p>
          )}
        </aside>
      </div>
      <div className={styles.past}>
        <span className={styles.eyebrow}>LATEST CHECKPOINTS</span>
        <ol>
          {plan.events
            .slice(-5)
            .toReversed()
            .map((e, i) => (
              <li key={`${e.at}:${i}`}>
                <time>{new Date(e.at).toLocaleTimeString()}</time>
                <span>{e.text}</span>
              </li>
            ))}
        </ol>
        <small>
          Source conversation <code>{plan.conversation_id}</code> · mission{" "}
          <code>{plan.id}</code>
        </small>
      </div>
    </section>
  );
}
