import type { RefObject } from "react";
import { modules, type WorkspaceSummary } from "./modules";
import type { SpatialState, SpatialEvent } from "./interaction-state";
import { ModuleCard } from "./module-card";
import styles from "./spatial.module.css";
export function ModuleOrbit({
  cards,
  state,
  summary,
  dispatch,
  flat,
}: {
  cards: RefObject<Array<HTMLButtonElement | null>>;
  state: SpatialState;
  summary: WorkspaceSummary;
  dispatch: (event: SpatialEvent) => void;
  flat: boolean;
}) {
  return (
    <div className={styles.orbit} role="group" aria-label="Ary modules">
      {modules.map((module, index) => (
        <ModuleCard
          key={module.id}
          index={index}
          state={state}
          summary={summary}
          dispatch={dispatch}
          flat={flat}
          cardRef={(node) => {
            cards.current[index] = node;
          }}
        />
      ))}
    </div>
  );
}
