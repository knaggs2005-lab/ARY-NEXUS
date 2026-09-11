import { memoryInScope } from "./nexus-memory";
import type { Memory } from "./models";
import { z } from "zod";
import type { BrainGraph, BrainNode, BrainEdge } from "./brain-graph";
export const mapKinds = [
  "ary",
  "agent",
  "mission",
  "memory",
  "person",
  "company",
  "project",
  "location",
  "tool",
  "application",
  "device",
  "skill",
  "automation",
  "product",
  "goal",
  "decision",
  "task",
  "organization",
  "object",
  "outcome",
] as const;
export type MapKind = (typeof mapKinds)[number];
export const mapQuery = z
  .object({
    lens: z.enum(["nexus", "world", "memory"]).default("nexus"),
    q: z.string().trim().max(120).default(""),
    kind: z.enum(mapKinds).optional(),
    root: z.uuid().optional(),
    depth: z.coerce.number().int().min(1).max(2).default(1),
    after: z.uuid().optional(),
    page: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type MapQuery = z.infer<typeof mapQuery>;
export type MapRecordKind = "memory" | "mission" | "facets";
export type MapRecord = {
  locationId?: string;
  id: string;
  label: string;
  kind: MapKind;
  status: string;
  updatedAt: string;
  entityIds: string[];
  memoryIds: string[];
  detail: string;
};
export interface MapReadRepository {
  readMapInspection(
    tool: "desktop.list_apps" | "studio.inspect",
  ): Promise<MapRecord[]>;
  readMapRecords(
    kind: MapRecordKind,
    q: string,
    after?: string,
    facet?: MapKind,
    scope?: { entityId?: string },
  ): Promise<{ records: MapRecord[]; more: boolean }>;
}
export type MapNode = BrainNode & {
  kind: MapKind;
  source: string;
  detail: string;
  recordId?: string;
  destination: string;
  tool?: string;
  cluster?: string;
  members?: string[];
};
export type MapEdge = BrainEdge & {
  provenance: "stored" | "reference" | "capability" | "aggregate";
  evidence: string[];
};
export type NexusMap = {
  nodes: MapNode[];
  edges: MapEdge[];
  meta: {
    generatedAt: string;
    more: boolean;
    cursor: string | null;
    warnings: string[];
  };
};
export function mapNode(
  id: string,
  label: string,
  kind: MapKind,
  source: string,
  detail: string,
  destination: string,
  extra: Partial<MapNode> = {},
): MapNode {
  return {
    id,
    label: label.slice(0, 160),
    kind,
    type: kind,
    status: "recorded",
    importance: null,
    recency: "",
    connectedMemoryCount: 0,
    activeBlockerCount: 0,
    activeBlockers: [],
    relatedGoalCount: 0,
    relatedGoals: [],
    source,
    detail: detail.slice(0, 500),
    destination,
    ...extra,
  };
}
export function mapEdge(
  source: string,
  target: string,
  type: string,
  provenance: MapEdge["provenance"],
  id = `${type}:${source}:${target}`,
): MapEdge {
  return {
    id,
    source,
    target,
    type,
    provenance,
    evidence: [],
    strength: 1,
    status: "current",
    validFrom: null,
    validTo: null,
    updatedAt: "",
    evidenceMemoryId: null,
  };
}
export function asBrainGraph(map: NexusMap): BrainGraph {
  return {
    version: "brain-graph-v1",
    nodes: map.nodes,
    edges: map.edges,
    meta: {
      root: null,
      depth: 1,
      generatedAt: map.meta.generatedAt,
      nodesTruncated: map.meta.more,
      edgesTruncated: false,
      nextCursor: map.meta.cursor,
    },
  };
}
/** Only source metadata is projected. Never copy embeddings, transcripts, model inputs or tool results. */
export function projectMapRecord(
  kind: MapRecordKind,
  raw: Record<string, unknown>,
): MapRecord | null {
  if (
    kind === "memory" &&
    (!memoryInScope({
      ...raw,
      metadata: raw.metadata ?? {},
    } as unknown as Memory) ||
      (raw.valid_to && Date.parse(String(raw.valid_to)) <= Date.now()) ||
      (raw.valid_from && Date.parse(String(raw.valid_from)) > Date.now()))
  )
    return null;
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  const plan = (raw.plan ?? metadata.plan) as
    Record<string, unknown> | undefined;
  const ids = (v: unknown) =>
    Array.isArray(v)
      ? v
          .filter(
            (x): x is string =>
              typeof x === "string" && z.uuid().safeParse(x).success,
          )
          .slice(0, 20)
      : [];
  if (kind === "mission" && !plan) return null;
  const facet = metadata.nexus_kind;
  if (
    kind === "facets" &&
    !(
      [
        "location",
        "application",
        "device",
        "skill",
        "automation",
        "organization",
        "object",
      ] as unknown[]
    ).includes(facet)
  )
    return null;
  return {
    id: String(raw.id),
    label: String(
      kind === "memory"
        ? raw.summary || String(raw.content ?? "Memory").slice(0, 90)
        : kind === "mission"
          ? plan?.goal || "Execution plan"
          : raw.name || "Entity",
    ).slice(0, 160),
    kind: kind === "facets" ? (facet as MapKind) : kind,
    status: String(
      kind === "mission"
        ? ((plan?.mission as { state?: string } | undefined)?.state ??
            plan?.status)
        : (raw.status ?? "recorded"),
    ),
    updatedAt: String(raw.updated_at),
    entityIds: kind === "mission" ? ids(plan?.entity_ids) : [],
    memoryIds: kind === "mission" ? ids(plan?.memory_ids) : [],
    detail:
      kind === "memory"
        ? `${raw.memory_type} · source evidence in Memory`
        : kind === "mission"
          ? `Saved plan revision ${plan?.revision ?? 0}`
          : "Explicit nexus_kind metadata on the canonical entity",
  };
}
/** Projection of existing successful inspection receipts. Never performs discovery or contacts devices. */
export function projectInspection(raw: Record<string, unknown>): MapRecord[] {
  const output = raw.output as { result?: Record<string, unknown> } | undefined,
    result = output?.result ?? {};
  const kind = raw.tool_name === "desktop.list_apps" ? "application" : "device";
  const items = result[kind === "application" ? "apps" : "devices"];
  if (!Array.isArray(items)) return [];
  const observations = Array.isArray(result.observations)
    ? result.observations
    : [];
  const devices: MapRecord[] = items
    .slice(0, 512)
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        (kind !== "device" ||
          item.adapter !== "unconfigured" ||
          observations.some(
            (o) => o.device_id === item.id && o.status === "available",
          )),
    )
    .map((item) => ({
      id: `${kind}:${item.id}`,
      label: item.name.slice(0, 160),
      kind,
      status: "previously_observed",
      updatedAt: String(raw.updated_at),
      ...(kind === "device"
        ? { locationId: `location:${item.location_id ?? "studio"}` }
        : {}),
      entityIds:
        typeof item.entity_id === "string" &&
        z.uuid().safeParse(item.entity_id).success
          ? [item.entity_id]
          : [],
      memoryIds: [],
      detail: `Inspection receipt ${raw.id}. This is a saved observation, not current availability.`,
    }));
  if (kind === "device" && Array.isArray(result.locations)) {
    for (const location of result.locations.slice(0, 30)) {
      if (
        !location ||
        typeof location !== "object" ||
        typeof location.id !== "string" ||
        typeof location.name !== "string"
      )
        continue;
      devices.push({
        id: `location:${location.id}`,
        label: location.name.slice(0, 160),
        kind: "location",
        status: "configured",
        updatedAt: String(raw.updated_at),
        entityIds:
          typeof location.entity_id === "string" &&
          z.uuid().safeParse(location.entity_id).success
            ? [location.entity_id]
            : [],
        memoryIds: [],
        detail: `Configured physical location from inspection ${raw.id}; no hardware presence implied.`,
      });
    }
  }
  return devices;
}
