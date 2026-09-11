import { AppError } from "../domain/validation";
import type { Repository } from "../domain/repository";
import type { EmbeddingProvider } from "../domain/providers";
import {
  embedRecord,
  embeddingHash,
  embeddingIdentity,
  embeddingInput,
} from "./embedding-record";
/** Rerunnable maintenance: includes every state, never modifies memory content or status. */
export class ReembeddingService {
  constructor(
    private repository: Repository,
    private provider: EmbeddingProvider,
  ) {}
  async run(limit = 50, dryRun = false) {
    const identity = embeddingIdentity(this.provider);
    const all = await this.repository.list("memories");
    const pending = all.filter(
      (m) =>
        !m.embedding ||
        m.embedding_model !== identity.embedding_model ||
        m.embedding_version !== identity.embedding_version ||
        m.embedding_dimensions !== identity.embedding_dimensions ||
        m.embedding_input_hash !==
          embeddingHash(embeddingInput(m.content, m.summary)),
    );
    const stats = {
      total: all.length,
      already_current: all.length - pending.length,
      updated: 0,
      failed: 0,
      error: null as string | null,
      remaining: pending.length,
      dry_run: dryRun,
      ...identity,
    };
    if (dryRun) return stats;
    for (const memory of pending.slice(0, Math.max(1, Math.min(50, limit)))) {
      try {
        const patch = await embedRecord(
          this.provider,
          memory.content,
          memory.summary,
        );
        await this.repository.batch([
          {
            kind: "update",
            table: "memories",
            id: memory.id,
            expected_updated_at: memory.updated_at,
            data: patch,
          },
        ]);
        stats.updated++;
      } catch (error) {
        stats.failed++;
        stats.error =
          error instanceof AppError
            ? error.message
            : "Re-embedding failed; check server logs and retry.";
        break;
      }
    }
    stats.remaining = pending.length - stats.updated;
    console.info(JSON.stringify({ event: "ary.reembedding", ...stats }));
    return stats;
  }
}
