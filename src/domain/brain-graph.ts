import { z } from "zod";

export const graphQuerySchema = z
  .object({
    root: z.uuid().optional(),
    depth: z.coerce.number().int().min(1).max(2).default(1),
    q: z.string().trim().max(120).default(""),
    types: z.preprocess(
      (v) => (typeof v === "string" ? v.split(",") : v),
      z
        .array(
          z.enum([
            "person",
            "company",
            "project",
            "product",
            "goal",
            "decision",
            "task",
          ]),
        )
        .max(7)
        .default([]),
    ),
    project_id: z.uuid().optional(),
    company_id: z.uuid().optional(),
    relationships: z.enum(["current", "historical", "all"]).default("current"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    edge_limit: z.coerce.number().int().min(1).max(500).default(200),
    after: z.uuid().optional(),
  })
  .strict()
  .refine((q) => !q.root || !q.after, {
    message: "Neighborhoods cannot use a node-search cursor",
    path: ["after"],
  });
export type GraphQuery = z.infer<typeof graphQuerySchema>;
export type BrainNode = {
  id: string;
  label: string;
  type: string;
  status: string;
  importance: number | null;
  recency: string;
  connectedMemoryCount: number;
  activeBlockerCount: number;
  activeBlockers: { id: string; label: string; relationshipId: string }[];
  relatedGoalCount: number;
  relatedGoals: {
    id: string;
    title: string;
    status: string;
    progress: number;
  }[];
};
export type BrainEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  status: "current" | "historical" | "scheduled" | "inactive";
  validFrom: string | null;
  validTo: string | null;
  updatedAt: string;
  evidenceMemoryId: string | null;
};
export type BrainGraph = {
  version: "brain-graph-v1";
  nodes: BrainNode[];
  edges: BrainEdge[];
  meta: {
    root: string | null;
    depth: number;
    generatedAt: string;
    nodesTruncated: boolean;
    edgesTruncated: boolean;
    nextCursor: string | null;
  };
};
/** Production implementations must bound traversal and aggregate in the database. */
export interface GraphReadRepository {
  queryGraph(query: GraphQuery): Promise<BrainGraph>;
}
