"use client";
import type { BrainGraph, BrainNode } from "@/domain/brain-graph";
import styles from "./brain.module.css";
export function BrainDetails({
  node,
  graph,
  busy,
  onClose,
  onSelect,
  onExpand,
  onFocus,
}: {
  node: BrainNode;
  graph: BrainGraph;
  busy: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onExpand: () => void;
  onFocus: () => void;
}) {
  const connected = graph.edges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );
  const index = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <aside
      className={styles.details}
      aria-label={`${node.label} context`}
      key={node.id}
    >
      <div className={styles.detailTop}>
        <span className={styles.eyebrow}>IN CONTEXT</span>
        <button
          onClick={onClose}
          className={styles.iconButton}
          aria-label="Close entity context"
        >
          ×
        </button>
      </div>
      <span className={styles.typeBadge}>{node.type}</span>
      <h2>{node.label}</h2>
      <div className={styles.status}>
        <i className={node.activeBlockerCount ? styles.amber : undefined} />
        {node.status === "unknown"
          ? "Status not yet defined"
          : node.status.replaceAll("_", " ")}
      </div>
      <div className={styles.metrics}>
        <div>
          <strong>{node.connectedMemoryCount}</strong>
          <span>Connected memories</span>
        </div>
        <div>
          <strong>
            {node.importance === null
              ? "—"
              : `${Math.round(node.importance * 100)}%`}
          </strong>
          <span>Importance</span>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy} onClick={onExpand}>
          Expand connections <span>↗</span>
        </button>
        <button disabled={busy} onClick={onFocus}>
          Focus neighborhood
        </button>
      </div>
      {node.activeBlockerCount > 0 && (
        <section className={styles.blockers}>
          <span className={styles.eyebrow}>◇ NEEDS ATTENTION</span>
          <p>
            {node.activeBlockerCount} active{" "}
            {node.activeBlockerCount === 1 ? "blocker" : "blockers"}
          </p>
          {node.activeBlockers.map((b) => (
            <button
              disabled={busy}
              key={b.relationshipId}
              onClick={() => onSelect(b.id)}
            >
              {b.label}
              <span>↗</span>
            </button>
          ))}
          {node.activeBlockerCount > node.activeBlockers.length && (
            <small>
              Showing {node.activeBlockers.length} of {node.activeBlockerCount}
            </small>
          )}
        </section>
      )}
      <section className={styles.detailSection}>
        <h3>
          Related goals <span>{node.relatedGoalCount}</span>
        </h3>
        {node.relatedGoals.length ? (
          node.relatedGoals.map((g) => (
            <div className={styles.goal} key={g.id}>
              <p>{g.title}</p>
              <div>
                <span>{g.status}</span>
                <span>{Math.round(g.progress * 100)}%</span>
              </div>
              <progress
                value={g.progress}
                max={1}
                aria-label={`${g.title} progress`}
              />
            </div>
          ))
        ) : (
          <p className={styles.muted}>No goal links recorded yet.</p>
        )}
        {node.relatedGoalCount > node.relatedGoals.length && (
          <small>
            Showing {node.relatedGoals.length} of {node.relatedGoalCount}
          </small>
        )}
      </section>
      <section className={styles.detailSection}>
        <h3>
          Connected paths <span>{connected.length}</span>
        </h3>
        {connected.slice(0, 20).map((e) => {
          const other = e.source === node.id ? e.target : e.source;
          return (
            <button
              className={styles.connection}
              disabled={busy}
              key={e.id}
              onClick={() => onSelect(other)}
            >
              <span>
                <strong>{index.get(other)?.label ?? "Linked entity"}</strong>
                <small>
                  {e.source === node.id ? "→" : "←"}{" "}
                  {e.type.replaceAll("_", " ")} · {e.status}
                </small>
              </span>
              <span>{Math.round(e.strength * 100)}%</span>
            </button>
          );
        })}
        {!connected.length && (
          <p className={styles.muted}>Expand to discover connected context.</p>
        )}
        {connected.length > 20 && (
          <small>Showing 20 of {connected.length} visible paths</small>
        )}
      </section>
      <footer className={styles.detailFooter}>
        <span>LAST CONTEXT UPDATE</span>
        <time dateTime={node.recency}>
          {new Date(node.recency).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </time>
      </footer>
    </aside>
  );
}
