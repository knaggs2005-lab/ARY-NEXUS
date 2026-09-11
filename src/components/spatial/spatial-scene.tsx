"use client";
import type { RefObject } from "react";
import type { WorkspaceSummary } from "./modules";
import type { SpatialState, SpatialEvent } from "./interaction-state";
import { ModuleOrbit } from "./module-orbit";
import { Postprocessing } from "./postprocessing";
import { qualitySettings, type Quality } from "./performance";
import styles from "./spatial.module.css";
export function SpatialScene({
  world,
  cards,
  state,
  summary,
  dispatch,
  flat,
  quality,
}: {
  world: RefObject<HTMLDivElement | null>;
  cards: RefObject<Array<HTMLButtonElement | null>>;
  state: SpatialState;
  summary: WorkspaceSummary;
  dispatch: (event: SpatialEvent) => void;
  flat: boolean;
  quality: Quality;
}) {
  return (
    <div
      ref={world}
      className={styles.world}
      data-flat={flat}
      data-frozen={state.frozen}
      aria-label="Spatial module orbit"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          dispatch({
            type: "rotate",
            direction: e.key === "ArrowLeft" ? -1 : 1,
          });
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dispatch({ type: "return" });
        }
      }}
    >
      <Postprocessing quality={quality} />
      <div className={styles.dust} aria-hidden="true">
        {Array.from({ length: qualitySettings[quality].particles }, (_, i) => (
          <i
            key={i}
            style={{
              left: `${(i * 37 + 9) % 100}%`,
              top: `${(i * 53 + 17) % 100}%`,
              opacity: 0.06 + (i % 3) * 0.025,
            }}
          />
        ))}
      </div>
      <div className={styles.orbitRing} aria-hidden="true" />
      <ModuleOrbit
        cards={cards}
        state={state}
        summary={summary}
        dispatch={dispatch}
        flat={flat}
      />
    </div>
  );
}
