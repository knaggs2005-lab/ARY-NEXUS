# Nexus Memory lifecycle and explanation system

September 9, 2026. Additive implementation; hosted migration 016 has **not** been applied.

## Audit and decisions

KEEP: canonical `MemoryService`, existing IDs/types/embeddings, PostgreSQL/Supabase repositories, pgvector/full-text search, RRF ranking, entity/alias linking, graph traversal, evidence/source/version records, temporal supersession, reviewed conflicts, Reflection and action/approval/permission/outcome infrastructure. No new brain, extractor, graph database, agent memory store or vendor runtime.

The [official Graphiti implementation](https://github.com/getzep/graphiti) offers useful episode provenance and temporal relationships. Ary already implements those concepts in its PostgreSQL evidence/version/relationship model. Adding its Python graph runtime and another graph backend would duplicate working infrastructure; no package or source was copied.

[Letta's memory-block attachment concepts](https://docs.letta.com/tutorials/attaching-detaching-blocks/) inform bounded context visibility and the distinction between detachment and deletion. Ary implements conversation-scoped working context in its current retrieval service rather than installing a second agent runtime.

PostgreSQL remains the owner-scoped record store; existing pgvector and PostgreSQL full-text ranking remain. There are no new dependencies or embedding/provider configuration changes.

## Classes and compatibility

The versioned policy lives under `memories.metadata.nexus_memory`, independently of legacy `memory_type`.

| Class      | Behavior                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| WORKING    | One owned conversation and explicit future expiry within 24 hours; excluded from other/generic retrieval.             |
| EPISODIC   | A recorded experience/event with sources and learned time; maps existing `episodic`.                                  |
| SEMANTIC   | Durable assertions/preferences/decisions/goals; default legacy interpretation.                                        |
| ENTITY     | Requires at least one existing canonical entity link.                                                                 |
| PROCEDURAL | Instructions/lessons; maps existing `procedural`, including existing Reflection lessons.                              |
| OUTCOME    | Requires an actual owner-scoped outcome; its status and evidence remain inspectable. No financial impact is invented. |

Legacy records are interpreted without updating or re-embedding them. `memory.classify` changes an existing current record in place after review, preserving ID, content, evidence and embedding. Consolidations retain their reviewed semantic classification. Generic memory create/update endpoints cannot forge or strip reserved lifecycle policy.

Expiry controls eligibility, not source-conversation retention. There is no automatic purge or invented confidence decay. Existing extraction continues independently; creating working context does not retroactively change all memories from that conversation.

## Knowledge separation

The new `knowledge_documents` table holds curated references with title/content, owner-provided source reference, recorded confidence, entity IDs and timestamps. Revisions append a row referencing `supersedes_id`; a unique successor constraint prevents forks. Content is immutable. Retirement retains history and cannot resurrect the previous version.

Knowledge has separate `knowledge.read`, search, capture and archive permissions. It never enters conversation extraction, memory reconciliation or learned-memory vector search. Explicit tool invocation retrieves references; ordinary Brain context does not silently include them. Knowledge search v1 is bounded lexical matching, not document semantic search, source verification, web fetching or autonomous ingestion.

## Retrieval and explanations

Existing flow: resolve entities → semantic + lexical + entity/graph candidates → eligibility → RRF → bounded context. Importance/confidence remain secondary signals.

Brain passes its conversation ID. Reconciliation excludes working context as a durable duplicate/conflict target; Reflection respects conversation visibility. New `search_memories_v5` applies working scope/expiry before SQL candidate limits while retaining v4 for older clients. Local search has equivalent scope filtering.

Each retrieved hit now exposes class, learned timestamp, recorded confidence, source references/quotes, validity, pending-conflict count and existing relevance reasons. The OpenAI payload includes that explanation alongside its existing maximum of eight retrieved memories. The inspector adds version history and entity/outcome links. Unknown provenance remains unknown; confidence is not a calibrated probability, and rank is not a truth probability.

## Consolidation, forgetting and deletion

Consolidation requires exact approval for a supplied summary of 2–8 distinct current durable memories without pending contradictions. Commit checks exact source revisions, pins content hashes, preserves originals/evidence, and unions entity links. Confidence cannot exceed the least-confident source. Approval is a human review of the summary; no automated entailment guarantee is claimed.

Retrieval withholds summaries when supporting content/confidence/validity changes or a source retires, expires or leaves scope. Dependent consolidations are checked recursively with cycle/depth guards. Original records and summaries remain inspectable; neither is silently rewritten.

`memory.forget` archives from active recall while preserving history. Existing DELETE `/api/memories/:id` retains its original archive behavior.

`memory.delete_record` is a distinct always-approved deletion. It removes that record and its evidence/source/version/entity-link rows in the existing atomic action/outcome batch. Later failure rolls back everything. Dependent memory versions, relationships or consolidations block deletion; archive instead. Ownership, revision checks and replay scope are enforced.

**Deletion is scoped:** source conversations, past responses/retrieved-context snapshots, action/approval records and backups remain. It is not account-wide erasure or a promise that the original conversation cannot establish another memory later. No real user records were deleted during testing.

## Authority and API

Every mutation follows existing ToolRegistry → action request → permission/approval → staged transaction → audit/outcome. Exact approval is mandatory even under an autonomous policy, and new tool requests require an idempotency key. Existing restrictions are inherited through `permissionParent`: for example, denying `memory.create` also denies classified capture. Input/entity-derived project scopes are checked, including replay after link deletion.

Tools: `memory.capture`, `memory.classify`, `memory.inspect`, `memory.consolidate`, `memory.forget`, `memory.delete_record`, `knowledge.search`, `knowledge.capture`, `knowledge.archive`. Global inspection refuses agent execution scopes; agents retain existing mission-scoped retrieval.

New reads: GET `/api/memory-system`, `/api/memory-system/:id`, `/api/knowledge?q=...`, `/api/knowledge/:id`. Knowledge revisions are inspectable via the ID endpoint. Existing routes remain compatible; there is no generic arbitrary-table deletion API.

## UI and performance

MEMORY → Memories → **Memory intelligence** adds classes, source/version inspection, query-specific relevance, capture/classification, reviewed consolidation and retirement/deletion. Knowledge is a separate collection. Existing library, search and shared approvals/history remain. Existing form/material primitives are reused with locally improved contrast and native disclosure/keyboard behavior; no decorative activity is invented.

The lazy view displays up to 200 memory rows and 100 reference results. Underlying repository lists still materialize owner history. Database-side consolidation-dependency filtering, cursor pagination, large-dataset acceptance and semantic document retrieval remain future work. Scoped filters after candidate generation on older hosted v4 can reduce recall when temporary records occupy its bounded pools; migration 016 fixes working scope/expiry filtering before those limits.

## Exact files

Added:

- `src/domain/nexus-memory.ts`: policy, classes, Knowledge and explanation contracts.
- `src/services/nexus-memory-service.ts`: lifecycle operations and read projections.
- `src/infrastructure/tools/memory-tools.ts`: adapters for the existing registry.
- `src/components/memory-system-view.tsx`, `memory-system.module.css`: lazy inspector and local contrast.
- `supabase/migrations/202609090016_nexus_memory.sql`: Knowledge, guards, constrained deletion, extended batch and v5 search.
- `tests/nexus-memory.test.ts`, `tests/nexus-memory-database.test.ts`: lifecycle/PostgreSQL tests.
- `scripts/lib/memory-browser-check.ts`: isolated browser checks.
- `docs/nexus-memory.md`: this report.

Extended:

- `src/domain/models.ts`, `repository.ts`: typed records, explanation and scoped-search/deletion contracts.
- `src/domain/permissions.ts`, `tool-registry.ts`, `src/services/permission-service.ts`: capabilities, inherited restrictions and discovery metadata.
- `src/services/memory-service.ts`: eligibility, source dependency checks and explanation.
- `src/services/memory-reconciliation-service.ts`, `reflection-service.ts`: working-context boundaries.
- `src/services/ary-brain-service.ts`, `src/infrastructure/providers/openai.ts`: conversation scope and bounded explanation serialization, with unchanged model selection.
- `src/services/action-request-service.ts`: real internal audit labeling, derived scope, request keys and deletion replay.
- `src/infrastructure/repositories/local.ts`, `supabase.ts`: Knowledge/deletion and scope-aware search; missing-v5 fallback retains v4 plus service filtering.
- `src/server/context.ts`, `http.ts`: registration/reads. Two existing `.filter(isCurrentMemory)` calls now use explicit lambdas so array indexes cannot become timestamp arguments.
- `src/components/dashboard.tsx`: lazy integration and response explanations.
- `scripts/evaluate-nexus-shell.ts`: focused memory mode within the existing disposable harness.
- `README.md`, `ARY_NEXUS_ROADMAP.md`, `docs/nexus-current-state.md`: usage and milestone status.

## Validation and activation

Baseline: 1,088 tests / 67 files. Final automated verification:

| Check                                         | Result                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Complete suite (`npm test -- --maxWorkers=1`) | PASS: **1,130 tests / 69 files**, including 42 new memory tests                                                         |
| Standalone TypeScript                         | PASS                                                                                                                    |
| Repository Prettier check                     | PASS; no separate lint command configured                                                                               |
| Production build                              | PASS: Next.js app and existing API route                                                                                |
| Migration audit                               | PASS: all 16 migrations, rerunnable adoption and drift refusal in disposable PostgreSQL                                 |
| PostgreSQL memory acceptance                  | PASS: owner isolation, Knowledge versions, deletion/CAS/rollback/dependants and scope filtering before candidate limits |
| Browser acceptance                            | PASS: normal + reduced-motion; final-source normal run passed                                                           |

Verification used the established exact-lock dependency mirror at `/tmp/ary-shell-dependencies` because of this checkout's prior iCloud dependency-read problems. Selected changes are copied back and checked for byte equality. Existing mission tests remain unchanged. Tests use disposable LocalRepository/PGlite with pgvector and all migrations. Browser tests use real local HTTP, approvals, transactions and reloads with explicit mock reasoning/local embeddings; they do not certify live OpenAI, native Electron or hosted Supabase activation.

An interrupted concurrent run recorded about 87 minutes in timed tests; a later overlapping browser run exposed an existing 100 ms mission-test timing sensitivity. Those runs are not passes. The unchanged mission suite passed separately; final verification runs without concurrent browser work. No unrelated mission implementation/test timeout was changed.

Review/apply migration 016 through the existing deployment process. It is additive/rerunnable and keeps v4. Knowledge and record deletion require activation; existing learned retrieval retains its compatibility path. Previous hosted 014/015 and worker activation gates remain unchanged. No hosted schema, credentials, package versions or real user data were modified.

Manual checks:

1. Capture PROCEDURAL memory, approve, inspect source/confidence/time and Action History.
2. Classify an existing memory and verify its ID/content/embedding identity remain unchanged.
3. Search a paraphrase and an irrelevant query; inspect actual ranks and reasons.
4. Give WORKING context a conversation and expiry; verify other-context exclusion and expiry without deleting history.
5. Consolidate two current facts. Reject, then approve; verify originals remain and changing a source withholds the summary.
6. Add/revise Knowledge; verify provenance/revisions and exclusion from learned retrieval.
7. On a disposable unreferenced record only, reject deletion, then approve and verify evidence/version removal and retained audit.

The roadmap NEXT 3 is unchanged. No next milestone is started.

Final browser evidence: real local HTTP → exact approval → classified memory/evidence/action/outcome → query explanation → rejected deletion → approved atomic deletion → separate Knowledge → reload persistence. Compact viewport had no horizontal overflow and the browser reported no errors. Normal and reduced-motion captures were inspected. Temporary app/data directories were cleaned up by the harness; production credentials were not copied.

Reproducible commands: `npm test -- --maxWorkers=1`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm run migrations:audit`, and `ARY_MEMORY_ONLY=1 node --import tsx scripts/evaluate-nexus-shell.ts` (optionally `ARY_PRESENCE_REDUCED=1`). Local logs: `/tmp/ary-memory-suite.log`, `/tmp/ary-memory-typecheck.log`, `/tmp/ary-memory-format.log`, `/tmp/ary-memory-build.log`, `/tmp/ary-memory-migrations.log`, `/tmp/ary-memory-browser-final.log`, `/tmp/ary-memory-browser-reduced.log`. Captures: `/tmp/ary-memory.png`, `/tmp/ary-memory-reduced.png`, `/tmp/ary-memory-compact.png`.
