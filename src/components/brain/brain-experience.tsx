"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrainNode } from "@/domain/brain-graph";
import { BrainCanvas, type BrainCanvasHandle } from "./brain-canvas";
import { BrainDetails } from "./brain-details";
import { useBrainGraph } from "./use-brain-graph";
import styles from "./brain.module.css";
export function BrainExperience({
  development = false,
  initialEntityId,
}: {
  development?: boolean;
  initialEntityId?: string;
}) {
  const [sample, setSample] = useState(false),
    [type, setType] = useState(""),
    [temporal, setTemporal] = useState("current"),
    [scope, setScope] = useState("");
  const data = useBrainGraph(sample, type, temporal, scope);
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState("");
  const [results, setResults] = useState<BrainNode[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState("");
  const [directory, setDirectory] = useState(false),
    [flight, setFlight] = useState<{ id: string; n: number } | null>(null);
  const canvas = useRef<BrainCanvasHandle>(null);
  const node = data.graph?.nodes.find((n) => n.id === selected) ?? null;
  const clear = useCallback(() => {
    setSelected(null);
    setFlight(null);
  }, []);
  const select = useCallback((id: string) => {
    setSelected(id);
    setFlight({ id, n: Date.now() });
  }, []);
  useEffect(() => {
    setSelected(null);
    setFlight(null);
    setQuery("");
  }, [sample, type, scope, temporal]);
  useEffect(() => {
    if (flight) {
      const frame = requestAnimationFrame(() =>
        canvas.current?.flyTo(flight.id),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [flight, data.graph]);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]);
    setSearchError("");
    if (!query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void data
        .fetchGraph({ q: query.trim(), limit: "8" }, controller.signal)
        .then((g) => {
          if (!controller.signal.aborted) setResults(g.nodes);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setSearchError(
              e instanceof Error ? e.message : "Search unavailable",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 240);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, data.fetchGraph]);
  const openedEntity = useRef<string | null>(null);
  useEffect(() => {
    if (
      !initialEntityId ||
      openedEntity.current === initialEntityId ||
      !data.graph ||
      data.busy
    )
      return;
    openedEntity.current = initialEntityId;
    void data.focus(initialEntityId).then((ok) => {
      if (ok) select(initialEntityId);
    });
  }, [initialEntityId, data, select]);
  async function visit(id: string) {
    if (data.graph?.nodes.some((n) => n.id === id)) {
      select(id);
      setQuery("");
      setDirectory(false);
    } else if (await data.focus(id)) {
      select(id);
      setQuery("");
      setDirectory(false);
    }
  }
  return (
    <section className={styles.experience} aria-label="Ary Nexus Brain Graph">
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            <span className={styles.orbitIcon}>◌</span> ARY NEXUS <span>/</span>{" "}
            INTELLIGENCE ATLAS
          </div>
          <h1>
            Brain<span>Graph</span>
            <sup>01</sup>
          </h1>
          <p>A living map of what matters.</p>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.live}>
            <i />
            {sample ? "Sample universe" : "Your connected world"}
          </span>
          {development && (
            <label className={styles.sourceLabel}>
              VIEW
              <select
                aria-label="Graph data source"
                value={sample ? "sample" : "workspace"}
                onChange={(e) => {
                  setSample(e.target.value === "sample");
                  setScope("");
                }}
              >
                <option value="workspace">Workspace</option>
                <option value="sample">Sample universe</option>
              </select>
            </label>
          )}
        </div>
      </header>
      <div className={styles.stage}>
        <div className={styles.ambient} />
        <div className={styles.topControls}>
          <div className={styles.searchWrap}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (results[0]) void visit(results[0].id);
              }}
              role="search"
            >
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="Search the brain graph"
                placeholder="Find a thought, project, or person…"
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
              />
              <kbd>↵</kbd>
            </form>
            {query.trim() && (
              <div
                className={styles.searchResults}
                aria-label="Graph search results"
                aria-live="polite"
              >
                {searching ? (
                  <p>Finding connections…</p>
                ) : searchError ? (
                  <p role="alert">{searchError}</p>
                ) : results.length ? (
                  results.map((n) => (
                    <button
                      disabled={data.busy}
                      key={n.id}
                      onClick={() => void visit(n.id)}
                    >
                      <span>
                        {n.label}
                        <small>{n.type}</small>
                      </span>
                      <span>↗</span>
                    </button>
                  ))
                ) : (
                  <p>No matching entities. Try another name.</p>
                )}
              </div>
            )}
          </div>
          <div className={styles.filters}>
            <select
              aria-label="Filter graph by entity type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">All entities</option>
              {[
                "company",
                "project",
                "person",
                "product",
                "goal",
                "decision",
                "task",
              ].map((t) => (
                <option key={t} value={t}>
                  {t === "company"
                    ? "Companies"
                    : t === "person"
                      ? "People"
                      : t[0].toUpperCase() + t.slice(1) + "s"}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter graph relationships"
              value={temporal}
              onChange={(e) => setTemporal(e.target.value)}
            >
              <option value="current">Current connections</option>
              <option value="historical">Historical connections</option>
              <option value="all">All connections</option>
            </select>
            <select
              aria-label="Filter graph by workspace scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">Entire workspace</option>
              {data.catalog
                .filter((n) => ["project", "company"].includes(n.type))
                .map((n) => (
                  <option value={`${n.type}:${n.id}`} key={n.id}>
                    {n.label}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div
          className={`${styles.graphRegion} ${node ? styles.withDetails : ""}`}
        >
          {data.graph && (
            <BrainCanvas
              knowledgeEvents={!sample}
              ref={canvas}
              graph={data.graph}
              selected={node?.id ?? null}
              onSelect={select}
              onClear={clear}
            />
          )}
          {!data.graph && !data.error && (
            <div className={styles.centerState}>
              <span className={styles.loadingOrb} />
              <h2>Gathering your world</h2>
              <p>Bringing connected context into view.</p>
            </div>
          )}
          {data.graph && !data.graph.nodes.length && (
            <div className={styles.centerState}>
              <span className={styles.emptyOrb}>◌</span>
              <h2>A little space to think.</h2>
              <p>
                No entities match this view. Try another filter
                <br />
                or add knowledge from the Entities screen.
              </p>
            </div>
          )}
          {data.graph && data.graph.nodes.length > 0 && !node && (
            <div className={styles.canvasCaption}>
              <span className={styles.eyebrow}>FOLLOW A CONNECTION</span>
              <p>Every point holds a little more context.</p>
            </div>
          )}
        </div>
        {node && data.graph && (
          <BrainDetails
            node={node}
            graph={data.graph}
            busy={data.busy}
            onClose={clear}
            onSelect={(id) => void visit(id)}
            onExpand={() => {
              setFlight(null);
              void data.expand(node.id).then((ok) => {
                if (ok) requestAnimationFrame(() => canvas.current?.fit());
              });
            }}
            onFocus={() => void data.focus(node.id)}
          />
        )}
        {data.error && (
          <div className={styles.toast} role="alert">
            {data.error}
            <button
              aria-label={
                data.graph ? "Dismiss graph error" : "Retry graph query"
              }
              onClick={data.graph ? data.clearError : data.retry}
            >
              {data.graph ? "×" : "Retry"}
            </button>
          </div>
        )}
        <div className={styles.bottomControls}>
          <div className={styles.legend}>
            <span>
              <i />
              Project
            </span>
            <span>
              <i className={styles.companyDot} />
              Company
            </span>
            <span>
              <i className={styles.personDot} />
              Person
            </span>
            <span>
              <b>◇</b>Blocker
            </span>
          </div>
          <div className={styles.viewportControls}>
            <button
              aria-label="Zoom out"
              onClick={() => canvas.current?.zoom(1 / 1.25)}
            >
              −
            </button>
            <button
              aria-label="Zoom in"
              onClick={() => canvas.current?.zoom(1.25)}
            >
              +
            </button>
            <span />
            <button
              aria-label="Fit graph to view"
              onClick={() => canvas.current?.fit()}
            >
              ⌗
            </button>
            <button
              aria-label="Open entity directory"
              aria-expanded={directory}
              onClick={() => setDirectory((v) => !v)}
            >
              ☷
            </button>
          </div>
        </div>
        {directory && (
          <aside
            className={styles.directory}
            aria-label="Graph entity directory"
          >
            <div>
              <h3>In this view</h3>
              <button
                aria-label="Close entity directory"
                onClick={() => setDirectory(false)}
              >
                ×
              </button>
            </div>
            <p>Select an entity to explore its context.</p>
            {data.graph?.nodes.map((n) => (
              <button
                disabled={data.busy}
                onClick={() => void visit(n.id)}
                key={n.id}
              >
                <span>{n.label}</span>
                <small>{n.type}</small>
              </button>
            ))}
          </aside>
        )}
      </div>
      <footer className={styles.footer}>
        <span>
          <i className={styles.smallDot} />
          {data.busy
            ? "Opening connections…"
            : `${data.graph?.nodes.length ?? 0} entities · ${data.graph?.edges.length ?? 0} connections`}
          {sample && " · Synthetic sample"}
        </span>
        <div>
          {data.canCollapse && (
            <button disabled={data.busy} onClick={data.collapse}>
              ↶ Collapse last expansion
            </button>
          )}
          {data.next && (
            <button disabled={data.busy} onClick={() => void data.more()}>
              Explore more +
            </button>
          )}
          <span>
            DRAG TO EXPLORE <b>·</b> SCROLL TO ZOOM
          </span>
        </div>
      </footer>
      {data.graph &&
        (data.graph.meta.nodesTruncated || data.graph.meta.edgesTruncated) && (
          <p className={styles.limitNote}>
            A focused view of your world. More connections may exist beyond this
            view; expand a node or narrow your scope.
          </p>
        )}
    </section>
  );
}
