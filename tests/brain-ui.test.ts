import { describe, it, expect } from "vitest";
import {
  graphSample,
  graphSampleId as id,
} from "../src/infrastructure/graph-sample";
import { queryLocalGraph } from "../src/infrastructure/repositories/local-graph";
import { graphQuerySchema, type BrainGraph } from "../src/domain/brain-graph";
import {
  fitCamera,
  layoutGraph,
  mergeGraph,
  neighborhood,
  radius,
  zoomAt,
  MAX_NODES,
  MAX_EDGES,
} from "../src/components/brain/graph-engine";
const graph = queryLocalGraph(graphSample(), graphQuerySchema.parse({}));
describe("Brain Graph interaction geometry", () => {
  it("keeps expanded nodes anchored and gives every node a finite, unique position", () => {
    const initial = { ...graph, nodes: graph.nodes.slice(0, 3) };
    const positions = layoutGraph(initial);
    const expanded = layoutGraph(graph, positions, id(2));
    for (const [key, point] of positions)
      expect(expanded.get(key)).toEqual(point);
    expect(expanded.size).toBe(graph.nodes.length);
    expect(
      new Set([...expanded.values()].map((p) => `${p.x},${p.y}`)).size,
    ).toBe(graph.nodes.length);
    expect(
      [...expanded.values()].every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    ).toBe(true);
  });
  it("preserves the pointer's world position through zoom and clamps scale", () => {
    const camera = { x: 60, y: 40, scale: 1 },
      pointer = { x: 140, y: 210 };
    const next = zoomAt(camera, 1.3, pointer);
    expect((pointer.x - next.x) / next.scale).toBeCloseTo(
      (pointer.x - camera.x) / camera.scale,
    );
    expect((pointer.y - next.y) / next.scale).toBeCloseTo(
      (pointer.y - camera.y) / camera.scale,
    );
    expect(zoomAt(camera, 1e6, pointer).scale).toBe(2.5);
    expect(zoomAt(camera, 0, pointer).scale).toBe(0.08);
  });
  it("highlights only directly connected nodes and scales importance safely", () => {
    expect(neighborhood(graph, id(4))).toEqual(new Set([id(4), id(2), id(5)]));
    expect(radius({ ...graph.nodes[0], importance: 1 })).toBeGreaterThan(
      radius({ ...graph.nodes[0], importance: 0 }),
    );
    expect(radius({ ...graph.nodes[0], importance: 99 })).toBe(
      radius({ ...graph.nodes[0], importance: 1 }),
    );
  });
  it("bounds incremental data, updates stable IDs and removes dangling edges", () => {
    const many: BrainGraph = {
      ...graph,
      nodes: Array.from({ length: 300 }, (_, i) => ({
        ...graph.nodes[0],
        id: id(1000 + i),
      })),
      edges: [],
    };
    many.edges = Array.from({ length: 1000 }, (_, i) => ({
      ...graph.edges[0],
      id: id(4000 + i),
      source: id(1000),
      target: id(1001),
    }));
    const merged = mergeGraph({ ...graph, nodes: [], edges: [] }, many);
    expect(merged.nodes).toHaveLength(MAX_NODES);
    expect(merged.edges).toHaveLength(MAX_EDGES);
    expect(merged.meta.nodesTruncated && merged.meta.edgesTruncated).toBe(true);
    const updated = mergeGraph(graph, {
      ...graph,
      nodes: [{ ...graph.nodes[0], label: "Updated label" }],
      edges: [],
    });
    expect(updated.nodes[0].label).toBe("Updated label");
    expect(updated.nodes.length).toBe(graph.nodes.length);
    expect(
      merged.edges.every(
        (e) =>
          merged.nodes.some((n) => n.id === e.source) &&
          merged.nodes.some((n) => n.id === e.target),
      ),
    ).toBe(true);
  });
  it("fits a large bounded graph inside the viewport with padding", () => {
    const large = {
      ...graph,
      nodes: Array.from({ length: 240 }, (_, i) => ({
        ...graph.nodes[0],
        id: id(1000 + i),
      })),
    };
    const positions = layoutGraph(large),
      camera = fitCamera(positions, 1000, 700);
    for (const p of positions.values()) {
      expect(p.x * camera.scale + camera.x).toBeGreaterThan(0);
      expect(p.x * camera.scale + camera.x).toBeLessThan(1000);
      expect(p.y * camera.scale + camera.y).toBeGreaterThan(0);
      expect(p.y * camera.scale + camera.y).toBeLessThan(700);
    }
  });
});
