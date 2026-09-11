import {
  mapEdge,
  mapNode,
  type NexusMap,
  type MapNode,
  type MapEdge,
} from "../../domain/nexus-map";
import { isFreshEvent, type NexusEvent } from "../../domain/nexus-events";
import type { Point } from "../brain/graph-engine";
export const MAP_NODE_BUDGET = 100;
export const kindLabels: Record<string, string> = {
  ary: "ARY",
  agent: "Perspectives",
  mission: "Missions",
  memory: "Memory",
  person: "People",
  company: "Companies",
  project: "Projects",
  location: "Locations",
  tool: "Tools",
  application: "Applications",
  device: "Devices",
  skill: "Skills",
  automation: "Automations",
  product: "Products",
  goal: "Goals",
  decision: "Decisions",
  task: "Tasks",
  organization: "Organizations",
  object: "Objects",
  outcome: "Outcomes",
};
/** Semantic membership uses explicit current project/company relationships, then record/capability meaning. */
export function clusters(map: NexusMap) {
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const parents = new Map<string, string>();
  for (const e of [...map.edges].sort((a, b) => a.id.localeCompare(b.id)))
    if (
      e.provenance === "stored" &&
      e.status === "current" &&
      ["part_of", "belongs_to"].includes(e.type) &&
      ["project", "company"].includes(nodes.get(e.target)?.kind ?? "")
    )
      if (!parents.has(e.source)) parents.set(e.source, e.target);
  const groups = new Map<string, { label: string; nodes: MapNode[] }>();
  for (const n of map.nodes) {
    if (n.kind === "ary") continue;
    const parent = parents.get(n.id);
    const key = parent ? `scope:${parent}` : `kind:${n.kind}`;
    const label = parent
      ? `${nodes.get(parent)!.label} context`
      : kindLabels[n.kind];
    const group = groups.get(key) ?? { label, nodes: [] };
    group.nodes.push(n);
    groups.set(key, group);
  }
  return groups;
}
export function projectMap(
  map: NexusMap,
  expanded: ReadonlySet<string>,
  detail: boolean,
  selected: string | null = null,
): NexusMap {
  const groups = clusters(map),
    nodes = map.nodes.filter((n) => n.kind === "ary"),
    owner = new Map<string, string>();
  for (const [key, group] of [...groups].sort(
    (a, b) =>
      Number(b[1].nodes.some((n) => n.id === selected)) -
      Number(a[1].nodes.some((n) => n.id === selected)),
  )) {
    const id = `cluster:${key}`;
    const shouldOpen =
      expanded.has(id) ||
      (detail && group.nodes.length <= 5 && selected !== id) ||
      group.nodes.some((n) => n.id === selected);
    const ordered = [...group.nodes].sort(
      (a, b) =>
        Number(b.id === selected) - Number(a.id === selected) ||
        (b.importance ?? 0) - (a.importance ?? 0) ||
        a.id.localeCompare(b.id),
    );
    const limit = shouldOpen
      ? Math.min(24, Math.max(0, MAP_NODE_BUDGET - nodes.length - groups.size))
      : 0;
    const visible = ordered.slice(0, limit),
      rest = ordered.slice(limit);
    for (const n of visible) {
      nodes.push({ ...n, cluster: id });
      owner.set(n.id, n.id);
    }
    if (rest.length) {
      nodes.push(
        mapNode(
          id,
          group.label,
          group.nodes[0].kind,
          "Semantic view group",
          `${rest.length} records in this loaded window. Grouping uses explicit membership and record meaning; it does not merge identities.`,
          "Graph",
          {
            type: "cluster",
            members: rest.map((n) => n.id),
            importance: 0.4,
            cluster: id,
            status: "group",
            label: shouldOpen
              ? `${group.label} · ${rest.length} more`
              : group.label,
          },
        ),
      );
      for (const n of rest) owner.set(n.id, id);
    }
  }
  for (const n of map.nodes.filter((n) => n.kind === "ary"))
    owner.set(n.id, n.id);
  const edges = new Map<string, MapEdge>();
  for (const e of map.edges) {
    const source = owner.get(e.source),
      target = owner.get(e.target);
    if (!source || !target || source === target) continue;
    const id =
      source === e.source && target === e.target
        ? e.id
        : `aggregate:${source}:${target}:${e.type}`;
    const prev = edges.get(id);
    edges.set(id, {
      ...e,
      id,
      source,
      target,
      provenance: id === e.id ? e.provenance : "aggregate",
      evidence: [
        ...(prev?.evidence ?? []),
        ...(e.evidence.length ? e.evidence : [e.id]),
      ].slice(0, 40),
    });
  }
  const kept = nodes.slice(0, MAP_NODE_BUDGET),
    keptIds = new Set(kept.map((n) => n.id));
  return {
    ...map,
    meta: {
      ...map.meta,
      more: map.meta.more || nodes.length > MAP_NODE_BUDGET,
    },
    nodes: kept,
    edges: [...edges.values()]
      .filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
      .slice(0, 240),
  };
}
const hash = (s: string) =>
  [...s].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 0);
/** Stable semantic sectors; no force simulation. Depth is presentation, never an asserted real-world distance. */
export function spatialLayout(
  map: NexusMap,
  yaw = 0,
  pitch = 0,
): Map<string, Point> {
  const keys = [
    ...new Set(
      map.nodes
        .filter((n) => n.kind !== "ary")
        .map((n) => n.cluster ?? `kind:${n.kind}`),
    ),
  ].sort();
  const groups = new Map(keys.map((k) => [k, [] as MapNode[]]));
  for (const n of map.nodes) groups.get(n.cluster ?? `kind:${n.kind}`)?.push(n);
  const positions = new Map<string, Point>();
  for (const n of map.nodes) {
    if (n.kind === "ary") {
      positions.set(n.id, { x: 0, y: 0 });
      continue;
    }
    const key = n.cluster ?? `kind:${n.kind}`,
      index = keys.indexOf(key),
      siblings = groups.get(key)!.sort((a, b) => a.id.localeCompare(b.id));
    const slot = siblings.indexOf(n),
      angle = -Math.PI / 2 + (index / Math.max(1, keys.length)) * Math.PI * 2;
    const distance = keys.length > 9 ? 530 : 430;
    const spread = n.members ? 0 : Math.sqrt(slot + 1) * 75,
      spin = slot * 2.399963;
    const x = Math.cos(angle) * distance + Math.cos(spin) * spread,
      y = Math.sin(angle) * distance * 0.78 + Math.sin(spin) * spread;
    const z = ((hash(key) % 5) - 2) * 42;
    const rx = x * Math.cos(yaw) + z * Math.sin(yaw),
      rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
    const ry = y * Math.cos(pitch) - rz * Math.sin(pitch),
      depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
    const perspective = 1100 / (1100 + depth);
    positions.set(n.id, { x: rx * perspective, y: ry * perspective });
  }
  return positions;
}
/** Only explicit IDs co-referenced by a fresh backend/database event can activate a path. */
export function eventConnections(
  map: NexusMap,
  events: readonly NexusEvent[],
  now = Date.now(),
) {
  const ids = new Set(map.nodes.map((n) => n.id)),
    edges: MapEdge[] = [];
  for (const e of events.slice(-100)) {
    if (
      e.source.kind === "client" ||
      e.visibility === "internal" ||
      !isFreshEvent(e, now) ||
      now - Date.parse(e.timestamp) > 8000
    )
      continue;
    const refs = [
      e.related_entity_id,
      e.mission_id ? `mission:${e.mission_id}` : null,
      e.payload.memory_id
        ? `memory:${e.payload.memory_id}`
        : e.source.name === "memories"
          ? `memory:${e.payload.record_id}`
          : null,
      e.payload.tool ? `tool:${e.payload.tool}` : null,
      e.payload.device_id ? `device:${e.payload.device_id}` : null,
      e.payload.role ? `agent:${e.payload.role}` : null,
      e.payload.agent_id ? `agent:${e.payload.agent_id}` : null,
      e.payload.parent_agent_id ? `agent:${e.payload.parent_agent_id}` : null,
    ].filter((x): x is string => !!x && ids.has(x));
    if (e.type.startsWith("agent.") && refs.length && ids.has("system:ary"))
      refs.push("system:ary");
    const unique = [...new Set(refs)];
    for (let i = 1; i < unique.length; i++)
      edges.push({
        ...mapEdge(
          unique[0],
          unique[i],
          "observed_together",
          "reference",
          `event:${e.id}:${i}`,
        ),
        evidence: [e.id],
        updatedAt: e.timestamp,
      });
  }
  return edges.slice(-40);
}
