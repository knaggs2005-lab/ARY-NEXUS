# Ary Communications Hub v1 — verification report

September 8, 2026. **Bounded implementation DONE.** Live Gmail/Calls/Calendar acceptance remains separately pending. No real communication was sent, and no external provider was called by this milestone's tests.

## Audit and preservation

The existing Communications screen already implemented Gmail search/read, source resolution, summaries, drafts, explicit send approval and individually reviewed evidence. Calls already had provider abstraction, guarded initiation, snapshots, outcome/audit links and separately approved source-linked task creation. Calendar already exposed resolved event context and approved writes. Canonical entities, current relationships, task status, approval history and the ActionService/PermissionService pipeline were reused.

No parallel email/contact/task/memory store was created. Memory, retrieval, temporal facts, graph/vgpu, Brain, voice, provider adapters, schemas, transactional action execution, approvals, idempotency and prior tests were intentionally untouched. The installed app's existing design and navigation remain in place.

## Exact source changes

Added:

- `src/domain/communications.ts`: frontend-friendly source/timeline/brief contract; messages reserved without an integration.
- `src/services/communications-service.ts`: owner-scoped read projection, source deduplication, evidence/coverage labeling, permission rechecks, current relationship context, follow-up/approval derivation and transparent ranking.
- `src/components/communications/communications-hub.tsx`: timeline, person/company/project filtering, last observed contact, explained follow-up intelligence and handoff to existing review screens.
- `tests/communications.test.ts`: 24 projection, permission, isolation, chronology and retention tests.
- `tests/helpers/communications-fixture.ts`: disposable attributed source fixtures shared by tests/evaluator; not imported by production code.
- `scripts/evaluate-communications.ts`: isolated real browser/HTTP/approval/task acceptance.
- `COMMUNICATIONS_HUB_TEST_REPORT.md`: this evidence record.

Extended:

- `src/domain/permissions.ts`: registered the read-only `communications.read` capability in the existing permission catalog.
- `src/server/http.ts`: authenticated, validated/paginated `GET /api/communications` inside the existing HTTP layer.
- `src/components/dashboard.tsx`: hub/Gmail subview navigation and source handoff; related Communications subtitle updated.
- `src/components/gmail/gmail-view.tsx`: optional source reference opens the existing reader after checking the active connection; disconnected/different accounts stop safely.
- `package.json`: `test:communications` command only; no dependency changes.
- `README.md`: behavior, API, interpretation, scoring, tests and limitations.
- `ARY_NEXUS_ROADMAP.md`: bounded milestone status and current verification; previous live acceptance gaps preserved.

**Migrations: none.** Existing source actions are projected without backfill or storage copies. No environment files, credentials or provider permissions changed. Four duplicate generated `.next/types/* 2.ts` artifacts initially caused typecheck collisions; only those generated duplicates were removed. No application API was changed to work around them.

## Automated gates

- `npm test`: **714 / 714 tests passed; 49 / 49 files.** Previous 690 tests retained; 24 new Communications tests.
- `npm run typecheck`: passed.
- `npm run format:check`: passed; no separate lint script is configured.
- `npm run build`: passed; static home/not-found and existing dynamic API catch-all generated successfully.
- `npm run test:communications`: **10 / 10 browser/HTTP/repository checks passed**. Localhost/browser launch needed the normal sandbox escalation; the test used only a temporary credential-free source copy and LocalRepository.

The new tests cover three-source deduplication, stable entity/context grouping, bounded summaries without raw mail/transcripts/drafts, future Calendar exclusion from last contact, observed unanswered/replied direction, incomplete/undated/future message suppression, account separation, drafts/failed calls, rejected/consumed/expired approvals, open vs completed/unrelated tasks, channel/project/hub permission revocation, cross-user isolation, pagination, historical relationship exclusion and duplicate-address ambiguity. A regression test ensures a newly forbidden source cannot surface an older unlinked snapshot.

## Realistic end-to-end scenario

A fixture person (Jordan), Clevaryn company and Wag Trails project are linked through existing entities/relationships. Existing-style source receipts describe an outbound email awaiting an observed reply, a completed call, a future Calendar review, an overdue call-linked follow-up task and an unapproved send.

1. Navigate with ⌘K to the unified Communications screen.
2. Verify three deduplicated sources, person/project grouping, one follow-up and one observed unanswered thread.
3. Verify no raw fixture email, transcript or draft body appears in hub output.
4. Open the follow-up intelligence view and its explained priorities.
5. Reject the pending request through the existing approval endpoint; refresh removes it.
6. Request completion of the actual task through ToolRegistry. Verify approval is required, approve the exact request, execute transactionally, and replay idempotently.
7. Verify the task is completed, its outcome and consumed approval are retained, and the open follow-up disappears without a page reload.
8. Open the Gmail source; its disconnected-account guard prevents reading with a different connection.
9. Revoke Gmail read permission; verify its timeline entries are redacted on refresh.
10. Verify no browser errors, no extra call initiation, and no successful Gmail send.

The disposable source/repository, test fixtures, server and browser session were cleaned up. Screenshot: `/tmp/ary-communications-e2e.png`; logs: `/tmp/ary-communications-{full-tests,typecheck,format,build,e2e}.log`.

**Installed Mac app:** ⌘K → Communications opened the new hub against authenticated Supabase successfully. It showed zero observed communication records, zero follow-ups and zero pending communication approvals. No synthetic sources were added to the real workspace. This verifies the live read/empty state, not live provider communication acceptance.

## Visual review

Reused existing Gmail glass/background, typography, chips, responsive layout, restrained transitions and reduced-motion rules. Added hub/Gmail navigation, contextual source cards, a person/project rail, explicit review counts and an expandable score explanation. No graph, shell or unrelated screen redesign. Source/history refresh updates React state without page reload; existing active work/approval interfaces perform actual mutations.

## Limits and next step

- Observed receipts only, not a synced mailbox. Missing replies/attendance/delivery are unknown; refresh sources before outreach.
- No automatic task inference or outbound actions. Follow-ups are existing source-linked tasks (the current real creation path is Calls); Gmail/Calendar task provenance is not newly added here.
- Calendar and email linking use existing source entity IDs plus unique exact stored addresses/current relationships. Unlinked records stay in the timeline; identities and commitments are not guessed.
- Phone source navigation opens existing Calls history; the timeline retains the exact provider/action IDs for inspection.
- Timeline payload is paginated, but repository history is materialized server-side; no large-history performance certification.
- Permanent-memory paths are preserved; the hub neither copies communications nor extracts memories.

Recommended next validation for this feature: controlled read-only Gmail/Calendar observations to populate real timeline context, with no outreach. The existing roadmap's broader acceptance queue is retained; no next milestone is started automatically.
