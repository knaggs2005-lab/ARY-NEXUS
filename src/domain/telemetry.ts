import type { ModelCall, NewRecord } from "./models";
export type ModelMetric = NewRecord<ModelCall>;
export type Telemetry = (metric: ModelMetric) => Promise<void>;
/** Only aggregate operational fields. Never log prompts, responses, keys, or vectors. */
export const consoleTelemetry: Telemetry = async (metric) => {
  console.info(JSON.stringify({ event: "ary.model_call", ...metric }));
};
// Standard text pricing, USD per million tokens, checked 2026-09-06.
// https://developers.openai.com/api/docs/models/gpt-5.6-sol
// https://developers.openai.com/api/docs/models/text-embedding-3-large
export const PRICING_VERSION = "openai-standard-2026-09-06";
export function estimateCost(
  model: string,
  input: number | null,
  cached: number | null,
  output: number | null,
) {
  if (input === null) return null;
  if (model === "text-embedding-3-large") return (input * 0.13) / 1e6;
  if (model === "gpt-5.6-sol" || model.startsWith("gpt-5.6-sol-")) {
    if (output === null) return null;
    const multiplier = input > 272000 ? 2 : 1;
    return (
      ((input - (cached ?? 0)) * 4 * multiplier +
        (cached ?? 0) * 0.4 * multiplier +
        output * 20 * (input > 272000 ? 1.5 : 1)) /
      1e6
    );
  }
  return null; // Do not invent prices for swapped models.
}
