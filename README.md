# Ary Nexus

Nexus Permission Engine: [policy classes, approval modes, emergency stop and migration 017](docs/nexus-permissions.md). Hosted activation of the new policy dimensions remains pending.

Desktop startup repair: [local dependency storage, Webpack launch and native verification](docs/desktop-launch-recovery.md).

## Nexus ToolRegistry

Tools now exposes the existing registry as a searchable capability inspector: semantic discovery, source/location, schemas, authentication, permissions, approval boundaries, recent use and observed health. The optional official MCP client uses stdio or Streamable HTTP through the same action pipeline. It is disabled by default; no external account was connected. See [configuration, safety boundaries, exact changes and acceptance](docs/nexus-tools.md).

For current milestone status, verified gaps, priorities and permanent guardrails, start with [ARY_NEXUS_ROADMAP.md](ARY_NEXUS_ROADMAP.md). It is the canonical roadmap; historical test reports remain verification records rather than current work queues.

## Recovery and deployment integrity

See [RECOVERY_DEPLOYMENT_TEST_REPORT.md](RECOVERY_DEPLOYMENT_TEST_REPORT.md) for current evidence and pending live acceptance. Existing migration 011 and the narrow audit-grant correction 013 are applied to the current Supabase project. Other environments must inspect their own migration state; do not rerun initial table-creation migrations on an existing database.

`npm run migrations:audit` runs all local SQL migrations in disposable PGlite and emits `/tmp/ary-migration-audit.sql`, `/tmp/ary-migration-expected.json`, and `/tmp/ary-migration-adopt.sql`. The command does not access or modify production. Run the read-only audit SQL in the intended Supabase project first. It compares columns/defaults/nullability, constraints, indexes, RLS/policies, effective application-role grants, triggers and normalized public function definitions. Constraint ordering uses stable collation; PostgreSQL 18 NOT NULL catalog entries are excluded because column nullability is already checked. Function whitespace/line-comment normalization is not a formal SQL equivalence proof.

The optional adoption SQL is only for a manually installed database whose schema already matches. It refuses drift/unexpected versions before recording a verified baseline with source hashes; it does not claim to recover original execution dates. Normal future releases should apply only new migrations and record their real versions through the deployment workflow. Preserve the previous baseline and review migration SQL before application. The current baseline is in `supabase/deployment-baseline.json`; protected migration-history metadata is outside the application API schema.

Migration 013 restores the intended grants on three audit tables. Supabase can pre-grant ALL privileges to authenticated clients; a later GRANT SELECT/INSERT does not revoke UPDATE/DELETE. The migration removes UPDATE/DELETE from model telemetry and DELETE from Reflection jobs/proposals while retaining intended writes/reviews. It is rerunnable and makes no record changes.

For a failed extraction: inspect Memory review and its original message, Action history, evidence and current/superseding facts before retrying. Restart the existing server if needed, wait for any active lease to expire, and use **Retry extraction**. The existing endpoint logs the previous job ID/status/error/attempt count before replay. Completed jobs return their stored result without re-extraction. Do not delete jobs, reset attempt limits or directly mark them complete. A repeated fact may finish with zero new memory IDs while adding one supporting source quote; that is a valid result. Pending conflicts still require reviewed acceptance.

`npm run test:supabase-integrity` is a prepared live HTTP/RLS/provider acceptance test, not an offline unit test. It requires an explicitly approved empty disposable Supabase account and environment-only `ARY_INTEGRITY_EMAIL`, `ARY_INTEGRITY_PASSWORD`, `ARY_INTEGRITY_USER_ID` (optional `ARY_INTEGRITY_APP_URL`, localhost only). The email must use the `recovery-…@ary-nexus.invalid` fixture namespace. The evaluator does not create users, accept the working user's session, or use a service-role key. It refuses a populated workspace. It exercises the supplied correction conversation, reviewed supersession, history/paraphrase/supporting evidence, replay, real telemetry, and nullable/revised/deduplicated Economics costs. Synthetic costs are labeled as fixtures with zero attribution confidence; it records no revenue or time savings. Successful output is `/tmp/ary-supabase-integrity-results.json`. Explicitly remove only that test account's fixtures afterward using an operator-reviewed cleanup; never weaken production ledger immutability or erase the working user's records for a test.

Ary Nexus is the foundation of Ary’s persistent intelligence system: a user-owned store of structured memories, entities, relationships, conversations, goals, decisions, tasks, actions, and outcomes. Chat is one way to interact with that system.

This initial implementation prioritizes readable service boundaries, inspectable retrieval, and working persistence. It includes a development dashboard, a Supabase migration with pgvector and row-level security, provider interfaces, seed data, and automated service/database tests. It lives in its own directory alongside the existing Premiere plugin.

## Central NEXUS map

NEXUS now opens a bounded spatial intelligence map. Search and filter real source records, open semantic groups, focus one/two-hop neighborhoods, pan/orbit, zoom and inspect provenance. **Entity Brain Graph** keeps the original graph available. Fresh explicitly linked backend events activate connections; missing sources stay empty. The projection reuses Canvas2D/vgpu and existing permissions without adding a graph library or business database.

See [renderer evaluation, source coverage, limits and verification](docs/nexus-spatial-map.md). **1,001 tests / 63 files**, typecheck, formatting, production build and isolated standard/reduced-motion browser acceptance passed. No new migration is needed for map reads; hosted activity still requires event migration 014. Inspection nodes come from saved receipts, not automatic app/device discovery.

Browser acceptance: `ARY_PRESENCE_ONLY=1 ARY_EVENTS_CHECK=1 ARY_MAP_CHECK=1 node --import tsx scripts/evaluate-nexus-shell.ts`. Add `ARY_PRESENCE_REDUCED=1` for reduced motion. It uses temporary local fixtures and no external effects.

## Nexus Event Bus

The shared backend event journal and resumable SSE now drive real UI observations across the existing Brain, Board, actions, memories, approvals, model telemetry and voice. Open **Activity → Action history** for family/correlation filters; **Systems** exposes raw normalized details and **Ambient** keeps essential activity. No simulated activity is generated. The original request streams remain a compatibility fallback.

See [the contract, producer map, consistency rules, exact changes and verification](docs/nexus-event-bus.md). **Supabase migration 014 is included and tested but not applied to the hosted project.** Apply only `supabase/migrations/202609080014_nexus_events.sql` through the existing migration workflow before expecting hosted live delivery. The stream reports unavailable until storage exists. Domain authorization and existing source records remain authoritative.

Verified: **969 tests / 62 files**, including **41 event tests**; typecheck, formatting, production build and disposable migration audit passed. Browser chat → approval → real task/outcome → live inspector passed in standard/reduced-motion modes. Hosted acceptance remains pending migration 014.

Focused acceptance: `ARY_PRESENCE_ONLY=1 ARY_EVENTS_CHECK=1 node --import tsx scripts/evaluate-nexus-shell.ts`. Add `ARY_PRESENCE_REDUCED=1` for reduced motion. The harness uses an isolated local server and temporary fixtures, without production credentials or external effects.

## Run locally

Requirements: Node.js 22 or newer and npm. PostgreSQL is not required for the local demo.

```sh
cd ary-nexus
npm ci
cp .env.example .env.local
# For an offline demo, set ARY_LLM_PROVIDER=mock and ARY_EMBEDDING_PROVIDER=local.
# For OpenAI, keep both as openai and configure OPENAI_API_KEY locally.
npm run dev
```

Open [Ary Nexus](http://localhost:3000). The development server binds to loopback. The example environment explicitly enables `ARY_STORAGE=demo`; demo access is rejected for non-localhost hosts and when `NODE_ENV=production`.

The demo automatically seeds Clevaryn, Wag Trails, and Ary Nexus. Data is saved atomically to `.data/demo.json` and survives server restarts. This adapter is for one local process and one development identity. It is not a replacement for Supabase, a multi-user deployment, or a production file database. `.data/` and environment files are ignored by Git.

Try this flow:

1. Ask **What is Ary Nexus?** and inspect the retrieved memories beside the response.
2. Use **Add memory** to save a fact with a type, importance, and confidence.
3. Ask about the fact and inspect the new retrieval snapshot.
4. Send **Remember: Ary Nexus should keep memory sources visible.** Watch the answer arrive, then the extraction status. Check the saved memory and its conversation provenance.
5. Inspect Entities, Relationships, Graph, and Activity. Select a graph node to see its connections.
6. Reload the page or restart the server; reopen the conversation from its selector.

The example configuration selects OpenAI. For an offline demo, explicitly select `ARY_LLM_PROVIDER=mock` and `ARY_EMBEDDING_PROVIDER=local`: a **deterministic development stub** and a **hashed concept/keyword baseline**. They are labeled in the dashboard. The baseline is not a semantic language model; real semantic retrieval is enabled through the configurable embedding provider below. No API keys are needed with both offline provider flags selected. OpenAI mode requires API credits, separately from any ChatGPT subscription.

## Architecture

```text
src/
  app/                         Next.js shell and thin REST route handlers
    api/[...path]/route.ts      Delegates transport to the server layer
  components/                  Dashboard, graph, browser auth/API client
  domain/
    models.ts                  Intelligence records and shared types
    validation.ts              Runtime input validation and application errors
    repository.ts              User-scoped persistence contract
    providers.ts               LLM and embedding contracts
  services/
    memory-service.ts          Memory lifecycle, retrieval, entity links
    entity-service.ts          Entity lookup, relationships, bounded graphs
    ary-brain-service.ts       Explicit conversation-to-memory pipeline
    action-service.ts          Server permission policy, action/outcome logging
  infrastructure/
    repositories/local.ts      Atomic JSON persistence for local development
    repositories/supabase.ts   PostgreSQL/PostgREST persistence and vector RPC
    providers/local.ts         Deterministic development implementations
    providers/compatible.ts    Configurable chat/embedding HTTP adapters
    providers/openai.ts        Responses API and versioned OpenAI embeddings
    seed.ts                    Repeatable, user-scoped seed routine
  server/
    context.ts                 Authentication, configuration, dependency wiring
    http.ts                    REST dispatch, validation, streaming, errors
supabase/
  migrations/202609060001_initial.sql
  migrations/202609060002_memory_foundation.sql
  migrations/202609060003_openai_embeddings.sql
  migrations/202609060004_hybrid_retrieval.sql
  migrations/202609060005_reflection.sql
  config.toml
scripts/seed.ts                 Authenticated Supabase seed CLI
scripts/reindex.ts              Re-embed memories with the configured model
tests/                        Service, database, and provider tests
```

Dependency direction: **UI → HTTP API → services → domain contracts**. Infrastructure implements the contracts. `server/context.ts` composes implementations per authenticated request. Services do not import Next.js, React, or Supabase. The browser never receives provider keys or a Supabase service-role key.

External execution is limited to the Google Calendar and Gmail v1 capabilities documented below. Calendar writes and Gmail sends always require explicit approval; there is no autonomous scheduling, autonomous sending, or financial execution.

## Supabase setup

1. Create a Supabase project, or run a local Supabase stack using its CLI and Docker.
2. On a **new project**, apply the five files in `supabase/migrations/` in order: `202609060001_initial.sql`, `202609060002_memory_foundation.sql`, `202609060003_openai_embeddings.sql`, `202609060004_hybrid_retrieval.sql`, then `202609060005_reflection.sql`. On an existing Ary installation, apply only migrations not yet applied; rerunning the initial schema causes “relation users already exists”. Schema migrations 001–003 and 005 run once; 004 safely recreates its RPC and can be rerun. If you manage migrations through the CLI, first reconcile any migrations previously applied manually in SQL Editor, then use:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   For a new local stack, use `supabase start` followed by `supabase db reset`. Reset deletes data in that local database; use it only for a disposable development stack. SQL seed execution is disabled because seeds must belong to a real authenticated user.

3. Create an email/password user in Supabase Authentication. This development dashboard has sign-in, not signup or password-reset flows.
4. Configure `.env.local` and restart Next.js:

   ```dotenv
   ARY_STORAGE=supabase
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
   ARY_LLM_PROVIDER=openai
   ARY_EMBEDDING_PROVIDER=openai
   OPENAI_REASONING_MODEL=gpt-5.6-sol
   OPENAI_API_KEY=
   ```

5. Sign in. The API verifies the bearer token with Supabase Auth and creates the matching public profile when needed. Select **Load Clevaryn, Wag Trails & Ary Nexus** in an empty workspace.
6. Alternatively, seed with the existing user’s credentials, supplied through local environment variables `ARY_SEED_EMAIL` and `ARY_SEED_PASSWORD`, then run `npm run seed`. The seed script loads `.env.local`; keep credentials out of committed files and shell history.

Seeding is repeatable for normal sequential runs. It creates three entities, two `tracks` edges, five memories, one goal, one decision, and one task. The `tracks` edges indicate inclusion in this workspace, not ownership. Wag Trails is a provisional project entity whose scope and ownership remain unspecified. Concurrent seed runs are not supported.

`npm run build` compiles the application. For `npm start`, configure Supabase: production explicitly refuses the unauthenticated demo. Provider keys are server-only. Only Supabase’s public URL/key are exposed to the client.

## Database model

All application records use UUID primary keys and timestamps. All tables enable row-level security. Records other than `users` carry `user_id`; profiles reference `auth.users`. Composite `(user_id, id)` foreign keys prevent edges, memory links, conversation messages, and goal/action references from crossing tenants, even if an attacker knows another user’s UUID.

| Table             | Purpose / notable fields                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`           | Auth-backed profile, display name, timestamps                                                                                                  |
| `entities`        | `entity_type`, name, description, metadata; person, company, project, product, goal, decision, task                                            |
| `memories`        | `memory_type`, content, summary, importance/confidence, access timestamps, vector, model identity, metadata, archive timestamp, source message |
| `relationships`   | Source/target entity IDs, relationship type, strength, metadata; directed unique edges                                                         |
| `memory_entities` | Many-to-many memory/entity links, with tenant-scoped uniqueness                                                                                |
| `conversations`   | Thread title and metadata                                                                                                                      |
| `messages`        | Conversation ID, role, content, retrieval snapshot and extraction status in metadata                                                           |
| `goals`           | Optional entity link, status, target date, progress                                                                                            |
| `decisions`       | Optional entity/goal links, rationale, status, confidence, decision time                                                                       |
| `tasks`           | Optional entity/goal links, status, priority, due date                                                                                         |
| `actions`         | Tool/action name, permission, lifecycle status, input/output, error, conversation link                                                         |
| `outcomes`        | Action and optional goal links, status, summary, metrics                                                                                       |

A typed entity can represent a goal/decision/task in the graph while its corresponding domain table stores its detailed state. These records are not automatically duplicated into entities; callers explicitly associate them through `entity_id`.

Memory fields include every field in the brief: `id`, `user_id`, `memory_type`, `content`, `summary`, `importance_score`, `confidence_score`, `created_at`, `updated_at`, `last_accessed_at`, `embedding`, and `metadata`. Additional fields include `embedding_model`, `archived_at`, `source_message_id`, `status`, `valid_from`, `valid_to`, and `supersedes_id`.

Memory types: `fact`, `preference`, `episodic`, `procedural`, `goal`, `decision`. Importance, confidence, relationship strength, and goal progress range from 0 to 1. Importance represents usefulness; confidence represents source/extraction certainty. Neither is a guarantee of truth.

Timestamps update through a database trigger. Memory archiving is soft deletion; archived records do not enter future retrieval. Existing response snapshots intentionally preserve the evidence used at that time. Deleting an account cascades through its owned records; this foundation exposes no account-deletion UI.

## Memory retrieval

The embedding interface is separate from the reasoning interface. On create, content and summary are embedded together. Editing either re-embeds the memory; a score-only update preserves its text and vector. Search results omit vectors from API responses.

Both `searchMemories(query, limit)` and `getRelevantMemories(query, limit)` use the same hybrid pipeline. Chat can pass already-resolved canonical IDs and ambiguous candidate IDs to avoid repeating entity resolution. Manual/API search resolves canonical names and aliases automatically.

```text
query → resolve entities → semantic pool + full-text pool + entity/graph pool
      → filter user/status/time/ambiguity → independent source ranks → RRF → context
```

Supabase's `search_memories_v4` RPC runs with **invoker privileges** and derives the user from `auth.uid()`. It collects the top 100 pgvector cosine candidates and top 100 PostgreSQL full-text candidates independently, returning their entire union (up to 200) with raw source scores/ranks. Semantic candidates must have a matching model/version, a non-stale embedding hash, and cosine ≥ 0.40 for `text-embedding-3-large` (0.20 for development/compatible providers). Full-text uses English `plainto_tsquery` (AND across non-stopword terms) and `ts_rank_cd` over content plus summary. Lexical candidates work even without a compatible vector. This is PostgreSQL FTS, not BM25.

Graph retrieval starts only from resolved, tenant-owned entities. It adds directly linked memories and traverses current, positive-strength relationships for up to **two hops**, visiting at most 100 entities and collecting at most 100 linked memories. Shortest paths win; deterministic IDs break equal-hop ties. Traversal is bidirectional for discovery, with original edge IDs, endpoints and direction preserved in `graph_steps`; reverse paths are labeled in the UI. Expired/future edges and edges supported by archived, disputed, superseded or otherwise non-current memories are excluded. Cycles and duplicate links never create extra votes.

All sources filter tenant, archive/status and validity (`valid_from ≤ now < valid_to`, with null bounds open). Explicitly ambiguous entity-linked evidence is withheld before ranking. Source ranks are recomputed after application filtering. Supabase also discards candidates whose timestamp changed between scoring and fetching content.

`services/hybrid-ranking.ts` performs **one** equal-weight reciprocal rank fusion:

```text
score = (semantic ? 1/(60 + semantic_rank) : 0)
      + (lexical  ? 1/(60 + text_rank)     : 0)
      + (graph    ? 1/(60 + graph_rank)    : 0)
```

Direct entity links and 1–2 hop paths share a single graph channel. Importance and then confidence only break identical final RRF scores; they cannot admit an irrelevant memory or override source ranks. No qualifying candidate means empty context. Final results default to 8 and are capped at 50. Scores are not probabilities. Only the bounded retrieved context goes to the reasoning provider.

The response snapshot and debug UI record `retrieval_sources`, `semantic_score`, `text_score`, source ranks, `graph_path`/`graph_steps`, `graph_hops`, `final_rank`, RRF `score` and `retrieval_reasons`, labeled `hybrid-rrf-v1`. A missing source score means that source did not admit the candidate, not a measured zero. Existing response snapshots keep their historical values and explicitly indicate missing per-source diagnostics.

The local adapter uses deterministic concept embeddings and an AND-based literal token overlap approximation for lexical search, without synonym expansion in the lexical channel. It is an explicit development baseline, **not learned semantic retrieval or PostgreSQL stemming**. Production scores are validated separately against the actual SQL migration in PGlite.

The schema has HNSW and GIN full-text indexes; benchmark `EXPLAIN` plans before large-scale use. Graph traversal and entity resolution currently load the user's workspace on the server, even though expansion and returned candidates are bounded. These records are never all sent to the LLM. Indexed graph queries and pagination are future scaling work. RRF orders qualifying evidence; it does not decide whether a graph-connected fact answers a narrow question. Similarity thresholds and the two-hop neighborhood still need evaluation on a larger real corpus.

Tests in `tests/hybrid-retrieval.test.ts` cover semantic-only paraphrases with controlled vectors, lexical-only identifiers, direct/one-hop/two-hop graph-only recall, reverse direction, the hop cap, irrelevant queries, quality tie-breakers, single-pass RRF arithmetic, and tenant/status/time/provenance filtering. `tests/database.test.ts` executes migration 004 twice and verifies PostgreSQL stemming, independent scores, version isolation, and RLS.

### Enable semantic embeddings and generated reasoning

The included HTTP adapters accept a chat-completions/embeddings-compatible API. You can point them at a local model server or a hosted provider without changing services. They do not require the same vendor, URL, key, or model.

```dotenv
ARY_LLM_PROVIDER=compatible
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=YOUR_CHAT_MODEL
LLM_API_KEY=

ARY_EMBEDDING_PROVIDER=compatible
EMBEDDING_BASE_URL=http://localhost:11434/v1
EMBEDDING_MODEL=YOUR_384_DIMENSION_EMBEDDING_MODEL
EMBEDDING_API_KEY=
```

The base URLs must expose `POST /chat/completions` and `POST /embeddings`, respectively. Authentication headers are sent only when a key is configured. Requests have a 60-second timeout. The chosen embedding model **must return exactly 384 finite, nonzero dimensions** to match `vector(384)`; a mismatch fails explicitly. Chat extraction must return valid JSON. Use models that support this output contract.

Changing vector dimension requires a schema migration, index rebuild, and full re-embedding. Do not pad or truncate vectors. Changing the model, provider URL, or local baseline requires re-indexing even if dimensions stay the same. Stored `embedding_model` identifies the space and prevents incompatible vector comparisons; text retrieval remains available for mismatched records.

After selecting the new embedding provider, run `npm run reindex`. In demo mode this uses the local file. In Supabase mode it uses the same authenticated seed credentials described above. It processes all current memory rows, including archived, disputed, and superseded states, sequentially and can safely be rerun after an interruption. Historical snapshots retain their original embedding provenance. It is a maintenance script, not a background job.

To support an API with a different protocol, implement `LanguageModelProvider` and/or `EmbeddingProvider` and add an explicit case in `server/context.ts`. Unknown provider configuration fails rather than silently selecting a stub.

## Services and brain pipeline

`MemoryService` exposes:

```ts
createMemory(input);
updateMemory(id, patch);
searchMemories(query, (limit = 8));
getRelevantMemories(query, (limit = 8));
linkMemoryToEntity(memoryId, entityId);
archiveMemory(id);
```

`EntityService` exposes:

```ts
createEntity(input)
findEntity(idOrExactName)
searchEntities(query = '')
linkEntities({ source_entity_id, target_entity_id, relationship_type, strength, metadata })
getEntityGraph(rootId?, depth = 2)
```

Rooted graph traversal follows both incoming and outgoing edges, preserves their direction, and caps traversal depth at five. Without a root, it returns the user’s graph. Entity resolution uses canonical names first, known aliases second, and conservative affiliation context for ambiguous names. It never creates or merges entities during resolution; see the identity-resolution rules below.

`AryBrainService.respond()` is an async generator:

```text
input
  → validate user and conversation; atomically persist user message + extraction job
  → identify intent
  → resolve canonical names, explicit aliases, and necessary affiliation disambiguation; persist and stream identity traces
  → retrieve active memories
  → construct context with up to 20 previous messages
  → reason through the configured provider
  → persist assistant message and retrieval snapshot
  → yield response to the browser
  → extract new memories from the user's input
  → validate quotes and IDs; reconcile candidates; atomically save evidence, memories, conflicts and job completion
  → persist extraction status and yield completion
```

The HTTP endpoint streams newline-delimited JSON. The browser updates the user message with identity traces at `entities`, displays the answer at `response`, then displays save status at `complete`. Extraction failures preserve the answer and produce a warning. Existing assistant-message metadata contains a snapshot of memory content, scores, entity IDs, intent, provider, and extraction status.

The mock extractor saves explicit `Remember: …` inputs only. The compatible provider implements the optional provider-agnostic `MemoryExtractionProvider.extractCandidates(ExtractionContext)` contract: it receives the source user message, bounded earlier messages, scoped canonical entities, and up to twelve relevant memories. It proposes new facts, duplicates, supersession, or conflicts. Assistant output and retrieved text are context, never sources of new user facts. Every candidate must contain a literal quote from the current user message, valid scoped entity IDs, and (for reconciliation) a memory ID supplied in context. A quote proves provenance, not entailment; model extraction still needs evaluation.

Candidates below 0.65 confidence are skipped. Exact duplicates attach additional evidence. Model-proposed paraphrase duplicates may attach evidence when numeric qualifiers agree; semantic equivalence is model judgment, not a proof. New/changed numeric facts and proposed contradictions become disputed memories with a pending review. The old fact remains active until reviewed. No model confidence score authorizes automatic supersession. `Memory review` lets the user keep the old fact, accept a replacement, or keep both. Accepted replacements retain the original memory and add `supersedes_id`; they are never hard-deleted. Unknown effective dates remain null.

An extraction job is persisted with its user message before reasoning. Model calls happen outside transactions; all accepted memories, evidence, entity links, conflicts, and job completion commit in one `apply_memory_batch` transaction. Failed commits leave no partial memories. Jobs have compare-and-swap claims, ten-minute crash-recovery leases, and a five-attempt cap. Retrying a completed job is a no-op. Pending/failed/expired jobs are retryable from `Memory review`. There is no scheduler or autonomous worker yet: jobs run after the streamed response or through the explicit retry endpoint. Provider calls may repeat after a crash, but completed jobs cannot commit twice. Different messages processed concurrently can still propose equivalent facts; cross-job semantic deduplication is not a database invariant.

## Temporal knowledge and evidence

The second migration adds six RLS-protected tables: `entity_aliases`, `memory_versions`, `relationship_versions`, `memory_evidence`, `memory_conflicts`, and `extraction_jobs`. Memory rows gain `status`, `valid_from`, `valid_to`, and `supersedes_id`. Relationships gain `valid_from`, `valid_to`, and optional `memory_id` provenance. Existing structural relationship uniqueness remains in place; ending/revising a connection produces history snapshots instead of duplicate current edges.

Database triggers capture complete memory/relationship snapshots on significant edits; access timestamps do not create versions. Authenticated clients can read their history but cannot insert, update, or delete version rows directly. The narrow definer trigger writes history; the batch RPC itself uses invoker rights, an allowlisted table set, parameterized values, composite tenant foreign keys, and RLS. Baselines for pre-existing records begin at migration time; earlier knowledge is not fabricated. The local file adapter provides the same atomic commit and memory-version semantics for single-process development.

`recorded_at` is system/knowledge time. Snapshot `valid_from`/`valid_to` express effective time; they are not inferred from recording time. `GET /api/memory-timeline?known_at=<ISO>&valid_at=<optional ISO>` selects the latest recorded snapshot per memory at the knowledge cutoff, then optionally filters validity. Unknown dates are retained and clearly labeled; they are not evidence that the fact was true at the requested time. Historical graph reconstruction and natural-language date parsing are deferred. The timeline UI uses local dates and sends UTC timestamps.

Evidence stores source message, exact quote, and supports/contradicts classification. It is associated with the stable memory identity and retained alongside versions; it is **not yet a revision-specific evidence ledger**. Archived facts and superseded facts remain inspectable through Memory review. The relationship history endpoint exposes earlier connection snapshots.

## Mem0 and Graphiti design references

The supplied `mem0-main` and `graphiti-main` directories were read as reference implementations, not as instructions to execute. The supplied Graphiti manifest is version 0.24.1; the preceding reference review also inspected upstream 0.30.1. Mem0’s inspected TypeScript package is 3.1.8. No source files were copied or reference applications installed. Ary keeps Next.js/TypeScript, Supabase/Postgres/pgvector, and its provider boundary.

- Mem0's contextual, additive extraction, evidence attribution, duplicate handling, and hybrid retrieval informed the extraction contract. Its current full `Memory` engine owns a different storage/entity schema, so it does not write Ary's canonical database.
- Graphiti's temporal facts, contradiction handling, and graph-assisted retrieval informed version snapshots, explicit conflict review, and graph candidates. Its Python runtime requires a supported graph store; Ary does not add one or build a custom Graphiti driver.
- No new runtime dependency is required. The public `mem0ai/oss` `LLMReranker` is a future optional adapter, not enabled by default: it adds per-document model calls and needs a quality/latency benchmark first.

## Actions, outcomes, and permissions

`ActionService` resolves the six numeric permission levels before registered operations run. Policies can restrict tools, action types, workspace/product contexts and users; exact-request approvals are consumed once, and attempts, decisions and policy revisions remain inspectable in Settings. See **Core permissions v1** below for the authority model, defaults, migration and API.

Actions and outcomes describe execution attempts and operational results. Database administrators remain trusted and can administer their own records; this is not an independent compliance archive.

## HTTP API

All application endpoints except `GET /api/config` require an authenticated Supabase bearer token, or the explicitly enabled loopback development mode. Authenticated identity is derived server-side, never from a submitted `user_id`. Writes reject a conflicting Origin header, validate JSON, and cap bodies at 64 KB. Responses use `Cache-Control: no-store`.

| Method and path                       | Behavior                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /api/config`                     | Public mode/configuration status, without secrets                                           |
| `GET /api/dashboard`                  | Workspace, recent actions/outcomes, provider labels                                         |
| `POST /api/chat`                      | `{ input, conversation_id? }`; NDJSON `entities`, `response`, `complete`, or `error` events |
| `GET /api/memories?q=...`             | Active memory list or hybrid retrieval                                                      |
| `POST /api/memories`                  | Create and embed a memory                                                                   |
| `PATCH /api/memories/:id`             | Validated partial update; re-embed on text change                                           |
| `DELETE /api/memories/:id`            | Archive a memory                                                                            |
| `POST /api/memories/:id/entities`     | Link with `{ entity_id }`                                                                   |
| `GET /api/entities?q=...`             | Entity search/list                                                                          |
| `POST /api/entities`                  | Create an entity                                                                            |
| `GET /api/relationships`              | List directed relationships                                                                 |
| `POST /api/relationships`             | Link entities                                                                               |
| `GET /api/graph?root=UUID&depth=2`    | Full or bounded graph                                                                       |
| `GET /api/conversations`              | Conversation list                                                                           |
| `GET /api/conversations/:id/messages` | Persisted history and retrieval snapshots                                                   |
| `POST /api/seed`                      | Seed the authenticated workspace                                                            |

Goals, decisions, tasks, actions, and outcomes have schemas/domain types and dashboard inspection. This initial version does not expose general CRUD forms/APIs for each of them.

Example for the local demo:

```sh
curl http://localhost:3000/api/memories \
  -H 'Content-Type: application/json' \
  -d '{"memory_type":"fact","content":"Ary Nexus prioritizes inspectable retrieval.","importance_score":0.9,"confidence_score":1}'

curl -N http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"input":"What does Ary Nexus prioritize?"}'
```

In Supabase mode add `Authorization: Bearer YOUR_USER_ACCESS_TOKEN`. Do not use a service-role key. Clients must inspect streamed `error` events: once headers have been sent, a pipeline error cannot change the HTTP status.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run format:check
```

Tests run without credentials. Service tests use fresh temporary files. Database tests execute the **actual migrations** in PGlite PostgreSQL with pgvector and a minimal Supabase Auth fixture. They verify table/RLS coverage, tenant-scoped vector retrieval, forbidden cross-tenant references and writes, score checks, permissions, archive exclusion, zero vectors, and embedding-space separation. This does not substitute for testing a deployed Supabase Auth/PostgREST stack.

Browser verification uses the installed `agent-browser` development tool. Its Chromium runtime may need a one-time install with `npx agent-browser install`. The application itself does not depend on a browser automation runtime.

Before public deployment: add production auth/account flows, rate limiting and quotas, pagination, production monitoring, and a scheduled worker for the durable extraction jobs appropriate to the hosting environment. Credentials are configured outside source control; no provider key is included in this repository.

## Reference documentation

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase semantic search](https://supabase.com/docs/guides/ai/semantic-search)
- [pgvector](https://github.com/pgvector/pgvector)
- [PGlite extensions and pgvector](https://pglite.dev/extensions/)

### Memory foundation API additions

| Method | Endpoint                                         | Purpose                                                                                               |
| ------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| GET    | `/api/memories/:id/history`                      | Evidence and version snapshots, embeddings omitted                                                    |
| GET    | `/api/memory-timeline?known_at=...&valid_at=...` | Knowledge cutoff and optional effective-time filter                                                   |
| POST   | `/api/entities/:id/aliases`                      | `{ "alias": "Nexus" }`; rejects aliases owned by another entity                                       |
| POST   | `/api/conflicts/:id`                             | `{ "resolution": "replaced" / "kept_existing" / "kept_both", "effective_at": null or ISO timestamp }` |
| POST   | `/api/extraction-jobs/:id/retry`                 | Process a pending, failed, or expired-lease job                                                       |
| GET    | `/api/relationships/:id/history`                 | Connection version snapshots                                                                          |
| DELETE | `/api/relationships/:id`                         | End the connection now, preserving it and its versions                                                |

The dashboard response includes `memoryRecords` (including archived/disputed/superseded records for inspection), unresolved `conflicts`, unfinished `jobs`, and `aliases`. Current chat retrieval excludes disputed memories while review is pending. The job table is authoritative after a retry; old assistant-message extraction-status snapshots describe the original run.

### Verified memory foundation upgrade

The incremental migration was applied to the connected Ary Nexus Supabase project. Live browser checks verified authenticated dashboard loading, a new evidence-backed memory, its version snapshot and exact source quote, alias creation, and retrieval traces. Automated tests cover rollback, compare-and-swap, RLS, protected history, retry idempotency, conflicts and reviewed supersession, graph-only candidates, validity filtering, and relationship expiration. These deterministic tests do not establish real LLM extraction quality. The OpenAI evaluation below is separate.

## OpenAI production provider

Apply `supabase/migrations/202609060003_openai_embeddings.sql` **once**, after the first two migrations. Do not rerun the initial table-creation SQL against an existing database. The third migration adds embedding provenance, `search_memories_v3`, and a tenant-protected `model_calls` table. It preserves existing memory content and history.

Set these server environment variables (never paste a key into chat or commit it):

```dotenv
ARY_LLM_PROVIDER=openai
ARY_EMBEDDING_PROVIDER=openai
OPENAI_REASONING_MODEL=gpt-5.6-sol
OPENAI_API_KEY=
```

The empty key above is a placeholder. Put the real key only in ignored `.env.local` or your hosting provider's secret environment settings. The OpenAI adapters read the key only from `process.env.OPENAI_API_KEY`. Optional `OPENAI_ORGANIZATION_ID` and `OPENAI_PROJECT_ID` pin requests to the intended funded account; the local deployment uses explicit routing. `LanguageModelProvider` and `EmbeddingProvider` remain independent contracts, wired in `server/context.ts`. No OpenAI SDK is required: a small typed HTTP adapter calls the official endpoints with a 60-second timeout. OpenAI is also the server default when provider flags are absent. There is no silent fallback after an API failure. Explicitly set `mock` / `local` to use development providers; switching embedding providers requires re-embedding.

Reasoning uses `POST /v1/responses`, `store:false`, low reasoning effort, and a bounded output. Extraction uses the same Responses API with a strict JSON schema, followed by local quote, entity, and memory-ID validation. The provider never receives a database dump: reasoning sends at most eight retrieved memories (2,000 content characters each), twenty entity identities, six recent messages (1,500 characters each), and the current input. Extraction receives at most twelve retrieved memories and twenty scoped entities. Metadata, vectors, user IDs, and nested retrieval snapshots are omitted. Server-side graph retrieval still reads workspace records; model payloads are bounded independently.

### Embedding identity and re-embedding

`text-embedding-3-large` is requested with its supported `dimensions:384` parameter, preserving the existing `vector(384)` column and indexes. This is model-supported dimensionality reduction, not client-side truncation. The model defaults to 3,072 dimensions; 384 is an architectural tradeoff whose recall should be evaluated on Ary's data. A future dimension increase needs a schema/index migration and another full re-embedding.

Every new embedding stores `embedding_model`, `embedding_version`, `embedding_dimensions`, and a SHA-256 `embedding_input_hash`. The current version is `openai-te3-large-384-content-summary-v1`. Input is trimmed content plus summary; input over 8,000 UTF-8 bytes is rejected without truncation. Legacy vectors are labeled `legacy-v1`. Semantic search requires the exact model/version and a valid hash marker; lexical and graph candidates can still include facts awaiting migration. Direct database text edits invalidate that marker. OpenAI semantic candidates use a provisional cosine floor of 0.4; local tests use 0.2. These are configurable in code and require workload evaluation.

From **Memory review**, click **Check embedding status**, then **Re-embed all memories**. The authenticated endpoint processes batches of five, includes archived/disputed/superseded records, and preserves their states. It skips records whose full embedding identity and content hash already match, uses compare-and-swap to avoid overwriting concurrent edits, and stops at the first failure. Run again after correcting the failure. Completed rows are not billed twice on ordinary reruns; an API success followed by a failed database commit can require another paid call. Historical version snapshots are audit records and retain their original labeled embeddings.

Alternatively:

```sh
npm run reembed -- --dry-run
npm run reembed
npm run reembed -- --dry-run
```

In Supabase mode the CLI needs the maintenance user's `ARY_SEED_EMAIL` and `ARY_SEED_PASSWORD` in the local environment. It uses normal authenticated RLS access, never a service-role key. Run for each user whose memories need migrating; the dashboard only touches the signed-in user's records. SQL schema migration is one-time; the re-embedding script is idempotent and resumable.

### Logging and validation

Each OpenAI request logs its operation, actual returned model, input/cached/output tokens, latency, estimated USD cost, retrieval count, proposed memory count, status, and a sanitized error code. Each assistant message additionally stores the actual provider/model, reasoning usage, and elapsed pipeline time through answer generation. The response badge and expandable Response metrics show these persisted values, including after switching providers. Legacy responses without recorded identity show Model unrecorded rather than inheriting the current provider. Pipeline latency includes preparation/retrieval but excludes response persistence, network delivery, and post-response extraction. Embedding/extraction costs are logged separately; the per-response cost shown is reasoning only. Aggregate records are persisted to `model_calls` under the current user's RLS scope and visible through **View recent model usage**. Prompts, responses, and keys are excluded from these logs. Proposed extraction counts are not committed-memory counts; extraction jobs and action outcomes record persistence results. Missing usage or unknown model pricing yields `null`, never a fabricated zero.

Cost estimates use standard pricing version `openai-standard-2026-09-06`: gpt-5.6-sol input $4, cached input $0.40, output $20 per million tokens; text-embedding-3-large input $0.13 per million. This is an estimate, not the provider invoice. Update the pricing table when rates change.

```sh
npm test                 # deterministic service, provider transport, and actual SQL migration checks
npm run test:openai      # paid live synthetic evaluation using the configured environment key
```

The live evaluation creates an isolated temporary local fixture, never modifies user memories, and checks semantic recall, paraphrased recall, entity-linked recall, no-relevant-memory abstention, reviewed corrections/supersession, conflicting memories, and full conversation extraction. It writes `.data/openai-evaluation.json` with results and aggregate usage, exits nonzero on a failed or incomplete run, and removes fixture data. Production Supabase re-embedding must additionally be verified with the authenticated dashboard.

The original real-provider synthetic suite passed all seven scenarios. During the hybrid retrieval upgrade, authenticated Supabase migration 004 succeeded and all six existing memories were re-embedded with `text-embedding-3-large`; rerunning updated zero records with zero remaining. Live dashboard checks are recorded in `HYBRID_TEST_REPORT.md`; the earlier provider/extraction/supersession measurements remain in `OPENAI_TEST_REPORT.md`.

Additional API endpoints:

| Method | Endpoint           | Behavior                                                                                           |
| ------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| POST   | `/api/reembed`     | `{ "limit": 5, "dry_run": false }`; bounded tenant-scoped maintenance, maximum 50 records per call |
| GET    | `/api/model-calls` | Latest 50 aggregate model metrics for the authenticated user                                       |

Official references: [Responses API](https://developers.openai.com/api/reference/resources/responses/), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [embedding dimensions](https://developers.openai.com/api/docs/guides/embeddings), [gpt-5.6-sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [text-embedding-3-large](https://developers.openai.com/api/docs/models/text-embedding-3-large).

## Canonical entity resolution

`EntityService.resolveMentions(text)` returns `{ entities, resolutions }`. `resolveEntities(text)` remains a compatibility wrapper returning only canonical entities. `findEntity(idOrName)` follows canonical-name precedence before alias lookup and returns null for ambiguous identity. The implementation is in `services/entity-resolution-service.ts`; domain trace types are in `domain/entity-resolution.ts`.

The existing `entity_aliases` table from migration 002 is reused. It has tenant RLS, a composite tenant/entity foreign key, and unique aliases per user. No extra migration or new integration is needed. Aliases must be explicitly added through the existing entity alias UI/API. The resolver never silently renames, creates, merges, or reassigns an entity; IDs remain unchanged. Resolution of ambiguous legacy normalized aliases is conservative even if direct database edits bypass alias creation checks.

Resolution order:

1. Match canonical names at Unicode word boundaries, ignoring case and normalizing Unicode tokens. Longest overlapping canonical names win, so “Clevaryn Labs” does not additionally resolve to “Clevaryn”. Preserve the original mention and character offsets for inspection.
2. Match known aliases in remaining spans. Canonical names take precedence over colliding aliases. “Ary Nexus” produces one canonical trace; “Nexus” maps through an explicitly recorded alias to the same ID.
3. Detect exact first/last-name tokens of known people as candidates. Partial person names and duplicate canonical names remain ambiguous by default, even if only one partial-name candidate currently exists.
4. Only when a mention is ambiguous, inspect current affiliation relationships for an explicit adjacent qualifier such as “Alex at Clevaryn”. Resolve only if that qualifier supports exactly one candidate. Co-mention elsewhere in the message, spelling similarity, description similarity, and previous conversation context do not establish identity. Expired, zero-strength, or inactive-memory-backed relationships are excluded.

Supported affiliation predicates are works_at, works_for, employed_by, member_of, affiliated_with, contact_for, founder_of, employs, has_member, has_contact, and founded_by. Other relationships remain graph edges but do not prove affiliation for identity resolution. This initial contextual step is deterministic; no extra LLM or embedding request is needed. Probabilistic semantic identity selection, pronoun resolution, and detection/creation of previously unknown entities are deliberately deferred. Misspelled company names are not mapped by similarity.

Each trace includes detected text, offsets, candidate IDs/names/types, resolved canonical ID/name or null, status, confidence, method, a resolution reason, and any supporting relationship IDs. Confidence values are policy scores (canonical 1.0, alias 0.98, contextual 0.9, unresolved 0), not calibrated probabilities or confidence that a memory is true.

User and assistant messages persist the same input-resolution snapshot as `metadata.entity_resolutions`, with `entity_resolution_version=rules-v1`. The `entities` stream event updates the optimistic user message before generation. Each message has expandable **Detected entities** diagnostics; ambiguous cases show alternatives and a clarification requirement. Historical messages are not backfilled with invented traces. Assistant traces describe the user input used to produce that response, not a new entity scan of the generated answer.

The server logs `ary.entity_resolution` with message ID, offsets, method, canonical ID, confidence, reason, and relationship evidence IDs. It omits the raw message and names from aggregate logs; the user-owned message snapshot contains the detailed trace. Reasoning receives bounded resolution status and is instructed to ask for clarification on unresolved identity. Retrieval withholds memories explicitly linked to ambiguous candidates, and extraction validates proposed entity IDs against the scoped entities supplied to the extractor. Unlinked legacy memory text can still mention a person, so this is a conservative linking boundary, not a general proof that generated prose cannot be mistaken.

Tests cover Ary Nexus/Nexus, illustrative Clevaryn and Wag Trails aliases, overlapping/similar company names, duplicate and partial person names, explicit affiliation, stale/disabled evidence, token boundaries, alias reassignment, tenant separation, and message trace persistence. Test-only aliases and people are isolated fixtures; they are not silently added to the live workspace.

## Reflection v1

`ReflectionService` performs a conservative, deterministic evidence review after each completed conversation turn. This is the v1 conversation checkpoint; there is no idle-time detector. Reflection does not make additional LLM calls. `ARY_REFLECTION_ENABLED=true` is the default for automatic queuing; set it to `false` to disable automatic runs. Manual inspection remains available in development.

### Background processing

After memory extraction, the brain durably inserts a `reflection_jobs` row keyed by the source user-message ID. It then finishes the chat stream. The Next.js route uses `after()` to drain up to two pending jobs after the response closes. Reflection is not awaited by the chat response. Browser disconnects do not cancel the server's persistence work. The queue lives in Supabase (or the local development repository), not in a fire-and-forget promise.

Jobs have a two-minute lease, compare-and-swap claim guards, a maximum of five attempts, and pending/running/completed/failed states. An expired lease can be recovered on a later chat request. Failed jobs can be retried in the panel. A job waits if its extraction job is incomplete; finish/retry extraction first. Completed source-message jobs are idempotent. No independent worker or scheduler integration was added: a stopped server cannot drain the queue, and interrupted work resumes on a subsequent chat or explicit development retry, subject to the hosting platform's `after()`/request-duration support.

### Inspection and proposal rules

Reflection reads only the authenticated user's records on the server. It inspects recent (seven-day) or conversation-linked memories, recent decisions, corrections/unresolved conflicts, recently completed tasks, explicitly associated outcomes, and repeated evidence/operational patterns. Categories are capped at 50 inspected records; runs produce at most 20 proposals. The dashboard shows the inspection scope and snapshots. This prototype still reads workspace tables before filtering and does not send them to a model.

| Proposal              | Evidence required                                                                | Applied only after acceptance                                                                                              |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Memory update         | Current memory has no summary                                                    | Add a literal content excerpt as its summary; re-embed; preserve the original fact content                                 |
| Importance adjustment | Support from at least three distinct user messages                               | Increase importance by at most 0.10, capped at 0.80; confidence stays unchanged                                            |
| Relationship update   | Existing positive-strength edge cites a non-current memory                       | Set strength to zero, retaining endpoints/type/history; retrieval already ignores invalid provenance                       |
| Lesson learned        | Completed task and recorded non-pending outcome linked by `action.input.task_id` | Create a procedural memory containing the observed outcome and preserved evidence, without inferring a general causal rule |
| Outcome link          | Explicit action → task → existing goal chain; outcome has no goal                | Add the existing goal ID and retain outcome version history                                                                |

Decisions, completed tasks without outcomes, and unresolved conflicts are observations, not automatic truth changes. Resolve conflicting facts in **Memory review**. Reflection never changes a fact's content, resolves a conflict, merges entities, treats repetition as independent corroboration, or assumes that task completion proves success. Broader semantic generalization and model-generated lessons are outside this rule-based v1.

### Review, evidence and history

The **Reflection** panel is development-only. It displays what Ary noticed, proposed payloads, source snapshots, pending/accepted/rejected status, the reviewer's reason and timestamp, and applied before/after changes. It refreshes every five seconds while open. Accept/reject requires a written reason. No proposals are accepted automatically.

Before acceptance, every evidence record is looked up through the current user's repository and compared with its preserved snapshot. Access timestamps and embedding maintenance do not make evidence stale. Meaningful changes do. All evidence is checked again under transactional row locks, then the target mutation and final proposal decision commit atomically. Memory and relationship changes use their existing version triggers; outcome changes use `outcome_versions`. Accepted lessons carry their proposal ID and evidence in metadata. Rejected proposals do not mutate knowledge. Completed reviews and proposal payloads are immutable through normal database permissions and application routes; decision retries do not apply changes twice.

Fingerprints deduplicate identical changes and evidence across jobs, including previously rejected proposals. A changed evidence set can produce a new reviewable proposal. Accepting one proposal may stale another that depended on the same record: reject the stale one and reflect after a new conversation turn to inspect updated evidence. The panel does not automatically override an earlier review.

Apply `supabase/migrations/202609060005_reflection.sql` once after 004. It adds `reflection_jobs`, `reflection_proposals`, `outcome_versions`, tenant foreign keys/RLS, immutable-review guards, and transactional evidence-check support. Existing outcomes receive baseline history at migration time.

| Method | Development endpoint             | Behavior                                                                                      |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/api/reflection`                | Latest 50 jobs and 100 proposals with observations/evidence/reviews                           |
| POST   | `/api/reflection/run`            | `{ "conversation_id": "uuid" }`; enqueue latest user turn, return 202, process after response |
| POST   | `/api/reflection/jobs/:id/retry` | Retry a pending/failed/expired job after response                                             |
| POST   | `/api/reflection/proposals/:id`  | `{ "decision": "accepted" or "rejected", "reason": "..." }`; atomic review                    |

These endpoints return 404 in production, while authenticated background reflection may still queue proposals. A production review surface must be deliberately enabled in a future version. Console telemetry records reflection job/proposal IDs, counts, policy version and decisions; evidence and written review reasons remain in tenant-protected storage.

Validation: reflection tests cover all five proposal kinds, asynchronous queuing, evidence/history preservation, rejection, idempotency, stale evidence, tenant boundaries, leases/extraction dependencies and failed-commit recovery. PostgreSQL tests verify actual RLS, immutable audit rows, and atomic rollback of a failed acceptance, including version-trigger effects.

## Production brain graph query layer

`GraphQueryService` (`src/services/graph-query-service.ts`) is a separate read model behind
`GraphReadRepository`. It makes no LLM calls and never changes canonical IDs or facts.
The Supabase adapter calls the authenticated, security-invoker
`query_brain_graph_v1` RPC in **migration 006**. Apply
`supabase/migrations/202609060006_brain_graph.sql` after migrations 001–005; it is
safe to rerun and adds only functions/indexes. The JSON development adapter reads
one tenant-filtered file snapshot and implements the same contract; it is not a
production storage option.

### HTTP contract

Send the normal Supabase bearer token. Responses are `Cache-Control: no-store`.

- `GET /api/brain-graph` — bounded graph page, or neighborhood with `root`.
- `GET /api/brain-graph/nodes` — same node search/filters, omits edges; rejects `root`.
- `GET /api/brain-graph/sample` — authenticated **development-only** synthetic fixture,
  same filters, with an extra `sample: true` marker. Never writes sample facts into
  the real workspace. Returns 404 in production.

| Parameter                   | Meaning / bounds                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `root`                      | Canonical entity UUID; omitted for paginated node search                                                    |
| `depth`                     | 1 (default) or 2, traversal in either direction                                                             |
| `q`                         | Up to 120 characters; exact canonical name/known alias or all simple full-text tokens in name + description |
| `types`                     | Comma-separated entity types, e.g. `project,task`                                                           |
| `project_id` / `company_id` | Canonical scope UUIDs; both supplied means intersection                                                     |
| `relationships`             | `current` (default), `historical`, or `all`                                                                 |
| `limit`                     | Nodes: default 50, maximum 100                                                                              |
| `edge_limit`                | Edges: default 200, maximum 500                                                                             |
| `after`                     | Last node UUID from `meta.nextCursor`; search only, keep the other filters unchanged                        |

Example: `/api/brain-graph?root=<entity-uuid>&depth=2&relationships=current`.
Search: `/api/brain-graph/nodes?q=Nexus&types=project&limit=20`.

The response is `{ version: "brain-graph-v1", nodes: [...], edges: [...], meta: {...} }`.
Each node has `id`, `label`, `type`, `status`, `importance`, `recency`,
`connectedMemoryCount`, `activeBlockerCount`, `activeBlockers`, `relatedGoalCount`,
and `relatedGoals`. Each edge has stable `id`, `source`, `target`, `type`,
`strength`, `status`, `validFrom`, `validTo`, `updatedAt`, and `evidenceMemoryId`.
IDs work directly as node/edge keys; all timestamps are ISO 8601 with offsets.
There are no embeddings, memory bodies, conversation bodies, or arbitrary metadata
blobs in the response.

### Semantics

- **Importance:** maximum importance among current linked memories, or `null`
  when unknown. This is an explainable display signal, not a relevance score.
- **Recency:** latest entity or current linked-memory update time; viewing the
  graph never changes it or increments memory access counters.
- **Status:** explicit `entity.metadata.status` when one of `active`, `blocked`,
  `completed`, `cancelled`, `paused`, `archived`, `unknown`; otherwise `unknown`.
  Existing entities are not silently assigned an inferred lifecycle state.
- **Memory count:** distinct links to active, unarchived memories whose validity
  interval includes now. Superseded, disputed, future and expired facts do not count.
- **Active blockers:** incoming `blocks` relationships that are current and have
  positive strength/current evidence. Completed, cancelled or archived blocker
  entities are excluded. Task entities with task records that are all completed
  or cancelled are also excluded. Pending tasks alone are not blockers.
- **Goals:** goals directly associated through `goal.entity_id`, plus goals linked
  through a task associated with the entity. Goal IDs are deduplicated. All goal
  states are returned so consumers can distinguish active and completed goals.
- Blocker and goal summaries are capped at **10 per node**. Their separate count
  fields reveal omitted items, including references outside the displayed neighborhood.
- **Scope:** directed `child -> parent` `part_of` relationships, up to two current
  hops, including the scope itself. This supports task -> project -> company.
  `tracks` and name similarity never imply ownership or membership. Existing
  Clevaryn/Wag Trails/Ary Nexus `tracks` edges therefore do not assert membership.
- **Temporal relationships:** `historical` includes ended or inactive relationships;
  `all` additionally includes scheduled future relationships. Zero strength or
  stale/superseded/archived evidence makes an otherwise timely edge inactive.
  Dates use half-open intervals `[valid_from, valid_to)`. Historical results are
  the latest stored relationship records, **not an audit snapshot at a past knowledge
  time**; full edit history remains in `relationship_versions`. Node summaries and
  scope membership remain current, even when viewing historical edges.
- Filters apply before traversal; excluded intermediate nodes do not bridge a path.
  The root remains an anchor regardless of text/type filters, but must satisfy
  scope filters. A missing/foreign root or wrong-type scope is 404; a root outside
  the requested scope returns an empty graph.

### Bounds and frontend integration

Neighborhoods use breadth-first traversal, stable UUID order within each hop,
maximum 100 nodes, and at most 500 eligible incident edges inspected per frontier
node (plus a lookahead). Cycles are deduplicated. `meta.nodesTruncated` reports
node or adjacency limits; `meta.edgesTruncated` reports the edge response cap.
Every returned edge has both endpoints in `nodes`. Truncated neighborhoods can
omit connections: narrow filters or expand around another root. They do not have
a continuation cursor. Node search uses deterministic UUID keyset pagination,
with `meta.nextCursor` only when another page exists; it is not relevance-ranked.
As data changes between requests, pagination is a live view, not a frozen snapshot.

Production reads filter/aggregate inside PostgreSQL with tenant-scoped adjacency,
membership, memory-link and goal/task indexes, plus a GIN full-text index. Returned
payloads are bounded; aggregate counts can still scan all indexed links for a hub.
Measure representative production datasets before choosing a latency SLO. The
legacy `/api/graph` and dashboard snapshot remain for older consumers;
new production visualizations should use `/api/brain-graph`, not that all-workspace
legacy endpoint.

The earlier development query inspector remains available as the reusable
`BrainGraphPanel` component. The Graph tab now uses the premium Brain Graph
experience documented below. Its source selector opens the same sample fixture.

### Sample fixture and tests

`src/infrastructure/graph-sample.ts` contains seven stable synthetic nodes for
Clevaryn, Wag Trails, Ary Nexus, two sample tasks, a sample goal entity and a
retired renderer. It demonstrates memberships, a blocker, related goals, memory
importance, ended/inactive edges, and a scheduled relationship. All claims are
marked synthetic, including the illustrative project/company memberships.

Sample IDs end in `000000000001` (Clevaryn), `000000000002` (Wag Trails), and
`000000000003` (Ary Nexus), with prefix `70000000-0000-4000-8000-`.
For example:
`/api/brain-graph/sample?root=70000000-0000-4000-8000-000000000001&depth=2`.

`tests/brain-graph.test.ts` executes the real migrations in PostgreSQL/PGlite and
checks both adapters: depth, filters, aliases/full text, irrelevant queries,
metadata, blockers/goals, current/historical/future states, pagination, caps,
cycles, stale evidence, completed blockers, tenant isolation, and matching payloads.
`tests/database.test.ts` reapplies migration 006 to verify rerunnability; HTTP tests
check authentication and production hiding of sample data.

## Brain Graph UI · first premium experience

The **Graph** screen now mounts a lazy-loaded `BrainExperience` from
`src/components/brain/`. It reads the bounded brain-graph API directly; it does
not use the old SVG's all-workspace graph payload. Graph styling is isolated in
`brain.module.css` and the dark shell class is applied only while Graph is open.
Chat, Memories, Entities, and their workflows keep their existing components.

- `BrainCanvas`: canvas rendering, animated camera, selection illumination,
  pointer dragging, wheel/pinch zoom, and viewport culling.
- `BrainDetails`: reusable glass context panel for memories, importance, goals,
  blockers, and directed connections. Metadata is factual; missing status stays
  unknown.
- `useBrainGraph`: abortable loading/search support, filtered queries, neighborhood
  expansion, bounded merge, six-step expansion history, and paged browsing.
- `graph-engine`: independently tested layout, camera geometry, highlighting,
  sizing, and merge limits. Explicit `part_of` membership groups subordinate
  nodes; expansions preserve existing positions and introduce new nodes near
  the selected entity.

Click a node to illuminate its direct connections and inspect its context.
Search names/aliases/keywords, then select a result or press Enter to fly to it.
Results outside the loaded view open their bounded neighborhood. **Expand
connections** adds one hop; **Focus neighborhood** replaces the current view;
**Collapse last expansion** restores the previous snapshot. Use the directory
button for a keyboard-accessible list of every loaded entity. The Graph source
selector offers a clearly labeled synthetic sample universe in development only.

Importance changes node radius. Active/recent nodes have a faint glow and a brief
settling pulse; blockers use amber diamonds and dashed amber edges. Historical
and inactive paths are dashed. Node labels remain legible as the camera zooms;
most labels disappear at distant zoom levels for dense views. Zoom controls and
Fit work with keyboard activation; a focused canvas supports arrow-key pan,
`+`/`-` zoom, `0` to fit, and Escape to clear selection. Pointer gestures support
one-finger pan and two-finger pinch. On narrow screens the side panel becomes a
bottom context sheet. System reduced-motion preferences disable easing and
pulses; offscreen/hidden canvases stop scheduling frames.

### Rendering and data limits

The first fetch requests at most 80 nodes and 400 edges. Incremental views cap at
**240 nodes / 900 edges** and expose server/client truncation. Camera and geometry
live outside React state; React receives only the zoom percentage during camera
movement. Layout settles for 20 bounded iterations on new nodes only, not a
continuous force simulation. The canvas sleeps when settled, caps device-pixel
ratio at 2, culls offscreen nodes, and drops low-zoom labels for dense graphs.
Request cancellation and generation checks prevent old responses from replacing
new filter/source selections. Expansion history is capped at six snapshots.

This is an inspectable graph snapshot, not a live collaboration feed. Refreshing
filters or revisiting the screen loads current data. No FPS guarantee has been
measured on very large production workspaces; the graph layer is bounded, while
the pre-existing dashboard bootstrap still fetches its broader workspace snapshot.
The reusable graph component can be mounted independently of that bootstrap.

`tests/brain-ui.test.ts` checks expansion coordinate stability, camera anchoring,
zoom limits, direct-neighbor highlighting, importance sizing, merge caps,
dangling-edge suppression, and fitting a 240-node layout. Existing graph-service,
provider, memory, entity-resolution, and reflection tests remain in the suite.

## Ary Voice v1

Voice uses the same `/api/chat` and `AryBrainService` pipeline as typed messages. Speech does not create a second conversation store or memory system. Open Chat, press **Microphone**, speak, then **Finish recording**. Partial transcription now appears in the Voice panel as the completed recording is processed. After transcription and audit finish, review or edit the final transcript in the message box and press **Send**. Ary streams its answer and speaks completed sentences while the remaining text is generated. **Read aloud** plays an existing answer. The UI labels the voice as AI-generated and displays the configured speech models.

### Boundaries and configuration

- `src/domain/voice.ts`: independent `SpeechToTextProvider`, `TextToSpeechProvider`, and cancellable reasoning options.
- `src/services/voice-service.ts`: provider-independent input limits and aggregate telemetry.
- `src/infrastructure/providers/openai-voice.ts`: initial server adapters for OpenAI Audio transcription and speech. Credentials come exclusively from the existing server environment. Raw audio is transient and is not written to Ary's database or logs.
- `LanguageModelProvider.reasonWithUsage(context, options)` optionally accepts `onDelta` and `signal`. The OpenAI adapter uses Responses SSE; other providers remain compatible and deliver their full answer without artificial token animation. The development reasoning stub remains explicitly selected with `ARY_LLM_PROVIDER=mock`.
- `src/components/voice/use-ary-voice.ts`: explicit microphone lifecycle, request cancellation, mute and playback controls. `speech-queue.ts` defines a separate browser `SpeechOutput` port, segments streamed text, prefetches one audio segment ahead, and discards late audio after interruption.
- `src/components/voice/voice-controls.tsx`: reusable controls and accessible state indicators. Existing Chat retrieval debug, Memory, Entity, and Brain Graph screens retain their services and routes.

```dotenv
ARY_STT_PROVIDER=openai
ARY_TTS_PROVIDER=openai
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
```

These defaults work without rewriting `.env.local`. Set either speech provider to `disabled` to reject voice calls explicitly; typing remains available. New speech adapters implement the relevant port and are selected in the server composition root (`src/server/context.ts`); Chat and Ary Brain need no provider-specific changes. STT and TTS model selection are independent of reasoning and embeddings. There is no silent speech fallback. The configured project must allow both speech models as well as its reasoning and embedding models.

The optional STT `onDelta` callback enables file-transcription streaming without changing the existing JSON contract. `src/server/voice-stream.ts` emits `delta` events after permission checking and a `complete` event only after action/outcome audit completes. Browser partials stay outside Chat input until completion; failure or cancellation discards them. The development voice panel shows first-text and ready timings measured from dispatch after recorder stop. These include upload/authentication/audit overhead, but not microphone capture duration. Streaming still starts after **Finish recording**, not while speaking.

Compare real provider latency with `node --import tsx scripts/evaluate-transcription-latency.ts`; use `--pipeline-only` for a real-provider streamed-transport/client check with an isolated temporary audit store. These paid synthetic-audio tests never submit text to Ary Brain. Provider-only results go to ignored `.data/transcription-latency.json`; they exclude physical microphone/network/browser acceptance.

The adapter contracts follow the official [transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [speech generation](https://developers.openai.com/api/docs/guides/text-to-speech), and [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses) APIs.

### API and persistence

| Endpoint                     | Input                                            | Result                                                                      |
| ---------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `GET /api/voice/config`      | Authenticated request                            | STT and TTS provider/model identifiers                                      |
| `POST /api/voice/transcribe` | Raw audio body with audio Content-Type           | `{ text }`, or NDJSON with `Accept: application/x-ndjson`; no message write |
| `POST /api/voice/speak`      | `{ text }` (1–700 characters)                    | Ephemeral MP3 response with `Cache-Control: no-store`                       |
| `POST /api/chat`             | `{ input, conversation_id?, modality: "voice" }` | NDJSON entity, delta, response, cancelled, and completion events            |

All voice routes share the existing authenticated tenant context and same-origin write check. Upload bytes are bounded while reading (5 MB); the browser also ends recordings after 60 seconds. Supported capture formats are WebM, MP4 and Ogg where MediaRecorder supports them; the STT endpoint also accepts WAV/MP3. No new schema migration is required: message metadata records modality, response status, and the existing extraction job ID. Original evidence and supersession rules remain authoritative.

**Stop speaking** clears current and queued audio and cancels speech requests without affecting the answer or extraction. **Mute** also suppresses future speech until unmuted; unmuting does not replay stopped audio. **Cancel response**, or pressing Microphone during a response, aborts reasoning and speech. Cancellation waits for the saved-message acknowledgement so a new conversation's canonical ID is retained. Partial assistant text is a transient preview and is not saved as a completed answer. The user message still runs through extraction and Reflection. Server consumption continues after disconnect, and Next `after()` keeps that work attached to the request lifetime. A process crash or host timeout still requires retrying the durable extraction job in Memory review; this is not a durable external worker. A subsequent turn sent immediately after an interruption may precede the prior extraction's completion, while bounded conversation history remains available.

Recording cancellation, navigation, sign-out and unmount stop microphone tracks. Nothing listens before a microphone click. No wake word, background capture, realtime voice service, or additional integration is introduced.

### Latency, checks, and v1 limits

Perception of latency is improved with actual reasoning deltas and sentence-level speech; only the current speech segment is buffered as an audio file. One segment can synthesize while the previous one plays. STT starts when recording ends, not during recording. Transcript review is intentional before facts enter memory. Browser audio restrictions may require a click on **Read aloud**; permission denial is shown without disabling typed chat. The physical microphone and acoustics still need a user check on each target browser/device.

Text reasoning retains model, token usage, latency, retrieval count, and estimated-cost metrics. Speech operations add model and latency to `model_calls`; audio usage/cost fields are explicitly `null` because the current file responses do not provide the usage breakdown needed for a defensible estimate. They are not reported as free. This v1 uses authenticated, bounded requests but does not introduce a distributed speech rate limiter; public deployment should apply the existing project's usage policy at the API boundary.

```sh
npm test                 # includes deterministic streaming, cancellation, voice ports, and extraction tests
npm run test:voice       # paid synthetic TTS → STT → Brain → extraction → paraphrased recall smoke test
npm run test:voice -- --text-only  # real Brain/extraction tests using a synthetic confirmed transcript; no speech calls
```

The live evaluator uses an isolated temporary repository and deletes it afterward. It never records the microphone or modifies your Supabase memories. Aggregate results and synthetic test text go to ignored `.data/voice-evaluation.json`. See `VOICE_TEST_REPORT.md` for the last verification and any remaining access restrictions.

## Core permissions v1

Open **Settings → Permissions** to configure Ary's authority and inspect action attempts. The account owner can always manage policies and review approvals; that recovery path is separate from Ary's tool permissions. In this personal-workspace release, users manage their own account only. Team roles and cross-user administration are not implemented.

| Level | Name                    | Allowed behavior                                                               |
| ----- | ----------------------- | ------------------------------------------------------------------------------ |
| 0     | `no_access`             | The tool operation is blocked                                                  |
| 1     | `observe`               | Read and inspect                                                               |
| 2     | `recommend`             | Observe and recommend; no execution                                            |
| 3     | `draft`                 | Prepare proposals/drafts; no execution                                         |
| 4     | `execute_with_approval` | Observe/recommend/draft directly; execution requires an exact-request approval |
| 5     | `autonomous`            | Execute the registered operation within its policy scope                       |

A server-owned registry defines each tool's action type and operation mode. Policies can restrict a tool, action type, workspace, product/project/company entity, authenticated user, or any intersection of these dimensions. Null scope fields mean all matching actions **within the owning account**, never all tenants. When several enabled policies match, the **lowest level wins**; a narrower permissive rule cannot override a broader restriction. Disable or revise a restriction to relax it. Unknown tools always resolve to level 0, even under a wildcard level-5 policy. No money-movement or trading executor is registered. Gmail sending, documented below, always requires explicit approval.

Existing registered internal operations default to level 5 to preserve the application's previously authorized behavior; the Settings screen lists each default and mode. For example, `brain.respond` is a recommendation operation, `reflection.run` prepares proposals, and `memory.create` or `reflection.review` executes changes. These remain independent capabilities: allowing reasoning does not override a policy restricting extraction, and allowing proposals does not authorize applying them. Tool registration is a code change, not something a model or permission policy can create.

### Service and scope boundaries

- `src/domain/permissions.ts`: levels, operation modes, registry and policy/approval contracts.
- `PermissionService`: resolves policies, appends revisions, records review decisions and audits owner policy changes.
- `ActionService.run`: gates registered callbacks before execution and records request, resolved numeric level, matched policy IDs/reason, whether approval is required, workspace/product scope, timestamp and terminal result. Blocked and approval-pending operations also produce outcomes. Core API mutations, voice calls, data reads and scheduled Reflection processing use this layer.
- `src/server/action-context.ts`: derives the authenticated actor and request fingerprint. Workspace is assigned by the server (`ary-nexus` in this release), not a caller-selected permission override. Product scopes come from owned target IDs in route parameters/body fields, memory links and current relationships; Brain supplies resolved canonical entities for reasoning/extraction. A scoped policy applies when that product is in the action's context. This is an **operation permission system**, not a replacement for Supabase RLS or a per-record confidentiality/filtering system. Aggregate queries and unresolved natural-language references require explicit scope adapters before future tools expose restricted products across shared workspaces.
- `ApprovalDialog` and the API client show the concrete pending request and retry only after user approval. Settings also supports reviewing a pending request for a later explicit retry.

Permission checks are made in server orchestration, not merely by disabling buttons. Supabase RLS remains the tenant boundary. An authenticated owner also has direct access to their own Supabase data through their existing database privileges; these policies constrain Ary's registered operations, not the human owner's independent database access. There is no service-role key or new integration.

### Approval and history

An approval binds the authenticated user, tool, conversation (if any), workspace/product context, original method/path/body hash, operation input and matched policy revision hash. Changing request data or a matching policy invalidates it. Approved grants expire after ten minutes and are consumed atomically by `consume_action_approval_v1`; concurrent retries cannot both use one grant. Grants are consumed before execution, so failures require a new approval. Review does not trigger unattended execution. Background extraction that needs approval leaves its durable job available in Memory review; retrying that job creates a concrete request that can be reviewed.

`permission_policies` is an append-only chain per scope. Revisions reference the preceding row; unique constraints reject stale/concurrent successors. Disabling creates a new revision rather than deleting history. `action_approvals` retains decisions, reasons, expiration and consumption. Neither table grants authenticated clients update/delete access. Only the bounded, authenticated consumption RPC can mark a grant used. Action request fields and terminal results cannot be rewritten through the application role. Older actions retain their original label in `metadata.legacy_permission_level` after conversion to numeric levels.

The API supports:

- `GET /api/permissions`: levels, registry, current policies, policy history, latest 100 action attempts, approvals and owned product scopes.
- `POST /api/permissions/policies`: add/revise/disable a policy with a reason and expected `parent_id`.
- `GET /api/permissions/attempts/:id`: inspect the exact pending request.
- `POST /api/permissions/attempts/:id/review`: `{ decision: "approved" | "rejected", reason }`.

Owner control-plane requests are authenticated and same-origin checked. Writes are audited even under a level-0 Ary policy. Unknown or malformed HTTP requests are rejected before operation dispatch; the action ledger describes dispatched operation attempts, while authentication/validation failures stay HTTP errors.

### Action requests, approval queue, and history

The repository audit found all six levels, scoped policy revisions, `ActionService.run()`, exact-request approvals, Settings, outcomes, RLS, and immutable audit records already implemented. This milestone extends those services; it does not introduce a competing policy engine or action store. The existing Graph renderer is Canvas2D plus vgpu; XYFlow remains reference material. None of those graph layers changed.

Open **Settings → Permissions** for policies, **Approvals** for tool discovery/request composition and review, and **Action history** for the full paged ledger. The original Settings playground and approval dialog remain available.

`ToolRegistry.describe()` returns each executable tool's name, description, available action, JSON input schema, required fields, risk, simulation flag, default authority and approval requirement. `GET /api/actions/tools` adds the effective workspace permission. Entity scope is resolved again on submission; that displayed workspace value is not an execution grant. A policy cannot expose an unregistered handler. Internal memory/provider capability metadata does not make those handlers dispatchable through the generic action endpoint.

All ten handlers are **simulations only**, with no repository, network, filesystem, or model access:

| Tool                         | Inputs                                 | Default level | Behavior                                                  |
| ---------------------------- | -------------------------------------- | ------------- | --------------------------------------------------------- |
| `mock.create_task`           | `title`, `project_id`                  | 4             | Return an unsaved example task                            |
| `mock.update_task`           | `task_id`, `status`                    | 4             | Return a proposed task update; owned task required        |
| `mock.update_project_status` | `project_id`, `status`                 | 4             | Return a proposed project update                          |
| `mock.draft_message`         | `recipient`, `message`                 | 3             | Return an unsent draft                                    |
| `mock.create_note`           | `title`, `content`                     | 4             | Return an unsaved note                                    |
| `mock.fetch_project_summary` | `project_id`                           | 1             | Return a clearly synthetic summary, not live project data |
| `mock.observe`               | none                                   | 1             | Fixed synthetic workspace summary                         |
| `mock.recommend`             | `message`                              | 2             | Deterministic recommendation                              |
| `mock.draft`                 | `message`                              | 3             | Unsaved example draft                                     |
| `mock.execute`               | `message`, optional `simulate_failure` | 4             | Simulated success or intentional failure                  |

Tool discovery contains allowed status enums. IDs used as project/task/evidence inputs must belong to the authenticated owner. Related memory links also contribute project/company scope, preventing a caller from omitting a restrictive scope while citing that memory. Distinct `mock_*` action types let tests target simulations without changing real-tool policies. Existing internal tool names and level-5 defaults remain unchanged.

#### Request and review API

```json
{
  "tool": "mock.create_note",
  "input": { "title": "Example", "content": "Review the project plan" },
  "reason": "Prepare an example for review.",
  "request_key": "a-unique-request-key",
  "product_entity_id": null,
  "conversation_id": null,
  "related_entity_ids": [],
  "related_memory_ids": []
}
```

- `POST /api/actions/request`: validates a typed, explicitly selected action, resolves authority, obtains approval if needed, executes its handler, records the result and outcome. Success is HTTP 201 `{ action_id, tool, result }`; pending review uses the existing HTTP 409 `approval_required` contract. This release does not add a free-form intent planner or LLM tool calling.
- `GET /api/actions/tools`: executable catalog with schemas and workspace permissions.
- `GET /api/actions/history?offset=0&pending=false`: 50 owner-scoped attempts per page, with approval decisions (including consumed grants), outcomes and associated model calls. `pending=true` selects the review/retry queue. The underlying repository still loads the owner's records before slicing; cursor-based database pagination is a future scaling improvement.
- `POST /api/actions/:id/revise`: accepts a complete edited envelope with a **new key**, validates it, rejects the unreviewed original with a reason, and submits the linked replacement. Original inputs/decisions remain immutable. An already reviewed request cannot be edited in place.
- Existing `POST /api/permissions/attempts/:id/review`: approve/reject with a reason. **Approve and run** in the queue reviews then resubmits the exact saved envelope. A changed policy or request requires a fresh grant. Approvals still expire after ten minutes and are consumed atomically once.
- `POST /api/actions/:id/remember`: explicit acceptance of a completed simulation's episodic memory proposal, described below.

All routes retain authentication, tenant scoping and same-origin write checks. Requesting identity is assigned by the server (`authenticated_user` for these requests, `ary` for existing service callbacks); clients cannot spoof an agent identity, tenant, handler, mode or authority. No multi-agent orchestration was added.

Envelope and foreign-reference errors retain their existing pre-dispatch HTTP behavior. Once dispatched, invalid tool input is audited **before any approval is requested or consumed**; denied, approval-pending, failed, successful and replay attempts are recorded. Each includes owner, tool/action, inputs, reason, requesting identity, relevant entity/memory IDs, permission decision, error, timestamps and result. Approval records preserve the review reason and exact grant. Existing `model_calls.action_id` supplies model cost/usage when present; mock execution makes no model call, so no cost is invented. Historical records missing an agent label remain marked as legacy.

#### Idempotency and migration 010

Apply `supabase/migrations/202609070010_action_execution_keys.sql` after migration 009. It is additive and rerunnable: one unique `(user_id, metadata.execution_key)` index on **existing actions**, plus authenticated `action_execution_ready_v1()` for a readiness check. No table or existing column is replaced. This migration was applied through the configured Supabase project's SQL editor on 2026-09-07. The local adapter mirrors uniqueness in its existing atomic write lock.

The new request UI always sends `request_key`; it retains that key for a retry and changes it when inputs change or **New request** is chosen. For compatibility, older callers may omit it, retaining their previous non-idempotent request behavior. `ActionService.run()` retains its existing parameters; its optional sixth audit argument now supports validation, metadata, a request key and replay reconstruction. Readiness is checked before granting keyed execution, so a Supabase installation missing migration 010 fails closed with HTTP 503.

An authorized execution claims its key before invoking the handler. Only one concurrent claim succeeds. An identical retry returns the original completed result/action ID without invoking the handler again; the retry itself gets a linked audit/outcome record. A key with changed inputs receives HTTP 409. A running key returns 409; retry later. A failed key is retained: inspect the failure and deliberately use a new key to retry. Current permissions are still checked before returning cached results. Canonical serialization keeps approval and retry fingerprints stable across JSONB key reordering. Success and its outcome commit together using the existing transaction API.

This is duplicate-execution protection, not a claim of exactly-once external side effects. A process crash after claiming a key can leave a `requested` record requiring investigation; no automatic reclaim or execution worker is added. Failure or interruption during revision submission can leave the original rejected without a runnable replacement; the owner can submit a fresh request and inspect both audit records.

#### Memory handoff

A completed simulation exposes **Accept episodic memory proposal** in Action history. That explicit user action calls the existing `memory.create` gate and `MemoryService.createMemory()`, with the existing provider used for its embedding. It records a low-importance episodic entry prefixed **Simulation record only — no real task, project or message was changed**, linked to its action and related evidence in metadata. Existing memory source/version handling remains responsible for provenance. It never rewrites a fact, advances a task, or invents a project outcome.

Permission denial blocks the memory write; level 4 uses the existing approval dialog. The fixed `action-memory:<action-id>` key prevents repeat acceptance from creating duplicate entries. No memory is saved automatically just because a mock tool ran. Its evidence references are retained in metadata; this milestone does not add new graph edges or bypass `memory.link` permissions.

Manual check: submit a mock note in Approvals, inspect its reason and inputs, modify it, and verify the original is rejected and the edit needs fresh approval. Approve and run; retry with the same key and verify the original result/action ID is returned. Inspect Action history. Separately test rejection, a scoped level-0 rule, and `mock.execute` with `simulate_failure=true`. Existing tests plus new cases cover all six levels, concurrency, schema validation, evidence scope, edited requests, idempotent replay, complete history and reviewed memory creation. See `ACTIONS_MILESTONE_TEST_REPORT.md` for the current audit and results.

### Existing schema installation

Apply `supabase/migrations/202609060007_permissions.sql` **once**, after migrations 001–006. It adds policies/approvals and converts historical action permission labels without deleting existing records. Do not rerun the initial schema. Migration 007 was applied to the configured Supabase project during implementation. The local repository upgrades legacy labels when reading its file and uses the same policy/approval contracts.

`npm test` covers all six levels, overlapping scopes, unknown-tool denial, policy revision conflicts, user/product isolation, approval rejection/expiry, changed inputs/policies, concurrent one-use consumption, SQL RLS, audit immutability, and owner recovery. The live UI was tested with a temporary level-4 `memory.reembed` policy using **Check embedding status** (`dry_run: true`): it required approval, executed once after approval, required fresh approval on repeat, and stopped on rejection. The temporary rule was disabled afterward, with its history retained. No production memories or embeddings changed. See `PERMISSIONS_TEST_REPORT.md`.

## Ary Economics / ROI accounting

Open **ROI** in the sidebar to view **Ary Economics**. This is an evidence ledger, not a payment system or accounting integration. All amounts use **USD**. Economics does not connect bank accounts, revenue feeds or money movement. Finance v1 below is a separate source-backed visibility ledger; it does not alter ROI attribution.

Apply `supabase/migrations/202609060008_roi.sql` once, after migration 007. It adds tenant-scoped, append-only `roi_cost_entries` and `roi_outcome_entries`, plus an optional owner-checked `model_calls.action_id`. Existing records and unlinked telemetry are retained. Demo storage initializes the tables automatically.

### Records and interfaces

- `RoiService.recordCost()` records an action's total estimated model cost, reported actual model cost when available, optional additional compute and tool costs, attribution confidence, notes, and evidence reference. Costs belong to the action, so multiple outcomes do not repeat its compute expense.
- `RoiService.recordOutcome()` records an existing outcome's time saved in minutes, revenue influenced, expense avoided, confidence, attribution notes, evidence, impact date, and attribution status. The outcome retains its original operational status (`pending`, `success`, or `failure`) independently. An outcome's cost is available through its linked action.
- `RoiService.report()` composes the dashboard through the repository interface. `calculateRoi()` contains the pure, provider-independent accounting rules; the UI performs no accounting calculations.
- `GET /api/roi?month=YYYY-MM` returns totals, action/replay counts, attribution quality, six UTC monthly trend points, uncertainty/coverage, cost rows, outcome assessments, record selectors, and full revision history.
- `POST /api/roi/costs` and `POST /api/roi/outcomes` validate strict schemas in `src/domain/roi.ts`. A first assessment uses `parent_id: null`; revisions name the current assessment ID. Unique root/successor constraints reject duplicates and stale concurrent revisions. No update/delete endpoint exists.
- Registered `roi.read` and `roi.record` capabilities pass through the existing permission gate and action/outcome audit. Recording evidence does not grant any ability to move money.

Model providers remain unchanged. The server's asynchronous action context associates new model-call telemetry with the exact enclosing action, including concurrent and nested actions. Token-priced `estimated_cost_usd` remains an **estimate**. Actual amounts are manually reported with an evidence reference; Ary does not claim they have been checked against a provider invoice.

### Accounting rules

1. **Null means unknown.** Blank financial/time fields remain null. Zero is accepted only when explicitly recorded. A technical success never supplies a financial benefit, saved minute, or default dollar amount.
2. **Count cost once.** For each action, reported actual model cost replaces the total estimate. Otherwise an explicit action compute estimate replaces its linked token-cost subtotal. Otherwise use available linked model-call estimates. Unpriced calls and actions without a cost record are counted in the coverage warnings, not silently priced at zero.
3. **Historical telemetry stays honest.** Old unlinked calls count once in their call month. Ary never guesses which action produced them. When a manual cost for a legacy action might overlap unlinked calls in that month, that assessment is retained but excluded from totals and net/ROI are withheld. A later revision can withdraw the manual values by setting both to null. Reconciliation of historical call ownership is intentionally not automated.
4. **Require outcome evidence.** Benefits require a linked, non-pending outcome. `pending` and `rejected` assessments are excluded. `estimated` assessments appear in a separate uncertain-attribution subtotal. Headline benefits include only `confirmed` attribution, which requires confidence 1 and an evidence reference. Confidence describes the human attribution claim, not independent verification. Use estimated whenever credit to Ary is uncertain.
5. **Preserve history.** Revisions supersede earlier accounting assessments without editing the underlying action or deleting evidence. Rejected revisions remove earlier benefits from current totals. Each outcome can have an independent assessment; notes must explain Ary's credited portion and prevent counting the same benefit across outcomes. Cross-outcome causal attribution still needs human review.
6. **Use UTC months.** All linked compute cost is assigned to the action's start month, even if its call completes the following month. Impact uses its explicit effective date. Monthly dashboards use the latest assessment, including revisions entered later; these are restated views, not closed accounting periods.
7. **Transparent formulas.** Recorded confirmed benefit = known confirmed revenue influenced + known confirmed expense avoided. Operating cost = known model cost + explicitly recorded additional compute cost + explicitly recorded tool cost. Net contribution = recorded confirmed benefit − recorded operating cost. ROI multiple = recorded confirmed benefit ÷ recorded cost. A missing benefit/cost, ambiguous legacy overlap, unknown model subtotal or unpriced model call withholds net contribution and ROI. A zero denominator also withholds ROI. Known zero benefit and positive cost correctly give a negative contribution and a zero multiple. These are totals of known records, not a forecast or complete profit calculation.
8. **Time remains time.** Saved minutes are never multiplied by an invented hourly rate or added to financial benefit. Hosting, storage, subscriptions, and other overhead count only when explicitly allocated into additional compute/tool evidence. No missing overhead is assumed to be zero.

Use **Record or revise accounting evidence** to select an action or outcome, enter supported values, and explain attribution. Select the same record again to append a revision. The dashboard displays cost basis, missing coverage, uncertain benefit, outcome inclusion/exclusion reasons, and an immutable history viewer. No synthetic financial benefit is seeded into the live database.

The initial service reads tenant records using the repository's paginated reads and calculates a monthly report in memory. This is appropriate for the current development workspace; introduce database-side monthly aggregation and paginated ledger/history endpoints before operating at large audit-log volumes. Currency conversion, invoice reconciliation, overhead allocation, automatic financial attribution, and period close are deliberately absent.

Apply `supabase/migrations/202609070011_roi_economics.sql` after the existing migrations to enable separate compute/tool recording. It adds two nullable columns to the existing immutable cost ledger and is safe to rerun. Existing records remain unchanged. The historical `estimated_compute_cost_usd` field retains its meaning as the total **model** estimate override; `additional_compute_cost_usd` and `tool_cost_usd` are added once, and must exclude costs already represented in another category. Legacy API payloads can omit both new fields.

The overview uses exact financial values with brief opacity/position transitions, restrained improvement/degradation lighting, accessible monthly tables, explicit unknown-month gaps, and reduced-motion support. It never animates through invented intermediate dollar values. Attribution confidence is reported human confidence, not verified causal proof; uncertain benefits remain outside headline totals. Action counts include audited read attempts, and successful non-replay counts do not imply a financial outcome.

Verification for this extension is documented in `ECONOMICS_TEST_REPORT.md`; `ROI_TEST_REPORT.md` records the original milestone. Run `npm run test:economics` against the local development server for isolated browser fixtures (no live financial writes). Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check` for the local checks.

## Google Calendar v1 — first external tool

Open **Calendar** in the Nexus orbit or workspace sidebar. This implementation uses the existing `ToolRegistry`, `ActionRequestService`, `PermissionService`, `ActionService`, approval queue, and action/outcome records. It does not create a parallel calendar database or change task/project models.

### Connection setup

1. In Google Cloud, enable Google Calendar API and create a **Web application** OAuth client. Configure the Google consent audience and, when using a testing app, add the intended Google account as a test user. Follow Google's [web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).
2. Add this exact authorized redirect for the installed local app: `http://127.0.0.1:3000/api/calendar/oauth/callback`. A deployed server must use its fixed HTTPS callback URL. Set the server-only `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and `GOOGLE_CALENDAR_REDIRECT_URI` environment variables. Never use `NEXT_PUBLIC` variables for secrets.
3. Set `ARY_INTEGRATION_ENCRYPTION_KEY` to 32 cryptographically random bytes encoded as 64 hexadecimal characters. Keep this key outside source control and back it up securely with the credential vault. Changing it without migrating existing credentials requires reconnecting. Local setup prepared this private key in the ignored `.env.local` without displaying its value.
4. `ARY_CALENDAR_VAULT_DIR` defaults to `.data/calendar-vault`, excluded from Git. The provided AES-256-GCM adapter is for a **single persistent host** (including the installed app's local server). For deployment use a private persistent volume; replace the `CalendarVault` adapter with managed encrypted storage before multi-host/serverless deployment. Do not deploy the default file vault to ephemeral storage.
5. Sign in to Ary with Supabase. Choose **Connect read-only**, then **Continue securely in Google**. To create/update personal events, choose **Enable approved editing** and complete Google consent. Return to Ary and select **Refresh connection**. The browser handoff also works with the existing Electron external-browser policy; no desktop security permissions were broadened.

OAuth uses Google's `google-auth-library`, PKCE, a short-lived one-time launch ticket, a browser-bound HttpOnly/SameSite cookie, one-time callback state, verified Google account identity, and encrypted per-Ary-user refresh tokens. Launch/callback responses are no-store and suppress referrers. Tokens never appear in action inputs, model context, frontend storage, or normal repository records. Connection/disconnection requests use the owner control-plane audit. Google API requests run inside audited Calendar actions; authorization transport does not grant tool execution permission. Disconnect removes local credentials even when remote revocation fails, and reports that case.

Calendar supports up to eight Google accounts per Ary user. Use **Add / reconnect account read-only** for each account, then select the account above the timeline. Adding a different verified account preserves existing accounts; reconnecting the same account rotates only its connection ID and invalidates its earlier approvals. Disconnect affects only the selected account. Existing single-account storage is read without migration; credentials remain in the same atomically written encrypted vault. Read/recommend actions accept an optional `connection_id`; legacy callers use the original default account. Each result covers one selected account’s primary calendar, not combined cross-account availability. Gmail remains unchanged.

Google consent requests `openid`, `email`, and either `calendar.events.readonly` or `calendar.events`. These scopes allow the required [Calendar event access](https://developers.google.com/workspace/calendar/api/auth); Ary exposes only primary-calendar read/recommend/create/update capabilities. Calendar v1 exposes no delete, invitation, or autonomous scheduling tools. Gmail has separate consent and capabilities below.

### Permission and action behavior

| Tool                        | Default     | Behavior                                                                                                                         |
| --------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `google_calendar.read`      | 1 observe   | Read an explicit window of up to 31 days, expand recurring events, identify overlaps, resolve canonical entity/alias mentions.   |
| `google_calendar.recommend` | 2 recommend | Read through its own observe permission check, then suggest up to three blocks inside the requested window. No event is created. |
| `google_calendar.create`    | 4 approval  | Create a timed personal event after reviewing exact details and linked Nexus entities.                                           |
| `google_calendar.update`    | 4 approval  | Update an owned, timed, non-recurring event without attendees after reviewing its before/after values and Google ETag.           |

The new optional `alwaysRequiresApproval` capability ceiling applies to Calendar writes. Even a level-5 workspace/tool policy cannot make them autonomous. Levels 0–3 block writes. Existing internal tools retain their previous behavior. Scope still uses existing user/workspace/tool/action/product policies, with linked entity IDs validated by the existing request pipeline. Permission Settings and tool metadata disclose this ceiling.

Create/update are dispatched through `POST /api/actions/request` with a `request_key`, `connection_id`, stable `operation_id`, and `event` object containing summary, description, explicit offset start/end, and IANA time zone. Updates also include `event_id`, `etag`, and `before`. Related entity/project IDs belong in the existing request envelope. Updates retain existing Nexus links and may add a link; omitting existing links is rejected so their scoped policies cannot be bypassed. Removing stored links is not exposed in v1. Inputs, reason, source conversation/message, related memories/entities, permission decision, approval, result/event ID, error, timestamps, and outcomes use the existing audit history. Optional memory recording still requires the existing explicit review.

The Google adapter checks the connection ID again at execution: reconnecting another account invalidates old proposals. Creates use a deterministic Google event ID and private operation fingerprint. Updates use [`If-Match` and ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources) to reject changes made after review. Both operations use `sendUpdates=none` and expose no attendee fields; existing attended/recurring/all-day/special events remain readable but cannot be edited in v1.

### Recovery and honest availability

A Google write and a PostgreSQL transaction cannot be one atomic transaction. Ary logs the action before external execution. If Google accepts a write but the local receipt transaction fails, the action remains failed/uncertain; inspect history and retry with a **new request key and fresh approval while retaining the operation ID**. The provider then recognizes its prior operation and returns the existing event instead of duplicating the write. Repeating a successful request key uses the existing local idempotent replay. Reusing an operation ID with different event details is rejected.

Reads follow up to four 250-event pages. If another page remains, `complete:false` suppresses availability recommendations; no free time is inferred from incomplete results. Overlap checks use half-open time intervals, skip declined/transparent events, and convert all-day date boundaries in the Calendar time zone, including DST. Suggestions check **only the connected primary calendar** and never imply that other calendars or people are available. Set the desired working window explicitly; Ary does not invent work hours.

The timeline renders Nexus entity chips, contextual evidence and conflicts, selected-event focus, exact before/after approval details, and Google-confirmed receipts. Motion is restrained and respects reduced motion. The existing approval queue also supports rejection and edited requests with a new approval. Action History includes the Calendar inputs and event result.

Chat supports explicit upcoming/today/tomorrow Calendar reads and conflict summaries with focus links into the timeline. Natural-language writes direct the user to the reviewed Calendar form; they do not silently infer event details or execute. Time-block recommendations use the explicit timeline window. This is intentionally narrower than a general scheduling agent.

### Operations and limits

No database migration is needed for Calendar: existing action/outcome/approval/entity schemas are reused, and credentials remain in their own server-only vault. API setup is explicit; missing OAuth configuration shows an unconnected state, never simulated events. A crashed process may leave a vault `.lock` file; stop the owning server and confirm no Calendar operation is in flight before an administrator removes that stale lock. Never clear locks automatically during uncertain external execution.

Live Google consent and account-level behavior require configured credentials and a signed-in user. Local adapter and browser tests use isolated fixtures. Run `npm run test:calendar` with the development server running, plus `npm test`, `npm run typecheck`, and `npm run build`. See `CALENDAR_TEST_REPORT.md` for exact changes, verification, setup status, and the manual test plan.

## Reference implementations and package adoption

The [reference catalog](references/README.md) maps Mem0, Graphiti, LangGraph, XYFlow, and LiveKit Agents to specific Ary problems, existing service boundaries, and acceptance criteria. Each reference has local source pointers, observed snapshot/version evidence, and reviewed-file hashes. Downloaded projects remain reference material, not merged applications. Package adoption must solve a concrete problem while preserving Ary's Next.js/TypeScript, Supabase/Postgres/pgvector, provider interfaces, canonical identities, evidence history, and permission/accounting ownership.

## Phase 1: core intelligence completion

The existing Next.js/TypeScript service architecture, canonical IDs, Supabase/Postgres database and pgvector embedding space remain in place. This phase strengthens the existing entity → hybrid retrieval → reconciliation pipeline; it does not add voice, agent orchestration, financial/email integrations, or autonomous execution.

| Capability                        | Implementation and behavior                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical identities and aliases  | `EntityResolutionService` matches complete known phrases before unrelated shorter substrings; exact canonical names take priority over aliases at the same mention span. Neither path renames or merges IDs. `EntityService.searchEntities()` now includes aliases.                                                                                     |
| Contextual disambiguation         | Current recorded affiliation edges can distinguish an ambiguous person through `Alex at Clevaryn` or `Clevaryn’s Alex`. Mere co-mention, spelling similarity, and unqualified names cannot establish identity. Resolution reasons and relationship IDs remain in message debug traces.                                                                  |
| Hybrid retrieval                  | Existing pgvector semantic search, PostgreSQL full-text search, entity-linked candidates and bounded 1–2 hop traversal fuse using equal-weight RRF. User/status/validity filters precede ranking; importance/confidence are tie breakers. UI retains channel scores, graph paths, final rank and inclusion reasons.                                     |
| Reconciliation and contradictions | Provider-proposed new/duplicate/conflict/supersession candidates require exact evidence from the source user message. New deterministic guards catch equivalent assertions with opposing negation and narrowly defined changed date slots even when mislabeled. Changed numbers, negation, month/day markers cannot be silently absorbed as duplicates. |
| Supersession                      | Review remains explicit. Replacing a fact atomically activates the candidate, records `supersedes_id`, and ends the previous fact's validity. An unspecified effective time now defaults to review time. Future-dated replacement is rejected rather than retiring current truth early. Historical snapshots and both sources remain.                   |
| Provenance                        | New `memory_sources` records cover each memory and each content/summary revision, with source kind, reference, quote when available, and the content snapshot. Original missing evidence is honestly labeled `legacy_unknown`.                                                                                                                          |
| Debugging                         | Retrieved memories include their latest source record and unresolved-conflict count. OpenAI receives the bounded provenance and conflict warning for retrieved memories only. Memory review exposes the full source timeline alongside supporting/contradicting messages and version history.                                                           |

Apply `supabase/migrations/202609060009_memory_sources.sql` once after 008. It creates the tenant-scoped source table and server-owned capture triggers, backfills provenance without changing existing memory content/embeddings, and removes application permission to edit/delete source quotes. Existing supporting/contradicting evidence is retained; new quotes are validated against an owned user message. The backfill helper skips memories already represented; its execution is restricted to the database owner/trigger path, not exposed as a public RPC. Demo storage mirrors capture and source validation.

`MemoryService.history(id)` now returns `{ versions, evidence, sources }`. Retrieval hits add `source_evidence` and `unresolved_conflict_count`; older response snapshots can lack both and are labeled accordingly. Provenance proves where input was recorded, not that a statement is independently true. Revisions never relabel an old conversation quote as evidence for newly edited wording.

Known limits: general semantic contradictions still depend on extraction quality and bounded retrieved candidates; the deterministic guards are intentionally narrow. Unclear identities require user clarification, and disputed facts require review. There is no pronoun-guessing or fuzzy-name auto-merge, no scheduled future supersession, and no invented reconstruction of lost source material. Large graph candidate generation still needs database-side traversal/pagination before unbounded workspace growth.

See `PHASE1_TEST_REPORT.md` for verification and the short manual test plan.

## Brain Graph GPU enhancement

The existing Canvas2D renderer still owns layout, selection, labels, pan/zoom, keyboard controls and fly-to navigation. XYFlow remains a reference candidate; the graph data model, APIs and database are unchanged. One transparent, pointer-inert vgpu 0.4.0 canvas renders beneath the graph. Use **Effects → Auto / Off** in the graph; this preference is stored locally. The adjacent GPU / Static indicator reports the active rendering mode.

`src/components/brain/brain-effects.tsx` lazily imports the GPU adapter. `effects/bridge.ts` shares the actual interpolated positions and camera through a subscription, without per-frame React renders. `effects/vgpu-renderer.ts` owns resource lifetime, resize, visibility and quality. `effects/scene.ts` culls and packs a bounded instance buffer. `effects/shaders.ts` contains Ary-authored WGSL strings, supported directly by vgpu, so no custom shader-loader configuration is required.

Two draws produce a faint moving field with camera parallax, soft important/selected-node halos, pulses along selected current relationships, and sparse creation particles. Text and graph geometry are never passed through bloom. Standard quality caps halos at 32, selected paths at 24, and particles at 48. Low quality uses 12 halos, 8 paths and no particles. Ambient rendering targets 30 FPS; camera/position changes render immediately for alignment. Effect resolution caps at 1.25 DPR and two million pixels; sustained slow animation-frame cadence reduces quality and resolution. These limits bound the enhancement, while the existing graph view retains its 240-node/900-edge cap.

No adapter, initialization/shader failure, device loss, or reduced-motion preference leaves the standard graph usable. Off and reduced motion allocate no GPU context. Hidden/offscreen views stop scheduling frames; unmount, Off and device loss release resources. Failure does not retry continuously. Turning Off then Auto retries deliberately.

Creation particles use ephemeral notifications from successful manual memory/relationship creation and chat extraction completion. They never infer creation from initial loading, pagination, search or expansion. Notifications expire after 15 seconds, are limited to eight, and are cleared on sign-out. Relationship particles anchor only to visible known endpoints; unlinked memory particles use a neutral bottom-of-view cue. Synthetic sample mode does not consume workspace notifications. No new polling, integrations or database writes are introduced.

Validation: `npm test`, `npm run typecheck`, `npm run build`. `npm run test:brain-gpu` additionally compiles and renders both shaders on a real local WebGPU adapter, reads pixels to verify a halo, and fails on GPU validation errors. It requires GPU access; it does not contact the database or AI providers. See [BRAIN_EFFECTS_TEST_REPORT.md](BRAIN_EFFECTS_TEST_REPORT.md) for browser checks and limitations.

Reference patterns: [official gradient lifecycle](https://vgpu.sh/examples/gradient/source.md), [adaptive quality](https://vgpu.sh/examples/adaptive-quality), and [vgpu performance guidance](https://vgpu.sh/docs/guides/performance-playbook). Only the package is reused; no reference application is copied.

## Mac desktop app with live updates

Ary Nexus is installed at `~/Applications/Ary Nexus.app`. Open it from Finder or Spotlight. It has its own window, icon, menus and persistent sign-in session. The installed **Live** app loads the current project at `/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus`; keep that folder and its Node installation available. This is a personal development app tied to this Mac, not a distributable offline release.

The desktop app connects to `http://127.0.0.1:3000`. It checks `/api/desktop/health` before displaying the page, reuses an existing Ary development server, or starts Next.js on loopback using the installed Node executable. An unrelated or production-mode server is left untouched and produces a native retry dialog. Closing the window keeps Ary available in the Dock; **Quit Ary Nexus** stops only a server it launched itself. A reused server keeps running. Help includes connection retry, project folder and server-log shortcuts.

Next.js Fast Refresh updates frontend code and styles as files are saved. Some edits reload the whole page; unsent UI state may reset. Backend route edits are picked up by the development server. Dependency or environment changes can require a server restart. Desktop launcher code is loaded from `desktop/` when the app starts, so use **Ary Nexus → Restart Ary Nexus** for shell changes. Changes to Electron itself, its icon, or packaged configuration need a new desktop build. There is no remote release updater in this version.

`desktop/main.cjs` owns the native window and lifecycle; `server-manager.cjs` owns only its own subprocess; `security.cjs` defines exact-origin navigation and microphone permissions. The renderer runs sandboxed with context isolation, no Node integration, and no privileged preload bridge. Web links open in the system browser. Only audio capture from Ary is eligible for an OS microphone prompt. Credentials remain in the existing server environment; neither `.env.local` nor the database is packaged. Desktop browser storage lives separately under macOS Application Support, so the first desktop launch may need a sign-in.

Developer commands:

```sh
# Open the development desktop shell
npm run desktop

# Produce an arm64 .app on this Mac (requires Xcode command-line tools)
npm run desktop:build
```

The build uses Electron 44.2.0 and `@electron/packager` 20.3.0. It creates a local ad-hoc-signed app in `dist-desktop/Ary Nexus-darwin-arm64/Ary Nexus.app`. Its small launcher contains only a project path and Node executable path; it loads application code from the source folder. `.desktop-build/` and `dist-desktop/` are ignored. Developer ID signing, notarization and a signed release update feed are future distribution work.

Verification: 167 tests passed, including server ownership, unrelated-server refusal, exact-origin restrictions and permission checks. The packaged app opened the authenticated Supabase workspace. A temporary footer edit appeared live in the native window and its removal appeared live too, without restarting the app. Cold-start process invocation/cleanup is covered by controlled tests; the observed desktop launch reused the existing running server. See [DESKTOP_TEST_REPORT.md](DESKTOP_TEST_REPORT.md).

References: [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), and the bundled Next.js Fast Refresh documentation.

## Real internal task creation

`create_task` now writes to the existing `tasks` table through `ToolRegistry` → validation → existing permissions/approval → `ActionService`. Its default is level 4 (`execute_with_approval`); levels 0–3 cannot create tasks, and an explicitly configured level 5 permits internal execution. `mock.create_task` remains a simulation so existing mock permissions and demonstrations never become real writes. Google Calendar is the first external adapter; connection requires separate owner OAuth consent.

In Chat, try: **“Ary, create a high priority task to finish the Wag Trails Live tracking bug fix tomorrow.”** The narrow command adapter uses the existing canonical/alias resolver, asks for clarification if the project is ambiguous, and shows the exact proposal before execution. Approve in Chat or the existing Approvals queue. **Activity → Tasks** displays the result; **Action history** includes its task ID, project, requester, reason, source, approval and outcome. Ask **“What task did you just create?”** in the same conversation to read the committed task record. This response is visibly labeled `internal · Internal task records`; it is not an LLM claim or a recalled proposal.

The existing `POST /api/actions/request` accepts:

```json
{
  "tool": "create_task",
  "input": {
    "title": "Finish the tracking fix",
    "description": "Verify tracking recovery",
    "project_id": "<owned project UUID>",
    "status": "pending",
    "priority": 2,
    "due_date": "2026-09-08"
  },
  "reason": "User requested a tracking fix",
  "conversation_id": "<owned conversation UUID, or omit>",
  "source_message_id": "<user message UUID from that conversation, or omit>",
  "related_entity_ids": [],
  "related_memory_ids": [],
  "request_key": "<stable unique key for this exact action>"
}
```

Priorities are 0 low, 1 normal, 2 high, 3 urgent. Status uses the existing pending/in_progress/completed/cancelled values. A project, product or company is required. Dates are optional calendar dates (`YYYY-MM-DD`); Chat also handles today/tomorrow in the browser's IANA time zone. `due_at` stores the date at 23:59:59 UTC as a date carrier; the UI displays the date, not a scheduled local reminder. Natural-language times and recurring tasks are not implemented.

No new migration is needed. Task ownership and timestamps use existing columns. Workspace, action ID, requester, source conversation/message, related entity/memory IDs and reason live in `tasks.metadata`. The handler stages an insert and ownership/version checks; the existing `Repository.batch` / Supabase `apply_memory_batch` commits it with the action's successful result and outcome. A late error rolls back all three. The earlier action attempt remains auditable and is marked failed when storage is available. Optional episodic memory remains an explicit review action after success, outside the task transaction.

Existing migration **010** is required for durable execution keys (already applied to the development Supabase project). Replaying the same successful key returns the original task; it does not insert another task. After a recorded failure, inspect Action history and submit a **new key with fresh approval**. An unresolved in-flight key stays blocked for investigation; no automatic lease takeover or blind retry is introduced. A network error after commit can be recovered by retrying the original key. New keys represent distinct requests, even if their titles match.

Normal provider reasoning, retrieval, extraction, reflection, graph and other screens keep their existing flows. Task commands use an intentionally small grammar; wider language coverage is future work. Extraction failures do not undo a committed task, and pending requests are never confirmed as created tasks. See [CREATE_TASK_TEST_REPORT.md](CREATE_TASK_TEST_REPORT.md) for the audit, exact file list, rollback tests and live Supabase evidence.

### Task action experience

Task creation uses scoped dark glass panels, soft gradient light fields, and a small breathing status light. Chat and Approvals show request-driven permission/approval/execution/success states; failures and rejections never display successful completion. A saved-task receipt visually joins the action to the actual task ID, project and execution ID. Existing real task rows enter with a brief fade/translation when mounted in Activity.

`TaskProgress` and `TaskReceipt` are reusable UI components in `src/components/task-experience.tsx`; all styling is scoped to `task-experience.module.css`. Continuous motion exists only during an active request. The `prefers-reduced-motion: reduce` rule disables all new animation, hover translation and transitions. No animation libraries, WebGPU changes, API changes or new database writes were introduced for the visual layer. See [TASK_EXPERIENCE_TEST_REPORT.md](TASK_EXPERIENCE_TEST_REPORT.md) for the audit and verification boundaries.

## Real internal task updates

Use **Activity → Tasks → Edit task** to change status, priority, title, description, due date, project, or linked entities. Review changes side by side, then request the update. The existing approval dialog or Approvals queue controls execution. Level 4 requires approval; levels 0–3 cannot update tasks; level 5 permits internal execution under the configured scope. `mock.update_task` remains a simulation.

`update_task` is registered in the existing ToolRegistry and uses `POST /api/actions/request`. Its input is `{ task_id, expected_updated_at, before, changes }`:

- `expected_updated_at` is the exact task timestamp returned by the repository; do not round it.
- `before` is the full editable snapshot (`title`, `description`, `status`, `priority`, `due_at`, `entity_id`, sorted `related_entity_ids`). `taskSnapshot(task)` constructs it.
- `changes` contains only requested fields: `title`, `description`, `status`, `priority`, `due_date`, `project_id`, `related_entity_ids`. Null clears the due date or project. Empty description and entity arrays are allowed; an empty title or empty patch is rejected.
- Pass a stable `request_key` in the action envelope. Optional conversation/message and related-memory evidence use the existing envelope fields. The Activity editor identifies the authenticated owner and does not invent a source conversation.

All four existing statuses can transition to each other, including reopening completed/cancelled tasks; every requested change still passes permission and approval checks. Priority remains 0 low, 1 normal, 2 high, 3 urgent. Dates retain the existing UTC end-of-calendar-date representation. The primary project is included in related entities. Reassignment removes the prior primary project from the default related list unless it is explicitly retained.

Execution compares the review snapshot with the current task, then stages a version-checked update. The task change, success action (including before/after evidence) and outcome commit together through the existing batch RPC. Stale approvals, concurrent edits or transaction failures cannot overwrite newer state. Successful same-key retries return their original result without reapplying changes, even if the task has subsequently changed. Recorded failures require a refreshed task, a new key and fresh approval. Existing handling of uncertain in-flight actions is preserved.

Permissions include both previous and proposed project/entity scopes and their current connected project neighbors. Task creation provenance stays intact; metadata adds `last_update_action_id`, `last_update_source_message_id`, `last_update_conversation_id`, and `last_update_user_id`. Update history lives in existing immutable action input/results; no task-version table or schema migration was added. Reviewed action memories describe an update as an update, never as a new creation.

The Activity card refreshes saved values without a page reload. Modified fields receive a brief highlight, and completed tasks transition to a subtle resolved border. All new motion respects reduced motion. Action History and approval dialogs show before/after values. No natural-language Chat update parser was added in this milestone; use Activity or the existing action request API. See [UPDATE_TASK_TEST_REPORT.md](UPDATE_TASK_TEST_REPORT.md) for the audit, exact changes, test matrix and live-preview verification.

### Real internal project updates

`update_project_status` now updates existing `entities` rows whose type is
`project`. Projects retain their canonical IDs; there is no projects table or
second project store. The harmless `mock.update_project_status` remains available.

Open **Entities → project card → Edit project → Review project changes**. The
existing approval dialog shows before/after values. After approval, the card
refreshes in place; Action history retains the exact request, result, source,
permission decision, and outcome. Project connections open the existing Brain
Graph with that entity focused.

Supported patch fields:

- `status`: active, blocked, paused, completed, cancelled, archived.
- `priority`: 0 low, 1 normal, 2 high, 3 urgent; null clears it.
- `health`: on_track, at_risk, off_track, unknown. Health is explicitly reviewed,
  never inferred from task completion.
- `notes`: up to 10,000 characters; an empty string clears project notes.
- `blocker_entity_ids`: up to 50 owned entities. Canonical `blocks` relationships
  point from blocker to project. Removal ends validity; reopening preserves the
  same relationship ID and the existing `relationship_versions` history.
  Scheduled blockers cannot silently be brought forward.
- `goal_ids`: up to 50 existing goals, directly associated through `goals.entity_id`.
  Unlinking clears that association; goals assigned to another entity cannot be
  moved by this tool. Goals reached through linked tasks remain read-only here.

State fields use `entities.metadata.status`, `.priority`, `.health`, and
`.project_notes`; unrelated metadata and entity descriptions remain intact.
Task rollups are calculated from existing `tasks.entity_id` records: total,
pending, in progress, completed, and cancelled. Empty projects show no linked
tasks; they do not acquire fabricated completion or health values.

Use the existing `POST /api/actions/request` API with `tool:
"update_project_status"`, a unique `request_key`, a reason, and an `input` containing
`project_id`, `expected_updated_at`, `before`, and `changes`.
`projectSnapshot()` in `src/domain/project-actions.ts` builds the review snapshot
from the existing entity, relationships, and goals; `projectUpdateInput` is the
strict input contract. Optional conversation, source message, related entities,
and related memories use the existing request envelope.

The tool defaults to permission level 4. It stages entity/relationship/goal
changes through `ActionService`, which commits them with the successful action
and outcome in one repository transaction. Current-version guards reject stale
reviews. A failed execution needs a fresh key and approval; a successful key
replays the saved result without reapplying the update. A lost acknowledgement
can therefore be recovered safely. Reviewed episodic memory remains opt-in.

No migration or provider change is needed beyond the existing migrations through 010. Project changes use existing batch RPC/RLS protections. Rollups in an action
result are observations at `rollup_observed_at`; the UI recalculates current totals
on refresh. Recorded blocker links may include resolved source entities; the Brain
Graph separately filters active blockers using its existing rules.

The project card adds state-tinted light, save highlights, and a reveal for links.
Only an in-flight request animates its light field. Reduced-motion preferences
turn off the new motion. Existing Graph selection, connected-path animation,
panning and vgpu fallback remain responsible for graph effects.

See [UPDATE_PROJECT_TEST_REPORT.md](UPDATE_PROJECT_TEST_REPORT.md) for audit,
exact file changes, verification, and remaining limits.

### Ary Voice presence (v1 extension)

Voice reuses the existing `SpeechToTextProvider`, `TextToSpeechProvider`,
`VoiceService`, speech endpoints, streaming Brain flow and memory extraction.
Provider configuration and model choices are unchanged. In Chat:

1. Press Microphone. The orb responds to local microphone energy while recording.
2. Finish recording; Ary transcribes it into the existing editable message box.
3. Review the transcript and Send. It uses the current conversation and the same
   retrieval, action permissions and memory pipeline as typed input.
4. Text streams immediately as received. Complete sentences are synthesized in
   order, with one segment prefetched ahead of playback. Sentences arriving while
   audio is playing now begin prefetching without waiting for playback to end.
5. Stop speaking stops speech only. Interrupt Ary also cancels capture and asks
   the existing Brain flow to cancel its response. Starting a new recording also
   interrupts. A message already saved remains eligible for memory extraction.

The presence shows ready, permission request, listening, transcription, transcript
review, thinking, buffering, speaking, memory-save, interrupted, and error states.
Listening size responds to locally measured RMS amplitude; speaking motion is a
state indicator, not an audio waveform. The microphone meter does not store audio
or route it to speakers. Sampling is limited to 20 Hz; visual updates use a CSS
variable rather than React renders of Chat. Tracks, animation frames, audio
contexts, requests and queued speech are released on cancellation/unmount.

Native CSS and Web Audio are sufficient; no Rive, new dependency, wake word,
background microphone listener, schema, or provider integration was added.
Reduced-motion preferences disable orb animation and amplitude scaling. If Web
Audio metering is unavailable, recording/transcription still work with state text.

STT still begins after recording ends and Send confirms the transcript. TTS still
buffers short audio segments. This is not full-duplex realtime voice. Browser
microphone/autoplay permissions and server speech-model access must be available.
See the September 7 extension in `VOICE_TEST_REPORT.md` for current verification
and the outstanding OpenAI project-model restriction.

### Spatial operating system shell

The home page now opens an orbital spatial shell around the existing Dashboard.
It uses native CSS 3D, one shared spring animation loop, and optional local hand
tracking. Open a module to enter its existing Ary workspace; **Return to orbit**
returns to navigation. Existing screens retain their theme, data, forms, graph
renderer and action protections. **View controls → Classic workspace** opens the
original interface. No database migration, API change or second data store exists.

| Module         | Existing destination                                                    |
| -------------- | ----------------------------------------------------------------------- |
| Home           | Chat and current conversations                                          |
| Brain          | Brain Graph, entities and memories                                      |
| Projects       | Entity directory and project state cards                                |
| Tasks          | Activity's existing task view                                           |
| Activity       | Action History                                                          |
| System         | Settings; existing Approvals remains accessible in workspace navigation |
| Finance        | Source-backed account visibility; existing ROI remains separate         |
| Calendar       | Google Calendar v1 timeline and approved personal-event changes         |
| Communications | Unavailable; no messaging integration                                   |
| Agents         | Existing advisory board                                                 |

Counts come from Dashboard's existing authenticated response. Tasks count open
tasks; actions mean the returned **recent** actions, not a lifetime total. A
project warning reflects its recorded blocked status. No fabricated sample counts
are substituted when disconnected.

Mouse/keyboard: click a card or shortcut to focus, drag to inspect and release to
return its slot, arrows to orbit, Open/double-click to enter, Escape to interrupt
or return. Keyboard input inside editable controls/dialogs is left to that view.
Focus alignment, card depth, approach and lighting share a master spring loop;
a revision prevents an interrupted sequence from reopening a workspace. Idle
motion settles exactly and the animation loop stops.

**View controls** includes 2D mode, reduced motion, effect quality, HUD visibility,
tracking status and classic fallback. OS reduced-motion preferences take priority.
The CSS compositor owns text resolution; this shell adds no canvas framebuffer or
separate DPR slider. The existing Brain Graph/vgpu layer retains its own DPR and
pixel-budget controls. Quality tiers limit haze and particles (18/8/0) and tracking
rate (24/20/12 maximum requested frames per second). The actual tracking rate is
lower when inference takes time. FPS/p95 describe the last measured animation,
not a continuous GPU benchmark. HUD hides on narrow screens; diagnostics remain
in View controls.

Optional hand tracking setup:

```sh
npm ci
npm run spatial:assets
npm run dev
```

Tracking is off until **Enable hand tracking** is pressed and browser camera
permission is granted. Model and WASM assets are served locally. The MediaPipe
package is lazy loaded in a worker; camera frames never enter Ary's API, memory,
conversation or provider pipelines. Disable tracking, switch to Classic, hide the
browser tab, or unmount to stop tracks and terminate the worker. Tracking startup,
inference failure and permission denial retain mouse/keyboard access.

Swipe rotates; a held pinch selects/grabs a module under the fingertip cursor (a miss does nothing); release
returns the card; pull expands; push returns; steady palm marks ambient motion
held. Ambient motion already settles rather than continuously drifting. Pull/push
use apparent palm size as a depth heuristic, not measured physical distance.
Confidence is heuristic. Circle activation is reserved. Gestures dispatch only
spatial events; inside an expanded view only push-to-return is accepted. They
cannot approve or execute an action.

Hand tracking now uses GPU inference with CPU fallback on initialization/inference errors and a bounded worker restart if the GPU stalls. Cursor motion is smoothed and mapped from the central camera area to the full screen. Pinch entry holds for 100 ms, release for 65 ms, and pull/push for 120 ms to suppress single-frame noise. Tracking loss immediately clears the cursor and releases drag. Sampling accounts for inference time, skips repeated video frames, keeps only one frame in flight, and changes rate without reopening the camera. Frozen camera/bitmap/worker paths have cleanup deadlines. A visible guide identifies the targeted module and offers Stop camera.

The installed Electron shell now permits audio/video capture only from Ary's own window and exact local origin, and asks macOS for the requested device. It previously rejected video and always requested microphone permission. Desktop shell changes load on app relaunch; the installed app was relaunched. Newly packaged launchers include an explicit on-device camera usage description; the currently installed launcher already contains a camera usage description. If macOS denies access, allow Ary Nexus under System Settings → Privacy & Security → Camera and retry. No camera frames are uploaded.

`npm run test:desktop-tracking` verifies the real detector and permission routing inside isolated Electron with a synthetic camera and no saved session. It does not test the real macOS privacy prompt. See [HAND_TRACKING_TEST_REPORT.md](HAND_TRACKING_TEST_REPORT.md) for results and the remaining hands-on check.

For reproducible browser verification, run `npm run test:spatial` with a server
running. It launches an isolated browser with a **synthetic** camera, verifies
actual model startup/inference and resource cleanup, and makes no business writes.
`SPATIAL_TEST_URL` can target a separate production server. Physical-hand accuracy
and lower-end devices still need manual validation. See
[SPATIAL_SHELL_TEST_REPORT.md](SPATIAL_SHELL_TEST_REPORT.md) for the audit, exact
file inventory, measured results, limitations and manual test plan.

### Ary Priority Intelligence

Open **Priority** in the existing workspace navigation, or **Open Priority
Intelligence** on the spatial shell. This is a read model over existing goals,
tasks, project entities, temporal dependency relationships and ROI evidence.
Canonical records, IDs, action protections and schemas are unchanged.

The authenticated `GET /api/priorities` endpoint requires the existing
`activity.read`, `entity.read` and `roi.read` permissions. It fails closed if any
required source is denied/unavailable. Reads use the current repository's user
scope; ordinary permission/audit behavior remains active. No LLM call is made.

Policy `priority-v1` uses the following transparent, additive weights:

| Factor                | Maximum points | Evidence / normalization                                                                                                              |
| --------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline              |             20 | Recorded due/target date: overdue 1, within 1 day .95, 7 days .8, 30 days .4, later .1. UTC evaluation.                               |
| Urgency               |             15 | Explicit task priority or goal/project `metadata.priority`, divided by 3.                                                             |
| Strategic importance  |             15 | Evidence-backed assessment between 0 and 1.                                                                                           |
| Active goal alignment |             15 | Task's explicit `goal_id`, an active goal itself, or project-linked active goals (saturates at three).                                |
| Dependency leverage   |             10 | Unique documented dependents within two hops; saturates at three.                                                                     |
| Blocker attention     |              5 | Documented prerequisites within two hops; saturates at two. Attention does not imply readiness.                                       |
| Expected revenue      |             10 | Explicit USD forecast with evidence and confidence: `min(1, log10(1 + USD) / 5) × confidence`. Historical ROI never fills this field. |
| Effort                |              5 | Supported hours estimate: `1 / (1 + hours / 8)`.                                                                                      |
| Confidence            |              5 | Recorded assessment confidence between 0 and 1.                                                                                       |

Unknown assessments earn no benefit, rather than an invented estimate. Evidence
coverage is displayed separately from confidence. A score is a policy preference,
not a probability, dollar value, or authorization. Exact ties use deadline then
stable canonical ID. Projects/goals/tasks are scored individually; do not add their
scores or revenue contexts together, because work may overlap.

Task dependencies use explicit `metadata.depends_on_task_ids` referencing current
canonical task IDs. Project/entity dependencies use current `blocks` (prerequisite
→ consumer) and `depends_on` (consumer → prerequisite) relationships. Expired and
future edges are excluded. Completed prerequisites stop constraining work;
cancelled/paused prerequisites are not treated as successful completion. Completed,
cancelled, archived, abandoned and paused work are excluded from the active list.
Missing dependencies and cycles found within the two-hop neighborhood are flagged.
Paths are limited to 50 reachable records per direction. No dependencies are
inferred from similar names or shared project membership. A project's blocker is
shown as task context but does not automatically become that task's prerequisite.

Existing metadata can contain explicit assessments using this convention:

```json
{
  "priority_intelligence": {
    "strategic_importance": {
      "value": 0.8,
      "evidence": "Reference to an actual reviewed strategy decision"
    },
    "effort_hours": {
      "value": 8,
      "evidence": "Reference to an actual owner estimate"
    },
    "confidence": {
      "value": 0.7,
      "evidence": "Reference explaining assessment uncertainty"
    },
    "expected_revenue_usd": {
      "value": 1000,
      "evidence": "Reference to an actual forecast and its assumptions"
    }
  }
}
```

This is documentation of the format, **not seed data or a claim about your
business**. Values without nonempty evidence are ignored. Forecasts also require
recorded confidence. This milestone adds no assessment editor or metadata write
endpoint; it reads what is already recorded. Historical ROI is shown only through
explicit active-goal/outcome links, with attribution status/confidence and source
IDs, and contributes zero forecast points. Superseded/rejected attribution and
pending outcomes are excluded from that context.

Expand any score factor to inspect its source IDs, fields, timestamps, explanation
and what would change its contribution. The upper-bound point gain is conditional;
actual rank also depends on other work. Dependency paths link back to source
relationships, and the Brain Graph shortcut reuses the current graph view.

**What-if planning** changes deadline/strategy emphasis and previews deadline bands
up to 30 days ahead. It is explicitly labeled, normalized to 100 points, and never
saved. Future preview does not predict completed tasks or future relationships.
Priority/deadline order and refresh update in place with interruptible rank motion,
soft emphasis and reduced-motion support. Evidence refreshes on entry, browser
focus/tab return or the Refresh button; this is not a realtime subscription.

Run `npm run test:priority` against a running app for an isolated browser test with
temporary, clearly labeled fixtures generated by `PriorityService`. It checks
reordering, animation, reduced motion and no business writes. `PRIORITY_TEST_URL`
can point at a separate production server. See
[PRIORITY_TEST_REPORT.md](PRIORITY_TEST_REPORT.md) for the audit, exact changes,
validation results and limitations.

## Daily Board Meeting v1

Open **Board** in the existing workspace, or open **Agents** from the spatial shell. Optionally enter a focus and select **Start daily meeting**. The board is advisory: it does not execute tools, create tasks, send messages, or change confirmed memory. Meetings are manually started; no daily scheduler is installed.

Four specialist perspectives—Sales Ary, CMO Ary, Research Ary, and Developer Ary—review one shared snapshot. Two specialist calls run at a time. Analyst Ary ranks every accepted finding and explains its tradeoffs using existing Priority Intelligence scores. CEO Ary deduplicates these findings into at most five actionable proposals, preserving Analyst order. These are role-scoped calls to the existing provider, not independent agents with their own memories or tools.

The snapshot uses canonical tasks/projects/goals from `PriorityService`, up to two additional active goals, existing hybrid memory retrieval, and current relationships around the selected work. It includes at most six leading work items, four memories, six relationships, and twelve context entities. The model receives bounded excerpts and provenance through the current provider payload; it does not receive the entire database. Evidence keys link back to canonical record IDs. Missing data or revenue impact stays unknown; absence from this bounded snapshot is not proof of absence elsewhere in the workspace.

Each role must return a validated JSON shape with a short summary, at most two evidence-linked findings, confidence, and proposed next steps. Unknown evidence IDs, malformed output, invented ranking IDs, or invalid CEO references fail that role. Failed roles remain visible, the meeting is marked partial, and no substitute findings are fabricated. A failed Analyst stage prevents CEO consolidation. The configured development stub remains available in Chat; the board fails explicitly if a provider lacks `reasonWithUsage`. No provider credentials, models, or integrations were changed.

Persistence reuses existing `conversations` and `messages`: one meeting, one central conversation, one assistant brief containing structured `metadata.board_report`. Reports are marked `source_type: advisory_proposal` and `confirmed_fact: false`; they do not trigger memory extraction. Existing memory facts, versions and supersession rules remain authoritative. The conversation/message, successful action result and outcome commit in the existing repository transaction. Existing action-key infrastructure prevents duplicate meeting execution for the same key. A failed attempt is recorded; inspect it and use a new key to retry. Model-call telemetry uses the existing action context and captures model, tokens, latency and estimated cost when available, including calls whose output later fails validation.

Permissions reuse `ActionService`: `board.meet` is a low-risk **recommend** capability, default level 2. Existing `memory.read`, `entity.read`, `activity.read`, `roi.read` and `conversation.read` gates must also pass before evidence is read or a model is called. Meeting history uses `conversation.read`. Roles receive no execution capabilities. The existing approval and action systems are unchanged.

API:

- `POST /api/board/meetings` accepts `{ "request_key": "UUID", "focus": "optional, up to 300 characters" }`; streams NDJSON `stage`, `role`, `complete` or `error` events. A successful HTTP stream alone does not indicate a completed meeting—wait for `complete`.
- `GET /api/board/meetings` returns the latest twenty saved shared reports for the authenticated user.

The Board screen displays actual stage transitions, role status/model/latency, incoming findings, Analyst ordering, evidence, project/graph links, the consolidated brief, and prior meetings. Native CSS transitions keep motion restrained and honor reduced motion. Stop cancels generation; once the atomic commit has begun, check history for a completed brief before starting again. No GSAP or orchestration dependency was necessary.

Validation: `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:board` (isolated browser fixtures against the running local app; set `BOARD_TEST_URL` for another local server). See `BOARD_MEETING_TEST_REPORT.md` for the audit, exact file inventory, live-provider result, and manual checks. No database migration is required. Existing repository list methods still gather evidence server-side before bounding the provider context; large-workspace query optimization and durable scheduled/background meetings remain future work.

## Gmail v1 — deliberate communications

Open **Communications** from the Nexus orbit or workspace sidebar. Search for a relevant conversation, read its context and canonical project/entity links, ask Ary for a summary, and prepare an editable draft. Sending requires a separate review of the exact sending account, recipients, subject and text. The screen moves through **Read → Understand → Draft → Approval → Sent**, with restrained entrance/state transitions and reduced-motion support. “Gmail accepted” is a provider receipt, not a guarantee of delivery.

This extends the existing tool registry, permissions, approvals, action/outcome receipts, entity resolver and MemoryService. It does not create another inbox database, memory system, task system, or model provider. Existing Calendar OAuth and encrypted-vault adapters accept optional Gmail configuration; Calendar retains its original interfaces/default behavior. No database migration or new dependency is required.

### Connect the account

1. Enable **Gmail API** in a Google Cloud project. Configure the consent audience and test users, then create a **Web application** OAuth client. Follow Google's [server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server). Gmail read access is a restricted scope; production use may require Google's verification/security assessment depending on the app and data handling. See the official [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes).
2. Register `http://127.0.0.1:3000/api/gmail/oauth/callback` for the installed local app, or the fixed HTTPS equivalent for a deployed server. Set server-only `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` and `GOOGLE_GMAIL_REDIRECT_URI` in the private environment. Empty examples are in `.env.example`. Never put secrets in `NEXT_PUBLIC` variables, source code or chat.
3. Reuse the existing `ARY_INTEGRATION_ENCRYPTION_KEY` and persistent `ARY_CALENDAR_VAULT_DIR`. Do **not** rotate an existing key: that would make existing integration credentials unreadable. Gmail uses a separate `gmail:` namespace in this server-only AES-256-GCM vault. Its browser cookie, launch tickets, callback state, connection IDs and credential records are separate from Calendar.
4. Sign in to Ary and select **Connect read-only → Continue securely in Google**. Complete consent in the system browser, return to Ary, and select **Refresh connection**. Read-only consent asks for `openid`, `email` and `gmail.readonly`. Ary demo mode cannot connect a real account.
5. When ready to review sends, select **Enable approved sending** and complete the separate consent flow. This requests `gmail.readonly` plus `gmail.send`; read access is also needed to recover uncertain sends from Sent. Google consent never replaces Ary approval. Disconnect removes local credentials even if Google revocation fails, and reports that failure.

The OAuth flow uses the existing PKCE/browser-bound, expiring, one-use handoff. Tokens never enter model context, action inputs, frontend storage or normal database records. A reconnect rotates the connection ID and invalidates previous proposals. The sender shown in the approval must match both the recorded draft and the account verified at execution.

### Capabilities and API boundary

| Tool              | Minimum permission      | Behavior                                                                                                              |
| ----------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `gmail.search`    | 1 observe               | Search an explicit query; return up to 12 thread references/snippets.                                                 |
| `gmail.read`      | 1 observe               | Fetch a selected conversation, resolve existing canonical names/aliases, return entity links.                         |
| `gmail.summarize` | 2 recommend             | Recheck read permission; summarize selected context and propose important evidence candidates. No memory write.       |
| `gmail.draft`     | 3 draft                 | Recheck read permission; return an unsent local subject/body with source and entity linkage. No Google draft or send. |
| `gmail.send`      | 4 execute with approval | Send the exact reviewed plain-text message through the existing approval and action pipeline.                         |
| `gmail.evidence`  | 4 execute with approval | Save one reviewed exact quote as attributed episodic evidence through existing memory permissions/services.           |

Both send and evidence have the existing `alwaysRequiresApproval` capability ceiling: even a level-5 policy cannot skip approval. Levels 0–3 cannot send. Workspace/tool/action/user/product restrictions remain in force; canonical entity scope is recovered server-side from the source draft/analysis so callers cannot omit it to evade project policies. Edits require a new exact-request approval. Existing Approvals and Action History display the source inputs, decision and resulting receipt; general action history cannot copy entire Gmail actions into memory.

All six tools use `POST /api/actions/request` with the existing request envelope. `gmail.send` requires `connection_id`, `operation_id`, `draft_action_id`, `from_account`, explicit `to`/optional `cc`, `subject`, `body` and `source_thread_id`; it must reference a completed draft owned by the current Ary user. Send/evidence also require a request idempotency key. No direct send endpoint bypasses the pipeline. `GET /api/gmail/status` returns connection metadata; `POST /api/gmail/connect` and `/disconnect` use the existing audited owner control plane. Public `/api/gmail/oauth/launch` and `/callback` require the one-use OAuth handoff, not a freely supplied user ID.

### Evidence and intelligence

Only a selected, bounded conversation goes to the existing configured language model. Reads retain at most the last 12 messages, 12,000 text characters per message and 40,000 text characters total; the network response is capped at 2 MiB. Only supported plain-text parts are read. HTML is never rendered, remote images are not loaded and attachments are not fetched. Incomplete context is visibly marked. Gmail search pagination is exposed by the provider; v1 UI asks the user to narrow searches beyond the first 12 matches.

The model is instructed to treat email as untrusted third-party data. Structured output is validated; it cannot call tools or set recipients. Candidates are limited to five decisions/facts/explicit task commitments, importance at least 0.7, confidence at least 0.65, and a verbatim quote from a non-truncated source message. Unsupported or invented quotes are discarded. Confidence and importance are model estimates, not independent verification.

Reading, summarizing and drafting never create permanent memories. Each evidence candidate requires individual approval and a fresh read-permission check. Capture uses `MemoryService.createMemory` with `memory_type: episodic`, the existing source/version infrastructure, source account/message/thread ID, sender header, date, exact quote, analysis action ID and reviewer. Content explicitly labels the statement as reported email evidence, not confirmed truth. It cannot silently supersede existing facts or create real tasks. Canonical entity links use the existing `memory.link` gate. Repeated capture of the same account/message/quote returns the original memory; a failed entity link can be repaired on an approved retry without duplicating the memory.

Full bounded read/analysis results are retained in **action audit receipts**, distinct from semantic long-term memory. Do not treat the audit store as ephemeral or assume Gmail disconnect deletes these records. A deployment retention policy for potentially sensitive email audit content is still an operational decision. Sender headers and quoted claims are attributed, not independently authenticated as true.

### Send recovery and intentional limits

The Google adapter uses [`users.messages.send`](https://developers.google.com/workspace/gmail/api/guides/sending) with base64url MIME, explicit recipients and no attachments/Bcc. V1 sends a **new plain-text email**; source conversation linkage is in Nexus, not a promise of Gmail threaded reply behavior. Drafts persist as Ary action results and are not synced to Google's Drafts folder. There is no background inbox ingestion, mail deletion/labeling, reply-all, automatic sending, new agent or external financial tool.

Gmail and PostgreSQL cannot share a transaction. Before dispatch, an encrypted operation record stores the exact-content fingerprint and a deterministic RFC Message-ID. A confirmed receipt is replayed without another POST. If a send is uncertain, retry checks Gmail Sent for that Message-ID and recovers only a unique match; it **never blindly resends**. A missing or ambiguous match leaves the action uncertain and requires operator review in Gmail. Search indexing delays or provider normalization may prevent automatic recovery. Changing recipients/text cannot reuse that operation ID. A local action/outcome commit failure after Gmail acceptance can recover from the provider receipt through a freshly approved retry with the same operation ID.

The file vault is suitable for one persistent host only. Use an encrypted managed adapter before multi-host/serverless deployment. Crash-left lock files fail closed; stop the owning server and confirm no operation is in flight before manual recovery. Never erase an uncertain send guard to “fix” a retry.

### Verification

`npm test`, `npm run typecheck`, `npm run build`, and `npm run test:gmail` verify the implementation. The browser command intercepts every Ary API request with fixtures and cannot send email. See [GMAIL_TEST_REPORT.md](GMAIL_TEST_REPORT.md) for exact files, regression results, limitations and the live manual test sequence. OAuth client credentials and real Google consent must be configured before live account verification; passing fixture tests does not claim a real message was sent.

## Ary Finance v1 — source-backed visibility

Open **Finance** in the existing sidebar or spatial orbit. **ROI / Ary Economics** remains separate and unchanged. Finance displays recorded accounts, balances, debt, net worth, investment balances/holdings, current-month recorded income/spending, source-declared recurring bills, and account history. It starts empty: no invented accounts, prices, bills or financial impact. There is no bank connection, money movement, trading, brokerage execution or Kronos integration.

### Storage and setup

Apply `supabase/migrations/202609070012_finance.sql` once after the existing migrations. It adds only `finance_snapshots`: an append-only, owner-scoped statement ledger with source references, balance date (`as_of`), source observation time (`observed_at`), import timestamps, stable account keys and explicit correction parents. It does not change existing memory, entity, goal, task, action, outcome or ROI tables, or the existing batch RPC. The migration was applied successfully to the current ARY NEXUS Supabase project on September 7, 2026. Other environments still need it. The local repository supports the same ledger invariants.

The database enforces owner RLS, insert/select only, immutable versions, stable account currency/type, linear correction ancestry, key uniqueness and ownership of linked entities/goals. The API and report parser strictly validate the normalized financial payload; malformed source data fails closed. Do not apply the migration a second time to a database that already has the table; use the migration history for deployments.

### Bringing in real sources

1. Select **Import statement**. Record a balance with an identifiable source and date, or download the blank JSON template and supply a normalized statement containing transactions, bills and holdings.
2. Use the same `account_key` for every statement belonging to that account. Use a new `import_key` for each distinct statement, and preserve it when retrying the same import.
3. Review the exact source, account, amounts and payload, then request import. Approve or reject it in the existing approval dialog/queue. After success, **Refresh evidence** loads the resulting ledger without a page reload.
4. To correct a statement, import a new JSON record with `parent_id` referencing the current version for the **same account and balance date**, with a later or equal observation time. Historical versions remain visible. A later balance date is a new snapshot, not a correction.

`FinanceImportProvider` is the adapter boundary; `StatementFinanceProvider` accepts normalized JSON only. The manual form records a balance, not a fabricated transaction history. JSON supports linked canonical entities/projects and goals, including transaction-level links. No CSV/PDF/OCR parsing, bank authentication or automatic financial ingestion is present. Source references are stored as attribution; Ary does not fetch them or claim to have independently verified a statement. The original binary source document is not uploaded by this flow.

Amounts use integer minor currency units: USD 12.34 is `1234`; JPY 123 is `123`. Supported currencies are USD, EUR, GBP, CAD, AUD, CHF and JPY, with no FX conversion or mixed-currency total. Debt is a positive amount owed. An unknown balance/value is `null`, never an assumed zero. Quantities are decimal strings; short positions and derivative valuation are outside v1. Imported holdings use only source-supplied values, never live quotes.

A payload represents one account snapshot. Limits are 200 transactions, 50 bills, 100 holdings, 20 direct entity links and 20 goal links, within the 60 KB UI file limit and existing API request limit. The overview supports at most 1,000 accounts; larger histories require further pagination/indexed query work before a production ingestion feed. There are no new runtime packages or provider credentials.

### Transparent calculations and change explanations

Reports select the latest source version available at the requested cutoff using both balance and observation time. Imported-at time is also shown, separately. The cutoff is a source-knowledge view, not a claim that Ary had already imported the source at that time. Reports cannot forecast future balances.

Net worth is recorded assets minus recorded debt within one currency. It remains unknown if any recorded account lacks a balance. Known assets/debt and portfolio amounts are partial recorded subtotals when balances are missing. Investment account balances already include their holdings; holdings are **not added again**. No completeness claim is made about unrecorded accounts or liabilities.

Income and spending use posted transactions in the selected latest statement and the reporting month in **UTC**. Spending is explicit expenses minus refunds; transfers, adjustments and unclassified records do not become income or spending. Pending records are excluded. Coverage is incomplete unless the source explicitly covers the whole requested month-to-date interval. A known subtotal is not a complete monthly total. Historical overlapping statement windows are not accumulated; nonoverlapping imports are not automatically stitched into a full transaction ledger. A corrected/latest snapshot must include the source records needed for its intended coverage.

Recurring bills are explicit source records, not guesses from repeated payments. Source-valued holdings and coverage are visible alongside the account statement. No returns, forecasts, tax advice, credit judgments, affordability claims or business impact are inferred.

**Why did this change?** compares the actual prior and current source values, displays both references/dates and distinguishes a source correction from a balance change. It does not invent transaction causes or market returns. The account timeline, contextual panel and canonical entity links navigate to the existing Brain Graph. Chat financial responses expose account buttons that focus the supporting Finance panel. A bare follow-up “Why did this change?” uses preceding financial conversation context; without it, name the financial account. Existing conversation history retains those responses, while source imports are not automatically copied into semantic long-term memory.

### Permissions, audit and recovery

- `finance.read` requires **observe** and uses the existing ToolRegistry/action pipeline. Reports and linked entity/goal reads are permission checked; scope is derived server-side from source linkage, including goal-to-project relationships.
- `finance.import` defaults to **execute_with_approval** and always requires approval, including under level 5. Levels 0–3 cannot import. The approval includes the exact financial source payload. Changing it requires a new approval.
- Attempts, decisions, errors, results and outcomes use the existing action infrastructure. Financial receipts may retain source payloads in audit history; they are not ephemeral. General “remember action” cannot copy Finance records into permanent semantic memory.
- Each statement is one atomic database insert. The separate action/outcome receipt commit uses the existing pipeline. If receipt persistence fails after insertion, an approved retry with the same import key recovers the existing snapshot. This is recoverable idempotency, not a distributed transaction; no duplicate account snapshot is silently inserted. Reusing an import key with different content is rejected.

Finance controls read/import into Nexus only. There is no executor for transferring funds, paying bills or placing trades. Existing Calendar, Gmail, permissions, approvals, memory and graph systems are preserved.

### Finance verification

Run `npm test`, `npm run typecheck`, `npm run build` and `npm run test:finance`. The Finance browser command intercepts Ary API requests with isolated fixtures; it never imports fictional finances into the real account. Tests cover source arithmetic, partial coverage, corrections, cutoff semantics, ownership, permissions, approvals, immutable SQL records, exact decimals, idempotency and failure recovery, plus responsive/reduced-motion UI and evidence navigation.

See [FINANCE_TEST_REPORT.md](FINANCE_TEST_REPORT.md) for exact files, test counts, live Supabase/desktop verification and remaining limits.

`npm run test:finance:e2e` additionally exercises the real browser → HTTP → approval → repository flow. It creates a disposable copy of the app with explicit demo storage and local/mock AI providers, starts a localhost server on an available port, and drives the actual import form. It verifies rejection, approved persistence, exact decimal amounts, replay without duplicates, a later statement, source comparison and persisted audits/outcomes. No API responses are mocked in this test. Credentials, environment files and production data are not copied. The temporary server, browser and test ledger are removed on completion. This complements the SQL migration tests; it does not claim a live bank import.

## Ary Desktop Bridge v1

Desktop Bridge extends the existing ToolRegistry → ActionRequestService → PermissionService / ActionService → audit / outcome flow. It does not expose a shell, add an IPC executor, or create another memory/action store. Settings now includes **Mac Desktop Bridge**; exact proposals use the existing approval dialog, editable approval queue, and Action History. Chat/voice intent parsing is unchanged in this milestone.

### Enablement and host identity

It is **disabled by default**. To opt in on the local Mac, set `ARY_DESKTOP_BRIDGE_ENABLED=true` and `ARY_DESKTOP_USER_ID` to the authenticated owner's Supabase UUID in the existing ignored server environment. Keep the existing `ARY_INTEGRATION_ENCRYPTION_KEY` (64 hex characters). Demo identities are refused. Never prefix these settings with `NEXT_PUBLIC_`.

Restart the installed Ary app with its **own** loopback development server. A separately started/reused server can continue serving normal Ary screens but cannot receive Desktop Bridge authority. Close a separately managed dev server using its normal controls before starting Ary; do not terminate unrelated processes. Electron main generates a private session token, passes it only to its child server, and injects it into same-origin API POSTs from its own webContents. Never set, print, persist, or copy `ARY_DESKTOP_SESSION_TOKEN` yourself. No privileged renderer preload or new TCP listener was added.

The server requires macOS, explicit enablement, the pinned authenticated owner, exact Origin `http://127.0.0.1:3000`, matching Host, and the launcher proof. Missing/null/foreign origins and remote forwarded addresses fail closed. The owning launcher binds its server to 127.0.0.1. Normal browser access, unsigned requests, a reused server, and demo mode do not acquire desktop capability. This is a local single-user trust boundary, not protection against arbitrary code already running as the same macOS user or compromise of Ary itself.

Launcher source changes take effect on relaunch. `desktop/build.mjs` now includes Apple Events and Reminders usage descriptions; a newly built app is required to receive updated packaged privacy descriptions. This milestone does not replace the installed bundle or change macOS privacy settings automatically.

### Fixed capabilities

All names use the `desktop.` prefix. `list_apps` has observe level 1; every other capability, including clipboard read, requires explicit approval even at level 5. More restrictive existing policies still apply.

| Tool                                 | Input / behavior                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_apps`                          | Fresh scan of /Applications, /System/Applications and the current user's Applications folder, including nested categories (bounded depth). Returns names, bundle IDs and installed paths. |
| `launch_app`                         | Exact scanned `app_id`; executable paths cannot be supplied by the caller. Duplicate IDs are ambiguous and rejected.                                                                      |
| `open_website`                       | HTTP(S) `url` only, no embedded credentials or file/javascript schemes. Opens in the default browser.                                                                                     |
| `media`                              | `player`: music or spotify; `command`: play, pause, next, previous. Selected player must already be running. No global HID/private-framework media control.                               |
| `volume`                             | Absolute system output `level` from 0 through 100.                                                                                                                                        |
| `clipboard_read` / `clipboard_write` | Plain text only, maximum 16,000 characters. Write accepts `text`; read requires approval before capture.                                                                                  |
| `hide_others`                        | Keep the selected running `app_id` visible and hide other foreground apps; requires macOS Accessibility/Automation.                                                                       |
| `quit_app`                           | Graceful quit of a scanned `app_id`; no forced termination. Protected Ary/system apps are refused. A save/cancel dialog may prevent completion.                                           |
| `lock_screen`                        | Dispatch the fixed macOS Control-Command-Q shortcut; receipt explicitly distinguishes dispatch from independent screen-state verification.                                                |
| `sleep_display`                      | Fixed `pmset displaysleepnow`; no machine sleep/shutdown/restart action.                                                                                                                  |
| `do_not_disturb`                     | Boolean `enabled`; only fixed Shortcuts names **Ary Focus On** and **Ary Focus Off**.                                                                                                     |
| `create_note`                        | `title`, `body`; creates in Notes' default account/folder, escapes HTML and returns the native record ID.                                                                                 |
| `create_reminder`                    | `title`, `notes`, optional offset-bearing ISO `due_at`; creates in Reminders' default list and returns the native ID.                                                                     |

Do Not Disturb requires you to create those two local shortcuts containing only **Set Focus → Do Not Disturb → On until turned off / Off**, respectively. Ary checks the exact shortcut is installed; it does not inspect or certify a shortcut's internal actions. Do not place other actions in those shortcuts. This explicit local prerequisite avoids undocumented Focus database changes or brittle Control Center scripting. Notes/Reminders use the native default account and may sync according to its existing settings; they are not Nexus memories.

All mutations require a UUID `operation_id`; every request also needs the existing `request_key`. The normal envelope is posted to `/api/actions/request`, e.g. `tool: "desktop.launch_app"`, `input: {app_id, operation_id}`, `reason`, and `request_key`. The Settings form generates IDs and preserves them through approval/retry. No new execution endpoint exists. App names/commands with shell syntax fail validation; note/clipboard content containing such syntax is literal data passed separately from fixed JXA source. Only `execFile` with absolute binaries and argument arrays is used by the native adapter. Timeouts, output sizes, text lengths and enum values are bounded.

### Recovery, evidence and privacy

Successful action/outcome records and request-key replay use the current infrastructure. OS changes cannot join a Postgres transaction. The existing encrypted vault primitive is reused under ignored `.data/desktop-vault` for a per-owner, per-operation lock and receipt. An operation is durably marked pending before dispatch, then complete when its native result is saved. A new approved request key with the **same operation ID and identical input** can recover a completed receipt after a database failure without repeating the OS effect. Changed input with that operation ID is rejected.

If a process times out, is cancelled, crashes, or cannot persist its receipt, the operation remains uncertain and cannot execute again under that ID. Inspect the native app and Action History first. An intentionally new action needs a new operation ID and fresh review; it is not automatic retry. Stale file locks after a host crash fail closed and need operator investigation, not deletion by a user-facing tool. Keep the encryption key and receipts across restarts. There is no force-retry/reset/delete capability.

Clipboard content and Notes/Reminders inputs/results are retained in the owner-scoped action audit and encrypted local operation receipts; they are not copied into semantic memory. The existing generic “remember action” path rejects Desktop Bridge records. Audit retention is not ephemeral clipboard access. Error messages suppress raw subprocess stderr and explain System Settings → Privacy & Security → Automation / Accessibility / Reminders as applicable. The operator must grant the requesting Ary/Node host access; the bridge cannot grant itself privacy permissions.

### Verification

Run `npm test`, `npm run typecheck`, `npm run format:check`, and `npm run build`. `node --import tsx scripts/evaluate-desktop-bridge.ts` performs a real read-only macOS scan through the registry/action/outcome path in an isolated LocalRepository, verifies known system apps and replay, and removes fixtures. It does not test live Supabase authentication or native writes. See [DESKTOP_BRIDGE_TEST_REPORT.md](DESKTOP_BRIDGE_TEST_REPORT.md) for exact evidence, the live disabled-state check, hardware acceptance steps, and remaining prerequisites.

## Universal Ary command palette

Press **⌘K** (Ctrl+K also works), or click **Search Ary** at the lower right. The palette is rendered into `document.body`, outside the hideable HUD and inactive workspace. Navigation reveals the existing workspace and focuses the chosen project/entity/task. Escape dismisses the palette and restores focus; arrows, Home/End and Enter navigate results; mouse selection uses the same dispatcher.

The index combines existing module definitions, loaded projects/entities/tasks and aliases, ToolRegistry catalog actions, installed apps from the existing Desktop Bridge, and valid `website`/`url` entity metadata. Paste an explicit HTTP(S) URL to open another website. No inferred website addresses or browser-history access. App discovery is an explicit **Refresh installed apps** action; it requires the already-enabled owner-bound Desktop Bridge and follows its existing security gates. Apps stay cached in memory until refresh/reload; they are rescanned by the bridge before execution.

Ranking is transparent: prefix → initials → word boundary → substring, with alphabetical ties and at most 30 visible results. Normalization includes case and diacritics. Search uses a memoized local index, with no network request per keystroke. When there is no lexical result, **Search Ary memory** opens the existing Memories search with the query, reusing its hybrid/semantic retrieval and permissions. Semantic guesses never execute a command.

**Speak a command** uses the existing STT hook. For example, “Open Graph” or “Show Wagtrails.” A unique exact canonical name or alias goes through the same dispatcher; ambiguous/partial transcriptions remain visible for selection. Keyboard, mouse and voice have no separate execution backend. This is explicit press-to-record voice, without wake words. Physical transcription accuracy remains covered by the separate Voice acceptance milestone.

Selecting a registry action opens the existing Approvals form with that tool selected and fresh inputs/context; it does not execute or invent required inputs. App and website selections submit to `/api/actions/request`; existing validation, permission levels, approval, audit, outcome and desktop execution safeguards remain authoritative. Successful native commands open Action History. Failed attempts retain their request/operation keys for safe retry. No permissions or Desktop Bridge flags are automatically enabled.

Validation: `npm test`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `npm run test:commands`. The browser evaluator uses a disposable credential-free demo server, creates one approved internal task, checks its actual persisted audit/outcome/approval links, then removes all fixtures. See [COMMAND_PALETTE_TEST_REPORT.md](COMMAND_PALETTE_TEST_REPORT.md).

## Ary Calls v1

Open **Calls** from the sidebar or ⌘K. Prepare a call using an existing person/company entity's `metadata.phone` (exact E.164 number), or enter an explicit number. Link an existing project/company, enter the message, and confirm your intent. Ary's fixed automated-assistant introduction is included in the exact script review. **Review and request call** opens the existing approval dialog; nothing dials until that request is approved. Changing a stored contact's number invalidates the old request. No name-based guessing, caller-ID override, voice cloning, live reasoning on the line or automatic calling from Chat/Board is added.

`PhoneProvider` (`src/domain/phone.ts`) defines `inspectNumber`, `initiate`, `getCall`, and `cancelCall`. `PhoneService` owns call policy, durable operation receipts and source-attributed summaries. The PhoneTool registration exposes `phone.initiate`, `phone.refresh`, and `phone.cancel` through the existing ToolRegistry. Initiation always requires approval, including permission level 5. Cancellation defaults to a separately scoped level-5 capability so an explicit stop request can proceed immediately, while existing restrictive policies still apply. Configuration/history use `phone.read`. The brain contains no telephony vendor dependency.

The first adapter is **Twilio**, using fixed REST endpoints and XML-escaped inline TwiML to speak the approved script once and hang up. Calls have a 20-second ringing timeout and 120-second maximum duration. Recording is off. This adapter does not capture recipient speech/transcripts; it is one-way script delivery. The shared interface can accept source-tagged transcripts from a future supporting adapter only when transcription and consent confirmation were part of the approved request. Unsolicited transcripts are discarded. No transcript is fabricated from the approved script.

### Configure deliberately

Keep all secrets in server environment variables. New blank entries are included in `.env.example`; this milestone does not modify `.env.local`, buy a number, connect an account, grant provider permissions or call anyone.

- `ARY_CALLS_ENABLED=true` only when ready for controlled acceptance; default false.
- `ARY_STORAGE=supabase` and `ARY_CALLS_USER_ID=<authenticated owner UUID>`.
- `ARY_CALLS_PROVIDER=twilio`.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `ARY_CALLS_FROM_NUMBER` (an eligible Twilio/verified caller number).
- `ARY_CALLS_ALLOWED_NUMBERS`: explicit comma-separated E.164 destination allowlist.
- Existing `ARY_INTEGRATION_ENCRYPTION_KEY`: 64 hex characters for encrypted durable receipts in `.data/calls-vault`. Preserve this key and directory; deleting guards can remove duplicate-call protection.

V1 accepts only **provider-verified US mobile/landline numbers** on that allowlist. Emergency/service short codes, premium prefixes, toll-free numbers, foreign destinations and unknown/VoIP line types are blocked. Lookup failure fails closed. Twilio Lookup Line Type Intelligence must be available on the account and may incur a provider charge. Provider/account geographic restrictions and verified caller requirements also apply. See [Twilio Call resource](https://www.twilio.com/docs/voice/api/call-resource) and [Lookup Line Type Intelligence](https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence).

Limits are fixed: one attempt to the same destination per rolling 24 hours, 3/hour, 10/day, and only one active/uncertain initiation at a time. Each initiation still requires fresh explicit intent and approval. A durable owner-level lock and receipt are saved before dialing. Failed/uncertain provider requests never automatically redial, including under a new request key. If the provider succeeded but the action transaction failed, an exact operation receipt can be recovered after fresh approval without another call. Uncertain receipts require operator inspection in the provider console; no unsafe reset endpoint is provided. This uses the existing single-host encrypted vault primitive and is not a multi-host rollout design.

### Results and follow-up

**Refresh provider status** polls one owned call through the existing action API; there is no public webhook or background polling. **Stop this call** asks the provider to end that call. Closing a tab or canceling an HTTP request does not terminate a telephone call; stop it explicitly once the provider reference is known. During an uncertain initiation, use the provider console. Status snapshots retain provider IDs, timestamps, duration, raw provider cost/currency if available, and transcript source when supported. "Completed" means a connection ended, not that a person agreed or even heard the whole script; voicemail/IVR is possible.

The Calls view and Action History retain every attempt, approval, result and error. Snapshots/outcomes reference the original call action. Scripts/transcripts stay in those attributed records and are not automatically permanent memory. Summaries are transparent status-based text plus a bounded unverified transcript excerpt, without fabricated business conclusions or model cost. Provider cost values are reported as received, not converted into ROI.

Select a project and choose **Propose follow-up task** on a recorded call. This uses the existing transactional `create_task` action and its own approval policy. The task stores `source_action_id`; related entities and reviewed source links are retained, including when revising a pending follow-up in the existing action form. There is no second task system.

Validation: `npm test`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `npm run test:calls`. The browser evaluator injects a fake telephony port only into a temporary source copy and uses a real disposable LocalRepository/action/approval/task flow; it cannot dial. Live provider/number acceptance is still required. See [CALLS_TEST_REPORT.md](CALLS_TEST_REPORT.md).

## Ary Communications Hub v1

Open **Communications → Communications hub** (also available through ⌘K). The existing **Gmail workspace**, Calls, Calendar, approval queue and Action History remain the execution/review surfaces.

`CommunicationsService` builds a read-only projection from the authenticated owner's existing action receipts, current entities/relationships, tasks and approval history. `GET /api/communications?entity_id=<canonical UUID>&offset=0&limit=50` returns typed source references, bounded summaries, a unified timeline, follow-up tasks, approvals and explained review priorities. `limit` is capped at 100. This endpoint never contacts a provider, schedules outreach, creates a task, extracts memory or copies email into another store. The new `communications.read` capability passes the existing ActionService gate; the audit records completion, not another copy of the returned communications.

### Sources and interpretation

- **Gmail:** observed read/summary receipts are grouped by connection + thread ID. Successful sends retain provider receipt references; drafts remain explicitly unsent. The latest observed message direction supports “review inbound” or “awaiting an observed reply,” not a claim that a reply is owed. Partial, ambiguous or undated thread data cannot establish reply status. A summary belongs to its captured analysis; a newer raw read does not silently reuse an older summary. Source navigation uses the existing Gmail reader and rechecks the active account connection.
- **Calls:** initiation/status/cancellation observations collapse by operation into the latest recorded snapshot. Failed/ringing calls are attempts, not completed contact. Completed connections may reach voicemail; recipient agreement and business outcome remain unknown. Scripts and transcripts are not returned by the hub.
- **Calendar:** observed events are grouped by connection + event ID. Event time supplies timeline context, never proof of attendance/contact. Changes after the last observation are unknown. The source opens the existing focused Calendar view.
- **Contacts/context:** reuse canonical entity IDs and source-resolved links. A unique exact `entity.metadata.email` address can link a participant; duplicate addresses remain unresolved. One explicit current relationship hop adds company/project context, labeled “related”; similar names never merge identities.
- **Future messages/SMS:** reserved in the typed channel contract only. No connector, messages table or messaging execution is introduced.

The hub rechecks source read, entity read, activity read where applicable, and hub permissions with project/company scopes. A forbidden source also suppresses older snapshots of that source. Changing a policy takes effect on the next hub refresh. No approval or send authority is inferred from permission to read history.

### Who do I need to follow up with?

The intelligence view explains its additive review score: overdue source-linked task **100**, pending approval **50**, open source-linked task **30**, latest inbound thread **20**, outbound thread without a later observed reply **10**, call outcome requiring review **5**. An overdue task contributes both its open-task and overdue signals. These are transparent workflow priorities, not confidence in a business claim or instructions to contact someone. Completing a task, recording a newer reply or resolving an approval changes the corresponding signals after refresh.

Only existing open tasks with `metadata.source_action_id` referencing a permitted communication receipt are counted as follow-ups. Unrelated tasks are not relabeled. Currently the real task pipeline supplies this linkage from Calls; this milestone does not expand Gmail/Calendar task creation or infer tasks from email wording. Expired approvals are visible as expired, and rejected/consumed approvals are excluded. Suggested actions open existing review surfaces; they never send or dial automatically.

Reading the hub creates no permanent memories. Existing individually reviewed Gmail evidence and the established memory reconciliation/extraction system remain the only applicable memory paths. Durable facts, commitments, decisions and outcomes require supporting evidence and review; an inbox thread is not automatically permanent memory.

### Validation and limits

Run `npm run test:communications` for the credential-free browser → HTTP → existing approval/task pipeline evaluator, plus the normal test/typecheck/format/build gates. Fixtures and the test server are disposable; no real email, phone call or Calendar write is performed. See [COMMUNICATIONS_HUB_TEST_REPORT.md](COMMUNICATIONS_HUB_TEST_REPORT.md).

Coverage is limited to successful source observations already recorded by Ary, not a continuously synchronized inbox. No later observed reply does not prove that nobody replied. Sources without canonical entity links remain in the timeline but do not invent a named contact brief. Follow-up briefs are heuristic and unscored business impact is never fabricated. Response timeline pagination bounds rendering; the current repository API still materializes owner-scoped history server-side, so very large histories will need a bounded query/index extension before scale claims. No migration, new dependency, provider configuration or external integration is required for this read model.

## Ary Creative — Premiere Pro v1

Open **Creative** in the sidebar or ⌘K. This is a dedicated Adobe UXP adapter registered in the existing ToolRegistry, with the existing permissions, exact-request approvals, action history, outcomes and retry keys. The separate `premiere-plugin` panel connects to Ary on loopback. The installed Clevaryn AI Editor is unchanged. No screen-coordinate clicking, shell execution or alternate editing backend is used.

`PremiereProvider` separates Ary from Adobe. The adapter supports opening a project/sequence, creating a sequence from an existing `.sqpreset`, importing media, creating/renaming bins, selecting existing timeline clips, adding Comment markers, assembling a new rough-selects sequence, seeking non-drop timecode, queuing an export with an existing `.epr`, and saving the project. Rough selects assembles explicitly chosen imported media in order using their existing in/out marks; it does not infer yesterday's interview or choose shots autonomously. Export success means **submitted to Adobe Media Encoder**, not a completed render.

**Inspect Premiere → choose action and exact inputs → Prepare action plan → request approval → existing approval dialog → exact receipt.** IDs come from the current inspection. All twelve change actions require approval even at level 5; inspect uses observe and planning uses recommend plus a separate observe check. Existing restrictive policies still apply. V1 uses a structured JSON input editor, not new natural-language editing intents. Action History contains the request, approval, operation ID, source context when provided, and resulting receipt/outcome.

Live use is disabled by default and restricted to macOS, the configured Supabase owner and the installed Ary desktop session. The UXP transport accepts an authenticated native connection at `127.0.0.1:3000`, rejects browser Origin headers and proxy hosts, and has no public enqueue endpoint. Server-side environment configuration restricts project/media/preset/export paths to explicitly chosen real folders. Current project path is checked for every change, including save. Symlink escapes, unknown verbs/IDs, unsupported files and output overwrite are rejected.

See [premiere-plugin/README.md](premiere-plugin/README.md) for setup and controlled native acceptance. Blank/disabled settings are in `.env.example`; no secret or live flag was installed during implementation. Preserve the existing vault encryption key and `.data/premiere-vault`: durable claims and immutable receipts prevent automatic edit replay after transport/database failure. A timeout or possible partial Adobe change blocks new operations pending inspection. Adobe edits and Supabase commits cannot form one atomic transaction, and the bridge does not pretend to roll back an unknown native result.

Validation: `npm test -- --maxWorkers=2`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm run test:premiere`. The browser evaluator runs a disposable repository and injected Premiere port with no Adobe edits. Native plugin loading, handshake and real action acceptance remain pending. See [PREMIERE_TEST_REPORT.md](PREMIERE_TEST_REPORT.md) for exact coverage and limits.

## Ary Edit Intelligence v1

Open **Creative → Edit Intelligence**. Paste or import a transcript package, then choose **Analyze edit plan**. This invokes the new `edit.plan` recommend capability through the existing ActionRequestService. The input and resulting versioned plan live in the existing owner-scoped action/outcome history. No new memory store, schema, provider or automatic Premiere execution is added. Download the plan JSON or inspect its source quotes, scores and hashes in Creative; earlier plans remain in Action History when a transcript is corrected and analyzed again.

The planner is a **deterministic, English-oriented editorial heuristic**, not an LLM pretending to have watched the footage. It ingests timed segments or SRT, suggests question/answer boundaries, hooks, selects, markers, a duration-bounded rough cut, clip ranking, repeated transcript takes and an export review. Question punctuation, adjacency, topic words, curiosity/change phrases, concrete numbers and passage length drive its transparent scores. Confidence is heuristic and includes supplied transcription confidence; it is not a calibrated quality or audience-performance prediction. Untimed prose, speaker diarization, automatic transcription, visual analysis and advanced autonomous editing are outside this version.

### Transcript package

```json
{
  "brief": "Explain the launch lesson",
  "destination": "Interview rough cut",
  "target_seconds": 60,
  "clips": [
    {
      "id": "source-clip-1",
      "name": "Interview camera A",
      "source_ref": "interview-transcript-v1.srt",
      "duration": 120,
      "fps": 29.97,
      "segments": [
        {
          "id": "cue-1",
          "start": 4.25,
          "end": 12.5,
          "text": "Replace with the exact source transcript.",
          "speaker": "Guest",
          "confidence": 0.9
        }
      ]
    }
  ]
}
```

All times are **source-relative seconds**. Display timecodes are non-drop frame labels at the supplied FPS; seconds remain authoritative. Use a clip's `srt` string instead of `segments` to ingest SRT cues. Embedded transcript content is data, never commands. Package limits: 20 clips, 200 cues per clip, 500 cues total, at most 55 KB in the UI (existing HTTP ceiling 64 KB). Split large interviews rather than silently truncating them. Every source needs a stable clip ID, transcript reference and duration; IDs are user labels until deliberately mapped to Premiere.

Transcript gaps of at least 1.5 seconds are **untranscribed intervals**, not proof of silence. Optional **Measure silence from a local audio excerpt** accepts browser-decodable audio up to 25 MB / 250 seconds matching the chosen source clip. It computes half-second, all-channel RMS windows locally; only windows and a SHA-256 source reference enter the JSON package. No microphone recording or raw audio upload occurs. Alternatively supply non-overlapping `audio_windows: [{start, end, rms_dbfs}]` and `audio_source_ref`. Contiguous windows at or below -45 dBFS for at least 0.8 seconds become silence suggestions. Supplied measurements are unverified claims; source hashes provide change detection, not authenticity. Always listen before removing pauses, room tone, music or meaningful dead space.

Ranking sums topic overlap (up to 20), following a question within three seconds (20), a hook phrase (15), numeric detail (5), at least eight words (10), and transcript confidence (up to 10). Whole cues scoring at least 20 are considered in descending score, with stable clip/time ties, no overlapping selected ranges and no cue truncation to fit the target. Exact normalized repeated wording (five words minimum, separately for questions/statements) is flagged; the first representative supplies the candidate and alternatives remain visible. Different numeric values are not merged. Delivery/picture differences and semantically similar paraphrases are not evaluated. A question/answer boundary is an adjacency suggestion, not proof of speaker identity or complete context.

### Structured handoff, not automatic editing

Every recommendation includes source clip, in/out seconds and timecode, reason, confidence, intended destination, cue IDs/quotes, source hash and related recommendation IDs. The rough-cut plan supplies sequence order and proposed destination offsets. Its trimmed ranges are explicitly **manual_range_edit_required**: current PremiereTool cannot execute arbitrary trims, so Ary never substitutes the existing whole-source `create_selects` command.

Marker instructions start as **mapping_required**. Expand **Prepare one marker for Premiere review**, choose a saved marker, and supply the exact current Premiere project/sequence IDs, verified sequence seconds and mapping evidence. `edit.prepare_marker` loads the owned successful plan, rechecks source/history/recommend permissions, verifies the live destination through `premiere.inspect`, and produces a valid `premiere.create_markers` request. Source time is never silently treated as sequence time. The request appears in the existing Premiere controls; **Request approval and execute** still requires the normal exact approval. Source action, product scope and provenance comments travel with the request and audit. Both the live bridge and its native acceptance remain separate prerequisites.

Export recommendations require a reviewed completed sequence, existing `.epr` preset and new output path. They do not invent delivery specifications. Use the existing Premiere planning/approval UI after supplying those values; AME submission still does not establish render completion.

Verification: `npm test -- --maxWorkers=2`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `npm run test:premiere` (now also covers edit-plan ingestion and marker handoff). See [EDIT_INTELLIGENCE_TEST_REPORT.md](EDIT_INTELLIGENCE_TEST_REPORT.md). No analysis sends communications, calls another provider, creates permanent memories or modifies the timeline.

## Ary Design Tool Adapter Framework v1

**Creative → Design** adds a reusable `DesignTool` boundary and one native adapter: **Cinema 4D 2026.2**, the installed supported 3D tool found during the audit. No Blender/Fusion/FreeCAD installation or second adapter was added. See [design-plugin/README.md](design-plugin/README.md) for capabilities, exact local setup and official API references.

`src/domain/design-tool.ts` defines strict operation inputs, state, units, revision, supported formats and the provider port. `registerDesignTools` composes into the existing ToolRegistry. `Cinema4DDesignTool` uses a fixed native Python MessageData plugin over authenticated loopback; `DesignBridge` reuses the existing encrypted vault primitive for durable delivery/receipt guards. This adds transport state, not another action/permission/memory system. The existing Premiere transport and native plugin were left untouched.

Inspect → prepare exact plan → normal approval → fixed SDK operation → exact receipt/outcome. All changes, including geometry, require approval even at level 5. Actions use the configured Supabase owner and installed Mac session, remain disabled by default, and cannot accept macros, shell commands, Python source, arbitrary properties or unchecked paths. Source geometry is not ingested as permanent memory.

V1 supports approved opening of simple `.c4d` documents; inspected-object selection; creating boxes; setting absolute local dimensions in millimeters on unscaled top-level boxes; object display color; saving a new version; OBJ export to a new path; undoing the latest unchanged Ary edit; and native viewport preview. It rejects unsupported scene content, unknown units and stale state. **STEP export, material graphs, general mesh/solid editing and offline rendering are unsupported.** The future bracket command is not advertised as a completed STEP workflow.

Run `npm run test:design` for the disposable browser → action/approval → test-provider evaluator, and `npm run test:design-plugin` for injected Cinema 4D SDK-port tests. Also run the full test/typecheck/format/build gates. **Native acceptance is pending licensing and a disposable scene.** The c4dpy probe reached a license-method prompt outside the sandbox; no account was selected, plugin installed, local secret changed or real document edited. See [DESIGN_TOOL_TEST_REPORT.md](DESIGN_TOOL_TEST_REPORT.md).

### Studio Control v2

Studio is a physical-control domain behind the existing ToolRegistry, approvals and action/outcome history. Open **Studio** from the sidebar or ⌘K. “Ary, podcast mode” prepares the configured scene and queues its exact plan for approval. Recording setup does **not** start recording.

Default scenes are unconfigured templates. The first real adapter implementation targets Amaran Desktop OpenAPI v2; it has not been physically verified on this Mac. Camera, prompter, display, LED-wall and audio slots stay unavailable until model-specific adapters exist. No simulated success replaces missing hardware.

To configure deliberately, review `studio.example.json`, replace the individual light node ID and settings, save it outside version control (for example `.data/studio.json`) and set `ARY_STUDIO_CONFIG_PATH` to its absolute path. Set `ARY_AMARAN_API_KEY` only in the environment after obtaining manufacturer API access. Pin `ARY_STUDIO_USER_ID` to the authenticated Supabase owner and explicitly enable `ARY_STUDIO_ENABLED=true`. Use the installed Mac app's existing local session; browser/cloud requests cannot gain hardware authority. Keep `ARY_INTEGRATION_ENCRYPTION_KEY` stable for encrypted receipts. No live settings are enabled by this milestone.

Plans bind exact steps, observed state and config revision. Required missing devices block a scene; optional failures and dependency skips are visible. Unknown delivery stops further effects and requires operator reconciliation. Never erase uncertain receipts to force a retry. Successful provider acknowledgment is not independent physical verification.

Run `npm run test:studio` for the disposable browser/approval/execution flow (fixture devices, no hardware); `npm test -- --maxWorkers=2` includes Studio domain and recovery cases. See [STUDIO_CONTROL_TEST_REPORT.md](STUDIO_CONTROL_TEST_REPORT.md) for exact changes, configuration limits and physical acceptance steps. No schema migration or new runtime dependency.

## Ary Perception v1

Open **Perception** from the sidebar or ⌘K. This is an on-demand visual evidence tool using the existing ToolRegistry, permissions, exact-request approvals, action audit, outcomes and idempotency. It does not watch in the background or modify the status of the action being inspected.

1. Choose upload, screenshot file, screen, window, webcam or studio camera. Camera enumeration alone does not activate a camera.
2. **Authorize one image**, review the existing approval dialog, then choose the file or click **Capture selected source**. Screen/window capture also requires the OS picker; camera access requires browser/macOS permission. Tracks stop after one frame, cancellation, hiding or leaving the panel.
3. Inspect the preview. For comparison, authorize and capture a second frame; order is before → after.
4. Choose inspect, verify or compare and write a specific visible criterion. Optionally enter an owned action ID to link the evidence.
5. **Review and analyze images** requests separate approval before sending these images and the question to the configured vision provider. The report shows frame-specific evidence, differences, uncertainty, model and latency. Action History retains the report.

`VisionProvider` and browser `CaptureProvider` keep analysis and capture independent. `ARY_VISION_PROVIDER=openai` uses the existing environment-only OpenAI key and Responses transport; `disabled` disables analysis. When unset, it inherits OpenAI only if the reasoning provider is OpenAI. `OPENAI_VISION_MODEL` optionally overrides the configured reasoning model. No implicit mock analysis or new model permissions. The current default is `gpt-5.6-sol`; no additional provider package or schema migration is required.

Privacy and limits:

- Separate permission definitions per source; capture and analysis always require approval, even at level 5. Source grants are owner-bound, single-use, expire and are rechecked against current permissions. Staging requires authenticated exact-origin requests. Analysis rechecks image hashes, ownership and project scope.
- No file/database image storage. Browser previews use revocable object URLs. Server buffers are process-local, capped at four frames per owner / 96 MiB total, and become unavailable after five minutes. An idle reaper clears expired buffers within the following 15 seconds. Analysis consumes frames, then clears buffers even on failure. Clear/leave removes previews and requests server cleanup. Process restart requires new capture. This is single-process v1, not a distributed image service or secure-erasure guarantee.
- Uploads are normalized in the browser through canvas to JPEG (longest side ≤2048); capture is one frame without audio. Server accepts bounded PNG/JPEG (≤3 MiB and 2048×2048 header dimensions); it does not fully decode/sanitize arbitrary direct API uploads. Raw image data never enters action input/output, model telemetry, permanent memory or the application’s ordinary logs. Questions, hashes, source labels and findings **do** remain in existing audit/outcome history and can contain sensitive descriptions.
- OpenAI requests set `store:false`; this is not a zero-retention guarantee. The connected OpenAI project's retention/sharing policies still apply. Stop cancels local capture/request work; it cannot recall an already transmitted image or guarantee the provider stops billing immediately.
- Labels describe the source selected by the user/browser; an uploaded image is not independently authenticated camera evidence. A visible export dialog does not establish an exported file; a lit room cannot prove which device caused it. Findings cannot silently confirm facts, rewrite memory, execute depicted instructions or mark the original action successful.
- Studio cameras must be exposed as OS video devices or supplied as an image file. No RTSP polling, arbitrary remote image URLs, face identification, surveillance, hand-tracking stream reuse or camera discovery that opens a stream.
- Electron uses the native system picker on supported macOS 15+ releases. If unavailable it denies capture rather than auto-selecting a screen. macOS Camera/Screen Recording privacy denial is translated into setup guidance. Restart the desktop application to load changes to its main process. Real desktop/camera acceptance is still pending.

Verification: `npm test -- --maxWorkers=2`, `npm run test:perception` (disposable browser/server with synthetic images and fixture vision), and `npm run test:perception:live` (one paid real vision comparison of synthetic images through existing approval/action services, temporary LocalRepository only). The live test neither captures your screen/camera nor creates a Supabase account. See [PERCEPTION_TEST_REPORT.md](PERCEPTION_TEST_REPORT.md) for evidence and native acceptance steps.

## Ary Multi-Tool Orchestration v1

Open **Execution Plans** from the sidebar or ⌘K. Ary remains the only identity. This extends the existing coordinator, provider, ToolRegistry, actions, approvals, outcomes and shared memory. Existing saved plan IDs and `orchestrator-v1` checkpoints stay compatible. No new framework, schema, credentials, integration or background worker is installed.

Enter a goal, review the proposed steps/inputs and missing information, then select **Run / resume plan**. Planning alone causes no domain effects. The existing optional `LanguageModelProvider.planWithUsage` uses the configured reasoning model, registered schemas for relevant tools, resolved central entities and at most four retrieved memories. It cannot grant permissions. Unknown IDs, files, connections, dates and time zones must be clarified, not invented.

### Dependencies and execution

- Plans have at most 12 topologically ordered steps. The model drafts `id`, `title`, `tool`, `input`, `depends_on`, `critical`, `missing`, `source_action_from`, and nullable `verification`. Server history adds objective/action/risk, effective permission preview, exact pending approvals, execution state, failure guidance, attempt count and evidence. Actual runtime permission resolution is authoritative.
- The UI projects persisted compatible states to planned, waiting for dependency/approval, ready, running, verifying, completed, failed, skipped and cancelled. Approved snapshots show ready. Dependencies release only after successful verification.
- Up to three independent **whitelisted observations in different domains** can run concurrently. The initial whitelist is task, Studio, Premiere, Design inspection and Calendar reads. Same-domain reads, planner-source-bound steps and mutations remain serial. Each observation has its own existing permission check, action key, audit and outcome.
- Every execution/read-back remains `ToolRegistry → ActionRequestService → ActionService/PermissionService → exact approval when required → adapter → action/outcome`. Domain state checks, financial/communication restrictions and uncertain-delivery safeguards remain intact. Planning does not enable disabled integrations.
- Read/planning receipts establish only that observation/planning finished. A mutation requires a separate registered observation tool and scalar equality predicate before it is completed. “Command sent” stays unverified; dependants remain blocked. Verification is bounded state equality, not proof of physical causality. Perception is not silently activated.

### Approvals, control and recovery

**Review step approval** uses the existing approval dialog and resumes that exact phase. Alternatively select up to three displayed related, non-high-risk pending actions and choose **Approve selected actions** / **Reject selected actions**. The server validates the current plan revision, action IDs, exact inputs, fingerprints and policy hashes; each decision is an immutable existing approval record. Unrelated/high-risk actions need separate review. Group review itself executes no domain effect; use Run / resume afterward. A group is a convenience over individual grants, not an atomic cross-tool transaction. A failure during recording may leave some individually recorded decisions; reload before continuing.

Pause/cancel controls persist in the plan's existing conversation. They stop subsequent dispatch across UI/text/voice, including after an in-flight wave settles. They cannot undo or recall an in-flight external operation. Closing the legacy plan panel stops its dispatch loop; UI Run drives bounded phases, while conversational resume advances one phase/observation wave at a time. Durable missions can instead use the separately enabled worker described below.

- Message compare-and-swap claims work before dispatch. Stable child keys include plan/step/phase/attempt and, for changed steps, revision generation. Only one concurrent dispatcher wins. Replay/recovery use recorded receipts without repeating successful effects.
- **Recover checkpoint** restores successful/failed receipts and pending approvals after checkpoint failure. Missing or still-running receipts stay unresolved. A timeout never establishes that repeating an external write is safe.
- Failure guidance distinguishes transient, permission, missing-input, unavailable-tool, required user decision and critical-dependency failures. Critical failures stop all future effects; optional failures stop dependent branches while independent work may continue. **Skip** explicitly stops an unexecuted branch. **Review safe retry** permits at most two retries of observations or transactional task/project operations; fresh permissions/approvals still apply. Unknown external effects are never blindly repeated.
- **Revise this plan** edits remaining steps in place and records the reason and full before/after specifications (up to eight revisions). Completed/uncertain effects retain their original steps and evidence. A proven pre-dispatch failure may be replaced with a reviewed alternative. Changed steps receive fresh keys and fresh approval requirements. Owner-skipped branches are not silently restored. Re-planning is owner-reviewed, not automatic model scope expansion.

### Text and voice

The existing `AryBrainService` calls a narrow conversation adapter before single-domain commands. Text and existing STT transcripts use identical dispatch and audit logic; STT/TTS/providers are unchanged. Examples:

- “Ary, plan getting the studio ready and scheduling editing time.” Explicit multi-domain imperative requests can also draft one plan.
- “What are you waiting on?” / “Show my plan.”
- “Pause that.” / “Resume the plan.” / “Cancel everything.” Cancellation is scoped to the plan established in this conversation; it never means all unrelated work.
- “Skip the export.” / “Approve the Premiere step.” Exact step IDs/titles take precedence. Ambiguous matches ask for one step.

Before conversational approval, Ary shows the exact pending action inputs and asks for confirmation of that snapshot. Saying approval again grants only those inputs; resume then passes through existing runtime checks. A new conversation without plan context does not control a guessed plan. The current history selector is bounded to the latest 30 plans. The software path is tested with both text and `modality:voice`; physical microphone/live STT acceptance remains a separate existing gate.

### Evidence and memory

Plans/checkpoints/control intents remain in the existing owner-scoped conversations/messages, with immutable action/approval/outcome receipts and a bounded event history. No table migration is required. Completed plans keep source entity/memory references and result/action IDs. **Review and save outcome memory** promotes one bounded episodic outcome/operational lesson through the existing MemoryService, embeddings, source and version machinery. The exact revision/summary needs separate approval; a deterministic ID and atomic revision check prevent duplicate or stale writes. Event-by-event traces are not made permanent memory and confirmed facts are not rewritten.

Structured input bindings such as `{"$from":"task","path":["result","task_id"]}` read only declared dependency output; verification may reference its own execution result. `verification.path` starts inside the observation RESULT, e.g. `["title"]`, without a `result` prefix. Prototype paths and expressions are rejected. `source_action_from` links a prerequisite planner action for execution only; independent read-back gets no unrelated mutation-source link. `task.inspect` reuses the actual task model and returns `task_id`, `title`, `status`, `priority`, `description`, `entity_id`, `updated_at`, and `before`.

Run `npm test -- --maxWorkers=2`, `npm run typecheck`, `npm run format:check`, `npm run build`, and `npm run test:orchestrator`. The browser acceptance uses disposable development storage/providers and real internal tasks, approvals, revision UI and reviewed memory. The regression suite includes Studio/Premiere/Calendar **provider fixtures**, not physical effects. `npm run test:orchestrator:live` separately makes a paid configured-model planning call and approves only a temporary synthetic internal task, then cleans up. Neither test enables integrations or sends external communications. See [MULTI_TOOL_ORCHESTRATION_TEST_REPORT.md](MULTI_TOOL_ORCHESTRATION_TEST_REPORT.md); the preceding [ORCHESTRATOR_TEST_REPORT.md](ORCHESTRATOR_TEST_REPORT.md) retains historical baseline evidence.

The Studio → Premiere → task → Calendar workflow passes with isolated external-provider fixtures and a real temporary internal task. Live acceptance still requires configured native providers, selected project/files, calendar consent/time zone and explicit effect approvals. Those roadmap gates remain pending.

## ARY visual presence

The shared presence visualizes actual Brain phases, action/mission execution, Board stages, voice state and approvals using the existing vgpu renderer package, with static and reduced-motion fallbacks. See [implementation and verification](docs/ary-presence-report.md) for event semantics, rendering choices, tests and limits.

## Durable Nexus Missions

`MissionEngine` wraps the existing coordinator with persisted lifecycle states, leased checkpoints, declarative branches/event waits, advisory agent submissions, bounded retries and restart recovery. Missions use canonical plan messages and the existing ToolRegistry, permissions, exact approvals, action/outcome receipts and reviewed memory flow. Save a durable mission in **MISSIONS → Execution Plans**, plan it, then explicitly start it. Existing execution plans remain available.

Apply migrations **014 and 015** before hosted use; neither was applied to hosted Supabase during this milestone. For progress without a browser, explicitly set `ARY_MISSION_WORKER_ENABLED=true` and supply `ARY_MISSION_ACCESS_TOKEN` through the worker environment, then run `npm run missions:worker` (or append `-- --once`). This is a supervised, per-user worker; token refresh and process hosting remain operational requirements. Domain actions still require their own permissions and approvals. A timeout never proves an external effect was cancelled.

Temporal was evaluated; no vendor SDK is coupled to ARY and no Temporal service was installed. See [Nexus Missions: contract, deployment, evaluation and acceptance](docs/nexus-missions.md). The milestone passes 1,040 tests, including real-process crash recovery and separate worker invocations, plus isolated browser approval/task completion. Hosted activation remains pending.

## Mission Control

Open **MISSIONS → Execution Plans** and select a mission. Mission Control shows its objective, expected outcome, workers, live checkpoint state, dependency graph, waits/failures, approval requirements and recorded cost coverage. Select a graph node to inspect planned inputs and actual tool calls, results, approval evidence and outcomes. Use **Open a mission by ID** for older missions outside recent history.

The pinned `@xyflow/react` renderer is read-only; existing lifecycle/approval controls keep all execution authority. The original Brain Graph/vgpu layer is unchanged. Realtime Nexus events refresh canonical checkpoints, with visible polling/stale fallback and reduced-motion support. Cost amounts reuse Economics records; missing or unlinked costs stay unknown. See [Mission Control implementation and acceptance](docs/nexus-mission-control.md).

## Nexus Agent Runtime

**AGENTS → Agent Runtime** manages persistent specialists and one-assignment workers. ARY remains the primary orchestrator. Profiles have stable IDs, functional specializations, capability/tool scopes, inherited permission ceilings, mission-linked central memory, server-selected model profiles and bounded execution budgets. Assignments become existing durable missions; plan/start/approvals/verification remain in Mission Control. Daily Board is still available under AGENTS.

The worker family view and central Nexus map show real parent/child relationships and activity. Termination prevents future subtree dispatch and requests cooperative cancellation; it does not undo committed effects. No agents are created until there is an explicit functional assignment/profile. See [runtime contract, exact changes, limits and acceptance](docs/nexus-agent-runtime.md).

Optional `ARY_AGENT_OPENAI_MODELS` adds server-approved model choices without changing the primary provider. Costs reuse recorded telemetry, not fabricated estimates or a promised hard dollar cap. No new SQL migration or external tool activation is required. Focused disposable browser verification: `ARY_AGENTS_ONLY=1 ARY_AGENTS_CHECK=1 node --import tsx scripts/evaluate-nexus-shell.ts`; add `ARY_PRESENCE_REDUCED=1` for reduced motion.

## Nexus Memory lifecycle and Knowledge

Open **MEMORY → Memories → Memory intelligence** to explore WORKING, EPISODIC, SEMANTIC, ENTITY, PROCEDURAL and OUTCOME memory. Existing IDs/types/evidence/embeddings are preserved; classification can update an existing record in place. The inspector explains source, learned/valid time, recorded confidence, conflicts, linked entities/outcomes and query-specific retrieval reasons.

Classified capture, consolidation, archive and record deletion use existing exact approvals, permissions, transactions, idempotency and audit/outcome records. Working context requires a conversation and expiry within 24 hours. Consolidations preserve originals and pin evidence; changed or retired sources suppress dependent summaries. Knowledge is a distinct curated-reference namespace, with immutable revisions and separate permissions, and is not silently injected into learned memory.

Review [the memory contract, exact changes, validation and limitations](docs/nexus-memory.md). **Additive migration 016 has not been applied to hosted Supabase.** It enables Knowledge, memory-record deletion and scoped SQL candidate filtering; older learned retrieval retains the v4 compatibility path. Deletion removes a memory and its evidence/history, not source conversations, past responses, audit records or backups.

Focused disposable browser verification: `ARY_MEMORY_ONLY=1 node --import tsx scripts/evaluate-nexus-shell.ts`; add `ARY_PRESENCE_REDUCED=1` for reduced motion. No live provider or real-user data is used by that test.

## MEMORY and WORLD perspectives

MEMORY and WORLD now open the shared Nexus spatial map with linked evidence, episodic timelines, historical changes, semantic search and recorded mission outcomes. Existing libraries and entity editors remain in the destination sections. See [the implementation and test report](docs/nexus-memory-world.md) for contracts, limits and manual tests.

## Controlled browser and Mac interaction

Open **TOOLS → Computer & Browser** for bounded page/window inspection, reviewed interactions, transfer-folder uploads/downloads, one-frame visual fallback and real Nexus activity. **STOP CONTROL** reuses the existing persistent emergency stop. All controls stay behind ToolRegistry, permissions, exact approval, action/outcome logging and replay protection; no autonomous browsing or unrestricted commands are exposed.

Control is disabled until the owner explicitly configures allowed apps/origins and grants macOS privacy access. See [the audit, setup, exact changes and real acceptance report](docs/nexus-digital-control.md). The existing installed-app launcher, memory, graph, providers and other tools remain intact.

### Persistent voice and Ambient conversation

Choose **Ambient → Start conversation** for automatic speech turns through the same Ary Brain. Speak over Ary to interrupt; End conversation releases the microphone. Background listening is opt-in. Tasks and draft missions use existing permissions and approvals. The single-message microphone remains available for transcript review.

See [the conversational interface audit, provider evaluation, tests and limitations](docs/nexus-conversational-interface.md). Wake-word detection is not enabled. Restart the desktop app to load its background/lock lifecycle changes; physical acoustic acceptance remains a separate check.

## Nexus Physical World

Tools → Studio now provides the spatial location/device view, timestamped telemetry, reviewed scenes and evidence-based equipment readiness. Create preparation mission saves a draft in the existing Mission Control. DeviceRegistry extends the current StudioConfig/StudioAdapter system; Amaran is preserved and a restricted Home Assistant light adapter is available behind existing explicit local enablement and approvals. Unconfigured devices stay unavailable. See [the audit, setup, provider evaluation and acceptance report](docs/nexus-physical-world.md). No production hardware is enabled by this change.

## Nexus Skills and Automations

Skills now supports reviewed, versioned workflows in a React Flow workshop. Automations pins a Skill version or Mission snapshot to manual/interval draft creation. Both reuse the existing MissionEngine, shared memory, ToolRegistry, permissions, approvals, audit, outcomes and idempotency. Generated workflows never grant permissions. See [contracts, configuration, bounds and manual tests](docs/nexus-skills.md). Run isolated UI acceptance with `node --import tsx scripts/evaluate-skills.ts`. Interval delivery stays disabled until explicitly configured.

## Outcome Engine

Open **WORLD → Economics → Outcome learning** to compare real action results, record approved assessments/corrections, inspect provenance, and accept or withdraw evidence-backed advisory lessons. Original receipts and earlier assessments remain historical; accepting advice never changes Ary’s core instructions, Skills or permissions. See [Outcome Engine contracts, audit and acceptance](docs/nexus-outcome-engine.md). Run `npx tsx scripts/evaluate-outcomes.ts` for the disposable local browser flow.

## ModelRouter

Ary now routes existing text reasoning, planning and extraction through task/capability, privacy, context, availability, latency and estimated-cost policies. Systems conversation shows each response’s actual model attempts and selection reason; Ambient stays simple. The current OpenAI provider is preserved. Additional Anthropic, Gemini, llama.cpp, MLX and compatible deployments require explicit server configuration. No extra provider is enabled automatically.

See [configuration, fallback behavior, exact changes and verification](docs/nexus-model-router.md). Development mock remains explicit. Cloud embedding outages retain lexical/graph retrieval without changing stored embedding spaces; complete model outages return labeled evidence only. Hosted database outages still require retry. Run `npx tsx scripts/evaluate-model-router.ts` for isolated acceptance, or `npx tsx scripts/evaluate-model-router-live.ts --live` for one paid synthetic request using the configured OpenAI key.

## Premiere professional workflow

Open **SKILLS → Creative → Premiere** for native project/timeline inspection, clip search, reviewed source transcription/silence/hooks, and exact clip-state/non-ripple-removal approvals. Existing import, sequence, marker, selects and export tools remain. [Read the audit, setup, exact changes and acceptance report](docs/nexus-premiere-professional.md). Reload Ary Creative Bridge 0.2.0 before using new capabilities.

FFmpeg is installed on this Mac; set `ARY_PREMIERE_FFMPEG_PATH` to the verified executable for compressed media. No production bridge flag or credential was changed. Native Adobe acceptance remains pending. Run `npx tsx scripts/evaluate-premiere.ts` for isolated UI acceptance and `npx tsx scripts/evaluate-premiere-media.ts` for real synthetic decoding; `--live` adds one synthetic paid STT call using the existing configured key.

## ARY Communications

WORLD → Communications now includes contact-linked planning and captured-evidence debriefs. Phone/email adapters prepare existing ToolRegistry requests; exact delivery approvals, source permissions, audit/outcomes and idempotency remain in place. Durable quotes and follow-ups require separate review. Two-way calls and messaging delivery remain unavailable until a configured adapter passes live acceptance. See [audit, contracts, LiveKit SIP evaluation and tests](docs/nexus-communications.md).

## ARY Mobile Companion

Open `/mobile` for the dedicated voice-first companion: Ary, Missions, Capture, Nexus and Updates. Phone-width visits to `/` select the companion; `/?systems=1` retains desktop Systems. Install assets are included for an authenticated HTTPS deployment. The same brain, memory, approvals and tools remain authoritative. Background push, physical-phone acceptance and remote Mac/device execution are separate gates. See [architecture decision, privacy, exact changes and verification](docs/nexus-mobile-companion.md).

## Cohesion verification

See the [current system map](docs/nexus-current-state.md) and [September 10 cohesion report](docs/nexus-cohesion.md) for BUILT / WORKING / PARTIAL / BLOCKED / NOT STARTED classifications and exact evidence. Current local verification: 1,463 automated tests, 12 Python adapter tests, typecheck, formatting, production build, and isolated mobile/communications/outcomes browser flows. The broad desktop visual sweep and physical/hosted integration gates remain incomplete.

Nexus base materials/font/focus live in `src/app/globals.css`. Executable mock tools and the mock playground are development/test-only; production retains real ToolRegistry capabilities and historical audits. Heavy screens load on demand. `node --import tsx scripts/profile-cohesion.ts` profiles command ranking, bounded graph projection and production Dashboard reference chunks after a build. No new package or migration is required.

### Subordinate cloud workers

The [Hermes worker adapter](docs/hermes-worker.md) extends the existing Ary action/approval/runtime architecture. Development diagnostics are under System → Permissions & settings. Live Hermes acceptance is blocked until the server endpoint, access key and independently restricted worker are configured; see the [test report](docs/HERMES_TEST_REPORT.md). No remote execution authority is granted by worker output.

### Calendar questions across accounts

Ask “What is on my calendar?” to read all connected primary calendars (next seven days by default). Use “What is on my work calendar tomorrow?”, “Show my personal calendar”, or an exact connected email to narrow the read. Ary labels each account, merges event times, and reports any account it could not check. Personal/work are conservative Gmail-domain versus non-Gmail-domain selectors; ambiguous matches require an exact email. Shared and secondary calendars are not searched. Every account read uses the existing tool/permission/audit pipeline; event changes still require the reviewed Calendar form.
