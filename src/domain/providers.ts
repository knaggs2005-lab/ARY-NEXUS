import type { EntityResolution } from "./entity-resolution";
import type { Entity, MemoryHit, Message } from "./models";
import type { z } from "zod";
import type { memoryInput } from "./validation";
export interface EmbeddingProvider {
  readonly modelId: string;
  readonly version?: string;
  readonly dimensions?: number;
  embed(text: string, options?: { signal?: AbortSignal }): Promise<number[]>;
}
export interface BrainContext {
  capabilities?: import("./models").Json[];
  entity_resolutions?: EntityResolution[];
  input: string;
  intent: string;
  entities: Entity[];
  memories: MemoryHit[];
  history: Message[];
}
export interface ExtractionContext {
  source: Message;
  history: Message[];
  entities: Entity[];
  memories: MemoryHit[];
}
export interface MemoryExtractionProvider {
  extractCandidates(
    context: ExtractionContext,
    options?: import("./voice").ReasoningOptions,
  ): Promise<z.input<typeof import("./validation").extractionCandidate>[]>;
}
export interface ReasoningResult {
  routing?: import("./model-router").RoutingTrace;
  content: string;
  model: string;
  provider: string;
  metrics: {
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
    latency_ms: number;
    estimated_cost_usd: number | null;
    retrieval_count: number;
    pricing_version: string;
  };
}
export interface LanguageModelProvider {
  planWithUsage?(
    context: BrainContext,
    capabilities: import("./models").Json[],
    options?: import("./voice").ReasoningOptions,
  ): Promise<ReasoningResult>;
  reasonWithUsage?(
    context: BrainContext,
    options?: import("./voice").ReasoningOptions,
  ): Promise<ReasoningResult>;
  readonly name: string;
  extractCandidates?: MemoryExtractionProvider["extractCandidates"];
  identifyIntent(input: string): Promise<string>;
  reason(context: BrainContext): Promise<string>;
  extractMemories(
    input: string,
    options?: import("./voice").ReasoningOptions,
  ): Promise<z.input<typeof memoryInput>[]>;
}
