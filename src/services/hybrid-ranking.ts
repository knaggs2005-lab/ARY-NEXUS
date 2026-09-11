import type { MemoryHit } from "../domain/models";

export const RRF_K = 60;
/** Fuse independent channels ONCE. Importance/confidence only break identical RRF scores. */
export function rankHybridCandidates(
  candidates: MemoryHit[],
  limit: number,
): MemoryHit[] {
  const ranks = (items: MemoryHit[]) =>
    new Map(items.map((m, i) => [m.id, i + 1]));
  const semantic = ranks(
    candidates
      .filter((m) => m.semantic_rank != null)
      .sort(
        (a, b) =>
          b.semantic_score! - a.semantic_score! || a.id.localeCompare(b.id),
      ),
  );
  const lexical = ranks(
    candidates
      .filter((m) => m.text_rank != null)
      .sort(
        (a, b) => b.text_score! - a.text_score! || a.id.localeCompare(b.id),
      ),
  );
  // Direct entity links and neighborhood paths share one graph channel; no double vote.
  const graph = ranks(
    candidates
      .filter((m) => m.graph_hops != null)
      .sort(
        (a, b) => a.graph_hops! - b.graph_hops! || a.id.localeCompare(b.id),
      ),
  );
  return candidates
    .map((m) => {
      const sr = semantic.get(m.id) ?? null,
        tr = lexical.get(m.id) ?? null,
        gr = graph.get(m.id) ?? null;
      const sources: NonNullable<MemoryHit["retrieval_sources"]> = [];
      const reasons: string[] = [];
      if (sr) {
        sources.push("semantic");
        reasons.push(
          `Semantic match: cosine ${m.semantic_score!.toFixed(4)} passed the similarity threshold; source rank ${sr}.`,
        );
      }
      if (tr) {
        sources.push("lexical");
        reasons.push(
          `Text match: query terms matched content/summary; source rank ${tr}.`,
        );
      }
      if (gr) {
        sources.push(m.graph_hops === 0 ? "entity" : "graph");
        reasons.push(
          m.graph_hops === 0 ? "Linked entity" : "Relationship path",
        );
        reasons.push(
          `${m.graph_hops} relationship hop(s) from a resolved entity; source rank ${gr}.`,
        );
      }
      const score = [sr, tr, gr].reduce<number>(
        (sum, r) => sum + (r ? 1 / (RRF_K + r) : 0),
        0,
      );
      reasons.push(
        `RRF = ${[sr, tr, gr]
          .filter((r) => r !== null)
          .map((r) => `1/(60+${r})`)
          .join(" + ")}.`,
      );
      return {
        ...m,
        score,
        retrieval_version: "hybrid-rrf-v1" as const,
        semantic_rank: sr,
        text_rank: tr,
        graph_rank: gr,
        semantic_score: m.semantic_score ?? null,
        text_score: m.text_score ?? null,
        retrieval_sources: sources,
        retrieval_reasons: reasons,
      };
    })
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.importance_score - a.importance_score ||
        b.confidence_score - a.confidence_score ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((m, i) => ({ ...m, final_rank: i + 1 }));
}
