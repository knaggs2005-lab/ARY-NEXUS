"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  Position,
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ExecutionPlan } from "../../domain/orchestration";
import { api } from "../api";
import { NexusSurface } from "../nexus/primitives";
import {
  skillDefinition,
  skillExamples,
  type SkillDefinition,
  type SkillRecord,
  type AutomationRecord,
} from "../../domain/skills";
import styles from "./skills.module.css";
type Catalog = { skills: SkillRecord[]; automations: AutomationRecord[] };
export default function SkillBuilder({
  automations = false,
  onMission,
}: {
  automations?: boolean;
  onMission: (id: string) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [automations]);
  const [catalog, setCatalog] = useState<Catalog>({
      skills: [],
      automations: [],
    }),
    [record, setRecord] = useState<SkillRecord | null>(null),
    [version, setVersion] = useState(0);
  const [draft, setDraft] = useState<SkillDefinition>(() => skillExamples()[0]),
    [selected, setSelected] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [goal, setGoal] = useState(""),
    [values, setValues] = useState<Record<string, string>>({}),
    [interval, setInterval] = useState("manual"),
    [notice, setNotice] = useState(""),
    [advanced, setAdvanced] = useState("");
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [missionTemplates, setMissionTemplates] = useState<ExecutionPlan[]>([]);
  const [missionTarget, setMissionTarget] = useState("");
  const missionTemplate = missionTemplates.find((m) => m.id === missionTarget);
  useEffect(() => {
    if (!automations) return;
    const c = new AbortController();
    void api("orchestrator/plans", { signal: c.signal })
      .then((r) => r.json())
      .then((p) => {
        if (!c.signal.aborted)
          setMissionTemplates(p.filter((m: ExecutionPlan) => m.mission));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [automations]);
  const current = record?.versions.find((v) => v.version === version);
  const dirty =
    !current || JSON.stringify(draft) !== JSON.stringify(current.definition);
  async function refresh() {
    const r = await api("skills");
    setCatalog(await r.json());
  }
  useEffect(() => {
    const c = new AbortController();
    void api("skills", { signal: c.signal })
      .then((r) => r.json())
      .then((v) => {
        if (!c.signal.aborted) setCatalog(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const nodes = useMemo<Node[]>(
    () =>
      draft.steps.map((s, i) => ({
        id: s.id,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: positions[s.id] ?? { x: i * 270, y: (i % 2) * 65 },
        data: {
          label: (
            <div className={styles.node}>
              <small>
                {s.when ? "DECISION · " : ""}
                {s.tool === "mission.agent" ? "AGENT" : "TOOL"}
                {s.repeat > 1 ? ` · LOOP ×${s.repeat}` : ""}
              </small>
              <strong>{s.title}</strong>
              <span>{s.tool}</span>
            </div>
          ),
        },
        selected: i === selected,
        style: {
          background: "#171c2b",
          color: "#eef0ff",
          border: "1px solid #7f8cba66",
          borderRadius: 16,
          width: 230,
        },
      })),
    [draft.steps, positions, selected],
  );
  const edges = useMemo<Edge[]>(
    () =>
      draft.steps.flatMap((s) =>
        s.depends_on.map((d) => ({
          id: `${d}-${s.id}`,
          source: d,
          target: s.id,
          label: s.when?.step === d ? "condition" : undefined,
          style: { stroke: "#9daade" },
          type: "smoothstep",
          labelStyle: { fill: "#bac7e6", fontSize: 10 },
          labelBgStyle: { fill: "#121b2a" },
        })),
      ),
    [draft.steps],
  );
  function choose(s: SkillRecord, v = s.versions.at(-1)!.version) {
    setRecord(s);
    setVersion(v);
    setDraft(
      structuredClone(s.versions.find((x) => x.version === v)!.definition),
    );
    setSelected(0);
    setPositions({});
    setError("");
    setAdvanced("");
    setNotice("");
  }
  function inputs() {
    for (const i of draft.inputs) {
      const v = values[i.name];
      if (i.required && (v === undefined || v.trim() === ""))
        throw new Error(`Provide ${i.name}`);
      if (
        v !== undefined &&
        i.type === "boolean" &&
        !["true", "false"].includes(v)
      )
        throw new Error(`${i.name} must be true or false`);
      if (
        v !== undefined &&
        i.type === "number" &&
        (!v.trim() || !Number.isFinite(Number(v)))
      )
        throw new Error(`${i.name} must be a finite number`);
    }

    return Object.fromEntries(
      draft.inputs
        .filter((i) => i.required || values[i.name] !== undefined)
        .map((i) => [
          i.name,
          i.type === "number"
            ? Number(values[i.name])
            : i.type === "boolean"
              ? values[i.name] === "true"
              : (values[i.name] ?? ""),
        ]),
    );
  }
  async function request(tool: string, input: Record<string, unknown>) {
    const r = await api("actions/request", {
      method: "POST",
      body: JSON.stringify({
        tool,
        input,
        request_key: crypto.randomUUID(),
        reason: `Owner reviewing Skills workspace: ${draft.title}`,
      }),
    });
    return (await r.json()).result;
  }
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function updateStep(patch: Partial<SkillDefinition["steps"][number]>) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s, i) => (i === selected ? { ...s, ...patch } : s)),
    }));
  }
  const step = draft.steps[selected];
  return (
    <NexusSurface label={automations ? "Skill automations" : "Skill workshop"}>
      <div ref={panel} className={styles.root} aria-busy={busy}>
        <header className={styles.heading}>
          <div>
            <small>REUSABLE INTELLIGENCE</small>
            <h2>
              {automations ? "Deliberate triggers" : "The Skill workshop"}
            </h2>
            <p>
              {automations
                ? "Pinned workflows. Mission drafts. Authority stays with you."
                : "Shape a workflow once. Review its exact version. Reuse it with evidence."}
            </p>
          </div>
          <span className={styles.state}>
            {busy
              ? "Working through Ary’s action pipeline…"
              : current?.approved_at && !dirty
                ? `Reviewed · v${version}`
                : "Draft · no execution authority"}
          </span>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className={styles.toolbar}>
          <label>
            Saved skill
            <select
              aria-label="Saved skill"
              value={record?.id ?? ""}
              onChange={(e) => {
                const s = catalog.skills.find((s) => s.id === e.target.value);
                if (s) choose(s);
              }}
            >
              <option value="">Unsaved proposal</option>
              {catalog.skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.versions.at(-1)!.definition.title}
                </option>
              ))}
            </select>
          </label>
          {record && (
            <label>
              Version
              <select
                value={version}
                onChange={(e) => choose(record, Number(e.target.value))}
              >
                {record.versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} · {v.approved_at ? "reviewed" : "draft"}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button disabled={busy} onClick={() => act(refresh)}>
            Refresh library
          </button>
        </div>
        {!automations && (
          <>
            <div className={styles.propose}>
              <label>
                Describe a reusable workflow
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Prepare a client onboarding checklist from our conversation"
                />
              </label>
              <button
                disabled={busy || goal.trim().length < 3}
                onClick={() =>
                  act(async () => {
                    const r = await request("skill.propose", { goal });
                    choose(r.skill);
                  })
                }
              >
                Propose with Ary
              </button>
            </div>
            <nav aria-label="Example skills" className={styles.examples}>
              {skillExamples().map((example) => (
                <button
                  key={example.title}
                  disabled={busy}
                  onClick={() => {
                    setRecord(null);
                    setVersion(0);
                    setDraft(example);
                    setSelected(0);
                    setPositions({});
                    setAdvanced("");
                    setNotice(
                      "Example loaded as an unsaved advisory draft. Configure inputs and review before use.",
                    );
                  }}
                >
                  {example.title}
                </button>
              ))}
            </nav>
            <div className={styles.workspace}>
              <div className={styles.canvas} aria-label="Skill workflow graph">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodeClick={(_, n) =>
                    setSelected(draft.steps.findIndex((s) => s.id === n.id))
                  }
                  onNodeDragStop={(_, n) =>
                    setPositions((p) => ({ ...p, [n.id]: n.position }))
                  }
                  onConnect={(c) => {
                    const from = draft.steps.findIndex(
                        (s) => s.id === c.source,
                      ),
                      to = draft.steps.findIndex((s) => s.id === c.target);
                    if (from < 0 || to <= from) {
                      setError(
                        "Dependencies must point forward; use bounded repeat for loops.",
                      );
                      return;
                    }
                    setDraft((d) => ({
                      ...d,
                      steps: d.steps.map((s, i) =>
                        i === to
                          ? {
                              ...s,
                              depends_on: [
                                ...new Set([...s.depends_on, c.source!]),
                              ],
                            }
                          : s,
                      ),
                    }));
                  }}
                  fitView
                  fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
                  minZoom={0.3}
                  maxZoom={1.5}
                  colorMode="dark"
                >
                  <Background gap={28} color="#545e7833" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </div>
              <aside
                className={styles.inspector}
                aria-label="Selected workflow step"
              >
                <small>STEP {selected + 1}</small>
                <label>
                  Step title
                  <input
                    value={step?.title ?? ""}
                    onChange={(e) => updateStep({ title: e.target.value })}
                  />
                </label>
                <label>
                  Tool capability
                  <input
                    value={step?.tool ?? ""}
                    onChange={(e) => updateStep({ tool: e.target.value })}
                  />
                </label>
                <label>
                  Bounded repetitions
                  <select
                    value={step?.repeat ?? 1}
                    onChange={(e) =>
                      updateStep({ repeat: Number(e.target.value) })
                    }
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <p>
                  Connections are dependencies. Conditions, exact inputs, output
                  paths and pinned subskills can be edited below.
                </p>
                <button
                  onClick={() => {
                    const next = {
                      ...structuredClone(step),
                      id: `step_${draft.steps.length}`,
                      title: "New workflow step",
                      depends_on: [step.id],
                    };
                    setDraft((d) => ({ ...d, steps: [...d.steps, next] }));
                    setSelected(draft.steps.length);
                  }}
                  disabled={busy || draft.steps.length >= 12}
                >
                  Add step
                </button>
                <button
                  disabled={busy || draft.steps.length <= 1}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      steps: d.steps
                        .filter((_, i) => i !== selected)
                        .map((s) => ({
                          ...s,
                          depends_on: s.depends_on.filter(
                            (id) => id !== step.id,
                          ),
                        })),
                    }));
                    setSelected(0);
                  }}
                >
                  Remove step
                </button>
              </aside>
            </div>
            <ol className={styles.sequence} aria-label="Workflow steps">
              {draft.steps.map((s, i) => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelected(i)}
                    aria-pressed={selected === i}
                  >
                    {i + 1}. {s.title} · {s.tool}
                    {s.repeat > 1 ? ` ×${s.repeat}` : ""}
                  </button>
                </li>
              ))}
            </ol>
            <div className={styles.details}>
              <label>
                Skill title
                <input
                  value={draft.title}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, title: e.target.value }))
                  }
                />
              </label>
              <label>
                Instructions
                <textarea
                  value={draft.instructions}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, instructions: e.target.value }))
                  }
                />
              </label>
              <label>
                Success criteria (one per line)
                <textarea
                  value={draft.success_criteria.join("\n")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      success_criteria: e.target.value.split("\n"),
                    }))
                  }
                />
              </label>
              <label>
                Declared tools (one per line)
                <textarea
                  value={draft.permissions.join("\n")}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      permissions: e.target.value.split("\n"),
                    }))
                  }
                />
              </label>
            </div>
            <details>
              <summary>
                Structured workflow editor · inputs, decisions, outputs and
                pinned subskills
              </summary>
              <p>
                Use a step’s when condition for decisions, repeat for bounded
                loops, and {'{"$input":"name"}'} for typed inputs. Saving
                validates the complete graph. Changes always create a draft
                revision.
              </p>
              <button
                onClick={() => setAdvanced(JSON.stringify(draft, null, 2))}
              >
                Load workflow JSON
              </button>
              <label>
                Workflow JSON
                <textarea
                  className={styles.json}
                  value={advanced}
                  onChange={(e) => setAdvanced(e.target.value)}
                />
              </label>
              <button
                disabled={!advanced || busy}
                onClick={() => {
                  try {
                    setDraft(skillDefinition.parse(JSON.parse(advanced)));
                    setSelected(0);
                    setError("");
                  } catch {
                    setError(
                      "Invalid workflow JSON or dependency order. No changes applied.",
                    );
                  }
                }}
              >
                Apply workflow edits
              </button>
            </details>
            <div className={styles.toolbar}>
              <button
                disabled={busy || !dirty}
                onClick={() =>
                  act(async () => {
                    const r = await request("skill.save", {
                      definition: draft,
                      ...(record
                        ? { id: record.id, revision: record.revision }
                        : {}),
                    });
                    choose(r.skill);
                  })
                }
              >
                Save draft version
              </button>
              <button
                disabled={busy || dirty || !!current?.approved_at}
                onClick={() =>
                  act(async () => {
                    const r = await request("skill.approve", {
                      id: record!.id,
                      version,
                      hash: current!.hash,
                    });
                    choose(r.skill, version);
                  })
                }
              >
                Review and approve version
              </button>
            </div>
            <p className={styles.note}>
              Declared tools are a ceiling, never a permission grant. Reviewing
              a Skill does not approve future sensitive actions. Version edits
              cannot change running Missions.
            </p>
          </>
        )}
        <section className={styles.launch} aria-label="Run reviewed skill">
          <h3>Prepare a Mission</h3>
          {draft.inputs.map((i) => (
            <label key={i.name}>
              {i.name} · {i.description}
              <input
                value={values[i.name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [i.name]: e.target.value }))
                }
                placeholder={i.type === "boolean" ? "true or false" : i.type}
              />
            </label>
          ))}
          <button
            disabled={busy || dirty || !current?.approved_at}
            onClick={() =>
              act(async () => {
                const r = await request("skill.launch", {
                  id: record!.id,
                  version,
                  inputs: inputs(),
                });
                onMission(r.mission_id);
              })
            }
          >
            Create mission draft
          </button>
        </section>
        {automations && (
          <>
            <section className={styles.launch}>
              <h3>Pin a trigger</h3>
              <label>
                Trigger target
                <select
                  value={missionTarget}
                  onChange={(e) => setMissionTarget(e.target.value)}
                >
                  <option value="">Selected reviewed Skill</option>
                  {missionTemplates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.spec.title} · Mission revision {m.revision}
                    </option>
                  ))}
                </select>
              </label>
              {missionTemplate && (
                <p>
                  {missionTemplate.spec.steps.length} steps pinned from this
                  Mission. A new draft will be created; the source Mission is
                  preserved.
                </p>
              )}
              <p>
                Select a reviewed Skill version and supply its inputs above.
                Triggers create drafts for review in Mission Control; they never
                silently start tool execution.
              </p>
              <label>
                Trigger
                <select
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                >
                  <option value="manual">Manual</option>
                  <option value="60">Hourly</option>
                  <option value="1440">Daily</option>
                  <option value="10080">Weekly</option>
                </select>
              </label>
              <button
                disabled={
                  busy || (!missionTemplate && (dirty || !current?.approved_at))
                }
                onClick={() =>
                  act(async () => {
                    await request("automation.save", {
                      title: `${missionTemplate?.spec.title ?? draft.title} trigger`,
                      target: missionTemplate
                        ? {
                            kind: "mission",
                            id: missionTemplate.id,
                            revision: missionTemplate.revision,
                          }
                        : {
                            kind: "skill",
                            id: record!.id,
                            version,
                            inputs: inputs(),
                          },
                      trigger:
                        interval === "manual"
                          ? { kind: "manual" }
                          : {
                              kind: "interval",
                              minutes: Number(interval),
                              starts_at: new Date().toISOString(),
                            },
                    });
                    setNotice(
                      "Disabled trigger saved. Review it before enabling.",
                    );
                  })
                }
              >
                Save disabled trigger
              </button>
            </section>
            <div className={styles.triggers}>
              {catalog.automations.map((a) => (
                <article key={a.id}>
                  <h3>{a.definition.title}</h3>
                  <p>
                    {a.enabled ? "Enabled" : "Disabled"} ·{" "}
                    {a.definition.trigger.kind} · pinned{" "}
                    {a.definition.target.kind} · revision {a.revision}
                  </p>
                  <small>
                    {a.definition.target.id}
                    {a.definition.target.kind === "skill"
                      ? ` · v${a.definition.target.version}`
                      : ""}
                  </small>
                  <div className={styles.toolbar}>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await request("automation.enable", {
                            id: a.id,
                            revision: a.revision,
                            enabled: !a.enabled,
                          });
                        })
                      }
                    >
                      {a.enabled ? "Disable trigger" : "Review and enable"}
                    </button>
                    <button
                      disabled={busy || !a.enabled}
                      onClick={() =>
                        act(async () => {
                          const r = await request("automation.fire", {
                            id: a.id,
                            invocation: crypto.randomUUID(),
                          });
                          onMission(r.mission_id);
                        })
                      }
                    >
                      Deliver trigger
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <p>
              Interval delivery requires the explicitly enabled existing Mission
              worker. No browser timer or unattended execution.
            </p>
          </>
        )}
      </div>
    </NexusSurface>
  );
}
