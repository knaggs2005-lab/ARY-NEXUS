"use client";
import { useRef, useState, type Ref } from "react";
import { modules, type WorkspaceSummary } from "./modules";
import {
  cardState,
  type SpatialState,
  type SpatialEvent,
} from "./interaction-state";
import styles from "./spatial.module.css";
export function ModuleCard({
  index,
  state,
  summary,
  dispatch,
  cardRef,
  flat,
}: {
  index: number;
  state: SpatialState;
  summary: WorkspaceSummary;
  dispatch: (e: SpatialEvent) => void;
  cardRef: Ref<HTMLButtonElement>;
  flat: boolean;
}) {
  const module = modules[index];
  const [hover, setHover] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const warning = module.id === "projects" && summary.blockedProjects > 0;
  const status = cardState(state, index, hover, warning);
  const metric = module.metric ? summary[module.metric] : null;
  return (
    <button
      ref={cardRef}
      className={styles.card}
      data-state={status}
      data-warning={warning}
      data-module={module.id}
      aria-label={`${module.name}${module.tab ? "" : " — not connected"}`}
      aria-pressed={state.index === index}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={(e) => {
        if (flat || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        dispatch({ type: "select", index });
      }}
      onPointerMove={(e) => {
        const start = drag.current;
        if (!start) return;
        const x = e.clientX - start.x,
          y = e.clientY - start.y;
        if (Math.hypot(x, y) > 5) {
          start.moved = true;
          dispatch({ type: "drag", x, y });
        }
      }}
      onPointerUp={() => {
        if (drag.current?.moved) dispatch({ type: "release" });
      }}
      onPointerCancel={() => {
        drag.current = null;
        dispatch({ type: "release" });
      }}
      onLostPointerCapture={() => dispatch({ type: "release" })}
      onClick={() => {
        const moved = drag.current?.moved;
        drag.current = null;
        if (!moved) dispatch({ type: "select", index });
      }}
      onDoubleClick={() => {
        if (module.tab) dispatch({ type: "expand" });
      }}
    >
      <span className={styles.cardTop}>
        <span>{module.code} / NEXUS</span>
        <span className={styles.symbol} aria-hidden="true">
          {module.symbol}
        </span>
      </span>
      <strong>{module.name}</strong>
      <span className={styles.cardDetail}>{module.detail}</span>
      <span className={styles.cardBottom}>
        <span>
          {!module.tab
            ? "NOT CONNECTED"
            : !summary.connected
              ? "CONNECT WORKSPACE"
              : module.metric
                ? `${metric} ${module.metric === "actions" ? "recent actions" : module.metric === "tasks" ? "open tasks" : module.metric}`
                : module.id === "finance"
                  ? "SOURCE VISIBILITY"
                  : "AVAILABLE"}
        </span>
        <span aria-hidden="true">↗</span>
      </span>
      {warning && (
        <span className={styles.warning}>
          {`${summary.blockedProjects} blocked`}
        </span>
      )}
    </button>
  );
}
