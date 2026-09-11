# Nexus Missions — durable objectives

September 9, 2026. Implementation and isolated acceptance; hosted activation is pending migrations and an explicitly configured worker.

## Audit and decision

The audit found a working `OrchestratorService`, not a missing mission system. Existing plans already live on canonical owner-scoped messages (`metadata.plan`, version `orchestrator-v1`) with source conversation/message, entity/memory references, per-step action keys, revision compare-and-swap, action receipts, exact approvals, read-back verification, bounded retries, pause/cancel requests, and safe observation parallelism. Existing Board roles share the central memory. The previous UI drove advancement in a browser loop; there was no independent durable mission scheduler or worker lease.

This milestone adds scheduling around that coordinator. It does not introduce a second Brain, graph, task model, memory, approval mechanism, action pipeline or mission database. Legacy execution plans keep their existing commands, defaults and UI.

## Temporal evaluation

Temporal is a good candidate for distributed production execution. Its [TypeScript message-passing model](https://docs.temporal.io/develop/typescript/workflows/message-passing) provides Signals, Queries and Updates for long-lived workflows. Signals/Updates can wake waiting work; their handlers must be designed for concurrency and replay. These map naturally to mission control, submissions and approval notifications.

Its [Activity timeout/retry guidance](https://github.com/temporalio/documentation/blob/main/docs/develop/typescript/activities/timeouts.mdx) supports timeout and retry policies, with cooperative cancellation delivery. A timed-out or cancelled workflow still cannot prove that an external effect did not happen; Ary's existing execution keys and domain-specific receipts remain necessary.

[Temporal deployment](https://docs.temporal.io/self-hosted-guide) adds a service deployment or managed service alongside application workers. This repository has no Temporal client, workflow worker, service connection or operational configuration. Installing a library alone would not make the application durable.

**Decision:** use `CheckpointMissionEngine` with the existing Postgres checkpoints now. No Temporal SDK or server has been installed, and no Temporal replay test is claimed. The domain-owned `MissionEngine` interface covers create, inspect, control, submit, tick and runDue. ARY, ToolRegistry and UI do not import a vendor SDK.

A future Temporal implementation would translate these commands into a workflow identified by owner + canonical mission ID. Activities would invoke the same permissioned coordinator/receipt recovery; signals would carry submission references, never action approval grants. Canonical mission IDs, evidence and action keys would remain in Ary. A production adapter requires worker deployment, authenticated owner delegation, SDK replay/versioning tests and crash acceptance against a running Temporal service. That adapter is not a fake stub in this implementation.

## State and execution contract

Mission state is additive `plan.mission.state`; legacy `plan.status` is preserved.

| State             | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| DRAFT             | Objective and any supplied spec are persisted. No reasoning or tool execution.                 |
| PLANNING          | A worker may prepare the existing plan using bounded shared context.                           |
| READY             | Planning finished; explicit start is still required.                                           |
| RUNNING           | Activated mission has runnable work or a recorded in-flight step.                              |
| WAITING           | External evidence, a retry timer, verification or an unresolved receipt is needed.             |
| APPROVAL_REQUIRED | An exact action is waiting in the existing approval queue.                                     |
| PAUSED            | Owner suspended future dispatch.                                                               |
| FAILED            | Planning or a step failed without an eligible automatic recovery.                              |
| CANCELLED         | Owner stopped remaining work. Completed effects remain recorded.                               |
| COMPLETED         | The coordinator finished without failed steps; deliberate nonmatching branches may be skipped. |

Flow: save objective → plan checkpoint → worker planning → READY → explicit start → claim lease → checkpoint → existing coordinator → ToolRegistry/permissions/approval → action/result/outcome → read-back → next checkpoint. Outcome memory remains the existing separately reviewed `orchestrator.remember` action.

The state has options (step/planning timeout, maximum attempts, retry delay), due time, wait deadlines, evidence submissions, retry state and uncertainty. There are at most 12 topologically ordered steps, three attempts per phase, 50 submissions and a 1,024-event dispatch budget for durable plans. The old 160-event budget remains unchanged for legacy plans. Polling an unresolved approval does not consume plan checkpoint history.

### Branches and waits

Existing step fields remain valid. Two optional fields add declarative gates:

```json
{
  "when": {
    "step": "inspect",
    "path": ["result", "status"],
    "equals": "ready"
  },
  "wait_for": {
    "name": "interview_uploaded",
    "timeout_ms": 3600000
  }
}
```

`when.step` must be a declared dependency. Conditions read an actual predecessor result using the existing safe binding implementation: no expressions, scripts or prototype traversal. False branches are skipped with an explanation. Missing branch evidence fails instead of guessing. Dependencies retain ALL semantics: an OR-join of mutually exclusive branches is not implemented.

A wait starts when its dependencies are satisfied. Its absolute deadline is saved. `mission.submit` accepts a UUID, declared name and bounded scalar JSON payload. Replaying an identical ID is idempotent; reusing it for different content fails. A submission can satisfy declared waits even if it arrived before the step began. It is evidence only: `approved: true` in a payload cannot approve a tool. Payloads are retained in the owner checkpoint and action audit, not copied to ambient events or permanent memory. Payload field binding into arbitrary tool inputs is not added.

External events enter through the authenticated existing action API, not an anonymous webhook:

```json
{
  "tool": "mission.submit",
  "request_key": "unique-submission-request-key",
  "input": {
    "mission_id": "<existing mission UUID>",
    "submission": {
      "id": "<submission UUID>",
      "name": "interview_uploaded",
      "payload": { "source_reference": "owner-approved upload reference" }
    }
  }
}
```

### Agents and parallelism

`mission.agent` submits `{role, objective}` to one of the existing six Board roles. It uses the current provider and central memory/entity services, limits context to four retrieved memories/eight linked entities, validates structured findings and evidence IDs, and stores results in the existing action/outcome record. Model usage stays in existing telemetry and result metrics. It cannot call tools, create agent-local memory, impersonate another identity, or dispatch nested missions.

The existing coordinator still runs up to three explicitly whitelisted observation tools from distinct domains concurrently. Mutations remain serial. Conditional/waiting steps are excluded from parallel waves. General arbitrary-write parallelism, child missions, recursive delegation and a second agent framework are intentionally absent.

## Durability and recovery

Migration `202609090015_durable_missions.sql` adds an index and owner-scoped lease/checkpoint RPCs on the **existing message record**. It adds no tables. A lease is a random internal token with an expiry; it is never caller-provided tool input. Claims serialize with a row lock. Checkpoint writes atomically check owner, active token, expiry and expected timestamp, and preserve canonical source identity. Old tokens cannot release or write over a replacement worker's lease.

Every managed dispatch and checkpoint checks ownership. Direct legacy coordinator advancement of managed missions fails closed. Pause/cancel controls use the existing durable owner control messages and are checked before dispatch and on checkpoint save.

- **Restart before dispatch:** an expired running checkpoint with no action can be reset to planned, retaining its original execution key.
- **Restart after commit:** recover the actual action/outcome receipt and continue verification; never create a second task.
- **Pending approval:** preserve its exact action ID/fingerprint; check the current decision and current policy before execution.
- **Timeout:** save uncertainty and wait for the receipt. Timeout does not promise native/API cancellation. A late worker cannot overwrite the newer checkpoint.
- **Safe transient failure:** bounded exponential retry delay is saved, not held in a browser timer. Only the coordinator's existing safe retry classes qualify.
- **Unknown in-flight external effect:** stay WAITING for an authoritative receipt/domain recovery. No blind replay or fabricated success. If a provider never records a result, operator recovery is still necessary.

`LocalRepository` supports sequential process restart and same-process concurrency, as before. It is not a cross-process live file database. Production concurrency uses Supabase RPCs. The SQL lease tests run through PGlite/PostgreSQL semantics; no hosted Supabase execution is claimed for this milestone.

## Worker and activation

The existing UI now has **Save durable mission**, lifecycle/checkpoint status, plan/start/pause/resume/cancel/manual checkpoint controls and evidence submission. Legacy **Build execution plan** and its original controls remain. Existing approval review, action receipts, read-back and reviewed memory controls are reused. The new map reads the durable mission state. No graph renderer or unrelated screen was redesigned.

Manual **Process checkpoint** works through `mission.tick` and the same ToolRegistry. Closing the browser does not lose data. Automatic progress after browser closure requires the independent worker:

```sh
npm run missions:worker
# Process one bounded pass, useful for supervised execution:
npm run missions:worker -- --once
```

Configuration in `.env.example`:

```dotenv
ARY_MISSION_WORKER_ENABLED=false
ARY_MISSION_ACCESS_TOKEN=
```

Enable deliberately on the worker host. Production uses an authenticated **user access token**, read only from the environment; no service-role bypass. Session expiry stops the worker until credentials are refreshed externally. This is a per-user supervised worker, not a completed multi-tenant daemon/session manager. The existing explicit development demo is supported; do not run concurrent file-store processes against the same file.

The worker asks for up to ten due missions every two seconds; storage caps the query at 20. Each advance goes through `mission.tick` with its own audit/idempotency key and each nested tool keeps its independent checks. Denied workers cannot execute steps. The service must stay running for automatic timers and due work; this implementation does not install launchd, enable autostart or configure Temporal.

Native desktop capabilities still require the current trusted desktop execution context. The generic worker does not forge it. No new provider connection, external effect or background worker was enabled during implementation.

**Hosted prerequisite:** apply the previously pending event migration **014**, then additive mission migration **015**, and configure/start the user-scoped worker. Both migrations remain unapplied to the hosted project in this session. Missing RPCs fail closed.

## Realtime events

The existing `mission.updated` event continues to report canonical checkpoints. Migration 015 adds atomic `mission.draft`, `mission.planning`, `mission.ready`, `mission.running`, `mission.waiting`, `mission.approval_required`, `mission.paused`, `mission.failed`, `mission.cancelled`, and `mission.completed` transitions. Local storage mirrors them. Lease maintenance alone emits no false activity.

`mission.submitted` and `agent.submitted/completed/failed` reuse NexusEventBus. They retain mission/correlation IDs and operational metadata. Source text, evidence payloads and credentials are not placed in the live visual event stream. Existing SSE delivery and Activity inspection are reused.

## Changed files

Added:

- `src/domain/mission.ts`: MissionEngine, lifecycle/runtime, submissions and persistence ports.
- `src/services/checkpoint-mission-engine.ts`: durable scheduling around the existing coordinator.
- `src/services/mission-execution-context.ts`: internal lease context and fencing.
- `src/infrastructure/tools/mission-tools.ts`: registrations through the existing ToolRegistry.
- `src/components/orchestrator/mission-controls.tsx`: scoped controls, status and submissions.
- `supabase/migrations/202609090015_durable_missions.sql`: index, atomic lease/CAS RPCs and lifecycle trigger.
- `scripts/run-missions.ts`: explicitly enabled per-user worker.
- `scripts/lib/mission-fixture.ts`, `scripts/mission-restart-fixture.ts`: isolated process acceptance fixtures.
- `tests/missions.test.ts`, `tests/missions-database.test.ts`.
- This report.

Extended:

- `domain/orchestration.ts`: optional runtime/gates and waiting state.
- `services/orchestrator-service.ts`: reuse planning preparation for durable drafts; guarded checkpoints, pre-dispatch recovery, existing controls and durable event budget. Old plan behavior remains covered by its 50 tests.
- `domain/repository.ts`, both repository adapters: additive mission methods and local atomic events.
- `services/board-meeting-service.ts`: advisory submission to existing roles with shared evidence.
- `domain/permissions.ts`, `services/action-request-service.ts`: capabilities, mandatory request keys, existing project-scope checks and accurate model-cost metadata.
- `server/context.ts`: composition of the engine/registry/Board service.
- `components/orchestrator/{orchestrator-panel,plan-review}.tsx`: show new controls alongside existing plans and approvals; prevent unsupported managed-plan revisions.
- `domain/nexus-map.ts`: show actual durable state.
- `scripts/evaluate-nexus-shell.ts`: opt-in browser mission acceptance.
- `package.json`: worker command only; no dependencies changed.
- `.env.example`, README and roadmap: configuration/status documentation.

Intentionally untouched: persistent memory/reconciliation, retrieval, entity resolution, original action execution/approval consumption/idempotency, provider adapters, task/project models, graph rendering/vgpu, external integrations and stored credentials.

## Verification and manual check

Baseline: **1,001 tests / 63 files**. Final: **1,040 tests / 65 files**, including 33 mission service/process tests and six SQL lease/checkpoint tests. Existing 50 orchestration tests remain passing. Typecheck, repository formatting and production build passed; no separate lint command is configured. All **381 source/test/script/migration/desktop/configuration files** matched the verification checkout byte for byte. The exact locked dependencies were verified in `/tmp/ary-shell-dependencies` because this working directory has the previously documented iCloud dependency-read issue; application source was synchronized, not replaced.

In addition to the crash test, the actual `missions:worker --once` entry point runs in three separate processes and completes an activated mission without browser dispatch. Mission-linked task count remains one (development seed tasks are excluded by source conversation, not by a global count). A final scheduling regression found by this test was fixed: last-step verification now durably records COMPLETED before due polling stops.

Verification logs: `/tmp/missions-all-final.log`, `/tmp/missions-types-final.log`, `/tmp/missions-format-final.log`, `/tmp/missions-build-final.log`, `/tmp/missions-browser-final.log`. Browser evidence: `/tmp/ary-durable-mission.png`.

The process acceptance exits a real Node worker after a task transaction commits, waits for its real persisted lease deadline (no timestamp editing), then launches a fresh process to recover the same receipt. Task ID remains unchanged and exactly one task exists.

Browser acceptance uses a disposable localhost store and explicit development model; real UI → HTTP → registry → approval → internal task transaction → read-back → COMPLETED. Browser reload preserves the exact pending approval. Fixtures, browser and local server are removed afterward. No production account or external tool was used.

Manual check: open MISSIONS → Execution Plans, enter an objective and optional reviewed structured plan, choose Save durable mission, Plan mission, then Process checkpoint (or run the worker). Review READY before Start. Approve the exact action via the existing review panel. Reload while waiting, then resume processing. Inspect the resulting task/action/verification IDs and checkpoint history. Try Pause and a declared event wait; they must survive reload without implying execution.
