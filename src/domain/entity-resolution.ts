import type { Entity } from "./models";
export interface EntityResolution {
  mention: string;
  start: number;
  end: number;
  status: "resolved" | "ambiguous";
  method: "canonical" | "alias" | "context" | "unresolved";
  canonical_entity_id: string | null;
  canonical_name: string | null;
  confidence: number;
  reason: string;
  candidates: {
    id: string;
    name: string;
    entity_type: Entity["entity_type"];
  }[];
  evidence_relationship_ids: string[];
}
export interface EntityResolutionResult {
  entities: Entity[];
  resolutions: EntityResolution[];
}
