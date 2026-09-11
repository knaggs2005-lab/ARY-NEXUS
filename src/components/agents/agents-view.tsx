"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { boardRoles } from "../../domain/board";
import type { AgentView } from "../../domain/agent";
import { api } from "../api";
import { useNexusEvents } from "../events/event-store";
import styles from "./agents.module.css";
const FamilyGraph = dynamic(() => import("./agent-family-graph"), {
  ssr: false,
  loading: () => <p>Preparing delegation view…</p>,
});
type Snapshot = {
  agents: AgentView[];
  models: { id: string; model: string; usage_reporting: boolean }[];
};
export function AgentsView({ onMission }: { onMission: (id: string) => void }) {
  const [data, setData] = useState<Snapshot>({ agents: [], models: [] }),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(""),
    [purpose, setPurpose] = useState(""),
    [role, setRole] = useState<(typeof boardRoles)[number]>("Developer Ary"),
    [lifetime, setLifetime] = useState("persistent"),
    [model, setModel] = useState("configured"),
    [memory, setMemory] = useState("mission"),
    [level, setLevel] = useState(2),
    [tools, setTools] = useState("mission.agent");
  const [limits, setLimits] = useState({
      runs: 10,
      tool_calls: 40,
      model_calls: 10,
      children: 2,
      timeout_ms: 30000,
    }),
    [objective, setObjective] = useState(""),
    [spec, setSpec] = useState(""),
    [now, setNow] = useState(Date.now),
    [reduced, setReduced] = useState(true);
  const mounted = useRef(true),
    fetching = useRef(false);
  const { events } = useNexusEvents();
  const view = data.agents.find((v) => v.agent.id === selected),
    agent = view?.agent;
  async function refresh() {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const next = await (
        await api("agents", { signal: AbortSignal.timeout(8000) })
      ).json();
      if (mounted.current) {
        setData(next);
        setLoaded(true);
        setLoadError("");
      }
    } catch (e) {
      if (mounted.current) setLoadError((e as Error).message);
    } finally {
      fetching.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) void refresh();
    }, 3000);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    change();
    media.addEventListener("change", change);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      media.removeEventListener("change", change);
    };
  }, []);
  async function request(tool: string, input: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await (
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify({
            tool,
            input,
            request_key: crypto.randomUUID(),
            reason: "Owner requested this scoped Agent Runtime operation",
          }),
        })
      ).json();
      await refresh();
      return r.result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const toolAccess = tools
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const config = () => ({
    name,
    purpose,
    specialization: role,
    lifetime,
    model,
    memory_scope: memory,
    permission_level: level,
    tool_access: toolAccess,
    capabilities: [
      ...(toolAccess.includes("mission.agent") ? ["analyze"] : []),
      ...(toolAccess.includes("agent.delegate") ? ["delegate"] : []),
      ...(toolAccess.some(
        (t) => !["mission.agent", "agent.delegate"].includes(t),
      )
        ? ["tools"]
        : []),
    ],
    budgets: limits,
  });
  return (
    <section className={styles.panel} aria-label="Nexus Agent Runtime">
      <header>
        <span>AGENT RUNTIME</span>
        <h2>Specialization with a purpose.</h2>
        <p>
          ARY orchestrates. Scoped workers carry out explicit assignments
          through the same missions, permissions and memory.
        </p>
      </header>
      {(error || loadError) && (
        <p role="alert">
          {error || loadError}
          <button onClick={() => void refresh()}>Refresh agents</button>
        </p>
      )}
      <details open={!data.agents.length}>
        <summary>Create a functional agent</summary>
        <div className={styles.form}>
          <label>
            Agent name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <label>
            Specialization
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              {boardRoles.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className={styles.wide}>
            Functional purpose
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              maxLength={1000}
            />
          </label>
          <label>
            Lifetime
            <select
              value={lifetime}
              onChange={(e) => setLifetime(e.target.value)}
            >
              <option value="persistent">Persistent specialization</option>
              <option value="ephemeral">One assignment worker</option>
            </select>
          </label>
          <label>
            Model profile
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.model}
                  {m.usage_reporting ? "" : " · advisory calls unavailable"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Memory scope
            <select value={memory} onChange={(e) => setMemory(e.target.value)}>
              <option value="mission">
                Mission-linked central memory only
              </option>
              <option value="none">No memory content</option>
            </select>
          </label>
          <label>
            Permission ceiling
            <select
              id="agent-permission-ceiling"
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            >
              {[
                "No access",
                "Observe",
                "Recommend",
                "Draft",
                "Execute with approval",
                "Autonomous within owner policy",
              ].map((l, i) => (
                <option key={i} value={i}>
                  {i} · {l}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.wide}>
            Tool access (comma separated)
            <input value={tools} onChange={(e) => setTools(e.target.value)} />
            <small>
              mission.agent, agent.delegate, create_task, update_task,
              update_project_status, task.inspect, mock.fetch_project_summary,
              mock.create_note, mock.draft_message
            </small>
          </label>
          {Object.entries(limits).map(([key, value]) => (
            <label key={key}>
              Budget: {key}
              <input
                type="number"
                value={value}
                onChange={(e) =>
                  setLimits((p) => ({ ...p, [key]: Number(e.target.value) }))
                }
              />
            </label>
          ))}
        </div>
        <button
          disabled={
            busy || name.trim().length < 3 || purpose.trim().length < 10
          }
          onClick={() =>
            void request("agent.create", config()).then((r) => {
              if (r?.agent) setSelected(r.agent.id);
            })
          }
        >
          Create agent
        </button>
      </details>
      {!loaded && !error && <p role="status">Reading persisted workers…</p>}
      {loaded && !data.agents.length && (
        <p>
          No workers have been created. Add a specialization when it has a
          concrete job.
        </p>
      )}
      <FamilyGraph
        agents={data.agents}
        selected={selected}
        select={setSelected}
        events={events}
        now={now}
        reduced={reduced}
        stale={!!loadError}
      />
      {data.agents.length > 64 && (
        <p>
          Showing the first 64 worker nodes. Select any worker from the list
          below.
        </p>
      )}
      <nav className={styles.list} aria-label="Registered agents">
        {data.agents.map((v) => (
          <button
            key={v.agent.id}
            aria-pressed={selected === v.agent.id}
            onClick={() => setSelected(v.agent.id)}
          >
            {v.agent.name} · {v.status}
          </button>
        ))}
      </nav>
      {agent && view && (
        <article className={styles.detail} aria-label="Agent inspector">
          <div>
            <span>
              {view.status} / {agent.lifetime}
            </span>
            <h3>{agent.name}</h3>
            <p>{agent.purpose}</p>
            <p>
              {agent.specialization} · model profile {agent.model}
            </p>
            <p>
              Parent:{" "}
              {data.agents.find((v) => v.agent.id === agent.parent_id)?.agent
                .name ?? "ARY"}
            </p>
            <p>
              Memory: {agent.memory_scope} · permission ceiling{" "}
              {agent.permission_level}
            </p>
            <p>Tools: {agent.tool_access.join(", ")}</p>
            <p>
              Reservations: {agent.run_keys.length}/{agent.budgets.runs} runs ·{" "}
              {agent.dispatch_keys.length}/{agent.budgets.tool_calls} tool
              attempts · {agent.model_keys.length}/{agent.budgets.model_calls}{" "}
              model calls · {agent.children.length}/{agent.budgets.children}{" "}
              descendants
            </p>
            <p>
              {view.usage.available ? (
                <>
                  Recorded model usage: {view.usage.calls} calls ·{" "}
                  {view.usage.input_tokens ?? "unknown"} input /{" "}
                  {view.usage.output_tokens ?? "unknown"} output tokens ·{" "}
                  {view.usage.estimated_cost_usd === null
                    ? "cost unknown"
                    : `$${view.usage.estimated_cost_usd.toFixed(4)} estimate`}{" "}
                  · {view.usage.unknown_cost_calls} calls with unknown cost
                </>
              ) : (
                "Model telemetry unavailable or restricted"
              )}
            </p>
            <small>
              Budgets reserve attempts, including failures. Estimates are not
              invoices; no dollar spend limit is implied.
            </small>
          </div>
          <div>
            <label>
              Assignment objective
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                maxLength={1500}
              />
            </label>
            <details>
              <summary>Optional reviewed mission specification</summary>
              <textarea
                aria-label="Agent mission JSON"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                rows={8}
              />
            </details>
            <button
              disabled={
                busy ||
                objective.trim().length < 3 ||
                view.status === "TERMINATED"
              }
              onClick={() => {
                try {
                  void request("agent.submit", {
                    agent_id: agent.id,
                    objective,
                    ...(spec.trim() ? { spec: JSON.parse(spec) } : {}),
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Submit assignment
            </button>
            <button
              disabled={
                busy ||
                objective.trim().length < 10 ||
                !agent.capabilities.includes("delegate") ||
                view.status === "TERMINATED"
              }
              onClick={() =>
                void request("agent.delegate", {
                  parent_id: agent.id,
                  objective,
                  child: {
                    name: `${agent.specialization} worker`,
                    purpose: objective,
                    specialization: agent.specialization,
                    capabilities: agent.capabilities,
                    tool_access: agent.tool_access,
                    memory_scope: agent.memory_scope,
                    permission_level: agent.permission_level,
                    model: agent.model,
                    budgets: agent.budgets,
                  },
                })
              }
            >
              Delegate child worker
            </button>
            <button
              disabled={busy || view.status === "TERMINATED"}
              onClick={() =>
                void request("agent.terminate", {
                  agent_id: agent.id,
                  reason:
                    "Owner terminated this worker subtree from Agent Runtime",
                })
              }
            >
              Terminate agent and workers
            </button>
            <p>
              Assignments open as durable drafts. Plan and start in Mission
              Control; each tool retains independent approval. Termination stops
              future dispatch and requests cancellation, without undoing
              in-flight effects.
            </p>
          </div>
          <nav className={styles.wide} aria-label="Agent missions">
            {view.missions.map((m) => (
              <button key={m.id} onClick={() => onMission(m.id)}>
                {m.spec.title} · {m.mission?.state} → Mission Control
              </button>
            ))}
          </nav>
        </article>
      )}
      {busy && <p role="status">Recording agent operation…</p>}
    </section>
  );
}
