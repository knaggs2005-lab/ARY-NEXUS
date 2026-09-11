# Phase 1 core intelligence test report

September 6, 2026.

## What changed

- Alias-aware entity search, complete-phrase matching before unrelated shorter substrings, and possessive affiliation disambiguation while preserving canonical IDs.
- Additional contradiction/duplicate safeguards, stale-target checks, and duplicate entity-link retention during reconciliation.
- Explicit validity boundaries on reviewed replacements; future replacements cannot prematurely retire current facts.
- Append-only, tenant-scoped source provenance for created, seeded, conversation-derived and revised memories; source backfill for existing records without changing their text or embeddings.
- Actual user-quote validation and application-level immutability for supporting/contradicting evidence.
- Source evidence and pending-contradiction warnings in retrieval snapshots, model context, and the debug UI.

Canonical/alias resolution, four-source RRF retrieval, version history, conflict review, and per-source retrieval debug traces already existed. This phase retains and verifies those components instead of replacing them with external libraries.

## Automated verification

**155 tests pass across 14 files.** Type checking and the production build pass. New regression coverage includes source capture/edit history, source ownership/immutability, fabricated quotes, assistant-source rejection, alias search, possessive disambiguation, mislabeled negation/date contradictions, pending-conflict retrieval warnings, and supersession validity. Existing tests cover canonical-name precedence, similar company names, ambiguous people, graph-only/exact/paraphrased recall, irrelevant-query suppression, current/historical filtering, and tenant isolation.

The actual migration 009 executes in PGlite alongside all preceding migrations. Database tests exercise real PostgreSQL/pgvector retrieval functions and constraints. No initial schema reset is performed.

## Real-provider verification

The existing isolated synthetic-data evaluation passed **7/7 checks** using `gpt-5.6-sol` and `text-embedding-3-large`:

1. Semantic recall.
2. Paraphrased recall.
3. Entity-linked recall through an alias.
4. No relevant memory / abstention.
5. Reviewed corrections and supersession: prior date excluded, new date recalled.
6. Full conversation memory extraction with an exact source quote.
7. Conflicting facts retained for review without silently replacing the current fact.

Three reasoning calls and sixteen embedding calls succeeded. Average reasoning-call latency: **2.584 s**. The full Brain conversation response measured **2.897 s** (one sample, not a benchmark). Estimated evaluation cost: **$0.02452746**.

These provider checks use a temporary local repository with real OpenAI calls; they are distinct from the PostgreSQL migration/retrieval tests. Synthetic memories are removed after the run and are not inserted into the live workspace. Aggregate results are in the ignored `.data/openai-evaluation.json`.

## Live database verification

Migration 009 is applied. A fresh read-only verification query returned 6 memories, 6 distinct memories with provenance, 0 unknown-source records, and `evidence_validation_installed=true`. Existing memory content and embeddings were preserved.

## Live browser check

The new Source evidence controls render alongside existing retrieval reasoning. A fresh live recall request was blocked by an expired Ary session (`Sign in to continue`); after refreshing, the app correctly showed the sign-in screen. A new authenticated response/evidence-panel check remains, rather than claiming this UI flow passed.

## What remains

- Complex semantic contradiction detection depends on model extraction and which candidates retrieval surfaces; it is not a formal truth checker.
- Ambiguous people/companies need clarification. Similar names and implicit pronouns are not auto-merged/resolved.
- Conflict resolution remains a user review operation. Future effective replacements need later review; this phase adds no scheduler or autonomous action.
- A missing historical source cannot be reconstructed honestly. Such records retain an explicit unknown-source marker.
- Scale work remains for database-side graph traversal and paginated audit/evidence browsing on much larger datasets.
- No new voice, agent, finance, email, or autonomous integration was added.

## Short manual test plan

Sign back into Ary Nexus first: the browser session expired during the live UI check. Use a disposable test project/facts so experiments do not become real project knowledge.

1. In Entities, add an alias for a test project. Ask about its full name, then its alias. The debug trace should show the same canonical ID with different resolution reasons.
2. Create two people called Alex with different surnames and a `works_at` edge from only one to Clevaryn. Ask about “Alex,” then “Clevaryn’s Alex.” The first stays ambiguous; the second uses the recorded affiliation.
3. Add a test memory and link it to the test project. Recall it with different wording. Open retrieved context: check sources, semantic/text scores, final rank, graph path where present, and Source evidence.
4. Say “Remember: Test Project launches in June.” Then “Correction: Test Project launches in July.” In Memory review, inspect the pending conflict and exact quotes. Choose **Replace with new fact**. Recall the launch date: July should be current; June should remain in version/source history.
5. Manually edit a test memory, then use **Inspect history** in Memory review. Original input and revision should both remain. No old quote should be presented as proof of the edited wording.
6. Ask an unrelated private-fact question with no stored answer. Ary should disclose that it lacks the information, with no invented memory. Archive disposable test facts afterward.
