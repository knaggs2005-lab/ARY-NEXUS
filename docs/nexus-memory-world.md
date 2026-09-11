# MEMORY + WORLD intelligence surfaces

September 9, 2026. Additive visual integration over the existing central Nexus map.

## Audit and preservation

The repository already had a bounded Canvas2D/vgpu Nexus map, canonical entity/facet projections, one/two-hop graph queries, spatial selection/search, source navigation, event-linked activity, and separate memory/entity editors. Memory already had six classes, pgvector/full-text/entity/graph retrieval, evidence, versions, supersession, working scope/expiry, and reviewed lifecycle tools. Missions already lived in canonical plan messages with action receipts and outcomes. These remain the authority.

The gap was presentation: MEMORY and WORLD opened record-oriented screens, map selection lacked memory/episode/change inspection, and a project-to-mission-to-outcome path was not projected. No memory, entity, graph, agent, action, provider, or permission system was rebuilt.

## What changed

- **WORLD** and **MEMORY** now open perspectives on the same central Nexus renderer. Existing Memories, Knowledge, Memory review, Reflection, Entities and Relationships remain accessible as secondary sections. Typed/voice primary destinations use the same navigation mapping.
- Selecting a canonical entity expands its recorded neighborhood, linked memories and scoped saved missions. Mission nodes expose outcomes through their actual execution/verification action IDs. Outcome nodes retain their action references and explicit project scopes.
- A bounded exploration trail preserves the selected path without asserting additional relationships. You can follow person → company → client → project → mission → outcome when those records and links exist. No Austin/client/mission chain is manufactured in real data.
- The context panel offers **What does ARY know about this?**, **Why are these connected?**, **What happened last time?**, and **What changed?** These are deterministic evidence views, not invented model answers.
- Episodic memory and mission/outcome records form a descending recorded-time timeline. Recorded time and real-world validity remain distinct. Changes compare stored content, summary, status, confidence, validity and archive fields; ordinary access timestamps are ignored. Explicit supersession has its own event and edge.
- Memory inspection includes recorded confidence, conflicts, validity, learned time and up to eight source references/quotes. Missing evidence remains missing. Historical mode exposes retired records; current mode excludes them. Working/expired memory is withheld from the global surface.
- Semantic search calls the existing `MemoryService.searchMemories` and shows its retrieval explanation. It is workspace-wide current learned-memory search, not a second ranking implementation or automatic Knowledge ingestion.
- Existing `nexus_kind` metadata represents places (`location`), software (`application`), devices, and now organizations/important objects. Canonical entity IDs and existing database entity types stay unchanged. These facets use existing entity storage rather than parallel tables.

## API and permission contract

`GET /api/nexus-map/intelligence?focus=<id>&history=current|all&q=<query>`

Focus accepts a canonical entity UUID, `memory:<UUID>`, `mission:<UUID>` or `outcome:<UUID>`. A query or focus is required. The response contains `map`, `focus`, `memories`, `timeline`, `query` and an explicit explanation. It contains no embeddings, raw provider inputs, entire conversation transcripts, credentials or arbitrary action outputs.

Authenticated owner-scoped repositories remain authoritative. Reads use existing `entity.read`, `memory.read`, `conversation.read` and `activity.read` gates, including explicit entity/product scopes. Successful aggregate read authorization is reused only within that single request and exact family/scope; it is not a cross-request cache. Denied/missing optional sources produce a visible warning, not fabricated content. Agent execution is refused here and continues to use its existing mission-scoped retrieval. Inspection executes no tool mutations. Existing semantic search retains its usual last-access updates and read audit.

No new SQL migration, package, external integration, production fixture, provider change or hosted setting is required. Previous hosted activation gates, including migrations 014–016, remain unchanged.

## Exact files

Added:

- `src/domain/nexus-intelligence.ts`: bounded request/response contract.
- `src/services/nexus-intelligence-service.ts`: owner/policy-scoped projection and source/time explanations.
- `src/components/atlas/intelligence-panel.tsx`: shared questions, memory evidence and timelines.
- `tests/nexus-intelligence.test.ts`: 23 projection/security/history/retrieval cases.
- `scripts/lib/intelligence-browser-check.ts`: disposable source-chain browser acceptance.
- `docs/nexus-memory-world.md`: this audit and report.

Extended:

- `src/domain/nexus-map.ts`: perspective, facet/outcome kinds, optional scoped mission lookup, working/expiry-safe memory projection.
- `src/services/nexus-map-service.ts`: perspective filtering, reuse existing source reads.
- `src/infrastructure/repositories/local.ts` and `supabase.ts`: optional entity-scoped mission lookup on existing canonical records; facet projection; safe memory fields. Existing signatures remain compatible.
- `src/server/http.ts`: authenticated read endpoint.
- `src/components/atlas/nexus-map.tsx` and `nexus-map.module.css`: shared map perspectives, semantic entry, breadcrumb, historical scope and context inspection. Background base-search responses no longer erase newer selection. Question selection survives scope refresh.
- `src/components/atlas/map-projection.ts`: organization/object/outcome labels; renderer/layout unchanged.
- `src/components/nexus/destinations.ts`, `src/components/commands/command-index.ts`, `src/components/dashboard.tsx`: primary perspective routing, existing editor access, exact mission source opening.
- `scripts/evaluate-nexus-shell.ts`: optional focused acceptance using the existing disposable harness.
- `README.md`, `ARY_NEXUS_ROADMAP.md`: navigation documentation and bounded milestone status.

## Verification

- **1,156 tests / 70 files passed**, including 23 new intelligence cases and three additional map categories. Existing regression tests remain intact.
- **Typecheck and configured formatting passed.** No separate lint script exists.
- **Production build passed** (Next.js 16.3.4 / Turbopack, including build-time TypeScript).
- Browser: **normal and reduced-motion passed** using a real local Next.js HTTP server and LocalRepository. Chain navigation, current/historical facts, episodic timeline, supersession, provenance, saved mission/action/outcome links, semantic retrieval, both perspectives and 900px desktop layout were verified. No browser error overlay. Fixtures/server/browser are removed by the existing harness.
- Browser fixtures were synthetic isolated records and local providers; they do not certify live OpenAI/Supabase or native Electron acceptance. Semantic paraphrase delegation/rank explanations are unit-tested with controlled retrieval results; browser search exercises the existing local retrieval path. No new real-provider recall claim.
- Verification used the healthy exact-lock `/tmp/ary-shell-dependencies` environment because the original iCloud dependency tree had prior read failures. Modified source/test/script files are copied back and byte-checked against the application checkout.

## Performance and honest limits

Existing renderer limits and fallback stay intact: semantic clustering, at most 100 drawn nodes, Canvas2D without WebGPU, native reduced-motion behavior. The context response caps memories at 32, missions at eight per entity, receipts at 24 per mission, graph nodes at 120, edges at 240 and timeline entries at 100. Exploration retains at most 12 selected records. Truncated windows are reported; counts are not global totals.

The source mission query is filtered by entity in Supabase before the existing page limit. Some legacy repository list reads (links, versions, conflicts) still materialize owner-scoped rows; high-cardinality deployments need profiling and paged/batched reads later. Memory inspection displays recorded status; actual semantic retrieval continues to apply the existing extra source-pinned consolidation eligibility checks. No independent truth or calibrated confidence claim is made.

Timeline inspection is of stored episodes/versions, not a new whole-database historical snapshot engine. Curated Knowledge remains separate in the original library. Reference-only facets require explicitly recorded canonical metadata; no new discovery/scanning or facet editor was added. Historical/pending sources, absent links, source unavailability and prior hosted/native activation gaps are not marked as solved.

## Manual test

1. Open **WORLD**. Search an existing person/company/project by name, select it, and follow a recorded connection. Inspect **Why are these connected?** for direction, strength and record/evidence references.
2. Follow linked projects into a saved mission and then a recorded outcome. Open source to inspect the existing mission view.
3. Select an entity with linked episodic memory. Open **What happened last time?**, then inspect confidence/provenance.
4. Choose **Include history** and **What changed?** on a corrected fact. Inspect the retired original and replacement; switch back to current context.
5. Open **MEMORY**, search by meaning, select a result and inspect **Why retrieved**. An unrelated query must leave an honest empty result.
6. Confirm old Memories/Knowledge and Entity editors still open from the same destination's sections. Repeat with reduced motion and a narrow desktop window.

No next milestone was started. Existing NEXT 3 remain Calls controlled live acceptance, Desktop Bridge controlled live acceptance, and Google Calendar live acceptance.
