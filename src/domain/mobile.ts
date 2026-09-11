import type { BrainGraph } from "./brain-graph";
export type MobileTab = "Ary" | "Missions" | "Capture" | "Nexus" | "Updates";
/** Navigation only; executable intents always go to the existing Brain/action pipeline. */
export function mobileDestination(destination: string): MobileTab {
  if (
    ["Approvals", "Action history", "Activity", "Settings"].includes(
      destination,
    )
  )
    return "Updates";
  if (
    ["Execution Plans", "Priority", "Board", "Agent Runtime"].includes(
      destination,
    )
  )
    return "Missions";
  if (["Perception"].includes(destination)) return "Capture";
  if (
    [
      "Memories",
      "Memory map",
      "World map",
      "Entities",
      "Relationships",
      "Graph",
      "Studio",
      "Tools",
    ].includes(destination)
  )
    return "Nexus";
  return "Ary";
}
/** Bounded, deterministic radial projection. No simulated nodes or activity. */
export function mobileGraphLayout(graph: BrainGraph) {
  const nodes = graph.nodes.slice(0, 18);
  const ids = new Set(nodes.map((n) => n.id));
  const root = nodes.find((n) => n.id === graph.meta.root) ?? nodes[0];
  const others = nodes.filter((n) => n !== root);
  return {
    nodes: nodes.map((node) => {
      const index = others.indexOf(node);
      const angle =
        (index / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
      const radius = index % 2 ? 115 : 145;
      return {
        ...node,
        x: node === root ? 180 : 180 + Math.cos(angle) * radius,
        y: node === root ? 180 : 180 + Math.sin(angle) * radius,
      };
    }),
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .slice(0, 36),
    truncated:
      graph.meta.nodesTruncated ||
      graph.nodes.length > 18 ||
      graph.meta.edgesTruncated ||
      graph.edges.length > 36,
  };
}
export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  observed_at: string;
}
export interface MobileLocationProvider {
  locate(signal: AbortSignal): Promise<LocationFix>;
}
export function coarseLocation(fix: LocationFix): LocationFix {
  if (
    ![fix.latitude, fix.longitude, fix.accuracy_m].every(Number.isFinite) ||
    Math.abs(fix.latitude) > 90 ||
    Math.abs(fix.longitude) > 180 ||
    fix.accuracy_m < 0 ||
    !Number.isFinite(Date.parse(fix.observed_at))
  )
    throw Error("Invalid location reading");
  return {
    latitude: Math.round(fix.latitude * 100) / 100,
    longitude: Math.round(fix.longitude * 100) / 100,
    accuracy_m: Math.max(1500, Math.ceil(fix.accuracy_m)),
    observed_at: fix.observed_at,
  };
}
export function mobileMissionCommands(state: string): string[] {
  return (
    (
      {
        DRAFT: ["plan", "cancel"],
        PLANNING: ["tick", "cancel"],
        READY: ["start", "cancel"],
        RUNNING: ["tick", "pause", "cancel"],
        WAITING: ["resume", "pause", "cancel"],
        APPROVAL_REQUIRED: ["resume", "pause", "cancel"],
        PAUSED: ["resume", "cancel"],
        FAILED: ["retry", "cancel"],
        CANCELLED: [],
        COMPLETED: [],
      } as Record<string, string[]>
    )[state] ?? []
  );
}

/** Hide destinations with no mobile detail surface instead of silently losing the selected record/action. */
export function mobileSupportsDestination(d: {
  tab: string;
  tool?: string;
  recordId?: string;
}) {
  if (d.tool) return false;
  if (d.recordId && !/^entity-[0-9a-f-]{36}$/i.test(d.recordId)) return false;
  return [
    "Chat",
    "Graph",
    "Memory map",
    "World map",
    "Memories",
    "Entities",
    "Relationships",
    "Execution Plans",
    "Approvals",
    "Action history",
    "Perception",
    "Studio",
  ].includes(d.tab);
}
