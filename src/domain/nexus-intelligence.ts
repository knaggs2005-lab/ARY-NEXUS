import { z } from "zod";
import type { NexusMap } from "./nexus-map";
import type { MemoryHit } from "./models";
export const intelligenceQuery = z
  .object({
    focus: z
      .string()
      .regex(/^(?:(?:memory|mission|outcome):)?[0-9a-f-]{36}$/i)
      .optional(),
    q: z.string().trim().max(200).default(""),
    history: z.enum(["current", "all"]).default("current"),
  })
  .strict()
  .refine((v) => Boolean(v.focus || v.q), "Select a record or enter a query");
export type IntelligenceMemory = {
  id: string;
  title: string;
  content: string;
  class: string;
  status: string;
  confidence: number;
  learnedAt: string;
  validFrom: string | null;
  validTo: string | null;
  sources: {
    id: string;
    kind: string;
    reference: string;
    quote: string | null;
    at: string;
  }[];
  conflicts: number;
  relevance?: MemoryHit["explanation"];
};
export type IntelligenceMoment = {
  id: string;
  nodeId: string;
  at: string;
  kind:
    "episode" | "learned" | "revision" | "supersession" | "mission" | "outcome";
  title: string;
  before?: string;
  after?: string;
  source: string;
};
export type NexusIntelligence = {
  map: NexusMap;
  focus: string | null;
  memories: IntelligenceMemory[];
  timeline: IntelligenceMoment[];
  query: string;
  explanation: string;
};
