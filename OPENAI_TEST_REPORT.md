# Ary Nexus OpenAI test report

Production-provider smoke tests passed. Follow-up during the hybrid retrieval upgrade completed the existing Supabase memory migration and live UI verification. The synthetic suite measurements below are from the earlier provider evaluation.

| Check                      | Result                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reasoning                  | PASS — gpt-5.6-sol via Responses API, 3 successful calls                                                                                                   |
| Embeddings                 | PASS — text-embedding-3-large, 384 dimensions, 16 calls                                                                                                    |
| Semantic recall            | PASS — hiking paraphrase returned the correct top memory, cosine 0.617                                                                                     |
| Paraphrased recall         | PASS — “bill its clients” recalled the invoicing fact, cosine 0.785                                                                                        |
| Entity-linked recall       | PASS — Trailbook alias resolved to Wag Trails and its linked fact                                                                                          |
| No relevant memory         | PASS — zero retrievals for an unrelated query; model abstained on missing personal information                                                             |
| Conversation extraction    | PASS — full brain pipeline saved a durable preference with an exact user-message evidence quote                                                            |
| Supersession               | PASS — October 1 changed to November 20 after explicit review; original row marked superseded, history retained, current retrieval/answer used November 20 |
| Conflicting facts          | PASS — conflicting primary contact queued for review; existing fact remained current until a decision                                                      |
| Existing Supabase memories | PASS — all 6 records re-embedded through the signed-in dashboard; second run updated 0, remaining 0                                                        |

Average reasoning latency: **1.871 s** across three successful reasoning requests. Pipeline latency through answer generation: **3.422 s**, one sample (includes retrieval; excludes response persistence, delivery, and extraction). Successful suite estimated cost: **$0.0233352**. This excludes earlier diagnostics and failed attempts with unavailable usage.

An earlier run had one 60-second upstream/network timeout. All seven scenarios passed on the full rerun. Samples are synthetic and small; retrieval thresholds/dimension choice need broader real-data evaluation. Corrections require explicit conflict review. Historical version embeddings retain their original version for audit purposes.

The app defaults to OpenAI, with development providers available only through explicit mock/local flags. Response badges persist actual model/provider identity, and expandable metrics show tokens, latency, retrieval count, and estimated reasoning cost. Credentials remain in ignored environment configuration. No new integrations were added.

The live suite uses a temporary local repository with real OpenAI calls. The SQL schema/RLS suite runs separately in PGlite. The follow-up authenticated Supabase migration and live UI checks are recorded in `HYBRID_TEST_REPORT.md`.

The six existing records now use embedding version `openai-te3-large-384-content-summary-v1`. Future maintenance can use Memory review → Re-embed all memories, or the idempotent `npm run reembed` CLI with authenticated maintenance credentials configured locally.
