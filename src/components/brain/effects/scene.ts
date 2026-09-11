import { radius } from "../graph-engine";
import type { EffectsSnapshot } from "./bridge";
import type { KnowledgeEvent } from "./knowledge-events";

export const MAX_SPRITES = 104;
export const STRIDE = 12;
export interface Burst {
  event: KnowledgeEvent;
  started: number;
}
export type Quality = "standard" | "low";
const palette = [0.55, 0.7, 0.62];

/** Pack bounded instances, never scan graph objects from a fullscreen fragment shader. */
export function packScene(
  s: EffectsSnapshot,
  bursts: Burst[],
  now: number,
  quality: Quality,
) {
  const data = new Float32Array(MAX_SPRITES * STRIDE);
  let count = 0;
  const { camera: c, width, height, positions } = s;
  const visible = (x: number, y: number, margin = 120) =>
    x * c.scale + c.x > -margin &&
    x * c.scale + c.x < width + margin &&
    y * c.scale + c.y > -margin &&
    y * c.scale + c.y < height + margin;
  const add = (a: number[], b: number[], color = palette, phase = 0) => {
    if (count >= MAX_SPRITES) return;
    data.set([...a, ...b, ...color, phase], count++ * STRIDE);
  };
  const nodes = s.graph.nodes
    .filter((n) => {
      const p = positions.get(n.id);
      return (
        p &&
        visible(p.x, p.y) &&
        (n.id === s.selected || (n.importance ?? 0) >= 0.55)
      );
    })
    .sort(
      (a, b) =>
        Number(b.id === s.selected) - Number(a.id === s.selected) ||
        (b.importance ?? 0) - (a.importance ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, quality === "low" ? 12 : 32);
  for (const n of nodes) {
    const p = positions.get(n.id)!;
    const active = n.id === s.selected;
    const alpha = (active ? 0.18 : 0.06) * (s.opacity.get(n.id) ?? 1);
    add(
      [p.x, p.y, radius(n) * (active ? 3.4 : 2.4), 0],
      [0, 0, alpha, 0],
      n.activeBlockerCount ? [0.74, 0.61, 0.43] : palette,
    );
  }
  let edges = 0;
  for (const e of s.graph.edges) {
    if (
      !s.selected ||
      e.status !== "current" ||
      (e.source !== s.selected && e.target !== s.selected)
    )
      continue;
    const a = positions.get(e.source),
      b = positions.get(e.target);
    if (!a || !b) continue;
    // Bounding box overlap includes paths crossing the viewport with offscreen ends.
    const ax = a.x * c.scale + c.x,
      ay = a.y * c.scale + c.y;
    const bx = b.x * c.scale + c.x,
      by = b.y * c.scale + c.y;
    if (
      Math.max(ax, bx) < 0 ||
      Math.min(ax, bx) > width ||
      Math.max(ay, by) < 0 ||
      Math.min(ay, by) > height
    )
      continue;
    add(
      [a.x, a.y, 5, 1],
      [b.x, b.y, 0.25 + Math.min(1, Math.max(0, e.strength)) * 0.12, 0],
      e.type === "blocks" ? [0.74, 0.61, 0.43] : palette,
      edges * 0.381966,
    );
    if (++edges >= (quality === "low" ? 8 : 24)) break;
  }
  if (quality !== "low")
    for (const burst of bursts.slice(-4)) {
      if (now - burst.started > 2.4) continue;
      const anchor = burst.event.entityIds
        .map((id) => positions.get(id))
        .find(Boolean);
      // Unlinked memory uses a neutral bottom-of-view cue, never an invented entity link.
      if (burst.event.entityIds.length && !anchor) continue;
      const p = anchor ?? {
        x: (width * 0.5 - c.x) / c.scale,
        y: (height * 0.82 - c.y) / c.scale,
      };
      if (!visible(p.x, p.y)) continue;
      for (let i = 0; i < 12; i++)
        add([p.x, p.y, 2, 2], [0, 0, 0.3, burst.started], palette, i / 12);
    }
  return { data, count };
}

/** Only downgrade after sustained poor presented-frame cadence; idle samples are excluded. */
export function createFrameHealth() {
  let previous = 0,
    slow = 0;
  return {
    reset() {
      previous = 0;
      slow = 0;
    },
    sample(now: number) {
      const gap = previous ? now - previous : 0;
      previous = now;
      slow =
        gap > 55 && gap < 250 ? slow + gap : Math.max(0, slow - gap * 0.25);
      return slow > 2500;
    },
  };
}
