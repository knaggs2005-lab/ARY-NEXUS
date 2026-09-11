import { z } from "zod";
import type { LanguageModelProvider } from "./providers";
export const modelTasks = [
  "chat",
  "analysis",
  "planning",
  "extraction",
] as const;
export type ModelTask = (typeof modelTasks)[number];
export const routePolicy = z
  .object({
    privacy: z.enum(["cloud_allowed", "local_only"]).default("cloud_allowed"),
    preference: z.enum(["balanced", "latency", "cost"]).default("balanced"),
    max_estimated_cost_usd: z.number().nonnegative().optional(),
    timeout_ms: z.number().int().min(50).max(60000).default(20000),
    total_timeout_ms: z.number().int().min(50).max(120000).default(45000),
    required_capabilities: z
      .array(z.enum(["reasoning", "structured", "streaming"]))
      .max(3)
      .default([]),
  })
  .strict();
export type RoutePolicy = z.infer<typeof routePolicy>;
export const modelTarget = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
    provider: z.enum([
      "openai",
      "anthropic",
      "gemini",
      "llama.cpp",
      "mlx",
      "compatible",
      "development",
    ]),
    model: z.string().min(1).max(120),
    location: z.enum(["local", "cloud"]),
    tasks: z.array(z.enum(modelTasks)).min(1).max(4),
    capabilities: z
      .array(z.enum(["reasoning", "structured", "streaming"]))
      .min(1)
      .max(3),
    context_tokens: z.number().int().min(128).max(4000000),
    priority: z.number().int().min(0).max(100).default(0),
    expected_latency_ms: z.number().positive().nullable().default(null),
    input_usd_per_million: z.number().nonnegative().nullable().default(null),
    output_usd_per_million: z.number().nonnegative().nullable().default(null),
    enabled: z.boolean().default(true),
  })
  .strict();
export type ModelDescriptor = z.infer<typeof modelTarget>;
export interface ModelTarget extends ModelDescriptor {
  adapter: LanguageModelProvider;
  available: () => boolean;
  healthKey: string;
}
export interface RoutingTrace {
  task: ModelTask;
  privacy: RoutePolicy["privacy"];
  preference: RoutePolicy["preference"];
  selected: string | null;
  reason: string;
  degraded: boolean;
  latency_ms: number;
  candidates: {
    id: string;
    eligible: boolean;
    reason: string;
    estimated_cost_usd: number | null;
  }[];
  attempts: {
    id: string;
    provider: string;
    model: string;
    status: "succeeded" | "failed";
    error_code?: string;
    latency_ms: number;
  }[];
}
