"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrainCanvas, type BrainCanvasHandle } from "../brain/brain-canvas";
import { BrainExperience } from "../brain/brain-experience";
import {
  asBrainGraph,
  mapKinds,
  type MapKind,
  type MapNode,
  type NexusMap,
} from "../../domain/nexus-map";
import { useNexusEvents } from "../events/event-store";
import { useNexusMode } from "../nexus/mode";
import { api } from "../api";
import {
  clusters,
  eventConnections,
  kindLabels,
  projectMap,
  spatialLayout,
} from "./map-projection";
import {
  IntelligencePanel,
  type IntelligenceQuestion,
} from "./intelligence-panel";
import type { NexusIntelligence } from "../../domain/nexus-intelligence";
import styles from "./nexus-map.module.css";
export function NexusMapExperience({
  initialEntityId,
  development = false,
  lens = "nexus",
  onNavigate,
}: {
  initialEntityId?: string;
  development?: boolean;
  lens?: "nexus" | "world" | "memory";
  onNavigate: (node: MapNode) => void;
}) {
  const [legacy, setLegacy] = useState(false);
  return (
    <>
      <div className={styles.switcher}>
        <button aria-pressed={!legacy} onClick={() => setLegacy(false)}>
          Nexus map
        </button>
        <button aria-pressed={legacy} onClick={() => setLegacy(true)}>
          Entity Brain Graph
        </button>
      </div>
      {legacy ? (
        <BrainExperience
          initialEntityId={initialEntityId}
          development={development}
        />
      ) : (
        <IntelligenceMap
          initialEntityId={initialEntityId}
          lens={lens}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
}
function IntelligenceMap({
  initialEntityId,
  lens,
  onNavigate,
}: {
  initialEntityId?: string;
  lens: "nexus" | "world" | "memory";
  onNavigate: (node: MapNode) => void;
}) {
  const [data, setData] = useState<NexusMap | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState<MapKind | "">(""),
    [root, setRoot] = useState<string | undefined>(initialEntityId),
    [depth, setDepth] = useState(1),
    [after, setAfter] = useState<string | undefined>(),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(
      initialEntityId ?? null,
    ),
    [expanded, setExpanded] = useState<Set<string>>(new Set()),
    [detail, setDetail] = useState(false),
    [directory, setDirectory] = useState(false),
    [orbit, setOrbit] = useState(false),
    [rotation, setRotation] = useState({ yaw: 0, pitch: 0 });
  const [question, setQuestion] = useState<IntelligenceQuestion>(
    "What does ARY know about this?",
  );
  const [intelligence, setIntelligence] = useState<NexusIntelligence | null>(
    null,
  );
  const [intelligenceError, setIntelligenceError] = useState("");
  const [semanticInput, setSemanticInput] = useState(""),
    [semantic, setSemantic] = useState("");
  const [history, setHistory] = useState<"current" | "all">("current");
  const [trail, setTrail] = useState<MapNode[]>([]);
  const [trailEdges, setTrailEdges] = useState<NexusMap["edges"]>([]);
  const inspectable =
    selected &&
    /^(?:(?:memory|mission|outcome):)?[0-9a-f-]{36}$/i.test(selected)
      ? selected
      : undefined;
  useEffect(() => {
    setIntelligence(null);
    setIntelligenceError("");
    if (!inspectable && !semantic) return;
    const cancel = new AbortController();
    const p = new URLSearchParams({ q: semantic, history });
    if (inspectable) p.set("focus", inspectable);
    void api(`nexus-map/intelligence?${p}`, { signal: cancel.signal })
      .then((r) => r.json())
      .then((r: NexusIntelligence) => {
        if (!cancel.signal.aborted) setIntelligence(r);
      })
      .catch((e) => {
        if (!cancel.signal.aborted) setIntelligenceError(e.message);
      });
    return () => cancel.abort();
  }, [inspectable, semantic, history, revision]);
  const [fitRevision, setFitRevision] = useState(0);
  const canvas = useRef<BrainCanvasHandle>(null),
    feed = useNexusEvents(),
    mode = useNexusMode();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (
      !feed.events.some(
        (e) =>
          e.source.kind !== "client" &&
          Date.now() - Date.parse(e.timestamp) < 8000,
      )
    )
      return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const end = setTimeout(() => clearInterval(timer), 9000);
    return () => {
      clearInterval(timer);
      clearTimeout(end);
    };
  }, [feed.events]);
  useEffect(() => {
    if (initialEntityId) {
      setRoot(initialEntityId);
      setSelected(initialEntityId);
    }
  }, [initialEntityId]);
  useEffect(() => {
    const cancel = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(
      () => {
        const p = new URLSearchParams({
          q: query,
          lens,
          depth: String(depth),
          page: String(page),
        });
        if (kind) p.set("kind", kind);
        if (root) p.set("root", root);
        if (after) p.set("after", after);
        void api(`nexus-map?${p}`, { signal: cancel.signal })
          .then((r) => r.json())
          .then((next: NexusMap) => {
            if (!cancel.signal.aborted) {
              setData(next);
              setExpanded(new Set());
            }
          })
          .catch((e) => {
            if (!cancel.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!cancel.signal.aborted) setBusy(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      clearTimeout(timer);
      cancel.abort();
    };
  }, [query, kind, root, depth, after, page, revision, lens]);
  const connected = useMemo(() => {
    if (!intelligence) return data;
    const source = intelligence.map;
    const nodes = [
      ...new Map([...trail, ...source.nodes].map((n) => [n.id, n])).values(),
    ];
    const ids = new Set(nodes.map((n) => n.id));
    const edges = [
      ...new Map(
        [...trailEdges, ...source.edges]
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e) => [e.id, e]),
      ).values(),
    ];
    return { ...source, nodes, edges };
  }, [intelligence, data, trail, trailEdges]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => canvas.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [connected, fitRevision]);
  const liveEdges = useMemo(
    () => (connected ? eventConnections(connected, feed.events, now) : []),
    [connected, feed.events, now],
  );
  const enriched = useMemo(
    () =>
      connected
        ? { ...connected, edges: [...connected.edges, ...liveEdges] }
        : null,
    [connected, liveEdges],
  );
  const view = useMemo(
    () =>
      enriched
        ? projectMap(
            enriched,
            expanded,
            detail || !!query || !!intelligence,
            selected,
          )
        : null,
    [enriched, expanded, detail, query, selected, intelligence],
  );
  const graph = useMemo(() => (view ? asBrainGraph(view) : null), [view]);
  const positions = useMemo(
    () =>
      view ? spatialLayout(view, rotation.yaw, rotation.pitch) : new Map(),
    [view, rotation],
  );
  const activeEdges = useMemo(
    () =>
      new Set(
        view?.edges
          .filter(
            (e) =>
              e.updatedAt &&
              now - Date.parse(e.updatedAt) < 8000 &&
              (e.id.startsWith("event:") || e.type === "observed_together"),
          )
          .map((e) => e.id),
      ),
    [view, now],
  );
  const selectedNode =
    view?.nodes.find((n) => n.id === selected) ??
    connected?.nodes.find((n) => n.id === selected);
  const groups = useMemo(() => (data ? clusters(data) : new Map()), [data]);
  const choose = useCallback(
    (id: string) => {
      const node = connected?.nodes.find((n) => n.id === id);
      if (node && !node.members) {
        setTrail((old) => {
          const i = old.findIndex((n) => n.id === id);
          return i >= 0 ? old.slice(0, i + 1) : [...old, node].slice(-12);
        });
        setTrailEdges((old) =>
          [
            ...new Map(
              [...old, ...(connected?.edges ?? [])].map((e) => [e.id, e]),
            ).values(),
          ].slice(-240),
        );
      }
      setSelected(id);
      requestAnimationFrame(() => canvas.current?.flyTo(id));
    },
    [connected],
  );
  const clear = useCallback(() => setSelected(null), []);
  const onScale = useCallback(
    (scale: number) => setDetail((old) => (old ? scale > 0.68 : scale > 0.88)),
    [],
  );
  const onOrbit = useCallback(
    (dx: number, dy: number) =>
      setRotation((r) => ({
        yaw: Math.max(-1.1, Math.min(1.1, r.yaw + dx * 0.003)),
        pitch: Math.max(-0.65, Math.min(0.65, r.pitch + dy * 0.003)),
      })),
    [],
  );
  const reset = () => {
    setRoot(undefined);
    setSelected(null);
    setIntelligence(null);
    setSemantic("");
    setSemanticInput("");
    setTrail([]);
    setTrailEdges([]);
    setAfter(undefined);
    setPage(0);
    setExpanded(new Set());
    setDetail(false);
    setOrbit(false);
    setRotation({ yaw: 0, pitch: 0 });
    setFitRevision((previous) => previous + 1);
    setKind("");
    setQuery("");
  };
  const category = (next: MapKind | "") => {
    setKind(next);
    setAfter(undefined);
    setPage(0);
    setRoot(undefined);
    setSelected(null);
  };
  const relationships =
    view?.edges.filter((e) => e.source === selected || e.target === selected) ??
    [];
  return (
    <section className={styles.map} aria-label="Central Nexus intelligence map">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>
            {lens.toUpperCase()} / CONNECTED INTELLIGENCE
          </span>
          <h1>
            {lens === "memory" ? (
              <>
                What ARY knows,<em> connected.</em>
              </>
            ) : (
              <>
                Your world,<em> in context.</em>
              </>
            )}
          </h1>
          <p>Follow meaning. Open only what matters.</p>
        </div>
        <div className={styles.health}>
          <i data-live={feed.connection === "live"} />
          {feed.connection === "live"
            ? "Event feed connected"
            : "Activity feed " + feed.connection}
          <small>
            {liveEdges.length
              ? `${liveEdges.length} observed connections`
              : "No matching live connection activity"}
          </small>
        </div>
      </header>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span>⌕</span>
          <input
            aria-label="Search Nexus map"
            type="search"
            placeholder="Find a person, project, memory or capability…"
            value={query}
            maxLength={120}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
              setTrail([]);
              setTrailEdges([]);
              setSemantic("");
              setAfter(undefined);
              setPage(0);
              setRoot(undefined);
            }}
          />
        </label>
        <select
          aria-label="Filter Nexus category"
          value={kind}
          onChange={(e) => category(e.target.value as MapKind | "")}
        >
          <option value="">All domains</option>
          {mapKinds
            .filter(
              (k) =>
                k !== "outcome" &&
                (lens === "nexus" ||
                  !["ary", "agent", "tool", "skill", "automation"].includes(k)),
            )
            .map((k) => (
              <option key={k} value={k}>
                {kindLabels[k]}
              </option>
            ))}
        </select>
        <button aria-pressed={orbit} onClick={() => setOrbit((v) => !v)}>
          {orbit ? "Orbit mode" : "Pan mode"}
        </button>
        <button
          onClick={() => setDirectory((v) => !v)}
          aria-expanded={directory}
        >
          Directory
        </button>
        <button onClick={() => setRevision((v) => v + 1)} disabled={busy}>
          Refresh
        </button>
      </div>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          setSelected(null);
          setTrail([]);
          setTrailEdges([]);
          setSemantic(semanticInput.trim());
        }}
      >
        <label className={styles.search}>
          <input
            aria-label="Semantic memory search"
            placeholder="Ask across learned memory by meaning…"
            maxLength={200}
            value={semanticInput}
            onChange={(e) => setSemanticInput(e.target.value)}
          />
        </label>
        <button type="submit">Search meaning</button>
        <select
          aria-label="Memory and relationship time scope"
          value={history}
          onChange={(e) => {
            setHistory(e.target.value as "current" | "all");
            setTrail([]);
            setTrailEdges([]);
          }}
        >
          <option value="current">Current context</option>
          <option value="all">Include history</option>
        </select>
        {semantic && (
          <button
            type="button"
            onClick={() => {
              setSemantic("");
              setSemanticInput("");
            }}
          >
            Clear meaning search
          </button>
        )}
      </form>
      {!!trail.length && (
        <nav className={styles.trail} aria-label="Exploration path">
          <button onClick={reset}>Overview</button>
          {trail.map((n) => (
            <button
              key={n.id}
              onClick={() => choose(n.id)}
              aria-current={selected === n.id ? "step" : undefined}
            >
              {n.label}
            </button>
          ))}
        </nav>
      )}
      {intelligenceError && <p role="alert">{intelligenceError}</p>}
      {intelligence?.map.meta.warnings.map((w) => (
        <p className={styles.note} key={w} role="status">
          {w}
        </p>
      ))}
      <div className={styles.workspace}>
        <div
          className={styles.stage}
          data-map-lod={detail ? "detail" : "overview"}
          data-map-yaw={rotation.yaw.toFixed(2)}
          data-active-paths={activeEdges.size}
        >
          <div className={styles.field} aria-hidden="true" />
          <div className={styles.stageLabel}>
            <span>
              {root
                ? `${depth}-HOP NEIGHBORHOOD`
                : kind
                  ? kindLabels[kind].toUpperCase()
                  : "SEMANTIC OVERVIEW"}
            </span>
            <small>
              {view?.nodes.length ?? 0} visible / {connected?.nodes.length ?? 0}{" "}
              loaded
            </small>
          </div>
          {graph && (
            <BrainCanvas
              ref={canvas}
              graph={graph}
              selected={
                selectedNode &&
                view?.nodes.some((n) => n.id === selectedNode.id)
                  ? selectedNode.id
                  : null
              }
              onSelect={choose}
              onClear={clear}
              layoutPositions={positions}
              onScale={onScale}
              onOrbit={orbit ? onOrbit : undefined}
              observedEdges={activeEdges}
              atlas
              knowledgeEvents={false}
            />
          )}
          {!data && !error && (
            <div className={styles.empty}>Reading your connected context…</div>
          )}
          {data && !data.nodes.length && (
            <div className={styles.empty}>
              <h2>
                No recorded {kind ? kindLabels[kind].toLowerCase() : "matches"}.
              </h2>
              <p>
                {kind === "automation"
                  ? "A recurring scheduler has not been implemented. No automated runs are implied."
                  : "Try another category or add an evidenced record in the existing workspace."}
              </p>
            </div>
          )}
          <div className={styles.controls}>
            <button
              aria-label="Zoom out Nexus"
              onClick={() => canvas.current?.zoom(1 / 1.3)}
            >
              −
            </button>
            <button
              aria-label="Zoom in Nexus"
              onClick={() => canvas.current?.zoom(1.3)}
            >
              +
            </button>
            <button onClick={() => canvas.current?.fit()}>Fit</button>
            <button onClick={reset}>Overview</button>
            {root && (
              <select
                aria-label="Neighborhood depth"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              >
                <option value={1}>1 hop</option>
                <option value={2}>2 hops</option>
              </select>
            )}
          </div>
          <div className={styles.caption}>
            Drag to {orbit ? "orbit" : "pan"} · scroll to reveal detail
            <br />
            <span>Groups organize records; they never merge identities.</span>
          </div>
        </div>
        <aside className={styles.context} aria-label="Nexus map context">
          {selectedNode ? (
            <>
              <span className={styles.eyebrow}>
                {selectedNode.type === "cluster"
                  ? "VIEW GROUP"
                  : selectedNode.kind.toUpperCase()}
              </span>
              <button
                className={styles.close}
                aria-label="Close map context"
                onClick={clear}
              >
                ×
              </button>
              <h2>{selectedNode.label}</h2>
              <span className={styles.status}>
                {selectedNode.status.replaceAll("_", " ")}
              </span>
              <p>{selectedNode.detail}</p>
              <details>
                <summary>Source record</summary>
                <dl>
                  <dt>Source</dt>
                  <dd>{selectedNode.source}</dd>
                  {selectedNode.recency && (
                    <>
                      <dt>Last recorded update</dt>
                      <dd>{new Date(selectedNode.recency).toLocaleString()}</dd>
                    </>
                  )}
                  {selectedNode.recordId && (
                    <>
                      <dt>Canonical reference</dt>
                      <dd>{selectedNode.recordId}</dd>
                    </>
                  )}
                </dl>
              </details>
              {selectedNode.members ? (
                <>
                  <button
                    className={styles.primary}
                    onClick={() => {
                      setExpanded((old) => new Set([...old, selectedNode.id]));
                      setSelected(null);
                    }}
                  >
                    Open group · {selectedNode.members.length}
                  </button>
                  <button onClick={() => category(selectedNode.kind)}>
                    Explore {kindLabels[selectedNode.kind]}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={styles.primary}
                    onClick={() => onNavigate(selectedNode)}
                  >
                    {selectedNode.tool ? "Review action" : "Open source"} ↗
                  </button>
                  {selectedNode.source.startsWith("Canonical entity") && (
                    <button
                      onClick={() => {
                        setKind("");
                        setQuery("");
                        setAfter(undefined);
                        setRoot(selectedNode.recordId);
                      }}
                    >
                      Focus neighborhood
                    </button>
                  )}
                </>
              )}
              {intelligence && (
                <IntelligencePanel
                  question={question}
                  setQuestion={setQuestion}
                  key={selectedNode.id}
                  data={intelligence}
                  selected={selected}
                  connections={relationships}
                  nodes={connected?.nodes ?? []}
                  onSelect={choose}
                />
              )}
              {inspectable && !intelligence && !intelligenceError && (
                <p role="status">Reading recorded context…</p>
              )}
              <h3>Connections in view</h3>
              {relationships.length ? (
                relationships.slice(0, 12).map((e) => (
                  <div className={styles.relationship} key={e.id}>
                    <button
                      onClick={() =>
                        choose(e.source === selected ? e.target : e.source)
                      }
                    >
                      {
                        view?.nodes.find(
                          (n) =>
                            n.id ===
                            (e.source === selected ? e.target : e.source),
                        )?.label
                      }
                    </button>
                    <small>
                      {e.type.replaceAll("_", " ")} · {e.provenance}
                    </small>
                    {mode === "systems" && (
                      <details>
                        <summary>Evidence</summary>
                        <code>
                          {e.id}
                          <br />
                          {e.evidence.join(", ") || "Relationship record"}
                        </code>
                      </details>
                    )}
                  </div>
                ))
              ) : (
                <p>No connections are asserted in this window.</p>
              )}
            </>
          ) : (
            <>
              <span className={styles.eyebrow}>ORIENT / EXPLORE / FOCUS</span>
              <h2>
                {semantic
                  ? "Meaning, with evidence."
                  : "One connected workspace."}
              </h2>
              {intelligence && (
                <IntelligencePanel
                  question={question}
                  setQuestion={setQuestion}
                  data={intelligence}
                  selected={null}
                  connections={[]}
                  nodes={connected?.nodes ?? []}
                  onSelect={choose}
                />
              )}

              <p>
                ARY stays at the center. Perspectives, knowledge and work keep
                their original sources.
              </p>
              <h3>In this window</h3>
              {[...groups].map(([key, g]) => (
                <button
                  className={styles.domainRow}
                  key={key}
                  onClick={() => {
                    const id = `cluster:${key}`;
                    if (view?.nodes.some((n) => n.id === id)) choose(id);
                    else choose(g.nodes[0].id);
                  }}
                >
                  <span>{g.label}</span>
                  <small>{g.nodes.length}</small>
                </button>
              ))}
              <p className={styles.note}>
                Counts describe this bounded window, not database totals.
                Registered adapters are not verified connections.
              </p>
            </>
          )}
        </aside>
      </div>
      {directory && (
        <nav className={styles.directory} aria-label="Map record directory">
          {connected?.nodes.map((n) => (
            <button
              key={n.id}
              aria-label={`Select ${n.label}`}
              onClick={() => choose(n.id)}
              aria-pressed={selected === n.id}
            >
              {n.label}
              <small>{n.type}</small>
            </button>
          ))}
        </nav>
      )}
      {(query || semantic) && connected && (
        <div className={styles.results} aria-label="Nexus search results">
          {connected.nodes.slice(0, 20).map((n) => (
            <button
              key={n.id}
              aria-label={`Focus ${n.label}`}
              onClick={() => choose(n.id)}
            >
              {n.label}
              <small>
                {n.kind} · {n.source}
              </small>
            </button>
          ))}
        </div>
      )}
      <footer className={styles.footer}>
        <span>
          {busy
            ? "Updating the bounded view…"
            : `${data?.edges.length ?? 0} source connections · ${detail ? "detail" : "overview"} level`}
        </span>
        {data?.meta.more &&
          (kind ? (
            <button
              disabled={busy}
              onClick={() => {
                setAfter(data.meta.cursor ?? undefined);
                setPage((v) => v + 1);
                setSelected(null);
              }}
            >
              Next window →
            </button>
          ) : (
            <span>More records exist. Choose a domain to continue.</span>
          ))}
        {page > 0 && (
          <button
            onClick={() => {
              setPage(0);
              setAfter(undefined);
            }}
          >
            First window
          </button>
        )}
      </footer>
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
        </p>
      )}
      {data?.meta.warnings.map((w) => (
        <p key={w} role="status" className={styles.note}>
          {w}
        </p>
      ))}
      {feed.connection === "unavailable" && (
        <p className={styles.note}>
          Map records remain available. Live connection activity is unavailable
          until event storage is ready.
        </p>
      )}
    </section>
  );
}
