# Ary Creative — Premiere Pro v1

Date: September 8, 2026.

**Implementation and isolated verification complete; native Premiere acceptance pending.** No real project was edited, no export was submitted, no live flag or secret was installed, and the new UXP plugin was not loaded. A disposable project/media folder is still needed for controlled acceptance. Do not mark the live milestone DONE based on these fixtures.

## Audit and reuse

Read the canonical roadmap and inspected the existing registry, permission definitions, ActionRequestService/ActionService, approvals, repository transaction/outcome handling, HTTP boundaries, desktop session gate, encrypted integration vault, navigation and tests. All were extended in place. Installed Premiere Pro is **26.3.2**; UXP Developer Tools is present. Its inventory showed the separate Clevaryn AI Editor plugin as not loaded. That plugin was not changed.

Reviewed Adobe's official UXP reference for Project, Sequence, FolderItem, ProjectItem, TrackItemSelection, Markers, TickTime and EncoderManager, plus manifest/filesystem/network documentation. Used supported UXP calls rather than screen-coordinate clicking, menu IDs or shell scripts. Preset-based sequence creation requires Premiere 26.3 or newer. API references and setup are in `premiere-plugin/README.md`.

## Exact files added

| File                                         | Purpose                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/premiere.ts`                     | Twelve hard-coded verbs, strict inputs, bounded live state, provider interface and transparent plan validation.                               |
| `src/infrastructure/premiere/bridge.ts`      | Owner/desktop/loopback gates, allowed-root validation, encrypted single-host claims and immutable receipts, stale/uncertain execution guards. |
| `src/infrastructure/tools/premiere-tools.ts` | Inspect, plan and execute registrations in the existing ToolRegistry.                                                                         |
| `src/components/creative/premiere-panel.tsx` | Scoped inspection, structured inputs, exact plan, existing approval flow and result view.                                                     |
| `premiere-plugin/manifest.json`              | Separate UXP panel, Premiere 26.3 minimum, loopback network permission and filesystem permission.                                             |
| `premiere-plugin/index.html`                 | Native bridge token/connect/status panel.                                                                                                     |
| `premiere-plugin/main.js`                    | Native polling, approved operation delivery and receipt-only retry.                                                                           |
| `premiere-plugin/engine.js`                  | Injected Adobe DOM adapter implementing the twelve deterministic operations.                                                                  |
| `premiere-plugin/README.md`                  | Configuration, native acceptance checklist, API references and limitations.                                                                   |
| `tests/premiere.test.ts`                     | 22 permission, pipeline, bridge, recovery and path/security tests.                                                                            |
| `tests/premiere-plugin.test.ts`              | 18 Adobe DOM port tests covering every supported operation and state/failure guards.                                                          |
| `scripts/evaluate-premiere.ts`               | Disposable browser → HTTP → existing approval/action/outcome evaluator with an injected test port.                                            |
| `PREMIERE_TEST_REPORT.md`                    | This evidence record.                                                                                                                         |

## Exact existing files extended

| File                                       | Why necessary                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `src/domain/permissions.ts`                | Discoverable Premiere capabilities; observe/plan levels and mandatory approval ceiling on all twelve changes. |
| `src/services/action-request-service.ts`   | Optional injected Premiere provider in the existing registry factory; no alternate action pipeline.           |
| `src/server/context.ts`                    | Bind the real provider to the authenticated owner and existing desktop session authorization.                 |
| `src/server/http.ts`                       | Narrow native poll/result transport, authenticated before its handlers; no plugin enqueue API.                |
| `src/components/dashboard.tsx`             | Creative navigation and panel mount.                                                                          |
| `src/components/commands/command-index.ts` | Creative destination in the existing universal palette.                                                       |
| `.env.example`                             | Disabled flag and empty owner/token/allowed-root configuration.                                               |
| `package.json`                             | `test:premiere` evaluator command. No dependency changes.                                                     |
| `README.md`                                | Architecture, use, safety and validation guide.                                                               |
| `ARY_NEXUS_ROADMAP.md`                     | IP-10 and current verification; native completion remains explicitly pending.                                 |

**Migrations: none.** Existing schemas, action/result/outcome records, approvals, idempotency interfaces, repositories and memory evidence paths remain authoritative. The bridge journal contains transport state/receipts only.

## Automated verification

| Gate                                | Result                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm test -- --maxWorkers=2`        | **754/754 passed, 51/51 files**: existing 714 plus 40 Premiere tests.                     |
| `npm run typecheck`                 | Passed.                                                                                   |
| `npm run format:check`              | Passed. No separate lint script is configured.                                            |
| Prettier check of `premiere-plugin` | Passed separately because the existing format script does not include this new directory. |
| `npm run build`                     | Passed production build.                                                                  |
| `npm run test:premiere`             | **8/8 isolated end-to-end checks passed**; no real Adobe connection or editing.           |

Default test concurrency initially caused an existing Finance PGlite `beforeAll` to exceed its 10-second timeout. The complete suite passed with two workers; no unrelated Finance code/test was changed. The first browser attempt timed out during initial Next compilation; explicit server warm-up corrected the evaluator and the rerun passed. Final checks were rerun after implementation corrections.

Covered: registry discovery; inspect/plan read gates; permission denial; mandatory approval even at level 5; rejection without execution; approved action/outcome and idempotent replay; provider failure audit; unknown verbs/extra inputs; missing/stale/incomplete state; disconnected transport; claim-once delivery; exact immutable receipt recovery without revalidating completed output files; changed operation inputs; uncertain completion blocking new IDs; allowlisted real paths, symlink escapes and output overwrite; command-shaped filenames; bridge disabled/wrong token/browser-origin rejection.

Adobe DOM fixtures verify all twelve API mappings, ordered source selection, undoable bin/rename/marker actions, marker bounds, exact sequence/clip IDs, source timeline preservation, non-drop fractional-frame seek, export submission rather than render completion, expired jobs, changed revision and conservative uncertainty on possible partial native failure. Fixtures cannot prove Adobe's real runtime method behavior.

## Realistic isolated end-to-end result

The evaluator creates a temporary source copy and credential-free LocalRepository with a test-only Premiere provider. Through the real browser/UI and HTTP pipeline it:

1. Opens Creative through the universal command palette.
2. Inspects the disposable interview fixture.
3. Prepares a specific `create_bin` plan.
4. Rejects it and verifies zero edits.
5. Replans, approves and verifies exactly one execution.
6. Verifies resulting bin ID, consumed approval, rejection record and action/outcome linkage.
7. Re-inspects the changed provider state.
8. Checks browser errors: none.

The browser session, owned server, source copy and repository fixtures were removed in `finally`. No production account or existing project data was reused. Screenshot `/tmp/ary-premiere-e2e.png` was visually inspected: existing navigation, dark Creative surface, readable plan and resulting receipt rendered without an unrelated redesign.

## Native acceptance and known limits

- **Not yet verified:** actual plugin load, UXP network/header handshake, physical-app execution, real Adobe state/IDs, preset import/create, save, AME submission/output and native failure recovery. The installed version/API inspection is not execution evidence.
- Bridge remains disabled and `.env.local` unchanged. The owner must choose a disposable project and scoped media/preset/export folders before live setup. Native actions require the configured Supabase owner and the installed desktop session.
- All changes require explicit approval. No clip deletion, move, trim, arbitrary script or autonomous edit verbs. V1 has a JSON input editor; no new free-form editing intent resolver.
- Rough selects assembles explicitly supplied source media in order with existing in/out marks; it does not determine yesterday's interview. No advanced autonomous editing.
- Export returns a queue receipt; render completion is unknown. Existing destinations are rejected. Timecode is non-drop and relative to sequence start, without display-start offset handling.
- Native changes and Supabase writes cannot be atomically committed together. Undoable API operations use Adobe transactions; ambiguous partial effects are not falsely rolled back. Claims are never redelivered, known receipts can be recovered, and unknown completion blocks new operations. There is no unsafe guard-reset endpoint.
- Single-host encrypted journal and lock, no multi-host guarantees or retention compaction. Plugin process loss before receipt delivery can require operator inspection. Disconnect does not undo an active operation.
- Small-project inventory limits and the existing 64 KB request ceiling fail closed on larger state. Structural revision checks do not capture every effect, setting or asset byte. Local file modification races remain a limitation.
- Existing memory/retrieval/entities/temporal facts, graph/vgpu, model/voice providers, task/project tools, Finance/Economics, Gmail/Calendar/Calls and existing UI behavior were intentionally untouched apart from the listed registry/navigation wiring. No permanent memory is extracted from Premiere automatically.

**Recommended next step:** controlled native acceptance on one disposable project using `premiere-plugin/README.md`, then record real evidence here. Do not start advanced editing or another milestone automatically.

## September 9 extension — professional workflow

[Detailed current audit, changes and acceptance](docs/nexus-premiere-professional.md). Existing operations/bridge preserved; added native source/timeline metadata, clip search, approved clip state/non-ripple removal, pinned media decoding/transcription/silence/hooks and activity/findings UI. Nexus **1,404 tests / 84 files**, QACutter **25 tests**, typecheck, formatting, production build and **17 isolated browser checks** passed. Real FFmpeg decoding and live synthetic OpenAI transcription through approval/evidence/outcomes/replay passed (2.329 seconds; single sample). Fixtures cleaned up. FFmpeg installed; no production flags, credentials or Adobe project changed. **Native UXP/Adobe acceptance remains pending; export submission still does not prove completion.**
