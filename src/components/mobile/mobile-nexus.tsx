"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BrainGraph } from "../../domain/brain-graph";
import type { Json, MemoryHit } from "../../domain/models";
import { mobileGraphLayout } from "../../domain/mobile";
import { api } from "../api";
import styles from "./mobile.module.css";
export function MobileNexus({
  initialEntityId,
  initialMode = "map",
}: {
  initialEntityId?: string;
  initialMode?: string;
}) {
  const [graph, setGraph] = useState<BrainGraph | null>(null),
    [root, setRoot] = useState(""),
    [query, setQuery] = useState(""),
    [mode, setMode] = useState("map"),
    [memories, setMemories] = useState<MemoryHit[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [inventory, setInventory] = useState<Json | null>(null),
    [scene, setScene] = useState("podcast"),
    [plan, setPlan] = useState<Json | null>(null);
  useEffect(() => {
    setRoot(initialEntityId ?? "");
    setQuery("");
    setMode(initialMode);
  }, [initialEntityId, initialMode]);
  const lock = useRef(false);
  const layout = useMemo(
    () => (graph ? mobileGraphLayout(graph) : null),
    [graph],
  );
  useEffect(() => {
    if (mode !== "map") return;
    const abort = new AbortController();
    setGraph(null);
    setError("");
    void api(
      `brain-graph?limit=18&edge_limit=36&depth=1${root ? `&root=${encodeURIComponent(root)}` : ""}&q=${encodeURIComponent(query)}`,
      { signal: abort.signal },
    )
      .then((r) => r.json())
      .then((next) => {
        if (!abort.signal.aborted) setGraph(next);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [root, query, mode]);
  async function action(
    tool: string,
    input: Json,
    key = crypto.randomUUID(),
    extra: Json = {},
  ) {
    return (
      await (
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify({
            tool,
            input,
            request_key: key,
            reason: "Owner selected this device operation from ARY Companion",
            ...extra,
          }),
        })
      ).json()
    ).result;
  }
  async function work(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Mobile Nexus">
      <p className={styles.eyebrow}>YOUR CONNECTED WORLD</p>
      <h1>Keep the context.</h1>
      <div className={styles.segment}>
        {["map", "memory", "devices"].map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setError("");
            }}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === "map" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRoot("");
              setQuery(String(new FormData(e.currentTarget).get("q") || ""));
            }}
          >
            <label>
              Find an entity
              <input
                name="q"
                maxLength={120}
                placeholder="A person, project or company"
              />
            </label>
            <button>Search Nexus</button>
          </form>
          {root && (
            <button onClick={() => setRoot("")}>Back to overview</button>
          )}
          <div className={styles.map} aria-label="Simplified spatial Nexus">
            {layout ? (
              <svg
                viewBox="0 0 360 360"
                role="group"
                aria-label="Connected entity neighborhood"
              >
                {layout.edges.map((e) => {
                  const a = layout.nodes.find((n) => n.id === e.source)!,
                    b = layout.nodes.find((n) => n.id === e.target)!;
                  return (
                    <line
                      key={e.id}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="currentColor"
                      opacity={0.3}
                      strokeWidth={1 + e.strength}
                    />
                  );
                })}
                {layout.nodes.map((n) => (
                  <g
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Focus ${n.label}`}
                    onClick={() => setRoot(n.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setRoot(n.id);
                      }
                    }}
                  >
                    <circle cx={n.x} cy={n.y} r={24} fill="transparent" />
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={7 + (n.importance ?? 0.3) * 9}
                      fill={n.id === root ? "#e6eaff" : "#7b8cb6"}
                    />
                    <text
                      x={n.x}
                      y={n.y + 29}
                      textAnchor="middle"
                      fill="currentColor"
                      fontSize="9"
                    >
                      {n.label.slice(0, 17)}
                    </text>
                  </g>
                ))}
              </svg>
            ) : (
              <p role="status">Reading this neighborhood…</p>
            )}
          </div>
          <p className={styles.fine}>
            One relationship hop · up to 18 entities.{" "}
            {layout?.truncated
              ? "Focused excerpt; select an entity to explore further."
              : "Only recorded entities and relationships."}
          </p>
          {layout?.nodes.map((n) => (
            <details className={styles.row} key={n.id}>
              <summary>
                {n.label} <small>{n.type}</small>
              </summary>
              <p>
                {n.status} · {n.connectedMemoryCount} connected memories ·{" "}
                {n.activeBlockerCount} blockers
              </p>
              <button onClick={() => setRoot(n.id)}>Focus neighborhood</button>
              {layout.edges
                .filter((e) => e.source === n.id || e.target === n.id)
                .map((e) => (
                  <p key={e.id}>
                    {e.type} ·{" "}
                    {
                      layout.nodes.find(
                        (v) =>
                          v.id === (e.source === n.id ? e.target : e.source),
                      )?.label
                    }
                  </p>
                ))}
            </details>
          ))}
          {layout && !layout.nodes.length && (
            <p>No matching entities. Try a different name.</p>
          )}
        </>
      )}
      {mode === "memory" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const q = String(new FormData(e.currentTarget).get("q"));
              void work(async () => {
                setMemories([]);
                setMemories(
                  await (
                    await api(`memories?q=${encodeURIComponent(q)}`)
                  ).json(),
                );
              });
            }}
          >
            <label>
              What should Ary remember?
              <input
                name="q"
                required
                maxLength={500}
                placeholder="What happened with Wag Trails?"
              />
            </label>
            <button disabled={busy}>Search memory</button>
          </form>
          {memories.map((m) => (
            <article className={styles.row} key={m.id}>
              <strong>{m.summary || m.content.slice(0, 80)}</strong>
              <p>{m.content}</p>
              <details>
                <summary>Confidence & source</summary>
                <p>
                  {Math.round(m.confidence_score * 100)}% estimated confidence ·{" "}
                  {new Date(m.created_at).toLocaleString()}
                </p>
                <pre>{JSON.stringify(m.source_evidence ?? [], null, 2)}</pre>
              </details>
            </article>
          ))}
        </>
      )}
      {mode === "devices" && (
        <>
          <p>
            Inspect actual device state, then review a scene. Mac-local adapters
            still require the authorized desktop host; this companion does not
            bypass that boundary.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void work(async () => {
                setInventory(await action("studio.inspect", {}));
              })
            }
          >
            Check devices
          </button>
          {inventory && <pre>{JSON.stringify(inventory, null, 2)}</pre>}
          <label>
            Scene
            <input
              value={scene}
              maxLength={100}
              onChange={(e) => {
                setScene(e.target.value);
                setPlan(null);
              }}
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void work(async () =>
                setPlan(await action("studio.plan_scene", { scene })),
              )
            }
          >
            Prepare scene
          </button>
          {plan && (
            <>
              <pre>{JSON.stringify(plan.plan, null, 2)}</pre>
              <button
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    const r = plan.request as Json;
                    const result = await action(
                      String(r.tool),
                      r.input as Json,
                      `mobile-scene:${r.source_action_id}`,
                      {
                        source_action_id: r.source_action_id,
                        related_entity_ids: r.related_entity_ids,
                      },
                    );
                    setInventory(result);
                    setPlan(null);
                  })
                }
              >
                Review scene execution
              </button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
