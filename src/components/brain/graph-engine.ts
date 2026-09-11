import type { BrainGraph, BrainNode } from "@/domain/brain-graph";
export type Point = { x: number; y: number };
export type Camera = Point & { scale: number };
export const MAX_NODES = 240;
export const MAX_EDGES = 900;
export const radius = (node: BrainNode) =>
  13 + Math.sqrt(Math.max(0, Math.min(1, node.importance ?? 0.15))) * 17;
export const nodeColor = (node: BrainNode) =>
  node.activeBlockerCount > 0 || node.status === "blocked"
    ? "#d4ae79"
    : node.type === "company"
      ? "#c4bcac"
      : node.type === "person"
        ? "#a9b6c9"
        : "#9abfb0";
export function neighborhood(graph: BrainGraph, selected: string | null) {
  const connected = new Set<string>(selected ? [selected] : []);
  for (const e of graph.edges) {
    if (e.source === selected) connected.add(e.target);
    if (e.target === selected) connected.add(e.source);
  }
  return connected;
}
/** Preserve all existing coordinates. Only new nodes participate in settling. */
export function layoutGraph(
  graph: BrainGraph,
  previous = new Map<string, Point>(),
  anchor?: string,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const ordered = [...graph.nodes].sort(
    (a, b) =>
      (b.importance ?? 0) - (a.importance ?? 0) || a.id.localeCompare(b.id),
  );
  const newIds = new Set(
    ordered.filter((n) => !previous.has(n.id)).map((n) => n.id),
  );
  const origin = (anchor && previous.get(anchor)) || { x: 0, y: 0 };
  const parents = new Map(
    graph.edges
      .filter((e) => e.type === "part_of" && e.status === "current")
      .map((e) => [e.source, e.target]),
  );
  const childCounts = new Map<string, number>();
  let index = 0;
  for (const n of ordered) {
    const prior = previous.get(n.id);
    if (prior) {
      positions.set(n.id, { ...prior });
      continue;
    }
    const parent = parents.get(n.id);
    const cluster =
      !previous.size && !["project", "company"].includes(n.type) && parent
        ? positions.get(parent)
        : undefined;
    const i = cluster && parent ? (childCounts.get(parent) ?? 0) : index++;
    if (cluster && parent) childCounts.set(parent, i + 1);
    const center = cluster ?? origin;
    const angle = i * 2.399963 - 0.7;
    const distance = cluster
      ? 170 + Math.sqrt(i) * 85
      : previous.size
        ? 160 + Math.sqrt(i) * 95
        : i === 0
          ? 0
          : 240 + Math.sqrt(i - 1) * 115;
    positions.set(n.id, {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + Math.sin(angle) * distance,
    });
  }
  // Small, bounded synchronous settle; no force simulation running during interaction.
  for (let pass = 0; pass < 20; pass++) {
    for (const id of newIds) {
      const p = positions.get(id)!;
      for (const [other, q] of positions) {
        if (other === id) continue;
        const dx = p.x - q.x,
          dy = p.y - q.y,
          d = Math.hypot(dx, dy) || 1;
        if (d < 175) {
          p.x += (dx / d) * (175 - d) * 0.15;
          p.y += (dy / d) * (175 - d) * 0.15;
        }
      }
    }
  }
  return positions;
}
export function mergeGraph(
  current: BrainGraph,
  incoming: BrainGraph,
): BrainGraph {
  const nodes = new Map(current.nodes.map((n) => [n.id, n]));
  let dropped = false;
  for (const n of incoming.nodes) {
    if (nodes.has(n.id) || nodes.size < MAX_NODES) nodes.set(n.id, n);
    else dropped = true;
  }
  const edges = new Map(current.edges.map((e) => [e.id, e]));
  for (const e of incoming.edges)
    if (nodes.has(e.source) && nodes.has(e.target)) edges.set(e.id, e);
  const kept = [...edges.values()].filter(
    (e) => nodes.has(e.source) && nodes.has(e.target),
  );
  return {
    version: current.version,
    nodes: [...nodes.values()],
    edges: kept.slice(0, MAX_EDGES),
    meta: {
      ...incoming.meta,
      nextCursor: null,
      nodesTruncated:
        dropped || current.meta.nodesTruncated || incoming.meta.nodesTruncated,
      edgesTruncated:
        kept.length > MAX_EDGES ||
        current.meta.edgesTruncated ||
        incoming.meta.edgesTruncated,
    },
  };
}
export function zoomAt(camera: Camera, factor: number, pointer: Point): Camera {
  const scale = Math.max(0.08, Math.min(2.5, camera.scale * factor));
  const ratio = scale / camera.scale;
  return {
    x: pointer.x - (pointer.x - camera.x) * ratio,
    y: pointer.y - (pointer.y - camera.y) * ratio,
    scale,
  };
}
export function fitCamera(
  positions: Map<string, Point>,
  width: number,
  height: number,
): Camera {
  if (!positions.size) return { x: width / 2, y: height / 2, scale: 1 };
  const values = [...positions.values()];
  const minX = Math.min(...values.map((p) => p.x)) - 100,
    maxX = Math.max(...values.map((p) => p.x)) + 100;
  const minY = Math.min(...values.map((p) => p.y)) - 100,
    maxY = Math.max(...values.map((p) => p.y)) + 100;
  const scale = Math.max(
    0.08,
    Math.min(
      1.15,
      (width - 80) / (maxX - minX),
      (height - 100) / (maxY - minY),
    ),
  );
  return {
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
    scale,
  };
}
