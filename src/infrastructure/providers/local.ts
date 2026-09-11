import { createHash } from "node:crypto";
import type {
  BrainContext,
  EmbeddingProvider,
  LanguageModelProvider,
} from "../../domain/providers";
/** Development baseline only: normalized hashed words with a small concept dictionary. */
const aliases: Record<string, string> = {
  remembering: "memory",
  memories: "memory",
  recall: "memory",
  remember: "memory",
  retrieval: "memory",
  persistent: "memory",
  persistence: "memory",
  organisation: "company",
  organization: "company",
  business: "company",
  objectives: "goal",
  goals: "goal",
  aim: "goal",
  choices: "decision",
  decisions: "decision",
  people: "person",
  connections: "relationship",
  relationships: "relationship",
  architecture: "system",
  hub: "system",
};
export function lexicalTokens(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (x) =>
      !new Set([
        "a",
        "an",
        "the",
        "is",
        "are",
        "and",
        "or",
        "of",
        "to",
        "in",
        "for",
        "what",
        "how",
        "about",
        "with",
        "it",
        "i",
        "me",
        "my",
      ]).has(x),
  );
}
export function tokens(text: string) {
  return lexicalTokens(text).map((x) => aliases[x] ?? x);
}
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelId = "local-concepts-v1:384";
  readonly version = "local-concepts-v1";
  readonly dimensions = 384;
  async embed(text: string) {
    const result = Array<number>(384).fill(0);
    for (const token of tokens(text)) {
      const hash = createHash("sha256").update(token).digest();
      result[hash.readUInt32BE(0) % 384] += 1;
    }
    const norm = Math.hypot(...result);
    return norm ? result.map((x) => x / norm) : result;
  }
}
export class MockLanguageModel implements LanguageModelProvider {
  readonly name = "Development stub";
  async identifyIntent(input: string) {
    return /^remember\s*:/i.test(input)
      ? "store_memory"
      : /\b(plan|next|goal)\b/i.test(input)
        ? "planning"
        : "recall";
  }
  async reason(context: BrainContext) {
    const evidence = context.memories
      .map((m, i) => `[${i + 1}] ${m.summary || m.content}`)
      .join("\n\n");
    return evidence
      ? `Here is the stored context relevant to your message:\n\n${evidence}\n\nDevelopment stub: these are retrieved records, not a generated conclusion.`
      : "I did not find a relevant active memory. Add a memory or say “Remember: …” to store an explicit fact. The development stub does not invent an answer.";
  }
  async extractMemories(input: string) {
    const match = input.match(/^remember\s*:\s*([\s\S]+)$/i);
    return match
      ? [
          {
            content: match[1],
            memory_type: "fact" as const,
            importance_score: 0.6,
            confidence_score: 0.8,
            metadata: { extraction: "explicit_user_request" },
          },
        ]
      : [];
  }
}
