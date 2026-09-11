import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../domain/providers";
export const embeddingInput = (content: string, summary: string) =>
  `${content.trim()}\n${summary.trim()}`;
export const embeddingHash = (input: string) =>
  createHash("sha256").update(input).digest("hex");
export function embeddingIdentity(provider: EmbeddingProvider) {
  return {
    embedding_model: provider.modelId,
    embedding_version: provider.version ?? "legacy-v1",
    embedding_dimensions: provider.dimensions ?? 384,
  };
}
export async function embedRecord(
  provider: EmbeddingProvider,
  content: string,
  summary: string,
) {
  const input = embeddingInput(content, summary);
  const embedding = await provider.embed(input);
  const identity = embeddingIdentity(provider);
  if (
    embedding.length !== identity.embedding_dimensions ||
    embedding.some((n) => !Number.isFinite(n))
  )
    throw new Error("Invalid embedding dimensions or values");
  return { ...identity, embedding, embedding_input_hash: embeddingHash(input) };
}
