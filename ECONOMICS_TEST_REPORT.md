# Ary Economics — ROI extension

Date: 2026-09-07.

## Audit and preserved infrastructure

The repository already had `RoiService`, pure `calculateRoi` calculations, immutable cost/outcome evidence ledgers, revision chains, tenant isolation, permission-gated ROI APIs, action-scoped model telemetry, and an ROI editor/history screen. This milestone extends those components in place. No new accounting store, action pipeline, provider, external integration, or money execution was added.

Existing null/zero semantics, outcome evidence requirements, UTC month attribution, actual-model-cost override, uncertain-attribution exclusion, and revision history remain in force. Financial examples in tests are isolated fixtures; none were seeded into the live database.

## Exact files

| File                                                 | Change and reason                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/roi.ts`                                  | Optional additional compute/tool cost fields, additive cost breakdown, action/replay counts, attribution quality, original operational outcome status, and withholding of net/ROI when model costs are incomplete. Keeps the existing model estimate override meaning. |
| `src/services/roi-service.ts`                        | Six monthly trend points from the existing tenant records and calculation rules, without extra database reads for each month. Bounds historical trend keys to supported four-digit years.                                                                              |
| `src/components/economics/economics-overview.tsx`    | Reusable metric, contribution chart, cost composition, attribution summary, and accessible monthly table. Exact values appear immediately; restrained transitions communicate changes.                                                                                 |
| `src/components/roi-dashboard.tsx`                   | Extends the existing screen/editor/history with the overview, new optional cost inputs, outcome status and category details, and in-place refresh. Aborted or denied loads cannot expose stale reports.                                                                |
| `src/components/roi.module.css`                      | Scoped dark glass, subtle mesh, chart styling, responsive layout, tabular figures, and reduced-motion support.                                                                                                                                                         |
| `src/components/dashboard.tsx`                       | Renames the existing ROI screen title to Ary Economics; existing navigation interface remains.                                                                                                                                                                         |
| `supabase/migrations/202609070011_roi_economics.sql` | Adds two nullable amount columns to the existing cost ledger; rerunnable; retains immutable triggers, owner constraints, RLS, and existing rows.                                                                                                                       |
| `tests/roi.test.ts`                                  | Extends original accounting tests for additional cost categories, overrides, incomplete costs, attribution quality, revisions/trends, counts, invalid values, and historical date boundaries.                                                                          |
| `tests/roi-http.test.ts`                             | Verifies existing authentication, permission gates, and recording through the action/outcome pipeline.                                                                                                                                                                 |
| `tests/database.test.ts`                             | Runs the additive migration twice and verifies constraints, tenant isolation, and append-only protection.                                                                                                                                                              |
| `scripts/evaluate-economics.ts`                      | Isolated browser verification using real RoiService calculations and intercepted API fixtures.                                                                                                                                                                         |
| `package.json`                                       | Adds `npm run test:economics`; no dependency changes.                                                                                                                                                                                                                  |
| `README.md`                                          | Documents the extension, formulas, migration, compatibility, coverage, evidence, and limitations.                                                                                                                                                                      |
| `ECONOMICS_TEST_REPORT.md`                           | This audit, verification record, and deployment status.                                                                                                                                                                                                                |

## Verification

- Full test suite: **473 passed across 35 files**.
- Typecheck: **passed**.
- Production build: **passed**.
- Repository formatting check: **passed**.
- Browser: **13 checks passed**, including separate costs, confirmed benefit formulas, unmonetized time, unknown-month gaps, attribution/status, refresh without reload, metric transitions, reduced motion, incomplete-cost suppression, 390px layout, permission-denied refresh, no financial writes, and no browser errors.
- Migration: applied twice to isolated PostgreSQL-compatible PGlite; owner checks, immutable history, and nonnegative cost constraints passed.
- Browser screenshot: `/tmp/ary-economics-dashboard.png` (test data only).

A final typecheck initially encountered four byte-identical `* 2.ts` copies inside generated `.next/types`. Only those generated duplicates were moved to a temporary backup; source code and compiler configuration were unchanged.

## Live deployment status

**Migration 011 is not yet applied to the user's Supabase project.** The Mac is locked, so the signed-in dashboard is unavailable, and no direct database connection is configured. Existing reports and legacy cost payloads remain compatible; separate compute/tool recording requires this migration. This is a live-deployment limitation, not a claim that the production database has been verified.

## Manual test plan

1. Apply migration 011 after the existing migrations. Open ROI → Ary Economics for the desired month.
2. With no supported outcome evidence, confirm revenue/savings/time remain unrecorded and no ROI is fabricated.
3. Select a real action and record only evidenced cost amounts. Keep overlapping model, compute, and tool charges out of multiple categories. Inspect the category totals and immutable history.
4. Select an existing non-pending outcome. Record an estimated attribution with notes and confidence; verify it appears under uncertain attribution and is excluded from headline benefits.
5. Only with supporting evidence, append confirmed attribution. Verify financial benefit and time remain separate. Net/ROI must remain withheld if model costs are incomplete.
6. Append a cost revision. Refresh the same month and verify exact values update without page reload, previous evidence remains visible, and changed metrics receive only a brief transition.
7. Compare months and the accessible chart table. Empty months show unknown values, not invented zeros. Enable reduced motion and confirm transitions stop.
8. Verify a user without ROI read/record permission cannot bypass the existing gates.

## Known limitations

All amounts are USD. Attribution confidence is a human claim, not independently verified causation. Actual model amounts are manually evidenced; additional compute/tool amounts require explicit attribution. Unknown overhead is not estimated, and recorded totals are not complete profit or a financial forecast. The conservative model-cost completeness rule also covers audited read actions; explicitly record known zero where evidence supports it rather than assuming free execution.

Reports still read tenant history through the existing repository and aggregate in memory. Large audit volumes need database aggregation and paginated history before scale-up. Invoice reconciliation, currency conversion, causal deduplication across outcomes, and closed accounting periods remain out of scope.

Memory, retrieval, temporal facts, entities, graph/vgpu, voice, board meetings, priorities, tasks/projects, model providers, permissions, approvals, action/outcome execution, and unrelated screens were intentionally untouched.

Recommended next milestone: database-side monthly aggregation and evidence-coverage review, preserving these formulas and ledger interfaces. No financial execution is needed.
