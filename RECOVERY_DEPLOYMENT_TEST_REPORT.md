# Recovery + Deployment Integrity

September 7, 2026 (local time; live recovery timestamps below are UTC).

**Status: DONE.** Recovery, schema repair and local release gates passed. Following explicit user approval, all **22 isolated Supabase-backed memory/Economics checks passed** on September 7, 2026. The temporary account and all 160 application fixture rows were removed; independent post-commit verification found no remaining fixtures or auth identity/session. No email was sent and no real user account was reused.

## Failed extraction: recovered

- Original job: `f6aa04d3-a138-4db6-987b-92829bca8871`; source message: `74df317d-961c-422d-bad7-a69a9a516f3e`; conversation: `974b7de1-5362-4f50-a807-c4b7ec03777e`.
- Source: “Ary, create a high priority task to finish the Wag Trails Live tracking bug fix tomorrow.”
- Initial state: failed, attempts 2, no lease, error “This record already exists”, empty saved IDs. One failed extraction, zero expired running extraction leases; the preceding audit found zero failed Reflection jobs.
- The same task-request fact already existed as memory `2615726d-1f04-47a0-a57d-694a72e0a357`, created before this job, linked to Wag Trails. It remained active with no superseding replacement. Replay could therefore add source support without reinstating an obsolete fact.
- Defect: duplicate reconciliation staged an unconditional `memory_entities` insert for an existing unique `(user_id, memory_id, entity_id)` link. LocalRepository silently tolerates duplicate links, masking PostgreSQL's rejection. Regression coverage now uses a strict batch boundary and inspects staged mutations. The historical error had been sanitized, so the original SQLSTATE/constraint name was not retained; the duplicate-link path is reproduced and the repaired path completed the original job.
- No memory tagged with the failed job and no evidence linked to its source existed before recovery. The original source and earlier fact were intact. Memory/evidence/source/version mutations share the existing atomic RPC; job claiming/failure and model telemetry are separate intended records. No partial fact/version cleanup was necessary.
- Recovery used **installed app → Memory review → Retry extraction → existing HTTP/ActionService → reconciliation → Supabase**. No direct SQL status change or bypass of permissions.
- Terminal state: **completed, attempts 3**, lease/error null, completed `2026-09-08T00:19:54.419192Z`. Empty saved IDs correctly mean no newly created memory.
- One new supporting evidence row: `e0f33e4f-ef09-41c5-8cb0-34cd043f302d`, exact quote from the original source, attached to the existing fact. Workspace memory count stayed **8**. No duplicate evidence groups; zero failed/expired extraction jobs afterward.
- Recovery action `646de99c-3a09-4b5e-b957-43d2f764811b` succeeded and has one outcome. Its immutable input retains the job/source IDs, previous error, previous status and previous attempt count. The old job and original conversation were not deleted.

## Economics migration and real telemetry

Existing migration **202609070011_roi_economics.sql** was applied unchanged and rerun successfully. Preflight cost-ledger rows: **0**; postflight rows: **0**. No existing cost evidence was rewritten.

| Column                      | PostgreSQL type  | Nullable | Default         | Constraint     |
| --------------------------- | ---------------- | -------- | --------------- | -------------- |
| additional_compute_cost_usd | double precision | YES      | none / SQL NULL | 0 through 1e12 |
| tool_cost_usd               | double precision | YES      | none / SQL NULL | 0 through 1e12 |

Both columns match the current Zod/domain/service/UI contract. Constraints, grants and immutable-ledger triggers match the migration-generated catalog. Existing SQL tests cover populated rows, nullable inputs, bounds, revisions and reruns. **Populated live Supabase write/read/revision and duplicate-rejection checks passed in the isolated test account; all synthetic ledger rows were subsequently removed.**

Real production recovery telemetry was successfully written/read:

| Operation / model              | Input / output tokens | Model latency | Estimated USD |
| ------------------------------ | --------------------- | ------------- | ------------- |
| embed / text-embedding-3-large | 19 / 0                | 1,573 ms      | 0.00000247    |
| extract / gpt-5.6-sol          | 976 / 195             | 6,860 ms      | 0.007804      |

Both calls succeeded with timestamps and the same recovery action ID; the action has an outcome. These are token-priced estimates, not billed actuals. Total estimated model cost: **$0.00780647**. This is extraction recovery latency, not an average chat response benchmark. No revenue, expenses avoided or time savings were invented.

## Migration integrity

- Audited all original 12 migration files; no duplicate local versions.
- Live `supabase_migrations.schema_migrations` was absent: prior installation used SQL Editor without CLI history. Missing history did not imply all migrations were missing.
- Executed the actual migrations in disposable PGlite, then compared **28 tables + 22 functions** with the live database: columns/defaults/nullability, constraints, valid indexes, triggers, RLS, policies, effective anon/authenticated grants and normalized function definitions/execute grants.
- Normalized PostgreSQL 18 vs 17 NOT NULL catalog representation, search-path qualification, constraint collation, whitespace and line comments. This is a catalog comparison, not formal semantic equivalence or a full backup/restore certification.
- Real drift beyond 011: Supabase default table grants left UPDATE/DELETE on `model_calls` and DELETE on `reflection_jobs`/`reflection_proposals`. These threaten telemetry/review history. Added **013_audit_grants.sql** to revoke only those unintended grants; applied/reran successfully. Intended INSERT/SELECT and reviewed Reflection UPDATE remain available.
- After repair: **50/50 expected objects match, no unexpected public objects**. Application tables/functions were neither replaced nor redesigned.
- Adopted all **13 versions exactly once** into a protected migration-history table only after a guarded parity check. Rows explicitly say “verified manual baseline” with source SHA-256; no original execution dates were fabricated. History has RLS and no anon/authenticated table access. See `supabase/deployment-baseline.json`.
- `npm run migrations:audit` regenerates read-only comparison SQL, expected manifest and a guarded optional adoption script in `/tmp`. It never connects to production or applies SQL. It also checks adoption/rerun and refuses a deliberately missing index in disposable PGlite.

## Validation

| Gate                                                                          | Result                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Full automated suite                                                          | **580 passed / 42 files**                                                                           |
| New duplicate-link tests                                                      | 2 passed; existing/staged links and replay                                                          |
| SQL regression suite                                                          | 24 passed, including Supabase default grants and rerunnable 013                                     |
| TypeScript                                                                    | Passed                                                                                              |
| Configured formatting                                                         | Passed; no separate lint script configured                                                          |
| Production build                                                              | Passed; home/not-found static, catch-all API dynamic                                                |
| Realistic installed-app E2E                                                   | Passed: authenticated failed-job retry, completed UI, Supabase evidence/action/outcome verification |
| Supabase migration verification                                               | Passed: 011/013 reruns, exact columns, 50-object parity, 13 history versions                        |
| Supabase duplicate recovery / supporting source                               | Passed on the real failed job, no new facts                                                         |
| Controlled launch-priority correction / historical / paraphrase / replay flow | **Passed in the isolated Supabase account**                                                         |
| Live Economics optional-cost write/read/revision/duplicate flow               | **Passed in the isolated Supabase account**                                                         |

Local gate logs: `/tmp/ary-recovery-{tests,typecheck,format,build}.log`; SQL test log `/tmp/ary-recovery-database-tests.log`.

The post-build typecheck initially encountered the previously documented generated-file duplication: `.next/types/cache-life.d 2.ts`, `root-params.d 2.ts`, and `validator 2.ts`. All three were verified byte-identical to their canonical generated files and moved to `/tmp/ary-generated-type-copies-m0LiBX`. Source types/configuration were not changed; typecheck was rerun. The external cause of those duplicate generated files remains unproven.

## Exact files changed

| File                                              | Reason                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| src/services/memory-reconciliation-service.ts     | Deduplicate existing and staged entity links without changing reconciliation interfaces          |
| src/server/http.ts                                | Preserve prior failed-job metadata in the existing retry action audit                            |
| tests/knowledge.test.ts                           | Prevent the local adapter's duplicate tolerance from hiding PostgreSQL failures                  |
| tests/database.test.ts                            | Simulate Supabase default grants; verify restricted audit mutations and rerunnable 013           |
| supabase/migrations/202609070013_audit_grants.sql | Remove unintended telemetry/reflection history mutation privileges                               |
| scripts/audit-migrations.ts                       | Generate credential-free catalog comparison, manifest and guarded manual baseline adoption       |
| scripts/evaluate-supabase-integrity.ts            | Executed real HTTP/RLS/provider acceptance flow with an explicit empty disposable-identity guard |
| supabase/deployment-baseline.json                 | Retain verified migration versions and source hashes                                             |
| package.json                                      | Add migration-audit and live-integrity commands                                                  |
| README.md                                         | Operational deployment/retry/test instructions                                                   |
| ARY_NEXUS_ROADMAP.md                              | Mark verified recovery DONE and advance NEXT 3 without starting further work                     |
| RECOVERY_DEPLOYMENT_TEST_REPORT.md                | This evidence report                                                                             |

## Isolated live acceptance and cleanup

`npm run test:supabase-integrity` completed successfully against the running application's authenticated HTTP API, existing services and real Supabase RLS storage. Reasoning/extraction used the configured OpenAI provider; embeddings used `text-embedding-3-large`. No stub substituted for these calls.

The user explicitly authorized the disposable account `47d44235-bf2b-4aa7-af45-898609fc82e5`. It was created with auto-confirm (no invitation or confirmation email), validated as an empty workspace, and used only for these tests. Credentials were transient environment inputs and are not stored in repository files or this report.

| Live check                   | Result                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Real conversation extraction | Passed: launch-priority fact persisted                                                                                          |
| Provider/model metadata      | Passed: real OpenAI response metadata                                                                                           |
| Original source and evidence | Passed: source message and supporting evidence retained                                                                         |
| Entity link                  | Passed: fact linked to the isolated Ary Nexus project                                                                           |
| Unresolved contradiction     | Passed: candidate disputed and pending review; original remained active                                                         |
| Reviewed supersession        | Passed: approved replacement active, original superseded                                                                        |
| Paraphrased recall           | Passed: “What should we connect first before shipping Ary Nexus?” retrieved current Calendar fact, excluded obsolete voice fact |
| Source/version history       | Passed: original source, evidence and versions retained                                                                         |
| Historical knowledge         | Passed: pre-correction timeline retained original fact                                                                          |
| Duplicate assertion          | Passed: added evidence without adding another fact                                                                              |
| Completed-job replay         | Passed: no new memory/evidence or attempt increment                                                                             |
| Grounded response            | Passed: response identified Calendar with current retrieved fact                                                                |
| Model telemetry              | Passed: persisted token usage, latency and estimated cost                                                                       |
| Embedding telemetry          | Passed: real production embedding call recorded                                                                                 |
| Action/outcome linkage       | Passed: model calls associated with existing action/outcome records                                                             |
| Economics columns            | Passed: additional compute/tool costs written and read                                                                          |
| Duplicate cost root          | Passed: HTTP 409, no overcounting                                                                                               |
| Cost revision retry          | Passed: HTTP 409, only one revision persisted                                                                                   |
| Missing optional costs       | Passed: null remained unknown, not zero                                                                                         |
| Economics revision/history   | Passed: current revision selected and original retained                                                                         |
| Unsupported financial impact | Passed: no revenue, savings or time-saved outcome invented                                                                      |
| Extraction completion        | Passed: four jobs completed, one attempt each, no failed jobs                                                                   |

Before cleanup, SQL independently confirmed two facts (one superseded, one active), two sources, four evidence rows, four versions, three synthetic cost-ledger rows and 19 real model-call records. The synthetic cost inputs were explicitly test fixtures, not claims about real operating expense.

Measured sample: **10,691 ms average complete conversation HTTP stream**, **2,293 ms mean reasoning-call latency**, **19 total model calls**, **$0.03168724 total estimated model cost**. These are a small validation sample, not first-token latency, an SLA or billed actuals. Real provider usage remains billable after test rows are removed.

Cleanup was locally exercised against the same migrations before execution. The live transaction checked the exact approved identity and terminal jobs, removed only its fixture data, and compared all non-test rows before/after by per-table JSON checksum. Its private temporary snapshot was dropped on commit. The immutable cost-ledger delete guard was temporarily disabled under an exclusive table lock within that transaction, then restored before commit; no lasting schema or grant change was made.

- **160 fixture rows removed across 27 user-owned tables**, plus the disposable public user profile.
- **Non-test records unchanged**, verified by checksums in the cleanup transaction.
- Supabase Auth account deleted afterward through the dashboard; test session had already signed out.
- Independent post-commit checks: **zero test rows in all 27 tables; zero public user, auth user, auth identity, auth session and refresh token**.
- Cost-ledger guard enabled; model-call UPDATE/DELETE grants still revoked; both nullable cost columns and all 13 migration-history versions still present.
- Working owner retained **8 memories**, original recovery job remained completed, and failed extraction count remained zero.

Aggregate evaluator evidence: `/tmp/ary-supabase-integrity-results.json`; run log: `/tmp/ary-supabase-integrity.log`. This report preserves the results because fixture records and the temporary login were intentionally deleted. No production code, provider configuration, UI or migration was changed during this final acceptance/cleanup pass; only this report and the roadmap were updated.

## Remaining risks and next steps

1. Background jobs still rely on the running application, existing leases and explicit retry; there is no independent worker. Concurrent stale commits can safely fail and need retry; the fix does not promise exactly-once LLM calls.
2. Model extraction/conflict detection remains probabilistic and corrections remain reviewed. The small live sample passed; it is not exhaustive relevance/contradiction coverage. No automatic fact rewriting was introduced.
3. The existing repository is an untracked local source tree; this milestone does not claim a clean Git index or a source-code deployment to GitHub. No broad commit, reset or unrelated cleanup occurred.
4. No destructive rollback was required for the additive columns. No full database backup restoration was tested. Preserve columns and roll application code back if needed; do not drop evidence or re-grant unsafe audit mutations.
5. Source code was unchanged during final acceptance. The September 7 release gates above remain applicable: 580 tests, typecheck, configured formatting and production build passed. The two updated Markdown documents received a fresh formatting check.

**NEXT 3:** live Voice verification; Calendar connection/verification; Gmail live acceptance and retention policy. No next milestone was started.
