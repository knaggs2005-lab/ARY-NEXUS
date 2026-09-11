import { beforeEach, describe, expect, it } from "vitest";
import {
  createEffectsBridge,
  type EffectsSnapshot,
} from "../src/components/brain/effects/bridge";
import {
  packScene,
  MAX_SPRITES,
  STRIDE,
  createFrameHealth,
} from "../src/components/brain/effects/scene";
import {
  clearKnowledgeEvents,
  noteKnowledgeCreated,
  takeKnowledgeEvents,
} from "../src/components/brain/effects/knowledge-events";
import { graphSample } from "../src/infrastructure/graph-sample";
import { queryLocalGraph } from "../src/infrastructure/repositories/local-graph";
import { graphQuerySchema } from "../src/domain/brain-graph";
const graph = queryLocalGraph(
  graphSample(),
  graphQuerySchema.parse({ relationships: "all" }),
);
function snapshot(): EffectsSnapshot {
  return {
    graph,
    camera: { x: 100, y: 100, scale: 1 },
    positions: new Map(
      graph.nodes.map((n, i) => [n.id, { x: i * 65, y: 200 }]),
    ),
    opacity: new Map(),
    selected: graph.nodes[0].id,
    width: 1000,
    height: 700,
  };
}
beforeEach(clearKnowledgeEvents);
describe("Brain effects presentation boundary", () => {
  it("tracks actual animated positions/camera without changing canonical data", () => {
    const bridge = createEffectsBridge();
    const s = snapshot(),
      original = JSON.stringify(s.graph);
    let updates = 0;
    const stop = bridge.subscribe(() => updates++);
    bridge.publish(s);
    const packed = packScene(s, [], 0, "standard");
    expect([...packed.data.slice(0, 2)]).toEqual([0, 200]);
    expect(bridge.read().snapshot?.camera).toEqual(s.camera);
    expect(JSON.stringify(s.graph)).toBe(original);
    stop();
    bridge.publish({ ...s, camera: { x: 50, y: 20, scale: 2 } });
    expect(updates).toBe(1);
    expect(bridge.read().revision).toBe(2);
  });
  it("bounds a high-degree graph and prioritizes the selected halo", () => {
    const s = snapshot();
    s.graph = {
      ...graph,
      nodes: Array.from({ length: 240 }, (_, i) => ({
        ...graph.nodes[0],
        id: String(i),
        importance: 0.9,
      })),
      edges: Array.from({ length: 900 }, (_, i) => ({
        ...graph.edges[0],
        id: String(i),
        source: "0",
        target: String((i % 239) + 1),
        status: "current",
      })),
    };
    s.selected = "239";
    s.positions = new Map(s.graph.nodes.map((n) => [n.id, { x: 100, y: 200 }]));
    const result = packScene(s, [], 0, "standard");
    expect(result.count).toBeLessThanOrEqual(56);
    expect(result.data.length).toBe(MAX_SPRITES * STRIDE);
    expect(result.data[6]).toBeCloseTo(0.18);
    expect(packScene(s, [], 0, "low").count).toBeLessThanOrEqual(20);
  });
  it("never animates historical relationships and culls offscreen halos", () => {
    const s = snapshot();
    s.graph = {
      ...graph,
      edges: graph.edges.map((e) => ({ ...e, status: "historical" })),
    };
    const p = packScene(s, [], 0, "standard");
    for (let i = 0; i < p.count; i++) expect(p.data[i * STRIDE + 3]).toBe(0);
    s.camera = { x: -10000, y: -10000, scale: 1 };
    expect(packScene(s, [], 0, "standard").count).toBe(0);
  });
  it("keeps selected paths crossing the viewport even with both endpoints outside", () => {
    const s = snapshot();
    s.graph = {
      ...graph,
      nodes: [],
      edges: [{ ...graph.edges[0], status: "current" }],
    };
    const e = s.graph.edges[0];
    s.selected = e.source;
    s.positions = new Map([
      [e.source, { x: -200, y: 150 }],
      [e.target, { x: 1500, y: 150 }],
    ]);
    expect(packScene(s, [], 0, "standard").count).toBe(1);
  });
  it("emits particles only for confirmed events, expires bursts, and suppresses them on low quality", () => {
    const s = snapshot();
    const base = packScene(s, [], 2, "standard").count;
    const burst = {
      event: { id: "saved", kind: "memory" as const, entityIds: [], at: 0 },
      started: 1,
    };
    expect(packScene(s, [burst], 2, "standard").count).toBe(base + 12);
    expect(packScene(s, [burst], 4, "standard").count).toBe(base);
    expect(packScene(s, [burst], 2, "low").count).toBe(
      packScene(s, [], 2, "low").count,
    );
    expect(
      packScene(
        s,
        [{ ...burst, event: { ...burst.event, entityIds: ["outside-scope"] } }],
        2,
        "standard",
      ).count,
    ).toBe(base);
    expect(takeKnowledgeEvents()).toEqual([]);
    noteKnowledgeCreated({ id: "save1", kind: "memory", entityIds: [] });
    noteKnowledgeCreated({ id: "save1", kind: "memory", entityIds: [] });
    expect(takeKnowledgeEvents()).toHaveLength(1);
    expect(takeKnowledgeEvents()).toEqual([]);
    noteKnowledgeCreated({ id: "stale", kind: "memory", entityIds: [] });
    expect(takeKnowledgeEvents(Date.now() + 16000)).toEqual([]);
  });
  it("downgrades only for sustained poor cadence, resetting after suspension", () => {
    const health = createFrameHealth();
    for (let i = 1; i <= 180; i++) expect(health.sample(i * 16.67)).toBe(false);
    health.reset();
    let degraded = false;
    for (let i = 1; i <= 50; i++) degraded ||= health.sample(i * 70);
    expect(degraded).toBe(true);
    health.reset();
    expect(health.sample(30000)).toBe(false);
  });
});
