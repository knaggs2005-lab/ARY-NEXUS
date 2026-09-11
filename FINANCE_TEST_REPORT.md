# Ary Finance v1 — implementation and verification

Verified September 7, 2026.

## Audit findings and preserved architecture

The repository already had canonical entities and aliases, memory/retrieval and temporal fact infrastructure, goals/projects/tasks, the Brain Graph and vgpu layer, production model providers, voice, Priority, Board, Economics/ROI, Calendar/Gmail, and the central ToolRegistry, permissions, approval queue, action/outcome audit and idempotency pipeline. These were inspected before implementation. Existing Economics tracks Ary attribution; it was not a financial account ledger. The Finance spatial tile previously opened ROI. There was no existing Finance statement/account store to duplicate.

The implementation adds a statement ledger and registers two tools in the existing pipeline. It preserves existing APIs and uses the current action request envelope. Existing task/project/goal models are referenced, not recreated. Financial records do not become general permanent memory automatically. The whole working tree was already untracked; no baseline files were reset, deleted or committed.

## Added files

| File                                           | Purpose                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/finance.ts`                        | Strict normalized source contract, minor-unit precision, stable account identity and correction invariants.                         |
| `src/services/finance-service.ts`              | Swappable statement adapter boundary, imports, as-of reports, explicit arithmetic, source comparisons and permission-gated linkage. |
| `src/services/finance-conversation-service.ts` | Deterministic financial answers and contextual source navigation through existing actions.                                          |
| `src/infrastructure/tools/finance-tools.ts`    | Register read/import only; no funds or brokerage executor.                                                                          |
| `src/components/finance/finance-view.tsx`      | Finance workspace, statement preview, account timeline, evidence panel, related entities/goals, transactions/bills/holdings.        |
| `src/components/finance/finance.module.css`    | Scoped glass/depth styling, number fades, source transitions, relationship paths and reduced-motion support.                        |
| `src/components/finance/finance-review.tsx`    | Human-readable source/amount summary in existing approvals and history.                                                             |
| `public/finance-statement-template.json`       | Blank normalized import template; requires real source fields before acceptance.                                                    |
| `supabase/migrations/202609070012_finance.sql` | Single additive append-only owner ledger, constraints, trigger and RLS.                                                             |
| `tests/finance.test.ts`                        | 28 service, pipeline, conversation and recovery tests.                                                                              |
| `tests/finance-database.test.ts`               | 7 tests executing the actual migration in PostgreSQL-compatible PGlite.                                                             |
| `scripts/evaluate-finance.ts`                  | Isolated fixture browser verification.                                                                                              |
| `scripts/evaluate-finance-e2e.ts`              | Real browser/HTTP/approval/persistence verification in a disposable app copy; no API mocks or production credentials.               |
| `FINANCE_TEST_REPORT.md`                       | This report.                                                                                                                        |

## Modified files and why

| File                                       | Additive extension                                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/models.ts`                     | Register the new table in existing typed repository models.                                                                                                                                                    |
| `src/infrastructure/repositories/local.ts` | Support the ledger with matching append-only, ownership and identity rules.                                                                                                                                    |
| `src/domain/permissions.ts`                | Add observe-level read and mandatory-approved import capabilities.                                                                                                                                             |
| `src/services/action-request-service.ts`   | Register tools, derive financial product/entity/goal scope server-side, preserve action idempotency, block automatic financial memory copying. Optional registry factory context preserves current call sites. |
| `src/server/context.ts`                    | Supply the existing ActionService to the extended registry factory.                                                                                                                                            |
| `src/services/ary-brain-service.ts`        | Route financial context through the new bridge while retaining existing response/history infrastructure.                                                                                                       |
| `src/components/dashboard.tsx`             | Lazy Finance tab and account-evidence navigation from Chat; existing sidebar and Graph callbacks retained.                                                                                                     |
| `src/components/spatial/modules.ts`        | Point the existing Finance module at Finance instead of ROI.                                                                                                                                                   |
| `src/components/spatial/module-card.tsx`   | Replace the stale Finance “ROI ACCOUNTING” label with “SOURCE VISIBILITY.”                                                                                                                                     |
| `src/components/approval-dialog.tsx`       | Show financial import source review in the existing approval dialog.                                                                                                                                           |
| `src/components/action-center.tsx`         | Show source review and prevent Finance receipts being copied with “remember action.”                                                                                                                           |
| `src/components/permissions-panel.tsx`     | Clarify that no money-movement/trading executor exists.                                                                                                                                                        |
| `package.json`                             | Add `test:finance`; no dependency additions.                                                                                                                                                                   |
| `package.json` (execution verification)    | Add `test:finance:e2e` for the realistic, disposable-server test. No application behavior or dependency changes.                                                                                               |
| `README.md`                                | Setup, contracts, source semantics, calculations, permissions/recovery, limits and verification. Correct stale Finance/ROI descriptions.                                                                       |

## Migration and live verification

The current authenticated Supabase SQL session was inspected first. `entities`, `goals`, `actions` and `action_approvals` existed; `finance_snapshots` did not. The additive migration was then run against the **ARY NEXUS** project (`hcgwkmpvlqndrkrfheny`) and returned **Success. No rows returned**.

A subsequent read-only query verified:

| Check                                | Result                  |
| ------------------------------------ | ----------------------- |
| Row-level security                   | Enabled                 |
| Policies                             | 2 (owner select/insert) |
| Authenticated SELECT / INSERT grants | Present, subject to RLS |
| Authenticated UPDATE / DELETE grants | Absent                  |
| Anonymous SELECT grant               | Absent                  |
| Imported financial statements        | 0                       |

The installed `/Users/austin/Applications/Ary Nexus.app` was opened. It connected to the existing localhost application, displayed the authenticated **SUPABASE** workspace, and successfully loaded Finance. The live view showed **No financial sources yet** and correctly kept financial values unknown. No fabricated statement, bank connection, credentials or financial transaction was added to the real account. A real populated-account test awaits an actual user-provided source.

## Automated results

| Verification                       | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| Full regression suite              | **577 tests passed, 42 files**                              |
| New Finance tests                  | **35 passed** (28 service/pipeline + 7 database)            |
| TypeScript                         | Passed                                                      |
| Production build                   | Passed                                                      |
| Formatting                         | Passed                                                      |
| Isolated Finance browser checks    | **14 passed**                                               |
| Real HTTP/browser end-to-end flow  | **8 checks passed**, no API mocks; disposable local storage |
| Installed app / live database read | Passed with empty ledger                                    |

Coverage includes unknown/missing balances; assets-minus-debt; avoiding holdings double-counting; per-currency reporting; posted transactions and transfer exclusion; partial coverage; integer decimal parsing; source/time context; UTC month boundaries; superseded snapshots and correction explanations; owner isolation and linked product policies; levels 0–3 blocked for import; mandatory approval under levels 4/5; rejection; read denial; full audit results; duplicate/import-key safety; database failure; concurrent imports; and recovery after a successful statement insert followed by failed receipt persistence.

The 14 browser checks cover recorded totals/partial coverage, both source statements behind “why,” transactions and explicit bills, entity/goal paths, timeline, exact decimal preview, approval source details, rejection, approved receipt, mobile overflow, reduced motion, denial clearing displayed records, no full page reload and no browser errors. Every Ary API request in that test is intercepted with fixtures. It cannot write real financial data. An initial browser run was blocked by the CLI not populating a required native date field; the test driver was corrected and the final run passed. No form validation was weakened.

The React quality review checked the lazy-loaded Finance boundary, client/server type-only imports, accessible named controls and focus states, stable record keys, request locking, unmount guards and reduced-motion behavior. No unrelated UI was refactored.

## Short manual test plan

1. Open Finance. Confirm no sources means unknown values. Use a real statement to record one balance, source reference and date; review, then reject the approval. Confirm no ledger record appears.
2. Request the same import again and approve. Refresh evidence. Confirm the source, balance, date, linked project/goal and resulting snapshot ID in Action History.
3. Import a later real statement using the same account key. Select the account and “Why did this change?” Confirm both actual sources and dates appear, with no unsupported cause attributed.
4. If a real correction is needed, use the JSON template with the earlier snapshot's ID as `parent_id`, the same balance date and corrected source values. Confirm the previous version remains historical and the explanation labels a source correction.
5. Ask Ary for financial balances, then “Why did this change?” Use the account evidence button to navigate to the supporting Finance panel. Multiple accounts require selecting the relevant account.
6. Set Finance read to no access and refresh. Confirm data disappears and a permission error is shown. Restore the intended policy. Import at level 5 must still require approval.

Use actual records in the real account. Synthetic arithmetic, failure and correction cases are already covered in isolated tests.

## Known limits and intentional boundaries

- V1 is statement/manual visibility, not live bank synchronization. JSON is normalized by the user; no PDF/CSV/OCR import or live pricing. Source content is attributed, not independently verified.
- Latest-statement transaction coverage drives current-month figures. Historical windows are not stitched together. Partial coverage is explicit; no unsupported monthly totals or financial conclusions are produced.
- Seven supported currencies; no FX, tax calculations, inferred recurring bills, market return attribution, short-position valuation or recommendations to trade.
- The source ledger insert is atomic, but the action/outcome receipt is a separate existing pipeline commit. Durable import keys make a retry recoverable; there is no claim of a distributed transaction.
- Financial source data can persist in action receipts and financial Chat answers in conversation history. The existing account's audit/history access and retention policy still applies. Import does not create semantic memories automatically.
- Payload limits: 200 transactions, 50 bills, 100 holdings and 60 KB UI import files. Reporting is bounded to 1,000 accounts but uses existing repository list semantics; large ingestion volumes need pagination and SQL-side reporting before rollout.
- Source observations and import times are distinct. A historical cutoff reflects source availability, not necessarily when Ary first ingested it.
- Existing schemas, APIs, memory/retrieval, canonical identities, temporal facts, graph/vgpu, providers, tasks/projects/goals, Economics/ROI, permissions/action contracts, voice, Calendar/Gmail and tests were preserved. No money movement, autonomous trading, brokerage execution or Kronos was added.

Recommended next milestone: validate a real statement end-to-end, then improve import coverage/reconciliation and paginated reporting before considering one read-only financial data provider. Keep Kronos deferred.

## Execution-mode completion check

The full 577-test regression suite, TypeScript, configured Prettier check and production build were rerun successfully. There is no separate lint script configured. The existing 14 fixture browser checks passed again.

An additional real end-to-end test drove the actual browser form against a disposable Next.js server with the existing LocalRepository. Rejecting the first request wrote no statement. Approval persisted exactly 100029 minor units ($1,000.29), and replaying the successful HTTP envelope retained one row. A later approved statement persisted 90029 minor units ($900.29). “Why did this change?” displayed both source references and the supported $100 difference without inferring a cause. Approval decisions, successful import actions and outcomes were present in the actual local ledger. No browser errors remained.

The test uses no API interception and no production credentials or financial records. Its test data and server are cleaned up after execution. Initial test-driver failures involved waiting for lazy rendering, matching an account button's full accessible name and waiting for the evidence panel; these were corrected in the test only. No application regression or unrelated refactor was necessary. The final verification added only the reusable test script, package command and documentation. Source arithmetic and RLS remain independently covered by the existing service and SQL tests.
