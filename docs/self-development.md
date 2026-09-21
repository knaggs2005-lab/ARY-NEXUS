# Supervised Ary self-development — architecture audit

Status: **Phase 1 implemented as a default-disabled, supervised single-host pilot.**
Implementation September 20, 2026, on `codex/supervised-self-development-v1`.
The original audit below was against `0f723740335be03e4f13555a7cfe2f791abbe44f`.
This implementation section supersedes the proposed filenames and design-only
status in that historical audit. No database migration, dependency, Brain, voice,
GPT-Live, transport, provider configuration or deployment change was made.

## Owner Engineering surface — September 20, 2026

The native dashboard now exposes **System → Engineering**. The standalone route is
`/engineering` (canonical local URL `http://127.0.0.1:3000/engineering`). It reuses
NexusSurface/NexusState, existing design tokens, ApprovalDialog, EmergencyControl,
the authenticated `api` client and the existing action/mission infrastructure.
No voice behavior, dependencies, database schema or other screens were redesigned.

The surface includes the eight-stage pipeline; recent run selection; evidence and
proposal; plan scope/protected files/acceptance; branch/worktree/base SHA; actual
changed-file/diff inspection; durable commands and results; security review; action
and approval receipts; release package/rollback; and owner decision. Estimates not
present in the run are explicitly “Not recorded.” Displayed model cost is the recorded
review cost only, not a fabricated whole-run total. No implementation commit SHA is
invented: the current backend creates an uncommitted worktree candidate.

`POST /api/engineering` provides the owner-scoped projection, bounded to 50 recent
runs and 100 related actions per run. Evidence snapshots/release packages and local
workspace diagnostics are expanded only for the selected run. Patch bodies are not
sent. Three-second visible-page polling reads durable state, not invented activity.
Source/progress content is rendered as escaped text and credential-looking strings
are redacted. Workspace policy violations retain the existing mission pause behavior.
This endpoint retains **native launcher authorization**, the existing development
inspect permission, user authentication and same-origin POST checks. GET is not an
alternate native-authorization bypass. No secret or permission configuration changed.

Owner controls use the existing keyed action request API. Plan scope approval selects
the existing build or protected-build capability. `development.feedback` is the only
new mutating capability: exact owner revision and mandatory approval are required;
it records rejection/revision evidence and cancels/pauses an existing mission.
Revision feedback cannot rewrite approved scope; revised scope requires a new bounded
plan/run. STOP run uses existing mission cancellation; STOP CONTROL retains the
existing global emergency stop. Cancellation is cooperative, not a promise of rollback.

Pending step review uses ApprovalDialog to record approval **only**. It never dispatches
`development.workspace`/implementation/test directly from the UI without a mission
lease. Prepare/start/resume/advance buttons operate the existing MissionEngine through
`mission.control` and `mission.tick`; every step keeps its exact approval requirement.
Owner release acceptance records intent only. The separate “Submit recorded decision
to mission” action submits the existing `owner_decision` event; later checkpoint/finalize
approval is still required. Nothing merges, pushes or deploys.

### Physical owner acceptance

1. Use `codex/supervised-self-development-v1` in
   `/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus-self-development`.
   The currently installed app may still point at another checkout; this task does not
   replace it. This checkout must use your existing secure server environment and owner
   configuration. Never paste keys into source or chat.
2. Ensure the existing `ARY_SELF_DEVELOPMENT_ENABLED=true`, desktop-bridge enablement,
   Supabase authentication and `ARY_DESKTOP_USER_ID` owner configuration are present.
   This pass does not enable them or copy credentials. Quit the other Ary launcher
   before starting this checkout so its launcher can own port 3000.
3. Run `npm run desktop` from this checkout. Sign in as the configured owner. Open
   **System → Engineering**. The equivalent local route is `/engineering`; live
   controls require the native session, not an ordinary browser tab.
4. Select an existing evidence-backed run. Check proposal/evidence and allowed files;
   choose **Approve plan scope** and inspect the existing one-time approval dialog.
   Use Prepare/Advance/Start as the mission state requires. Review pending steps,
   then Resume/Advance; never manually execute a lease-bound step outside its mission.
   No demo runs are created. If empty, first create a bounded proposal using the existing
   development tools. This screen reviews runs; it does not invent or author patches.
5. Verify command receipts, test results and the diff; try Request revision or STOP
   on a disposable approved run. For a release candidate, provide a decision reason,
   approve or reject its release intent, then submit the recorded decision. Confirm
   main remains unchanged. A scope warning must show NOT READY and disable acceptance.

### Automated acceptance and limits

Validation: 51 focused tests (43 self-development + 8 HTTP), 1,776 full-suite tests
across 109 files; typecheck and production build passed. Browser contract acceptance
passed with no page errors. The same four pre-existing formatting warnings remain;
no unrelated formatting repairs were made.

Run `npx vitest run tests/self-development.test.ts tests/http.test.ts` for backend
and authorization coverage. Run `npm run build` then
`node --import tsx scripts/evaluate-engineering.ts` for browser acceptance. The latter
starts an isolated compiled UI server on port 4327, intercepts API calls with fixtures,
and shuts it down afterward. It covers plan approval/rejection, revision pause, native
POST contract, lease-safe pending approval, mission controls/stop, test/diff/security
inspection, scope warning, release accept/reject and decision submission, empty/disabled/
error states, responsive layout/reduced motion and browser errors. No fixture enters
production and no model/provider/development command is called by this browser script.
The real native owner/provider flow is **not claimed as physically accepted** here.

No new run-creation editor, automatic background mission runner, automatic patch author,
new event bus or merge implementation was added. Workspace existence, command receipts
and costs are shown only when recorded; refresh failures remain visible. Unknown costs,
estimates and runtime details are not inferred. Existing roadmap milestones remain intact.

## Workspace execution hardening — September 20, 2026

Extends the existing Phase 1 implementation on the same feature branch; no parallel
executor, permissions store, database migration or new dependency. The prior code
already supplied real Git worktrees, immutable patch application, five sandboxed
checks, repository reservation, and canonical action/mission integration.

This pass adds:

- A durable ownership manifest binding run, owner, repository/common Git directory,
  plan hash, creating action and creation time. Every file operation verifies the
  exact `ary/dev/<run-id>` branch and owned real worktree path; main, foreign
  worktrees, parent symlinks and hardlinks fail closed.
- Actual Git changed-file discovery (including untracked/ignored files) rather than
  treating the proposal list as execution evidence. New-file diffs use disk contents.
  Out-of-scope, dependency/authority and unapproved protected/migration changes stop
  execution. Policy failures request pause through the existing durable MissionEngine
  control path. Pause never silently expands approved scope.
- A 96,000-character diff budget and potential-secret rejection before review/model
  context. Git failures omit raw process output. Existing source and patch limits remain.
- Durable per-command started/result receipts, linked to action operation and candidate,
  with relative cwd, fixed timeout and network policy. Native receipts distinguish
  cancellation, timeout, output-limit termination and ordinary exit. A process crash
  leaves an uncertain started receipt, never an automatic retry.
- `development.cleanup`, a mandatory-approval capability usable only after a completed
  mission and owner completion/rejection. It runs non-forced `git worktree remove`
  only when no tracked, untracked or ignored work remains. Branches, validation
  snapshots, ownership and evidence journals are retained. Dirty work is never reset,
  stashed, committed or deleted to make cleanup possible. A refused/uncertain cleanup
  requires manual inspection; there is no automatic cleanup retry.

### Command policy

No caller-supplied executable, shell, cwd, script body, timeout, network exception or
Git argument array is exposed. The five existing profiles invoke installed CLIs:
`test` (Vitest), `focused` (validated `tests/*.test.ts[x]` paths), `typecheck` (tsc),
`format` (Prettier check, not rewrite), and `build` (Next webpack). These implement
approved existing project script semantics without npm lifecycle hooks. There is no
lint script configured. Other scripts (including live provider diagnostics), package
installation, dependency edits and arbitrary `npm run` remain unavailable. Adding a
profile requires reviewed host code, not a model argument.

Commands run in fresh isolated copies, never in main or the writable candidate.
macOS deny-default sandbox remains mandatory: no network, credentials, writable
installed dependencies or host data access. Fixed ceilings are five minutes for test/build, two minutes for typecheck and one
minute for focused tests/format, with a
2-MiB output kill budget, 512-KiB retained output ceiling, cancellation and exit
status. Git operations remain private fixed callsites plus a verb allowlist, shell
false, 15-second limit and bounded output; no merge/push/reset/clean/force verb.
Git itself runs against the trusted local repository, not an arbitrary remote repo.

All runs for one configured repository root are serialized, including disjoint scopes.
This conservative overlap policy is intentional. Dependency and core-authorization
changes are denied even with ADMIN; migration and other protected proposals require
existing `build_protected` approval. Elevated review is not an automatic grant of
package installation, migration execution, deployment or weakened permissions.

### Verification for this pass

40 focused self-development tests; 1,772 full-suite tests across 109 files. Production
build and TypeScript pass. Formatting retains the same four pre-existing warnings:
`src/components/calls/calls-panel.tsx`, the pre-existing phone block in
`src/domain/permissions.ts`, `src/infrastructure/phone/twilio-phone.ts`, and
`src/services/phone-service.ts`. New/changed development files are formatted.
Generated duplicate `.next` type artifacts encountered on the first check were
preserved outside the repository and regenerated; no source typing workaround.

Added adversarial coverage: branch/main substitution, parent symlink escape, forged
ownership, dirty/unknown-file cleanup, completion/approval/replay, dependency and
migration changes, oversized/secret diffs, actual new-file evidence, per-command
receipts, injection/chaining/traversal, durable scope-drift pause, credential filenames,
and cancellation of a real running sandbox process. Prior restart/overlap/protected
path/permission and lifecycle tests remain intact. No production effects exercised.

### Remaining boundaries

This is a supervised, trusted-owner, single-host pilot, not a hostile multi-user VM.
A malicious same-user process can race filesystem checks; OS sandboxing covers development
commands, not a compromised host or tampered trusted Git configuration. Secret filters
are conservative pattern checks, not exhaustive DLP. Credentials must never be committed
to source. No network-enabled command profile, arbitrary repository-script execution,
automated uncertain-operation repair, dependency-changing build or automatic push exists.
Full lifecycle acceptance uses fixture reviewer/command providers; real sandbox probes
exercise OS containment, fixed Vitest execution and running cancellation. No claim of
live autonomous source generation or release is made.

## Phase 1 implementation

### Reused authority and persistence

`SelfDevelopmentService` is a domain adapter, not an execution engine. Its bounded
run artifact lives in the owner's existing `messages.metadata.self_development_v1`.
The existing `CheckpointMissionEngine` owns scheduling, leases, waits, cancellation,
restart and step state. Existing `ToolRegistry`, `ActionRequestService`,
`ActionService` and `PermissionService` own validation, exact approvals, execution
keys, action/outcome receipts and event emission. Existing AgentRuntime profiles can
be explicitly granted engineering inspect/proposal/plan/patch capabilities, never
owner build/merge-decision capabilities. No new assistants or memories are created.
Hermes remains an optional advisory author: findings confer no execution authority.

Observations must cite owned messages/actions/outcomes/tasks/entities. Their exact
source IDs, hashes and snapshots are retained. Plans, patches, test receipts, review
and release manifests are versioned by compare-and-set on the canonical message.
Every transition records its role and action ID; the action records the requester,
permission and approval. Mission source/steps point back to the same run ID. The
release manifest connects the original plan/base, branch, exact diff, file list,
candidate hash, tests, reviewer and manual rollback approach. Existing OutcomeEngine
can assess the action evidence; `ReleasedDevelopmentOutcome` defines the future
verified-merge/metric linkage only. No automatic memory writes or benefit claims.

### Tools and lifecycle

| Role/stage           | Native capability                                   | Authority and evidence                                                                                                             |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Observer             | `development.observe`, `development.propose`        | Canonical evidence mandatory; no source edits                                                                                      |
| Architect            | `development.source`, `development.plan`            | Exact base commit; bounded source; file scope, acceptance, risks, rollback and focused tests                                       |
| Owner build          | `development.build` / `development.build_protected` | Exact immutable plan hash; mandatory approval; protected variant also requires ADMIN                                               |
| Dev workspace        | `development.workspace`                             | One reserved Git worktree, `ary/dev/<run-id>`; never the live checkout                                                             |
| Dev proposal         | `development.patch`, `development.patch_ready`      | Exact preimage hashes, bounded contents, immutable patch hash; owner can inspect before execution                                  |
| Dev implementation   | `development.implement`                             | Separately approved exact patch hash; mission lease required                                                                       |
| Test                 | `development.test`                                  | Fixed validation commands; separate fresh snapshot per command; no implementation edits                                            |
| Security/Review      | `development.review`                                | Separate configured-provider invocation with no author history/memory/tools; nine strict security findings; concerns/unknown block |
| Release              | `development.release`                               | Tests/review/candidate must agree; exact bounded diff and manual rollback evidence                                                 |
| Owner decision       | `development.decide`                                | Exact release hash, approve/reject and reason; cannot be invoked as an agent                                                       |
| Completion           | `development.finalize`                              | Records COMPLETED or REJECTED; **neither means merged**                                                                            |
| Inspection           | `development.inspect`, `development.verify`         | Canonical read-back and current candidate hash; uses existing mission verification                                                 |
| Reservation recovery | `development.unlock`                                | Separate approval; terminal run and all filesystem operations known complete; preserves files                                      |

The mission contains workspace → wait `patch_ready` → implement → test → review →
release → wait `owner_decision` → finalize. All mutating/executing mission stages
require their own exact approval, even under an always-allow policy. Wait submissions
are signals, never grants. Independent read-back gates every execution stage. A failed
test or review cannot reach release; revisions require a new bounded run. The fixed
mission uses one attempt, with no automatic uncertain-effect retry.

Logical stages are OBSERVATION, PROPOSAL, ARCHITECTURE_PLAN, APPROVED, WORKSPACE,
IMPLEMENTATION, TEST, REVIEW, RELEASE_CANDIDATE, COMPLETED and REJECTED. WAITING,
APPROVAL_REQUIRED, PAUSED, FAILED and CANCELLED come from the existing mission state,
not a competing state machine. A completed run is a **reviewed release decision**, not
proof of a deployed or even merged change.

### Isolation, commands and protected systems

The broker creates worktrees under `~/.ary-development/workspaces`, outside the live
repository. A cross-process filesystem reservation serializes all runs for this broker
root (stronger than just overlapping-path exclusion). No lock stealing or automatic
expiry. Exclusive started/done operation receipts preserve uncertainty across crashes;
a started receipt blocks replay and unlocking until manual investigation. Completed
receipts can be reconciled without repeating effects. Canonical action replay still
records the replay attempt separately, without executing again.

Paths are relative, bounded and traversal-free. Symlinks, hardlinks, unexpected
preimages, scope expansion and oversized snapshots are rejected. Existing tests are
immutable; new regression tests may be added. Git uses fixed arguments, disabled
hooks/fsmonitor/external diff and no shell. There is no merge, push, checkout-main,
reset, clean, migration-execution, package-install or arbitrary-command tool.

Core authorization, secret handling, action integrity, runner/policy code, agent
execution context, package/test configuration, scripts and native launcher code are
forbidden even under ADMIN. Memory, repository/provider/server code, mission/agent
runtime, deployment configuration and migration **proposals** require the separate
ADMIN-class build approval. This narrow protected-proposal exception supersedes the
original audit's blanket migration-proposal prohibition; it never permits live DDL,
a deployment, credential edits or weaker authorization. Static suspicious-diff checks
and independent review fail closed; they are not a proof against all malicious code.

Validation invokes fixed installed Vitest, TypeScript, Prettier and Next CLIs, without
shell interpretation, installs, credentials or inherited environment. Vitest uses
literal loopback hostname and middleware mode solely to avoid DNS/server startup;
network access remains denied. macOS Seatbelt denies host data reads, writes outside
the scratch directory, dependency writes, external/loopback network and signals to
unrelated processes. Node/system runtime libraries and directory metadata needed to
resolve approved paths are readable. Each command receives a fresh candidate copy,
read-only dependency links, bounded output, a fixed command-specific timeout and a 2 GB Node heap
limit. Cancellation kills the owned process group. Mission cancellation/pause/lease
loss is also checked during execution. No unsandboxed fallback exists.

### Owner workflow and local verification

Keep `ARY_SELF_DEVELOPMENT_ENABLED=false` until reviewing these limitations. To opt
into this pilot, enable that server-side flag in the installed owner-local Mac runtime;
it additionally requires the existing Desktop Bridge owner/Supabase/session checks.
This is not exposed to a remote browser or a background worker lacking the native
session. Configuration does not prove that sandbox validation succeeds.

Use the existing action request/approval API and Mission Control:

1. Submit `development.observe` with `conversation_id`, a unique `request_key`,
   observation and owned source references. Retain returned `run_id` and revision.
2. Submit `development.propose`, then `development.plan` with that revision, the exact
   Git base, allowed file list, risks/acceptance/rollback and focused test paths.
3. Inspect the plan; approve `development.build` (or protected variant) for its exact
   hash. Use existing `mission.control` plan/start and `mission.tick` for the returned
   mission. Approve its isolated-workspace request in the existing Approvals queue.
4. Submit `development.patch` with exact before-content hashes (null for new files),
   then existing `mission.submit` with name `patch_ready`, a UUID and `{submitted:true}`.
   Approve the mission's exact implement/test/review/release actions as they arise.
5. Inspect `development.inspect` and the release manifest. Record an approved
   `development.decide` using the exact release hash and accept/reject reason; submit
   `owner_decision` through `mission.submit`. Finalization records the decision only.
6. Any real Git commit/merge is a separate human operation. Once terminal and known
   settled, `development.unlock` releases the reservation without deleting evidence.

API envelopes remain the existing `POST /api/actions/request` format:
`{tool,input,reason,request_key,conversation_id}`. A request key identifies one exact
request and must not be reused for changed inputs. Existing owner approval review and
replay endpoints remain unchanged. The Tools, Approvals, Activity and Mission Control
surfaces inspect these operations; no new dashboard or automatic prompt loop was added.

Run the isolated acceptance suite (disposable Git/data, no real provider or user data):

```sh
cd "/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus-self-development"
npm test -- tests/self-development.test.ts
```

### Acceptance and remaining limits

Fresh implementation validation (September 20, 2026):

| Check                               | Result                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused self-development acceptance | 26 passed; owner rejection, denied permission, real Git and native sandbox coverage included                                                                                                                   |
| Full suite                          | 1,758 tests / 109 files passed                                                                                                                                                                                 |
| TypeScript                          | Passed                                                                                                                                                                                                         |
| Production build                    | Passed; existing `/`, `/mic-test`, `/mobile`, API routes preserved                                                                                                                                             |
| Formatting                          | Four pre-existing warnings preserved: `src/components/calls/calls-panel.tsx`, `src/domain/permissions.ts` (unchanged phone entry), `src/infrastructure/phone/twilio-phone.ts`, `src/services/phone-service.ts` |
| Main merge / production deployment  | Not performed                                                                                                                                                                                                  |

The build-generated `next-env.d.ts` path rewrite is excluded from this feature.
The original formatting warning in the phone entry of `permissions.ts` is preserved;
only development capability entries were appended to that file.

- The lifecycle fixture uses real local canonical storage, MissionEngine, actions,
  approvals and disposable Git worktrees. Its command results and reviewer are
  deliberately fixture providers, not proof of live model review or a production run.
- Separate physical macOS checks exercise actual OS denials (including Data-volume path aliases and unrelated-process signals) and a real fixed Vitest
  command. No live OpenAI/Hermes call, production account mutation or deployment occurs.
- Network-dependent tests cannot pass inside this network-denied runner. Full app
  validation may also exceed the fixed 45-second command bound; such results remain
  failures and cannot be bypassed. No broad loopback exception or skipped tests.
- This is a supervised, single-host pilot, not a hostile-code VM: disk/PID quotas,
  proof of cleanup for descendants that deliberately detach, multi-host reservations,
  and cloud sandbox portability are not implemented. Keep execution disabled for
  untrusted autonomous patches. Interrupted operations retain a quarantine reservation.
- No automatic Git commit/merge/push/deploy, dependency installation, binary patches,
  arbitrary file deletion, schema changes, provider selection, agent proliferation or
  self-improvement loop. Review context is bounded; no provider review means NOT READY.
- Post-release measurable outcome ingestion and Level 2/3 autonomy remain unimplemented.

### Exact Phase 1 files

Added:

- `src/domain/self-development.ts` — contracts, scope policy, bounded patch/review schemas and native mission specification.
- `src/services/self-development-service.ts` — canonical artifacts, role transitions, source evidence, independent review and release decision.
- `src/infrastructure/development/workspace.ts` — Git isolation, reservation/operation receipts, scope/preimage checks and fresh validation snapshots.
- `src/infrastructure/development/runner.ts` — fixed, offline macOS sandbox commands and cancellation.
- `src/infrastructure/tools/development-tools.ts` — registrations in the existing ToolRegistry.
- `tests/self-development.test.ts` — 26 focused acceptance/security/recovery tests.

Extended:

- `src/domain/permissions.ts` — development capability metadata and mandatory approval classes only.
- `src/services/action-request-service.ts` — truthful development receipts/outcomes, keyed requests and existing telemetry classification; no generic task-memory shortcut for code results.
- `src/services/agent-runtime-service.ts` — explicit inspect/proposal tool eligibility for existing profiles; no worker build/merge authority.
- `src/server/context.ts` — disabled-by-default owner-local composition, using the existing Desktop Bridge gate.
- `.env.example` — `ARY_SELF_DEVELOPMENT_ENABLED=false`, no secret.
- `docs/self-development.md` — this implementation status and retained audit.
- `ARY_NEXUS_ROADMAP.md` — bounded milestone evidence; prior DONE entries/NEXT 3 unchanged.

## Historical architecture audit (preserved)

## Decision

Make development a **domain of the existing MissionEngine and ToolRegistry**.
Ary Brain remains the user-facing authority. Engineering roles produce bounded,
typed artifacts; they do not acquire a second brain, memory, scheduler, or permission
store. Add a small development service and a constrained local repository executor.
Reuse canonical actions, exact approvals, outcomes, owner-scoped repositories, and
mission recovery. Hermes can propose code or review findings, never execute a local
patch or authorize a release.

Level 1 ends with a tested, independently reviewed release candidate and an owner
recommendation. It does **not** merge, push, publish a PR, deploy, apply migrations,
or change the running application. GitHub publication is a later separately approved
capability, not a side effect of preparing a candidate.

The first execution gate is **real process isolation**. `execFile(..., shell:false)`
prevents shell interpolation, but does not make tests, build scripts, imported code,
Git configuration, or generated source safe. A worktree is Git isolation, not a
security sandbox. Until a restricted execution environment passes escape tests,
Ary may inspect approved source and propose patches but may not run candidate code.

## Current reusable architecture and verified limits

Paths below are repository-relative. The inspection manifest at the end records
exact inspected files; this table identifies responsibilities, not a claim that
every integration was exercised live during this audit.

| System                        | Existing implementation to reuse                                                                                  | Limit relevant to self-development                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical Brain               | `src/services/ary-brain-service.ts`, `src/server/context.ts`                                                      | Existing conversation/source-message persistence, extraction jobs, entity resolution and tool discovery remain authoritative. No engineering loop inside `respond()`.                                                                                                                                                                          |
| Memory/evidence/entities      | `MemoryService`, `NexusMemoryService`, existing reconciliation/entity services; `src/domain/memory-source.ts`     | Use reviewed OUTCOME/EPISODIC evidence. Source code, test logs and worker claims are not confirmed user facts. Only actual user messages can be cited as user assertions.                                                                                                                                                                      |
| Durable missions              | `src/domain/mission.ts`, `CheckpointMissionEngine`, `OrchestratorService`, `mission-execution-context.ts`         | Real engine is `checkpoint-v1`, not Temporal. Existing leases/CAS, dependency gates, pause/cancel, external submissions and recovery are reusable. Twelve steps maximum; step timeout at most 300 seconds, lease at most 360 seconds.                                                                                                          |
| Mission revisions/retries     | `src/domain/orchestration.ts`, `orchestration-control.ts`                                                         | Durable mission replanning is deliberately rejected. Failed writes are not generically retry-safe. Preserve this: changed scope creates a linked follow-up mission, not a silently edited plan.                                                                                                                                                |
| Agent runtime                 | `src/domain/agent.ts`, `AgentRuntimeService`, `agent-context.ts`, `AgentModelRegistry` through server composition | Profiles, parent ceilings, termination and budget reservations already exist. Specializations currently use the six Board roles. Tool access is an explicit small internal allowlist; model-call budget accounting in dispatch recognizes `mission.agent`. New engineering tools require explicit allowlist and budget wiring, not a wildcard. |
| Hermes                        | `AgentProvider`, `AgentProviderRegistry`, `DelegatedJobService`, `HermesAgentProvider`, `worker-tools.ts`         | Submission/review already require approval. `code_proposal` exists. Results are untrusted; artifacts limited to four text items of up to 8,000 characters each. Side effects are explicitly `not_independently_verified`. No need to replace or broaden the provider.                                                                          |
| Skills/automations            | `src/domain/skills.ts`, `SkillService`                                                                            | Versioned reviewed definitions compile to existing bounded plans; manual/interval triggers and pinned versions exist. Declaring a tool never grants its permissions. Automated engineering triggers remain off in Level 1.                                                                                                                     |
| Tools/discovery               | `ToolRegistry`, `tool-capabilities.ts`, `ToolDiscoveryService`                                                    | Typed registration, validation, preflight and capability metadata exist. Discovery is not authorization. New local-development descriptors must truthfully report sandbox/runner availability; no discovery redesign.                                                                                                                          |
| Permission/approval authority | `PermissionService`, `permissions.ts`, `permission-classes.ts`                                                    | Numeric levels 0–5, classes, restrictive scope intersection, agent ceilings, mandatory approval, exact fingerprint/policy hash, one-use expiry and emergency latch already exist. A plan/Skill/worker review is not a patch/command grant.                                                                                                     |
| Actions/receipts              | `ActionRequestService`, `ActionService`                                                                           | Canonical request envelope, durable execution keys, replay, rejection, outcome and staged DB writes exist. Filesystem/Git effects cannot participate in the DB transaction; add domain receipt reconciliation rather than claim atomicity across both.                                                                                         |
| Outcomes                      | `OutcomeEngine`, `outcome-engine.ts`, existing Economics telemetry                                                | Reviewed assessments snapshot/hash evidence and use CAS. Recommendations preserve history and never rewrite prompts. Command success, candidate readiness, merged code and production benefit are separate claims.                                                                                                                             |
| Reflection                    | `ReflectionService`                                                                                               | Deterministic evidence snapshots and reviewable proposals already exist. Reuse as observations only; a reflection proposal cannot authorize a source edit.                                                                                                                                                                                     |
| Board/Priority                | `BoardMeetingService`, `PriorityService`, `board.ts`                                                              | Evidence-backed advisory findings and transparent priorities can supply observations. Board's two-finding, short-text schema is not a patch/engineering-plan schema; do not loosen it.                                                                                                                                                         |
| Audit/events                  | `NexusEventBus`, `nexus-events.ts`, existing Activity inspector                                                   | Sanitized event families and persistence exist. `record()` can fail softly; it is presentation telemetry, not execution authority. Canonical durable receipts must succeed before advancing.                                                                                                                                                   |
| Storage                       | `Repository`, `LocalRepository`, `SupabaseRepository`                                                             | Existing messages JSON metadata stores plans, agents, Skills and worker jobs. `batch()` and mission RPCs provide ownership/CAS. LocalRepository is single-process development storage, not a cross-process lock.                                                                                                                               |
| Local execution               | `infrastructure/desktop/process.ts`, desktop security, `ControlFiles`, native launcher                            | Fixed native verbs and narrow transfer files are reusable security patterns. They are not an engineering executor. The desktop launcher loads project environment and runs the live source; never point it at a candidate.                                                                                                                     |
| Existing presentation         | Mission Control, ApprovalDialog, ActivityInspector, OutcomeComparison                                             | Extend their detail sections later. No separate engineering dashboard, approval queue, event bus or visual redesign is necessary.                                                                                                                                                                                                              |

### Git/GitHub reality

The checkout has `origin=https://github.com/knaggs2005-lab/ARY-NEXUS.git`, branch
`main`, and baseline HEAD above. Six unrelated untracked `.DS_Store` files were
present at audit start. They must not be imported, staged or cleaned up by a run.

Inspection/search of `src`, `scripts`, `desktop` and capability definitions found
no dedicated Git/GitHub ToolRegistry adapter, repository worktree manager, engineering
runner or release-candidate verifier. No `.github` directory exists in this checkout.
The generic MCP adapter can load owner-configured servers; that does not establish a
GitHub connection or authorize it. Secret MCP configuration was not read. Existing
developer Git usage and this Codex session are not Ary runtime capabilities. Remote
branch protection, CI configuration, credentials and current GitHub settings were
not queried or verified.

## What is missing

1. A typed development-run projection linked to a mission and immutable observation.
2. Source snapshot selection, content hashes, sensitive-file exclusion and bounded
   evidence packaging. Reading an entire checkout into a model is not acceptable.
3. Trusted Git broker for isolated branches/worktrees and immutable candidate diffs.
4. Host-wide exclusive repository ownership, stale-worker fencing and filesystem
   receipts that survive a crash between an effect and canonical DB persistence.
5. Structured patch validation and protected-path enforcement outside candidate code.
6. A credential-free, network-denied command sandbox with bounded process/output
   handling, child-process termination and explicit local fixtures.
7. Engineering role output schemas, independent review binding and verified test
   manifests. Existing Board output cannot carry these safely.
8. Specific development tool definitions, agent ceiling/budget integration, exact
   approval previews and mandatory development request keys.
9. Release evidence, recovery tests and later verified human merge/outcome import.

No runtime sandbox availability was tested in this audit. Do not select or install
another library/framework as a substitute for proving the execution boundary.

## Smallest proposed interfaces

These are design sketches, **not implemented TypeScript APIs**. New schemas must be
strict, bounded and versioned. Internal scope objects are created by the trusted
server; model inputs cannot mint a user, lease, grant or path root.

```ts
type EngineeringRole =
  | "observer"
  | "architect"
  | "developer"
  | "tester"
  | "security_review"
  | "release"
  | "outcome";
type CommandId =
  | "test_all"
  | "test_focused"
  | "typecheck"
  | "format_check"
  | "build"
  | "acceptance_local";
type DevelopmentPhase =
  | "OBSERVED"
  | "PLANNING"
  | "PLAN_REVIEW"
  | "ISOLATING"
  | "EDITING"
  | "VALIDATING"
  | "REVIEWING"
  | "RELEASE_CANDIDATE"
  | "OWNER_DECISION"
  | "CLOSED";

interface DevelopmentRunV1 {
  version: 1;
  mission_id: string; // the run ID IS the existing mission ID
  repository_id: string; // trusted allowlisted repo identity, not a caller path
  observation: { message_id: string; action_id?: string; hash: string };
  base_commit: string;
  phase: DevelopmentPhase; // subordinate to MissionRuntime.state
  scope: { paths: string[]; max_files: number; max_bytes: number };
  policy_hash: string;
  plan_artifact_id: string;
  workspace_receipt_id?: string;
  patch_receipt_ids: string[];
  validation_receipt_ids: string[];
  review_receipt_ids: string[];
  release_candidate_id?: string;
  outcome_ids: string[];
  follow_up_mission_ids: string[];
}
interface DevelopmentService {
  propose(observationRef: unknown, scope: unknown): Promise<unknown>;
  inspect(missionId: string): Promise<unknown>;
  // Called only from registered tools, never a second autonomous scheduler.
  analyzeRole(input: unknown, context: ToolExecutionContext): Promise<unknown>;
  prepareRelease(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown>;
}
interface DevelopmentWorkspace {
  inspect(scope: TrustedRunScope): Promise<WorkspaceReceipt>;
  isolate(scope: TrustedRunScope): Promise<WorkspaceReceipt>;
  applyPatch(
    patch: ValidatedPatch,
    scope: TrustedRunScope,
  ): Promise<PatchReceipt>;
  runCommand(
    command: CommandId,
    scope: TrustedRunScope,
  ): Promise<CommandReceipt>;
  reconcile(
    operationId: string,
    scope: TrustedRunScope,
  ): Promise<RecoveryReceipt>;
  cancel(operationId: string, scope: TrustedRunScope): Promise<StopReceipt>;
}
```

Proposed registered verbs: `development.inspect`, `development.propose`,
`development.analyze`, `development.isolate`, `development.apply_patch`,
`development.validate`, `development.inspect_receipt`, `development.prepare_release`.
Normal cancellation uses existing mission control and emergency-stop hooks, not a
new owner policy. If a resource-specific stop tool becomes necessary, it must be a
fixed stop-only capability available under the existing emergency latch.

Use existing `/api/actions/request` for every executable request. Tool inputs carry
mission ID, expected revision, snapshot/patch/command hashes and bounded references.
Never accept a shell string, environment dictionary, absolute working directory,
arbitrary executable, Git remote or approval boolean. An authenticated read projection
may extend existing Mission Control; no unaudited execution route.

### Canonical persistence without a new table

Add optional, validated `ExecutionPlan.development` metadata inside the existing
`messages.metadata.plan`. Checkpoint through the existing mission lease/CAS path;
do not replace the surrounding plan or overwrite control/lease fields. Initial
attachment must occur during trusted mission creation/checkpointing, not a generic
client metadata update. Ownership and observation references must be validated.

Bounded versioned artifacts live in existing system-message metadata with original
conversation/mission IDs, content digest, producing action ID and artifact type.
Actions/outcomes remain canonical execution receipts. Logs should be capped (for
example 64 KiB sanitized excerpt per command, explicit truncation); do not accumulate
unbounded logs in the mission JSON. Private local larger artifacts may be referenced
by digest but must display unavailable if lost. They are not another memory store.

**No new SQL migration is required for a single-host Level 1 implementation**, provided
the existing action-key, mission, permission and event migrations are installed and
verified. Existing JSON metadata and owner-scoped tables can represent the records.
This is not a claim that migration-free distributed scheduling is safe. Multi-host
repository reservations, efficient development queries at scale, and stronger
append-only artifact retention may later justify a separately reviewed additive
migration. Do not silently change existing database validation/RLS.

## Roles subordinate to Ary

| Role            | Inputs/output                                                                                                                                     | Authority                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Observer        | User issue, failed receipt, test baseline, Board finding or Outcome evidence → bounded observation with source/hash, reproduction and uncertainty | Approved reads only; no surveillance or recursive self-triggering         |
| Architect       | Observation + relevant source → files, acceptance criteria, risk, alternatives, bounded mission specification                                     | Propose, never grant scope                                                |
| Dev             | Approved scope + fixed base → structured patch with explanation                                                                                   | Submit patch; only trusted tool applies it after exact approval           |
| Test            | Immutable candidate → test selection and runner-produced results                                                                                  | Cannot edit candidate, tests, expected results or command policy          |
| Security/Review | Exact diff, original requirement, baseline and fresh results → independent accept/reject findings                                                 | Separate ephemeral agent/session from author; read-only; no self-approval |
| Release         | Candidate + reviews + receipts → release package and merge/reject recommendation                                                                  | No main write, push, deploy or approval authority                         |
| Outcome         | Verified eventual result/correction → assessed outcome and reviewed lesson                                                                        | Existing OutcomeEngine; never rewrite core instructions                   |

Reuse existing persistent/ephemeral profiles; do not create seven perpetual fake
personality loops. Map engineering role to existing specializations (Research,
Developer, Analyst) with a typed engineering-role input. Add the engineering output
contract alongside Board, not inside its schema. Extend the existing runtime's
allowed tools and model-budget reservation for the exact new analysis capability,
including parent limits and termination. Keep existing model selection/router.
Separate reviewer identity/process context is evidence of independent review, not
a guarantee that the same underlying model will find every bug. The human remains
the final release decision-maker.

Hermes can optionally receive an approved redacted excerpt via existing
`worker.submit` and `code_proposal`/`analysis`, then existing result review. It receives
no Git credentials, local file access, production data or authority token. A returned
patch must pass the same local validation and approval as any other candidate.

## Lifecycle: one mission, a development phase projection

Normal flow:

`OBSERVED → PLANNING → PLAN_REVIEW → ISOLATING → EDITING → VALIDATING → REVIEWING → RELEASE_CANDIDATE → OWNER_DECISION → CLOSED`

| Transition         | Required evidence/gate                                                                 | Existing mission state                                            |
| ------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Observation → plan | Owned source, current base SHA, finite scope and acceptance criteria                   | DRAFT → PLANNING → READY                                          |
| Plan review        | Existing exact approval to record accepted scope; no blanket execution grant           | APPROVAL_REQUIRED while waiting                                   |
| Isolation          | Approved repository/base, no protected target, repository reservation acquired         | RUNNING                                                           |
| Apply patch        | Exact diff/preimage hash, allowed paths, current policy and separate approval          | APPROVAL_REQUIRED → RUNNING                                       |
| Validate           | Exact candidate hash, command profile hash, proven sandbox and approval                | RUNNING; WAITING only for a known running operation               |
| Review             | Required command receipts from this candidate; no ignored failed gates                 | RUNNING                                                           |
| Prepare candidate  | Distinct reviewer, no unresolved blocking findings, immutable artifact set             | RUNNING                                                           |
| Owner decision     | Candidate accept/reject decision through an existing approved action; no merge implied | APPROVAL_REQUIRED                                                 |
| Close              | Verified decision/result and outcome; no running or uncertain process                  | COMPLETED if package accepted, or CANCELLED if rejected/abandoned |

Each transition checks canonical receipts; an LLM cannot set the phase to bypass a
gate. READY/candidate preparation never means code is released. Mission COMPLETED
means the supervised package objective is satisfied; deployed effectiveness remains
unknown until separately evidenced.

Failure overlays reuse `FAILED`, `PAUSED`, `WAITING` and `CANCELLED`. Unknown external
effects set the existing `mission.uncertain` and WAITING. A failed test remains a
failed result even when its process exited normally with a report. After review
rejects a patch, create an explicitly scoped follow-up mission referencing the failed
candidate; do not reset successful steps, rewrite durable plan specifications, or
loop indefinitely. Cap revision attempts at two in the first pilot.

Keep the first plan within twelve steps by representing the fixed validation suite
as one bounded command profile with individual child receipts. If the suite cannot
finish inside the current step/lease bounds, **do not increase timeouts silently**:
use one approved keyed runner operation with read-only status/receipt observation
and an existing mission wait, or stop as unsupported until that recovery path is
implemented. The runner manages only its process lifetime, not a second workflow.

## Risk and command policy

Risk is a trusted policy classification; model confidence, role name and permission
level cannot lower it. Aggregate the highest risk from paths, commands and effects.

| Risk                 | Examples                                                                                                                           | Existing classes / Level 1 treatment                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| R0 inspect           | Approved non-secret source snapshot, diff and receipt reads                                                                        | READ; owner/agent scope still checked                                                                   |
| R1 propose           | Local plan, patch proposal, reviewer analysis                                                                                      | READ/WRITE as appropriate; no execution grant; provider use subject to explicitly approved usage budget |
| R2 isolated change   | Create owned worktree, apply exact non-protected patch, immutable candidate packaging                                              | WRITE/EXECUTE, medium risk, mandatory exact approval                                                    |
| R3 execute candidate | Tests, typecheck, formatting check, build, local acceptance server                                                                 | EXECUTE, high risk, mandatory approval + sandbox; tests can execute arbitrary candidate code            |
| R4 forbidden         | Credentials/auth/security changes, migrations, main merge, deployment, purchase, outreach, destructive Git/history/file operations | Denied; not exposed as self-development tools in Level 1                                                |

Use fixed server-owned command IDs. Initially map to the current `npm test`,
`npm run typecheck`, `npm run format:check`, and `npm run build` commands; focused
test file arguments must be enumerated approved paths, never caller flags. A named
acceptance profile is trusted configuration, not model-provided JavaScript. No
`npm install`, `npx` remote resolution, dependency upgrades, shell, arbitrary macros,
Git aliases, hooks, editor/pager/filter execution or package publish.

Pin executable versions, trusted package scripts and lockfile/dependency digest.
Reject changed test-runner/compiler/build/package configuration. Even unchanged
scripts import candidate code: run them under enforceable filesystem/network/process
isolation, not merely with an allowlist. Writable space is disposable scratch only;
approved input snapshot and dependencies are read-only. No host HOME, `.env*`, cloud
keys, SSH agent, Git credential helper, Docker socket, desktop bridge token, browser
profile, live database or writable host `node_modules` is available. Minimal explicit
environment; disable telemetry/network-dependent features. Local acceptance uses
synthetic fixtures and isolated loopback, never the running owner's Nexus server.
If a build needs network, report that requirement rather than enable it automatically.

Set finite CPU/time/memory/output/disk and model-call/token budgets before start.
Existing budget counters are reused; unknown costs are not zero. No new purchase,
credit top-up or unconstrained paid inference. A remote/model call needs the owner's
explicit existing usage authorization and a bounded budget; absent that, use local
inspection/proposals only. No provider call was made for this audit.

## Git isolation, simultaneous jobs and protected systems

Trusted host-side Git broker owns an allowlisted repository ID and generates
`ary/dev/<run-id>` plus an absolute worktree path outside the active app checkout.
Start from a pinned commit, never copy the owner's dirty/untracked files. No stash,
reset, clean, force push, main checkout or automatic rebase. Local commit/package
creation, if enabled, is an exact approved action with hooks/signing helpers disabled.
No remote operations in Level 1.

The broker uses fixed executable/argv calls with `shell:false`, pinned Git config,
disabled hooks/pagers/external diff and network/credential use. Git reads themselves
must not invoke repository-specified helpers, filters or submodules. The candidate
execution sandbox receives an exported snapshot, **not `.git`, a linked worktree's
gitdir, or the host repository's shared refs**. Only the trusted broker can change
the worktree/ref. Validated patch objects specify relative regular-file paths,
preimage/postimage hashes and bounded replacement contents. Reject symlinks, hardlink
escape, traversal, case/Unicode path aliases, special files, submodules, binary
payloads and executable-mode changes in Level 1. Validate all entries before writing;
stage a versioned candidate snapshot and promote it atomically inside owned scratch.
Crash recovery verifies the complete manifest instead of accepting a half patch.

**Level 1 concurrency rule:** one mutation-capable run per canonical repository on
one trusted host; queue the others. Read-only reviews may inspect immutable snapshots
in parallel. Each run still has its own worktree. Acquire a cross-process host
reservation before creating/editing; a JavaScript Map or per-mission DB lease is
insufficient because two different missions can target the same repository. Store
owner/run/operation identity and a monotonically changing fence in a private broker
journal; canonical actions remain the audit authority. On stale reservation, prove
the previous process ended and reconcile its operation before transfer. Lease expiry
alone never authorizes another writer. Refuse multi-host repository mutation in v1.

Later non-overlapping jobs may use sorted path/subtree reservations and a serialized
integration queue; unplanned file overlap pauses both, never auto-resolves conflicts.
Any base drift invalidates candidate approval/tests/review and requires a new pinned
candidate. Git mergeability alone is not semantic compatibility.

### Protected paths and policies

Trusted policy lives outside the candidate worktree and is version/hash-bound to
every approval. Default-deny edits except the exact approved file list. The initial
deny set includes:

- `.env*`, `.git/**`, `.data/**`, keys/vaults, user Library/SSH/cloud/browser folders,
  dependencies, symlinks and any path outside the owned candidate.
- `src/services/permission-service.ts`, `action-service.ts`,
  `action-request-service.ts`, `action-cancellation.ts`, `agent-context.ts`,
  `mission-execution-context.ts`; corresponding permission/registry domains.
- `src/server/**`, auth/OAuth/vault/security code, `desktop/**`,
  `src/infrastructure/control/**`, `src/infrastructure/desktop/**`,
  `src/infrastructure/mcp/**`, provider credential-loading paths, and the new
  development broker/sandbox/policy implementation itself.
- Canonical Brain, memory/reconciliation/retrieval/entity services and their domains,
  model routing/provider configuration, mission and agent authority code. These are
  human-led changes in the initial pilot, even if a proposed edit sounds cosmetic.
- `supabase/**`, `deploy/**`, `.github/**` if introduced, package/lockfiles,
  compiler/Next/Vitest configuration, build/release scripts, `AGENTS.md` and core
  authorization/system instructions wherever stored.
- Existing tests and test harness configuration are immutable to the Dev role in
  the initial pilot. New narrowly scoped regression tests may be proposed and
  approved, but cannot replace/remove/skip baseline tests or alter assertions to
  make a failure disappear. Test and Review roles cannot edit even those new tests.

These are minimum protected families, not an exhaustive claim that path matching
proves semantic safety. Ordinary application code can still leak data or undermine
security; review imports, behavior and permission tests as well. A change requiring
protected code is a **human-led engineering task**, outside the self-development
runner. Owner plan approval cannot override hard-deny policy in-band. Bootstrap the
new tools through normal developer review; Ary cannot install its own authority.

## Evidence, approvals and outcome linkage

### Hard safety invariants

1. The existing Brain, PermissionService, ActionService and MissionEngine retain
   authority. A role, model output, tool result, Skill or worker cannot grant access.
2. Every effect has a durable canonical intent and exact current authorization before
   dispatch; no owner approval is synthesized from a successful test or review.
3. The trusted supervisor/policy/executor runs from an owner-installed immutable
   version outside the candidate and cannot load candidate modules or instructions.
4. No write reaches main, the active application checkout, production data, protected
   paths, credentials or remote systems. No migration or deployment verb exists.
5. Candidate code receives neither secrets nor a network/desktop/permission bridge.
   Isolation failure or missing infrastructure blocks execution; no unsafe fallback.
6. All approval, validation and review evidence binds to one exact base and candidate.
   Any change invalidates affected grants and results; scope never expands silently.
7. A failed, skipped, incomplete or unknown required gate cannot become PASS. Tests
   and security policy cannot be suppressed or weakened by the candidate author.
8. Cancellation and timeout are not rollback. Uncertain effects remain blocked until
   reconciled; a second worker cannot act merely because a lease expired.
9. Code/comments/logs/Hermes output are untrusted data, not system instructions.
   Render artifacts as inert escaped text, never executable HTML or scripts.
10. Outcome learning is attributable, versioned and reviewed; it cannot alter core
    instructions or permissions. Model confidence is not evidence of effectiveness.

The inspectable chain is:

`source observation → canonical source message → mission/run → plan artifact → exact action request → approval/denial → executor receipt → test artifacts → independent review → release candidate → owner decision → eventual verified outcome → reviewed lesson`

Preserve original observation table/ID/revision and hash, Board finding ID or failed
action when applicable, repository/base SHA, goal/project/entity/memory references,
role/agent/provider identity, action and approval IDs, canonical request key and
policy hash. Automated observations are system evidence, never fabricated user
messages or implicit authorization. The owner's actual instruction is the source
user intent for the development mission.

Patch receipts bind pre/post tree hashes and exact changed paths. Command receipts
include command profile/hash, candidate tree, dependency/toolchain/sandbox version,
timestamps, exit code/signal, assertions/test counts, sanitized bounded logs, output
digest and timeout/cancellation status. Capture logs in the trusted runner outside
candidate-writable space; parse reports without executing report content. False
"PASS" stdout is not an independent result. Approval fingerprints include these
identities as applicable; path, base, command, patch or policy changes invalidate
approval. Existing ten-minute, one-use approval semantics stay intact.

Release manifest binds all validation/review receipts to **the same candidate**,
diff summary, risks, unverified gates, rollback proposal and owner decision. A
reviewer cannot accept their own authored patch. Never copy full secrets/logs/source
into memory or event payloads. Use `mission.*`, `tool.*`, `agent.*`, `system.*` with
existing event fields (`record_id`, `action_id`, `phase`, `reason_code`), not a new
unrecognized event family. Events reflect receipts, never invented activity.

Keep small operational manifests in canonical records; broker journal only reconciles
local effects. If audit intent cannot be stored, do not execute. If an effect succeeds
but final DB write fails, retain private durable receipt and block successors until
reconciliation. `NexusEventBus.record()` success/failure alone cannot establish an
action result. Preserve evidence even on rejection or cancellation.

Use existing `outcome.assess` evidence snapshots and entity/agent/Skill links. Link
mission/release references through action/message evidence metadata; the existing
Outcome link enum has no `mission` or `release` kind, so do not invent those values.
Use existing reviewed `memory.capture` with OUTCOME + real outcome ID for lessons.
Do not use generic action remembrance if its task-oriented wording misclassifies an
engineering result. No automatic self-training, weight updates or instruction edits.

## Cancellation, recovery and eventual rollback

1. Pause/cancel and emergency stop persist through existing controls before stopping
   future dispatch. Broker checks owner stop state, policy and mission/run fence
   before each effect, not just once at planning.
2. Send cancellation to the owned sandbox process group and cooperative model/worker
   calls. Do not signal arbitrary PIDs. Stop acknowledgment means process termination
   was observed; requesting stop is not proof. If children cannot be proven stopped,
   quarantine the sandbox, retain the repository reservation and report uncertainty.
3. On restart reconcile action execution key, broker receipt, candidate hashes and
   owned process identity before resuming. A stale PID without start identity is not
   proof. No new process or patch dispatch while an earlier effect is uncertain.
4. Replayed successful keys return saved results. Known failed attempts remain failed;
   a new approved key is required for retry. Do not expand generic write retries.
   Recheck base, scope, sandbox, budgets and permission policy on resume.
5. Cancellation preserves patches/logs and existing results. Cleanup is a separate,
   owner-reviewed broker maintenance operation limited to positively identified Ary
   scratch after retention/export checks; no recursive delete capability for agents.

Before merge, rollback means reject/quarantine the isolated candidate: production
was never changed. Later, after a verified human merge, propose a normal **revert
commit** against the current base, rerun validation and require a new approval. No
history rewrite, hard reset, forced push or automatic deploy rollback. Deployment
rollback requires its own future artifact/health/approval integration. Data changes
are excluded; a Git revert cannot undo schema changes, outbound messages or other
external effects. Record compensating actions separately, never erase old receipts.

## Acceptance plan before any enablement

These are future tests, not claims of current self-development functionality.

| Area             | Required acceptance                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| End-to-end       | Explicit observed bug → approved plan → isolated patch → full baseline + new regression + typecheck + formatting + build + fixture acceptance → independent review → release package → owner decision; main/live app unchanged |
| Authorization    | Denied read/write/execute; rejected/expired/used grant; forged agent; cross-owner/run/repo reference; changed diff/base/scope/command/policy; level 5 still cannot override mandatory approvals                                |
| Git              | Dirty main preserved; exactly one run worktree; duplicate creation replay; pinned base; main/remote refs unchanged; no hooks, credential helper, submodule/filter invocation; no network                                       |
| Injection        | Shell metacharacters, malicious filenames, option injection, traversal, symlink/hardlink race, Git config, npm lifecycle payload, test spawning shell; either rejected input or contained execution, never host effect         |
| Isolation        | Candidate attempts host secret read, localhost production DB/control access, outbound exfiltration, writable shared dependency/Git ref access, process escape; enforce deny outside candidate control                          |
| Concurrency      | Same repository two processes/two missions queue; stale lease and delayed worker cannot write; reviewer snapshot stable; second host denied; overlapping future paths conflict deterministically                               |
| Integrity        | Changed/removed/skipped baseline test rejected; fabricated stdout cannot pass; nonzero exit and missing/truncated test report remain failures/unknown; baseline and candidate comparable                                       |
| Review           | Author cannot self-review; stale reviewer output rejected after any patch; baseline security tests unchanged; protected import/behavior changes flagged; unresolved findings prevent candidate acceptance                      |
| Failure recovery | Crash before/after worktree creation, patch promotion, process launch, exit and DB commit; disk full, partial patch, lost receipt, expired mission lease; no duplicate or partial accepted result                              |
| Stop/restart     | Stop during analysis/edit/test/build; child processes stopped; late callback fenced; owner reset never auto-resumes; restart reconstructs from canonical checkpoints and reconciled receipt                                    |
| Evidence/privacy | Complete observation-to-outcome links, no invented user facts, no secrets in SSE/UI/logs/artifacts/worker context; missing artifacts visible; rejected jobs retained historically                                              |
| Outcome          | Candidate accepted ≠ merged ≠ deployed ≠ benefit; later user correction creates history; unsupported cost/time-saved stays unknown; lesson remains reversible proposal                                                         |

Use disposable repositories and existing LocalRepository/PGlite fixtures first.
Then repeat owner-isolated Supabase persistence/restart acceptance explicitly without
real source secrets or external integrations. Test deployment state separately; a
mocked sandbox is not proof of containment. Required gates cannot be waived by Ary.
Existing baseline warnings remain visible; any owner-approved pre-existing exception
must be exact and recorded and cannot hide a new regression.

## Rollout: Level 1 → Level 2 → Level 3

These rollout levels are **not** replacements for permission levels 0–5.

**Level 1 — supervised single-host pilot.** First deliver contracts, read-only audit
and patch proposal. Enable isolated edits/commands only after sandbox, broker recovery
and approval tests pass. Single repository, one active writer, narrowly approved
non-protected files, no scheduled triggers, exact per-effect approvals, independent
review and human release decision. Default disabled; missing sandbox fails closed.

**Level 2 — bounded supervised batches.** After repeated measured success and no
unresolved security incidents, allow owner-approved, time-limited scopes for low-risk
observations/planning and carefully enumerated validations. Use existing Skills and
automations with pinned versions and existing permissions; do not weaken Level 1
mandatory-effect tools to obtain this. Add narrower separately reviewed capability
variants only where justified. Multiple isolated jobs need proven path reservations,
budget reservation and serialized integration review. GitHub draft publication, if
requested, is an exact EXTERNAL_PUBLISH approval with narrowly scoped credentials.
Merge/deployment/protected policy changes remain human-controlled.

**Level 3 — bounded autonomy, separately authorized.** Consider only well-measured
low-risk change classes with immutable acceptance/permission policy, quota, expiry,
owner kill switch, independent review and verified rollback. Same mission/action/
receipt abstractions remain. No self-expanding scope, self-granted permissions,
unlimited spending or self-modified authorization. Automatic merge/deployment is not
authorized by this design; any later proposal requires new threat modeling and
explicit policy approval. Outcomes may recommend scope changes; only the owner can
grant them. Do not equate passing tests with proof of safe autonomy.

## Proposed implementation file plan (nothing below created in this audit)

| Add                                                                                                                                                      | Purpose                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/domain/self-development.ts`                                                                                                                         | Strict run, engineering role, patch, command receipt and release schemas                                          |
| `src/services/self-development-service.ts`                                                                                                               | Domain proposal, artifact validation and projection over existing missions/actions; no loop/scheduler             |
| `src/infrastructure/tools/development-tools.ts`                                                                                                          | Typed fixed verbs through existing ToolRegistry                                                                   |
| `src/infrastructure/development/workspace.ts`                                                                                                            | Trusted Git broker, path validation, cross-process reservation/fences, operation receipt recovery                 |
| `src/infrastructure/development/runner.ts`                                                                                                               | Fixed command profiles, enforced sandbox boundary, process lifetime and bounded results; unavailable until proven |
| `src/components/orchestrator/development-details.tsx`                                                                                                    | Small mission/approval detail projection; no standalone dashboard                                                 |
| `tests/self-development.test.ts`, `tests/development-workspace.test.ts`, `tests/development-security.test.ts`, `tests/self-development-database.test.ts` | Role/permission/state, disposable Git, sandbox/escape and canonical persistence acceptance                        |

Minimal existing extension points:

- `src/domain/orchestration.ts`, `src/services/orchestrator-service.ts`,
  `src/services/checkpoint-mission-engine.ts`, `src/infrastructure/tools/mission-tools.ts`:
  trusted optional development metadata initialization/checkpoint preservation only;
  no replacement engine, no altered generic retry semantics.
- `src/services/agent-runtime-service.ts`: exact new tool allowance and model-budget /
  termination accounting; engineering analysis under existing agent identity/model.
  Preserve `src/domain/agent.ts` Board specializations by mapping roles as above.
- `src/domain/permissions.ts`: additive reviewed tool definitions/classes and mandatory
  approvals; do not change PermissionService's resolution algorithm.
- `src/services/action-request-service.ts`: require development request keys and mark
  local effects truthfully; no automatic engineering memory via task wording.
- `src/server/context.ts`: disabled-by-default trusted composition; `src/server/http.ts`
  only if the existing mission detail projection needs an authenticated read extension.
- `src/services/mission-control-service.ts`, `src/components/orchestrator/mission-control.tsx`,
  `src/components/approval-dialog.tsx`: expose domain preview and linked artifacts;
  reuse current audit/approval endpoints and visual primitives.
- `.env.example`: only a future blank/disabled enablement flag and non-secret repository
  registration guidance; no credential copied to candidate or frontend.

No planned change to Brain, retrieval, entities, graph, voice, provider transports,
Hermes protocol, OutcomeEngine policy, schemas, existing test meaning or permissions
algorithm. If implementation reveals a necessary exception, identify it explicitly
before expanding scope. Bootstrap changes to protected integration files above are
human-reviewed implementation work, not permission for Ary to edit them later.

## Fresh baseline and audit limitations

- `npm test`: **PASS — 1,732 tests, 108 files**, 33.35 seconds, exit 0.
  Includes existing process-restart mission recovery and PGlite SQL tests; not a live
  hosted Supabase or cloud-worker acceptance run.
- `npm run typecheck`: **PASS**, exit 0.
- `npm run format:check`: **FAIL — four unchanged baseline files**, exit 1:
  `src/components/calls/calls-panel.tsx`, `src/domain/permissions.ts`,
  `src/infrastructure/phone/twilio-phone.ts`, `src/services/phone-service.ts`.
  No formatting fixes made to these files.
- Production build was **not rerun** for this documentation-only audit. Earlier
  roadmap build success is historical, not a fresh result. No live provider call,
  credential read, native device action, sandbox test or production DB mutation.
- Logs: `/tmp/ary-self-development-tests.log`, `/tmp/ary-self-development-types.log`,
  `/tmp/ary-self-development-format.log`. Tests may generate disposable local
  fixtures/cache; no application implementation files were changed by this audit.

Implementation can start with contracts/proposals without a migration. **Execution
enablement is not ready** until the sandbox, immutable policy and local crash/fencing
boundaries have been implemented and independently verified. No current test proves
those missing components.

## Exact inspection manifest

Full files or relevant implementation sections were read; test files marked below
were inspected for fixture patterns/test declarations and executed as part of the
full suite. This is not a claim of line-by-line review of all 108 test files.

```text
AGENTS.md
ARY_NEXUS_ROADMAP.md
package.json
.gitignore
vitest.config.ts
src/domain/mission.ts
src/domain/orchestration.ts
src/domain/agent.ts
src/domain/agent-models.ts
src/domain/agent-provider.ts
src/domain/providers.ts
src/domain/mission-control.ts
src/domain/tool-registry.ts
src/domain/tool-capabilities.ts
src/domain/permissions.ts
src/domain/permission-classes.ts
src/domain/repository.ts
src/domain/models.ts
src/domain/skills.ts
src/domain/outcome-engine.ts
src/domain/nexus-events.ts
src/domain/board.ts
src/domain/memory-source.ts
src/services/ary-brain-service.ts
src/services/checkpoint-mission-engine.ts
src/services/orchestrator-service.ts
src/services/orchestration-control.ts
src/services/mission-execution-context.ts
src/services/mission-control-service.ts
src/services/agent-runtime-service.ts
src/services/agent-context.ts
src/services/delegated-job-service.ts
src/services/skill-service.ts
src/services/action-request-service.ts
src/services/action-service.ts
src/services/action-cancellation.ts
src/services/permission-service.ts
src/services/tool-discovery-service.ts
src/services/model-router.ts
src/services/memory-service.ts
src/services/nexus-memory-service.ts
src/services/entity-service.ts
src/services/memory-reconciliation-service.ts
src/services/reflection-service.ts
src/services/outcome-engine.ts
src/services/board-meeting-service.ts
src/services/priority-service.ts
src/services/nexus-event-bus.ts
src/infrastructure/agents/hermes-agent-provider.ts
src/infrastructure/tools/worker-tools.ts
src/infrastructure/tools/agent-tools.ts
src/infrastructure/tools/mission-tools.ts
src/infrastructure/tools/memory-tools.ts
src/infrastructure/tools/outcome-tools.ts
src/infrastructure/repositories/local.ts
src/infrastructure/repositories/supabase.ts
src/infrastructure/desktop/process.ts
src/infrastructure/desktop/security.ts
src/infrastructure/control/files.ts
src/infrastructure/mcp/config.ts
src/infrastructure/mcp/adapter.ts
src/server/context.ts
src/server/http.ts
src/components/approval-dialog.tsx
src/components/orchestrator/mission-control.tsx
src/components/events/activity-inspector.tsx
src/components/outcomes/outcome-comparison.tsx
desktop/server-manager.cjs
scripts/run-missions.ts
supabase/migrations/202609070010_action_execution_keys.sql
supabase/migrations/202609090015_durable_missions.sql
tests/missions.test.ts
tests/missions-database.test.ts
tests/orchestrator.test.ts
tests/agents.test.ts
tests/hermes.test.ts
tests/skills.test.ts
tests/outcome-engine.test.ts
tests/action-requests.test.ts
tests/permission-engine.test.ts
```

Additional discovery: filename inventory of `src/services`, `src/domain`,
`src/infrastructure`, `src/server`, `scripts`, `tests`, `docs`, `desktop` and
`supabase`; source search for Git/GitHub/worktree and process execution; no `.github`
directory. Targeted Git-reference searches (not full document audits) in
`docs/nexus-current-state.md`, `docs/nexus-agent-runtime.md`,
`docs/nexus-missions.md`, `docs/nexus-skills.md`, `docs/nexus-outcome-engine.md`,
`docs/hermes-worker.md`. Git status, recent log and remote URL inspected; no secret
files or hosted account configuration inspected.
