# ARY Nexus cohesion pass

September 10, 2026. No new major feature. This report distinguishes implemented code, verified local behavior and live operational acceptance. [Current implementation map](nexus-current-state.md) covers every major system; [roadmap](../ARY_NEXUS_ROADMAP.md) remains the ordered status document.

## Finding

Nexus has one integrated intelligence/action core. Desktop, voice, missions, Skills, agents and mobile share canonical records and authority. The audit found stale presentation/documentation, eager screen imports and exposed development tooling, rather than a justification for another framework or data model.

The cohesion pass is implemented and locally tested. **Complete production cohesion is not certified:** the broad desktop browser sweep did not finish, several physical/external integrations lack live acceptance, hosted migrations/worker rollout are not reverified, and database aggregation still has scale debt.

## Audit method and scope

Read the roadmap and existing audit, inventoried source/tests/scripts/migrations, traced root/mobile entries, shared Dashboard, navigation/commands, domain views, event projections, server composition, authenticated routes, action/permission/execution services, registries, adapter guards and tests. Reviewed memory/identity/retrieval/provenance, MissionEngine/agents/Skills, device/control/media/communications providers, outcome/model routing boundaries and retained acceptance reports. Compared 544 actual-checkout files with the dependency mirror before edits: application/test/script/schema files matched; differences were historical documentation/screenshots. Those unrelated documents were not overwritten from the mirror.

Fresh validation used isolated local identities and fixtures, mock/local providers, PGlite PostgreSQL tests and disposable browsers. No production account was reused for fixture writes. No real calls, mail, calendar changes, cameras, microphone sessions, device changes or model requests were made. No enable flags, credentials, migrations or provider settings changed. Source inspection of `.env.local` found Supabase storage and no explicit desktop/control/studio/Premiere/design/MCP enable flags there; runtime overrides and hosted state were not inspected, so this is not a connectivity claim.

## Corrections made

| Finding                                                                     | Correction                                                                                                                                                                                                                                  | Reason / preserved behavior                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulated executors were registered in production                           | Production `createActionToolRegistry` starts with an empty registry before adding real tools; production permission catalogue omits `mock.*`. Development playground is server-flagged and tucked under an explicit development disclosure. | Prevent production from presenting simulated task/note results as operating capabilities. Tests/development fixtures and historical audit records remain. Forged production mock requests fail and are audited. |
| Action proposal opened with a mock note example                             | Default is real `create_task` with empty user-supplied JSON; intent text is neutral.                                                                                                                                                        | Removes a misleading demonstration path without auto-creating a task.                                                                                                                                           |
| Tool metadata claimed execution minimum was 5                               | Metadata now says minimum 4, with approval, consistent with existing execution policy.                                                                                                                                                      | Actual numeric/class permissions and mandatory approval ceilings unchanged.                                                                                                                                     |
| Heavy screens loaded with every Dashboard                                   | Eleven screen components now use existing Next dynamic imports and shared `NexusState` loading presentation.                                                                                                                                | Reuses handlers and composition; reduces initial Dashboard reference chunks.                                                                                                                                    |
| Desktop/mobile/global controls had competing base tokens                    | Material, focus and font tokens are canonical in `globals.css`; shell/mobile consume them.                                                                                                                                                  | Removes root light-theme flash/mismatched global controls; preserves domain layouts and semantic status colors.                                                                                                 |
| Unconditional activity claims/motion                                        | Generic window title no longer claims “Live”. Static Economics backdrop and Finance relationship lines no longer animate perpetually.                                                                                                       | Busy, speech, actual state transitions and event-driven paths retain their motion and reduced-motion support.                                                                                                   |
| Mobile commands discarded record/tool context                               | Optional shared-palette destination predicate hides unsupported mobile details; entity selections retain canonical focus and memory/device destinations open the appropriate existing view.                                                 | No second command dispatcher or executor. Task/Skill/deep tool destinations remain desktop-only until they have real mobile surfaces.                                                                           |
| Dead graph query inspector and capability placeholder                       | Removed two files with no source/test/script consumers.                                                                                                                                                                                     | Actual entity graph, Nexus map, Skills/Automations workshop and reference packages retained.                                                                                                                    |
| Canonical audit described obsolete architecture                             | Archived dated September 8 snapshot, replaced current-state map, updated design/roadmap/README/mobile evidence.                                                                                                                             | Historical evidence remains dated; XYFlow, runtime worker and newer systems are accurately described.                                                                                                           |
| Shell evaluator assumed obsolete immediate navigation and Ambient inspector | Added a route wait and updated Ambient expectation to shared conversation.                                                                                                                                                                  | Test follows current interaction contract; no product behavior changed to satisfy stale assertions. Final wide sweep still incomplete, described below.                                                         |

## Authority and cohesion review

- **One Brain:** Dashboard owns conversation continuity and streaming/extraction; voice transcribes into the same send path. Mobile is a presentation branch. ModelRouter is a provider policy layer, not an agent or second memory system.
- **One action system:** external/internal executables remain ToolRegistry → validated ActionRequestService → ActionService/PermissionService → exact approval → result/outcome/audit. Owner-only permission administration is intentionally a separate audited control plane so an agent cannot disable recovery controls. Existing first-party read/CRUD routes use ActionService directly; this pass does not claim every HTTP read is a ToolRegistry invocation.
- **Permissions:** server-owned owner/workspace/agent/product scope; restrictive policy matching; fingerprinted one-use grants; changed input/schema/source invalidates approval; read permissions still apply to source-derived intelligence; STOP persists, cancels cooperative work and pauses missions without auto-resume. Existing tests cover denied execution, stale/replayed grants, cross-user references, escalation, stopped workers and transaction rollback.
- **Inspectability:** shared ApprovalDialog/Action History/Activity inspector, Mission Control steps/receipts, provider routing details, model telemetry, source inspections and memory history use authoritative records. Events explain activity; opening a panel never grants authority. Diagnostics requiring Systems remain outside Ambient/mobile.
- **Memory:** canonical IDs, aliases, RRF semantic/lexical/graph retrieval, evidence quotes, class/scope/version filtering, reviewed contradictions/supersession and historical provenance are preserved. Knowledge is a separate source class, not a second learned-memory pipeline. Confidence remains an estimate. Legacy records may have incomplete evidence; the UI must show that absence, not invent it.
- **Agents:** creation requires purpose/specialization/capability and bounded parent/memory/tool/model scopes. Board roles have defined advisory functions and share context. Declared roles on the graph are not reported as running workers. Semantic quality of a user-supplied purpose is not established merely by schema validation.
- **Missions/Skills:** one coordinator and leased checkpoint wrapper; pinned Skill versions, bounded branches/loops/subskills, retries, deadlines, events, pauses and receipt-based recovery. Triggers create drafts, not silently authorized executions. Local process recovery passes; distributed/hosted execution and uncertain external receipts remain operational gates.
- **Visuals:** shared shell/primitives, actual presence/event projections, deterministic graph grouping, 100-node render budget, 18-node mobile neighborhood and scoped detail panels. Entity Brain Graph, orbital navigation and XYFlow workflows solve distinct presentation needs against shared data; deleting them as “duplicates” would remove working functionality.
- **Outcomes:** source/action/mission/Skill links, costs, assessments and reversible recommendations retain provenance. Simulated historical evidence is explicitly identified. No financial attribution or learned behavior is fabricated; recommendations cannot rewrite core instructions or gain permissions.
- **Devices/native/communications:** disconnected/unknown/capability-only states stay distinct from successful receipts. Browser/AX/desktop/UXP/CAD/studio adapters stay behind fixed capabilities, scope and approval gates. Two-way calls, messaging and background mobile push are not represented as functioning transports.

## Security and permission review

Reviewed authenticated bearer resolution, owner repository/RLS boundaries, same-origin writes/capture/events, body limits, tool schemas/owned references, capability classes, exact request/replay handling, native allowlists, fixed argument execution, browser origins/files, MCP configuration/schema drift, expiring perception frames, encrypted credential vault and model fallback privacy constraints.

- Full suite includes HTTP/auth/CSRF, foreign-reference denial, action/permission levels, agent scope inheritance, emergency stop, SQL grants/RLS, task/outcome rollback, path/URL/command injection, OAuth state, phone exclusions/rate limiting, native receipt/replay, MCP drift and mobile sensor cancellation cases.
- Two added production boundary cases verify absent mock executors/catalogue, recorded rejection and intact real `create_task` metadata.
- `npm audit --omit=dev --json`: **0 known production dependency vulnerabilities** in the returned advisory snapshot. [Raw result](evidence/cohesion/dependency-audit.json). No dependency upgrades were performed. Dev dependency and operating-system/plugin advisory coverage are not claimed.
- No caller-controlled shell executor was found in the reviewed source paths; existing native adapters use fixed enum/argv boundaries. This is source review plus negative tests, not a penetration test or exhaustive proof.
- **Remaining risks:** hosted migration/authorization parity not rechecked; owner-history reads and request-rate limits need scale validation; encrypted file vault uses single-host exclusive lock files that may survive an unclean process exit; distributed token/worker/receipt recovery is not accepted. Secure remote device transport and mobile push need dedicated deployment boundaries. This pass does not “fix” these by weakening guards.

## Verification

| Check                                              | Result and precise scope                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline full suite                                | **1,460 / 86 files passed** before edits.                                                                                                                                                                                                                                                                                                             |
| Final full suite                                   | **1,463 / 86 files passed**. Existing tests preserved; three additional cases cover production mock boundaries and mobile command contracts.                                                                                                                                                                                                          |
| Integration / database                             | Full suite includes real PGlite PostgreSQL/pgvector/schema/transaction/RLS cases for memory, missions, permissions, Finance and outcomes, plus provider/HTTP/adapter fixtures. This is not hosted Supabase acceptance.                                                                                                                                |
| Restart recovery                                   | Existing `missions.test.ts` passed, including actual Node-process exit after task commit → lease expiry → exact-task recovery/completion, separate worker invocations, persisted waits/deadlines and concurrency fencing.                                                                                                                             |
| Python CAD adapter                                 | **12 passed** against the SDK fixture. No licensed scene edited.                                                                                                                                                                                                                                                                                      |
| Mobile browser                                     | **18 checks passed**, including reviewed capture → real local memory → recall, task approval → idempotent replay, mission DRAFT → PLANNING → READY, bounded graph, camera choices without activation, command surface, offline no-replay, manifest, reduced motion and desktop entry. Cleaned up fixtures/server/browser.                             |
| Communications browser                             | **16 checks passed**: source plan/debrief, separate memory/task approvals, actual local results, replay, source redaction/revocation, follow-ups, reduced motion and no browser errors. No outreach.                                                                                                                                                  |
| Outcome browser                                    | **12 checks passed**: task receipt, assessment rejection/approval, evidence comparison, repeated lessons, accepted/reversible withdrawal and audit. Mock failures stayed isolated.                                                                                                                                                                    |
| Broad desktop navigation/events/missions/map sweep | **PARTIAL**. First run hit a navigation race; second exposed outdated Ambient inspector expectation; both harness issues corrected. Final allowed retry timed out in agent-browser while the captured UI showed the expected `create_task approval_required` item. Full sweep and full event/mission/map visual acceptance are not counted as passed. |
| Visual comparison                                  | Mobile home/map inspected; command dock overlap absent. Desktop mode-round-trip screenshot comparison showed **5.82–6.14% changed pixels**, with changing event/status content. No stable pixel-regression pass claimed. [Pending approval capture](evidence/cohesion/desktop-pending-approval.png).                                                  |
| Typecheck / formatting                             | Passed; repository has configured Prettier check, no separate lint command.                                                                                                                                                                                                                                                                           |
| Production build                                   | Passed; `/`, `/mobile` and existing API route built. Build is not deployment/authenticated phone acceptance.                                                                                                                                                                                                                                          |

Reproducible commands:

```sh
npx vitest run --maxWorkers=2
python3 tests/design-plugin-test.py
npm run typecheck
npm run format:check
npm run build
npm audit --omit=dev --json
node --import tsx scripts/audit-migrations.ts
node --import tsx scripts/profile-cohesion.ts
node --import tsx scripts/evaluate-mobile.ts
node --import tsx scripts/evaluate-communications.ts
node --import tsx scripts/evaluate-outcomes.ts
ARY_EVENTS_CHECK=true ARY_MISSION_CHECK=true ARY_MAP_CHECK=true node --import tsx scripts/evaluate-nexus-shell.ts
```

The local migration audit also applied all **17 migrations** in disposable PGlite, reran its guarded baseline adoption twice and rejected deliberate index drift. Hosted Supabase was not contacted.

## Performance evidence

Measured on this Mac (darwin arm64, Node 26.7.0), five warmups + 30 CPU samples. [Raw measurements](evidence/cohesion/performance.json).

- Production Dashboard client-reference chunks: **673,594 → 518,789 raw bytes**, **186,863 → 145,536 gzip bytes** (about **23% raw / 22% gzip reduction**). This is the same build-manifest metric before/after; it excludes framework/runtime, other dynamic modules, media and total route transfer.
- At 10,000 synthetic command entries, indexing p95 **10.199 ms**; ranked query p95 **1.019 ms**.
- At the normal 180 loaded map records, expanded projection p95 **0.110 ms**, layout p95 **0.057 ms**. At 10,000 synthetic records, projection p95 **3.900 ms**, layout p95 **0.032 ms**; projection rendered **50 nodes** in these two expanded clusters, within the existing 100-node budget.
- Synthetic CPU measurements do not establish mobile frame rate, network latency, real audio latency or hosted database scalability. The remaining likely bottleneck is owner-history aggregation and initial snapshot size, not a reason to replace the renderer.

## Exact source changes

Modified:

- `src/services/action-request-service.ts`: production registry excludes fixtures.
- `src/domain/tool-registry.ts`: truthful execute-with-approval minimum metadata.
- `src/server/http.ts`: server-owned development UI flag and production permission catalogue filter.
- `src/components/permissions-panel.tsx`: conditional development disclosure.
- `src/components/action-center.tsx`: real-tool default, empty user input.
- `src/components/dashboard.tsx`: eleven existing screens deferred, common loading state.
- `src/app/globals.css`, `src/components/nexus/nexus.module.css`, `src/components/mobile/mobile.module.css`: shared base materials/font/focus.
- `src/components/nexus/nexus-shell.tsx`: remove unconditional Live title.
- `src/components/roi.module.css`, `src/components/finance/finance.module.css`: remove continuous decorative motion.
- `src/components/commands/command-palette.tsx`, `src/domain/mobile.ts`, `src/components/mobile/mobile-companion.tsx`, `src/components/mobile/mobile-nexus.tsx`: supported-destination contract and real entity focus.
- `tests/action-requests.test.ts`, `tests/mobile.test.ts`: meaningful boundary cases.
- `scripts/evaluate-nexus-shell.ts`: current navigation/Ambient test contract.

Added `scripts/profile-cohesion.ts`, this report, evidence files and an explicitly historical audit archive. Updated `docs/nexus-current-state.md`, `docs/nexus-design-system.md`, `docs/nexus-mobile-companion.md`, README and roadmap. Removed unused `src/components/brain-graph-panel.tsx` and `src/components/nexus/capability-view.tsx`.

No migration, provider/key change, external connection, new business schema, dependency, second brain or executor. Changed files are copied from the tested dependency mirror into the actual checkout and hash-verified; actual desktop dependency symlink/build state are preserved. This checkout has no release commit; no push or signed release is implied.

## Factual disposition

- **BUILT:** cohesion corrections, comprehensive current-state map, production fixture boundary, common materials/loading, mobile destination contract and repeatable profiler.
- **WORKING (verified locally):** 1,463 automated cases, 12 Python cases, mobile/communications/outcomes browser flows; shared memory/action/permission/mission contracts; production compilation. Local restart and transactional safety are tested, not inferred.
- **PARTIAL:** broad desktop visual acceptance; uniformity of every domain screen; bounded database aggregation; physical voice/perception; live Calendar/Gmail/calls/Premiere/CAD/studio; additional model endpoints and mobile installation.
- **BLOCKED for release acceptance:** stable completion of the broad desktop browser sweep; hosted 014–017 parity/worker activation evidence; required native licensing/configuration/privacy/device/provider setup; no tracked/notarized release. These were not bypassed or marked complete.
- **NOT STARTED in this pass:** native SwiftUI/App Store client, background push, new integrations, two-way conversational calling/messaging, remote device host, new agent framework, schema reorganization or another major milestone.

No automatic next milestone. Complete the existing acceptance gates before expanding scope.
