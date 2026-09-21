# Level 2: bounded local documentation release

## Boundary and current evidence

This is an opt-in **local release pilot**, not general autonomous self-modification.
The existing Brain, supervised development run, MissionEngine, ToolRegistry,
permissions, exact approvals, canonical messages/actions/outcomes, sandbox runner
and independent reviewer remain authoritative. Planning, workspace creation, patch
execution, tests and review retain their supervised approval gates. Level 2 adds
conditional automatic publication of an already-reviewed candidate to a private Git
ref. It never merges main, pushes, deploys, starts services, or changes a live checkout.

The owner reports physical supervised acceptance. The inspected checkout at
`f76b4fb` still contains the earlier blocked-acceptance state, with no committed
successful-run evidence. That report is not converted into invented outcome IDs.
Three distinct completed, accepted documentation runs with owner-qualified successful
outcomes are required before any real candidate can qualify. No class was enabled
in a real account during this implementation.

## What qualifies

Only corrections to existing, nonempty ordinary `docs/*.md` files (including
subdirectories), at most two changed files and 8 KiB of diff. New/deleted files,
mode changes, renames, copies, binary changes, code fences, HTML and newly added
HTTP links escalate. The existing protected-path policy is supplemented with strict
documentation allowlisting and exclusion of sensitive documentation names.

Tests, diagnostics, UI changes and refactors are **not yet automatically eligible**.
Dependencies, migrations, permissions/authentication, secrets, memory/provenance,
audit, Brain/prompts, autonomous scope, payments/finance, calling/messaging, external
integrations, deployments, devices and destructive operations are excluded. The
Level 2 implementation itself is forbidden to the development patch tool.

All gates must pass:

- Undecided release candidate and complete observation/plan/patch/mission evidence.
- Exact plan, patch, release-manifest and current workspace hash agreement.
- Full suite, focused suite, typecheck, formatting and production build all pass;
  no missing/duplicate command receipts, timeout, signal or truncated output.
- Isolated Test Ary receipt separate from the patch action; patch-author agents
  cannot act as Test Ary. Existing independent review must use a real provider,
  separate action/context, and pass every security category. Unknown escalates.
- Three distinct owner-qualified completed documentation outcomes. Qualification
  is an owner-only, always-approved canonical action and references a successful
  outcome belonging to the original run. Qualification is the owner's attestation
  that the accepted change was actually released and observed healthy; acceptance
  of a plan alone is insufficient evidence for this attestation.
- Complete evidence-backed ROI cost entries (confidence 1, all cost fields known)
  for every historical action in the candidate. Unknown is not zero.
- Fixed budgets, no current/uncertain reservation, no previous attempt for this run.

## Budgets and recovery

- One concurrent development workspace through the existing repository reservation;
  one active local release through the canonical ledger compare-and-swap.
- One attempted change per UTC day; failed attempts count.
- At most $1 in accounted candidate model/compute/tool costs per release day.
  This does not introduce an autonomous model-spending loop: upstream development
  is still supervised; publication itself makes no model/network call.
- Zero automatic retries, including after interruption or restart.
- 48-hour cooldown after a stopped/rolled-back release.
- Discovery: at most one proposal per 24 hours, never the same observation twice.
- Ledger capped at 512 entries; reaching capacity requires owner maintenance.

The ledger is stored in existing owner-scoped `messages.metadata`, not a new table
or second memory system. A reservation commits before the Git effect. A crash after
reservation or publication blocks retry; filesystem operation receipts plus the
canonical action/ledger must be reconciled by the owner. No automatic stealing of
locks, retry of uncertain effects, pruning, resets or cleanup.

Local publication uses structured `execFile` Git plumbing, a private index and
fixed args, hooks disabled, no shell or inherited credentials. It creates a commit
from the approved base and changed documentation only, then compare-and-swaps:

`refs/ary/releases/<run UUID>`: absent → candidate commit

The existing worktree branch and user's index/files/main remain untouched. Health
checks verify the actual published ref/tree and that the candidate has not drifted.
Because nothing was deployed, these are **Git artifact health checks**, not claims
about production application health.

If deterministic verification returns unhealthy, only this private ref may move
from the exact candidate commit to the recorded base commit using compare-and-swap.
If another writer moved it, inspection fails, cancellation occurs, or the state is
uncertain, stop and report the failure in Activity. Never reset user files or assume
external effects are reversible. Objects and receipts remain available for review.

## Controls

Defaults in `.env.example`:

```dotenv
ARY_SELF_DEVELOPMENT_ENABLED=false
ARY_DEVELOPMENT_LEVEL2_ENABLED=false
```

Keep Level 2 false until the acceptance procedure below passes. Enable it only in
the owner-local native runtime by explicitly setting the second flag true and
restarting that runtime. Existing Mac/Desktop Bridge/Supabase/native-session checks
still apply. The flag grants **no tool permission**.

Existing ToolRegistry additions:

| Tool                           | Authority / purpose                                               |
| ------------------------------ | ----------------------------------------------------------------- |
| `development.autonomy_inspect` | Read exact candidate eligibility and reasons                      |
| `development.autonomy_metrics` | Read counts, qualifications and release receipts                  |
| `development.qualify`          | Owner-only exact approval of a historical outcome                 |
| `development.autorelease`      | Default level 4; release hash required; all policy gates checked  |
| `development.discover`         | Draft-level proposal from an existing evidence-backed observation |

Only after acceptance, an owner may explicitly grant level 5 to
`development.autorelease` using existing Permissions. Do not change any other
permission, and do not grant a blanket `development.*` allowance. Other supervised
capabilities retain their mandatory approvals. Default level 4 requires approval on
each release request. A denied policy returns `OWNER_REVIEW` with every failed gate;
it does not fall back to a manual merge or grant authority.

Disable by revoking that narrow grant and setting `ARY_DEVELOPMENT_LEVEL2_ENABLED=false`
and restarting. Existing **Emergency stop / STOP CONTROL** blocks future canonical
actions and aborts active action signals; the release executor checks the signal
before each Git command. Interrupted publication requires owner reconciliation;
STOP does not mean a ref mutation was undone.

The existing Skills/Automations system can periodically submit
`development.discover` with an existing evidence-backed `run_id`. This promotes only
an OBSERVATION to a PROPOSAL, retains evidence, and cannot approve/build/patch/release.
No timer or automation is installed automatically, no repository surveillance is
added, and discovery does not create its own input observations or recurse from a
release. Scope planning remains an explicit subsequent step.

## Metrics and evidence

`development.autonomy_metrics` reports proposals, runs with scope approval,
rejections, healthy local releases, confirmed ref rollbacks, failed validations,
qualified outcomes and each release attempt's action/time/ref/commit/base/status.
Regressions, time saved and outcome improvement remain null until independently
measured; Git health failure is not fabricated business impact. Existing ActionService
records the request, permission decision, result/failure and outcome. Local Git
receipts preserve uncertain intermediate execution. No canonical memory is rewritten.

## Acceptance procedure

1. Run `npm test -- tests/development-autonomy.test.ts tests/self-development.test.ts`,
   then `npm test`, `npm run typecheck`, `npm run format:check`, and `npm run build`.
   Fixture histories/reviewers in tests are not physical acceptance evidence.
2. Resolve any existing repository/snapshot/formatting blockers without weakening
   checks. This checkout's known `[...path]` and `vault.ts` snapshot restrictions
   were not silently changed by Level 2, and unrelated formatting warnings persist.
3. In the native app, inspect three real completed and accepted documentation runs.
   Verify their actual release and healthy outcome evidence. Submit
   `development.qualify` with `{run_id,outcome_id}` for each, and personally approve
   each exact request. Do not seed fixture evidence into a live account.
4. Create one ordinary documentation correction through the existing supervised
   pipeline. Obtain real full validation, independent reviewer and release manifest.
   Record complete cost evidence through existing ROI accounting.
5. With Level 2 disabled, `development.autonomy_inspect` must say `OWNER_REVIEW`.
   After all acceptance prerequisites pass, opt into the local flag and restart.
   Confirm every gate passes for the candidate; a protected/ambiguous candidate must
   still fail. Keep default level 4 for the first physical local publication.
6. Submit `development.autorelease` with `{run_id,release_hash}` through existing
   Actions. Inspect and approve that exact request. Check returned commit/ref/base,
   Activity/action/outcome, Git receipt, unchanged main/index and health checks.
7. Retry the same run: no second publication. Exercise STOP, concurrent requests,
   missing costs/history, stale candidate and unhealthy-ref cases in disposable
   repositories only. Never test destructive failure scenarios on user work.
8. Only then consider the narrow level-5 tool grant. Do not enable deployments,
   automatic main merges or general autonomous development. Owner release intent in
   Engineering remains separate and cannot silently merge this local artifact.

Production health orchestration, automatic main merges, autonomous implementation,
new eligible classes and measured improvement loops are intentionally not enabled.

## Implementation validation — September 21, 2026

- 70 new Level 2 tests passed, including real disposable Git publication, deterministic
  ref rollback, collision protection, interrupted receipts, canonical approval/audit/
  outcome flow, concurrent reservations, revoked outcome evidence and proposal-only
  discovery. Existing 43 supervised-development tests also passed in the full suite.
- Full suite: **1,846 tests / 110 files passed** (57.01 seconds).
- Production build and standalone TypeScript: passed.
- Changed source/test formatting: passed. Repository-wide formatting: failed on the
  same four prior warnings (`calls-panel.tsx`, existing portion of `permissions.ts`,
  `twilio-phone.ts`, `phone-service.ts`). No unrelated formatting was changed.
- No network/model call, live release, main merge, push, deployment, credential change,
  runtime Level 2 enablement or permission grant occurred during validation.
- The end-to-end local action tests use isolated fixture history/reviewer evidence;
  the Git publication/rollback tests use actual temporary Git repositories. These
  do not establish live owner qualification or production readiness.

Implementation files: `src/domain/development-autonomy.ts`,
`src/services/development-autonomy-service.ts`, existing development domain/service,
workspace, tool registration, permission capability definitions and server composition;
`.env.example`; `tests/development-autonomy.test.ts`; this document, the supervised
architecture document and canonical roadmap. No dependency, database or voice change.
