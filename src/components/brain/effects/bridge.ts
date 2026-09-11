import type { BrainGraph } from "../../../domain/brain-graph";
import type { Camera, Point } from "../graph-engine";

/** Presentation only: the graph renderer owns positions, camera and interactions. */
export interface EffectsSnapshot {
  graph: BrainGraph;
  camera: Camera;
  positions: ReadonlyMap<string, Point>;
  opacity: ReadonlyMap<string, number>;
  selected: string | null;
  width: number;
  height: number;
}
export function createEffectsBridge() {
  let snapshot: EffectsSnapshot | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => ({ snapshot, revision }),
    publish(next: EffectsSnapshot) {
      snapshot = next;
      revision++;
      for (const notify of listeners) notify();
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}
export type EffectsBridge = ReturnType<typeof createEffectsBridge>;
