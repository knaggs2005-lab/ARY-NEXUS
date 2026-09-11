# Ary ROI accounting verification

Verified September 6, 2026.

- **145 automated tests passed** across 14 files, including 16 ROI unit/service tests and two additional PostgreSQL integration cases.
- **TypeScript, production build, and formatting passed.**
- **Migration 008 applied to the live Supabase project.** Preflight confirmed the ROI tables were absent; execution returned “Success. No rows returned.” The exact migration also ran in PGlite with the existing migrations and tenant policies.
- **Live dashboard verified:** September shows $0.033401 in estimated model compute cost, no reported actual cost, and no claimed revenue, expense savings, saved time, net contribution, or ROI multiple. It identifies 29 unlinked model calls and 3 calls with unknown pricing. This is recorded telemetry coverage, not an account balance or invoice.
- **Month navigation verified:** August has no cost or impact records, and all monetary/time totals remain unknown. September was restored and the ROI dashboard left open.
- **Evidence editor verified:** existing actions/outcomes are selectable; a new outcome assessment starts with blank financial/time values and Pending evidence. No fabricated financial assessments were written to the live workspace.

## Covered behavior

Empty data and technical success do not create financial impact. Actual cost replaces estimated cost and linked call subtotals. Explicit estimates remain estimates. Uncertain, pending, rejected, missing, and operationally pending outcomes cannot inflate confirmed totals. Revisions preserve history and replace earlier totals, including rejection and impact moved between months. Multiple outcomes share one action cost. Zero benefits, zero cost, negative contribution, partial pricing, UTC month boundaries, and potentially overlapping legacy costs are handled explicitly.

Tenant boundaries, finite nonnegative amounts, confidence/evidence requirements, append-only records, stale/concurrent revisions, and foreign action/outcome references are tested. Concurrent and nested actions retain separate telemetry context. Existing permission tests continue to reject unknown financial/email tools.

## Practical limits

- Actual model cost requires a manually entered amount and evidence reference. It is not automatically verified against billing.
- Hosting and other overhead are excluded. Unknown costs remain visible; totals and ratios describe recorded amounts rather than a complete budget.
- Uncertain benefits are separated rather than probability-weighted. Humans must attribute benefits and avoid repeating one benefit across different outcomes.
- Historical unlinked calls are not assigned to actions by guesswork. Potentially overlapping legacy manual costs are excluded and ratios withheld.
- Monthly reports use current assessment revisions, not historical period-close snapshots. The current service reads tenant history in paginated batches and aggregates in memory; database-side aggregation and UI pagination are future scaling work.
- Financial test amounts exist only in temporary test fixtures. No payment, bank, revenue, email, or other external financial integration was added.
