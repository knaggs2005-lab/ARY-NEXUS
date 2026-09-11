import { describe, it, expect, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import {
  mobileDestination,
  mobileMissionCommands,
  mobileSupportsDestination,
  mobileGraphLayout,
  coarseLocation,
} from "../src/domain/mobile";
import { BrowserLocationInput } from "../src/components/mobile/location";
import type { BrainGraph } from "../src/domain/brain-graph";
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["Chat", "Ary"],
  ["Approvals", "Updates"],
  ["Execution Plans", "Missions"],
  ["Memories", "Nexus"],
  ["Perception", "Capture"],
  ["Studio", "Nexus"],
])("maps existing destination %s without executing commands", (tab, expected) =>
  expect(mobileDestination(tab)).toBe(expected),
);
it("projects only bounded real nodes and edges", () => {
  const graph = {
    nodes: Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      label: `Entity ${i}`,
    })),
    edges: Array.from({ length: 99 }, (_, i) => ({
      id: String(i),
      source: "0",
      target: String(i + 1),
    })),
    meta: { root: "0", nodesTruncated: false, edgesTruncated: false },
  } as BrainGraph;
  const layout = mobileGraphLayout(graph);
  expect(layout.nodes).toHaveLength(18);
  expect(layout.edges).toHaveLength(17);
  expect(layout.truncated).toBe(true);
  expect(layout.nodes[0]).toMatchObject({ x: 180, y: 180 });
  expect(mobileGraphLayout(graph)).toEqual(layout);
});
it("handles empty graph without invented nodes", () =>
  expect(
    mobileGraphLayout({
      nodes: [],
      edges: [],
      meta: { nodesTruncated: false, edgesTruncated: false },
    } as unknown as BrainGraph).nodes,
  ).toEqual([]));
it("reduces precision and does not overstate location accuracy", () =>
  expect(
    coarseLocation({
      latitude: 37.77493,
      longitude: -122.41942,
      accuracy_m: 8,
      observed_at: "2026-09-10T00:00:00Z",
    }),
  ).toMatchObject({ latitude: 37.77, longitude: -122.42, accuracy_m: 1500 }));
it.each([NaN, Infinity, 100])("rejects invalid latitude %s", (latitude) =>
  expect(() =>
    coarseLocation({
      latitude,
      longitude: 0,
      accuracy_m: 8,
      observed_at: new Date().toISOString(),
    }),
  ).toThrow(),
);
it("location access is only made on explicit call and uses one-shot low-accuracy options", async () => {
  const get = vi.fn((done) =>
    done({
      coords: { latitude: 34.0123, longitude: -118.4456, accuracy: 5 },
      timestamp: Date.now(),
    }),
  );
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: get } });
  const provider = new BrowserLocationInput();
  expect(get).not.toHaveBeenCalled();
  await provider.locate(new AbortController().signal);
  expect(get).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
    enableHighAccuracy: false,
    maximumAge: 0,
    timeout: 10000,
  });
});
it("location denial returns an actionable error", async () => {
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: unknown, fail: (e: unknown) => void) =>
        fail({ code: 1 }),
    },
  });
  await expect(
    new BrowserLocationInput().locate(new AbortController().signal),
  ).rejects.toThrow("declined");
});
it("cancelled location request never resolves late coordinates", async () => {
  let success: (v: unknown) => void = () => {};
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (done: typeof success) => {
        success = done;
      },
    },
  });
  const c = new AbortController();
  const promise = new BrowserLocationInput().locate(c.signal);
  c.abort();
  await expect(promise).rejects.toThrow("cancelled");
  success({
    coords: { latitude: 0, longitude: 0, accuracy: 0 },
    timestamp: Date.now(),
  });
});
it("insecure origins cannot request location", async () => {
  vi.stubGlobal("window", { isSecureContext: false });
  await expect(
    new BrowserLocationInput().locate(new AbortController().signal),
  ).rejects.toThrow("HTTPS");
});
it("manifest stays scoped to mobile and provides real icon files", async () => {
  const m = JSON.parse(
    await readFile("public/mobile/manifest.webmanifest", "utf8"),
  );
  expect(m.scope).toBe("/mobile");
  expect(m.start_url).toBe("/mobile");
  for (const icon of m.icons)
    expect((await readFile(`public${icon.src}`)).length).toBeGreaterThan(100);
});
it("service worker cannot cache private data or replay writes", async () => {
  const sw = await readFile("public/mobile/sw.js", "utf8");
  expect(sw).not.toMatch(/caches\.|indexedDB|sync|pushManager/);
  expect(sw).toContain('event.request.mode !== "navigate"');
  expect(sw).toContain('"Cache-Control": "no-store"');
});

it.each([
  ["DRAFT", ["plan", "cancel"]],
  ["PLANNING", ["tick", "cancel"]],
  ["RUNNING", ["tick", "pause", "cancel"]],
  ["READY", ["start", "cancel"]],
  ["COMPLETED", []],
  ["PAUSED", ["resume", "cancel"]],
  ["FAILED", ["retry", "cancel"]],
])("mission %s offers only meaningful controls", (state, expected) =>
  expect(mobileMissionCommands(state as string)).toEqual(expected),
);

it("mobile commands expose real destinations, retain entity focus and exclude unsupported task/action details", () => {
  expect(
    mobileSupportsDestination({
      tab: "Entities",
      recordId: "entity-00000000-0000-4000-8000-000000000001",
    }),
  ).toBe(true);
  expect(
    mobileSupportsDestination({ tab: "Approvals", tool: "create_task" }),
  ).toBe(false);
  expect(
    mobileSupportsDestination({
      tab: "Activity",
      recordId: "task-00000000-0000-4000-8000-000000000001",
    }),
  ).toBe(false);
  expect(mobileSupportsDestination({ tab: "Skills" })).toBe(false);
  expect(mobileSupportsDestination({ tab: "Execution Plans" })).toBe(true);
});
