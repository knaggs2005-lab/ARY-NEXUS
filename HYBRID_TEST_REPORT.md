# Ary Nexus hybrid retrieval verification

Hybrid retrieval is implemented and migration `202609060004_hybrid_retrieval.sql` was applied successfully to the existing Supabase project on September 6, 2026. No new integrations were added.

## Automated checks

- **63 tests passed** across eight test files.
- Production Next.js build and TypeScript checks passed.
- Graph-only recall: direct entity links, one hop, two hops, reverse traversal and three-hop exclusion passed.
- Paraphrased recall: controlled-vector fixture retrieved the intended memory with no text or entity match.
- Exact recall: lexical-only identifiers and actual PostgreSQL English stemming passed.
- Irrelevant suppression: unrelated, blank and stopword-only fixture queries returned empty results, even with high-importance memories.
- Ranking: independent three-channel RRF arithmetic passed; importance/confidence only break equal final scores.
- Eligibility: tenant isolation, archive/status/validity filters, expired/zero-strength relationships and superseded relationship provenance passed.
- PostgreSQL migration executed twice in PGlite, confirming rerunnability and independent source-score output under authenticated RLS.

## Authenticated live checks

Used the existing Supabase workspace with real `text-embedding-3-large` embeddings and `gpt-5.6-sol` reasoning.

| Check                    | Observed result                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing embeddings      | All 6 records migrated to `openai-te3-large-384-content-summary-v1`; 0 remaining                                                                                                                                                                  |
| Idempotent rerun         | 0 updated; 0 remaining                                                                                                                                                                                                                            |
| Paraphrased recall       | “What should we favor when choosing between a prettier interface and simpler system structure with reliable recall?” retrieved the architecture-clarity/working-memory priority fact through **semantic only**, cosine **0.5000**, RRF **0.0164** |
| Paraphrase response      | Correctly favored clearer architecture and reliable recall, citing the retrieved memory; 3,280 ms pipeline, 1,787 ms reasoning, 252 input / 49 output tokens, estimated reasoning cost $0.001988                                                  |
| Exact recall             | “Ary Nexus” returned 6 memories through semantic + PostgreSQL full-text + direct entity/relationship evidence                                                                                                                                     |
| Transparent ranking      | Top exact-match memory: cosine **0.8196**, text score **0.1167**, source ranks semantic 1 / text 1 / graph 2; RRF `1/61 + 1/61 + 1/62` = **0.0489**                                                                                               |
| Graph diagnostics        | UI showed `Ary Nexus → tracks → Clevaryn` and `Ary Nexus → tracks → Wag Trails`, one hop each                                                                                                                                                     |
| Irrelevant query         | “What is my favorite kind of pizza?” returned **0 memories**; model stated it had no stored information                                                                                                                                           |
| Extraction during checks | All three test questions completed extraction with no new durable memories; original 6 records remained unchanged apart from embeddings/access timestamps                                                                                         |
| Browser                  | Page and diagnostics rendered; no captured browser warnings/errors                                                                                                                                                                                |

The graph-only and two-hop cases use isolated automated fixtures; the existing live workspace contains only one-hop seed relationships. The displayed live measurements are small smoke-test samples, not a latency benchmark or a comprehensive relevance evaluation.

## Limits

Graph expansion and entity resolution still read the user's workspace on the server; returned candidates/context are bounded and the full workspace is never sent to the model. Graph proximity supplies contextual evidence, not proof that a memory answers every question mentioning that entity. Larger-corpus evaluation and indexed graph queries remain future scaling work. The development lexical adapter approximates PostgreSQL using literal token overlap; actual production stemming/scoring is tested separately in PostgreSQL.

Reloading the dashboard and reopening the Ary Nexus conversation preserved all six retrieval snapshots, source scores, ranks and graph paths.
