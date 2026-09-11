# Nexus Event Bus v1

Implementation and verification: September 8, 2026. Extends the existing intelligence, action and visual-presence systems. Hosted Supabase activation is pending migration 014; local implementation and isolated verification are complete.

## Audit and preserved systems

The repository already had request-scoped Brain/Board NDJSON, an AsyncLocalStorage presence callback for ActionService, a browser presence store, voice state, durable actions/outcomes, model_calls and Activity history. It did not have a normalized cross-request journal, resumable backend event feed or a raw event inspector. Those existing interfaces remain usable. No new brain, executor, memory store, provider, graph renderer or authorization system was created.

The bus reports observations. It never dispatches tools or grants permission. Original domain records, permissions, approvals, execution keys and outcomes remain authoritative. The event journal is a metadata projection, not a second business database or an event-sourced rewrite.

## Contract and producers

`domain/nexus-events.ts` defines version 1: UUID `id`, namespaced `type`, ISO timestamp, `{kind,name}` source, nullable `related_entity_id`, `correlation_id`, `mission_id`, severity, visibility and typed payload. Persisted records add `user_id` and a string delivery `sequence`. Null links mean no known association, not an invented entity/mission. Action requests without a conversation correlate by action ID. The canonical orchestration plan remains stored on its original message; that message ID is the mission reference.

| Family     | Current observed producer                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------ |
| ary        | Actual entity-resolution, understanding, reasoning and completion boundaries in AryBrainService  |
| agent      | Actual advisory Board stages, role results, completion/error                                     |
| mission    | Canonical saved plan revision/status and existing mission presence                               |
| memory     | Retrieval/extraction phases; committed memory changes, conflicts and extraction-job state        |
| tool       | Existing ActionService execution; committed action states and outcomes                           |
| skill      | Successful ToolRegistry catalog read; no new skill executor                                      |
| automation | Contract reserved; no scheduler exists to report runs, so no run events are invented             |
| device     | Existing Studio action execution/result; no claim that a device state was independently sensed   |
| voice      | Actual client capture/playback lifecycle; audited server STT/TTS provider results                |
| computer   | Existing DesktopBridge action execution/result                                                   |
| browser    | Actual module navigation observations and existing website-opening action results                |
| permission | Existing policy changes, approval decisions and approval-required presence                       |
| model      | Original model_calls records, including real status, latency, tokens and nullable estimated cost |
| system     | Actual stream connection/availability changes in the browser                                     |

The allowlisted payload contains bounded operational labels, states, record/action/conversation IDs, counts, revision, model/provider, timing/tokens/cost and error reason codes. Unknown payload fields are stripped; invalid scalar types are rejected. SQL also validates payload shapes. Prompts, response text, memory content, tool inputs/output, credentials, embeddings, clipboard contents, transcripts, images and audio are not copied. Labels must remain operational descriptions, never user content. Null cost stays unknown.

`source.kind=client` observations are local UI facts, not attested backend completion. They are not uploaded or persisted. Even a persisted source label is not a security attestation: the owner-authenticated append RPC can publish within that owner's journal. Events are never execution authority. `internal` records are omitted from application reads/SSE. Systems Mode is a presentation mode, not an elevated permission role.

## Persistence and consistency

Migration `202609080014_nexus_events.sql` adds one owner-scoped `nexus_events` table, indexes, read-only RLS, append/read RPCs and nine source-table triggers. Direct authenticated UPDATE/DELETE/INSERT are revoked, including Supabase default grants. Private trigger/store functions are not callable by application roles. Reads and append RPCs resolve the owner from `auth.uid()`; clients cannot select another user.

Triggers cover actions, outcomes, memories, memory_conflicts, action_approvals, permission_policies, model_calls, messages with plan revisions and extraction_jobs. Source records and their events commit or roll back together. Memory access-time touches, embeddings-only changes and approval-consumption bookkeeping are suppressed. No backfill reclassifies historical records as new activity.

Postgres uses a transactional outbox: inserts start with a null delivery sequence. The read RPC serializes delivery sequencing per owner and assigns monotonically increasing cursors only to rows visible in that read transaction. A late source commit is assigned a later cursor on the next read, even if its event timestamp is older. Publishers acquire no event-sequencing lock while holding domain row locks. This avoids source-lock/event-lock inversion. Append acknowledgement can therefore have `sequence: null`; delivered pages always have string cursors. Timestamp is occurrence time; sequence is delivery order.

LocalRepository uses its existing serialized file transaction to append source records and events atomically and assign committed sequences. Its existing single-process/demo limitation remains. Same-owner event ID replay returns the original record; reuse with different data is rejected. HTTP clients can receive duplicates on reconnect and deduplicate by ID. This does not claim exactly-once delivery.

Operational phase publication uses a best-effort `record()` wrapper so telemetry unavailability does not turn successful domain execution into failure. It logs a bounded warning without contents. Canonical source events remain transactional after migration installation; failure of those triggers rolls back the source write. Operational phases are not a durable job queue or a guarantee that every transient phase survives process failure.

## Realtime transport and visual projection

- `GET /api/events?limit=50`: latest page in ascending delivery order. Use `before` for older pages or `after` to resume; each page is capped at 100. Existing bearer authentication and the existing `activity.read` permission apply.
- `GET /api/events/stream?after=<cursor>`: authenticated SSE, also accepting `Last-Event-ID`. Explicit foreign Origin is rejected. Missing storage produces a visible error rather than synthetic activity.
- SSE polls the shared repository at a one-second interval, works across application processes, respects stream backpressure, sends non-activity heartbeat comments and closes after 45 seconds for bounded reconnect/reauthentication and read-policy rechecks. Revocation takes effect on the next connection, within this 45-second lifetime. An explicit deadline also closes unread streams. Eight streams per owner per process are allowed; this is not a distributed global quota.
- The single shell subscriber bootstraps history, resumes by cursor, deduplicates, backs off up to 30 seconds after failure and cancels when hidden/unmounted. Timers, fetch readers and presence scopes are cleaned up. Original request-scoped presence is the compatibility fallback when this stream is unavailable.
- Only fresh ambient phase events affect ARY's visual presence. Historical hydration never animates past work. Terminal events clear operations; Board completion clears concurrent roles and ignores late role updates. A two-minute stale phase lease becomes “current state unconfirmed,” never an invented success/failure. Existing voice meter and lifecycle remain directly responsive; high-frequency audio samples are not journal events.
- Live events are capped at 300 browser records; earlier inspection loads at most another 600. No GPU work, extra animation library or graph changes were introduced. Inspector motion is static and supports the existing reduced-motion shell.

## Activity inspector

Open **Activity → Action history**. The new Nexus activity inspector sits above the existing canonical Action History. It shows connection health, timestamps, type, severity, operational description, family filters and correlation/mission filtering. Systems Mode exposes expandable raw normalized JSON; Ambient Mode omits raw JSON and filters to essential ambient/warning/error activity. Existing action details remain the place to inspect actual inputs, approvals, task IDs and results.

## Exact changes

Added:

- `src/domain/nexus-events.ts`, `nexus-record-events.ts`: contract and canonical record classification.
- `src/services/nexus-event-bus.ts`: owner-scoped publication and presence adapter.
- `src/server/nexus-event-stream.ts`: resumable authenticated SSE.
- `src/components/events/{event-store.ts,sse.ts,presence-projector.ts,nexus-realtime.tsx,activity-inspector.tsx,events.module.css}`: bounded subscription, visual projection and inspector.
- `src/components/nexus/mode.ts`: exposes the existing mode to descendants.
- Migration 014, `tests/nexus-events.test.ts`, `tests/nexus-events-database.test.ts`, and this document.

Extended:

- `src/domain/repository.ts`, both `src/infrastructure/repositories/{local,supabase}.ts`: additive event repository methods; existing domain APIs preserved.
- `src/services/{ary-brain-service,action-service,board-meeting-service}.ts`: observations at existing actual lifecycle boundaries, without changing execution authority.
- `src/server/context.ts`: report existing audited voice results; `src/server/http.ts`: event reads/stream and observed catalog read.
- `src/components/nexus/nexus-shell.tsx`: one shared subscriber and existing-mode context; `src/components/dashboard.tsx`: inspector on Action history.
- `src/components/voice/use-ary-voice.ts`: actual local capture/playback observations; `src/components/presence/store.ts`: avoid duplicate request-stream projection while normalized stream is live.
- `scripts/evaluate-nexus-shell.ts`: optional isolated event acceptance through the existing harness. README and canonical roadmap document this milestone.

No packages, environment values, model settings, core business schemas, task/approval APIs, native adapters, graph interaction or vgpu shaders were replaced.

## Verification and deployment boundary

Automated tests cover all 14 namespaces, schema/payload validation, owner/internal isolation, replay, bounded ordering, rollback, memory-touch suppression, SSE origin/cursor validation, cancellation/deadlines/storage failure, chunked CRLF parsing, deduplication, bounded retention, stale/future suppression and Board role cleanup. Disposable PGlite runs the complete migration chain and reruns 014, exercises RLS/RPC grants, source transaction rollback, source input redaction, late delivery ordering and rejected malformed payloads.

The isolated browser test uses the real UI, HTTP API, LocalRepository and existing approvals/ToolRegistry; reasoning uses the explicit development mock, not a paid model. It asks Ary a memory question, navigates to a canonical project, submits create_task, verifies no task before approval, approves, verifies the actual task/action/outcome/approval, inspects the live journal, switches Ambient/Systems and reloads without replaying work. Standard and reduced-motion runs passed without browser errors. Fixtures, browser sessions and temporary servers were removed. Captures: `/tmp/ary-events-systems.png`, `/tmp/ary-events-ambient.png`.

Verification uses a byte-matched source copy with exact locked dependencies in `/tmp/ary-shell-dependencies`, following the previously documented iCloud dependency read failure. No production credentials or data are copied. Final gates passed: **969 tests across 62 files**, including **41 new event tests**; standalone TypeScript, configured repository Prettier check, production build and all-14-migration audit. No separate lint command is configured. SHA-256 comparison verified **349 source/test/script/migration/config files** match the tested checkout.

**Hosted deployment remains pending.** Apply only migration 014 through the existing reviewed Supabase deployment workflow, then open Activity and verify authenticated live delivery, reconnect and a controlled existing action. Do not rerun initial schema migrations or overwrite the recorded 013 baseline. No hosted account, fixture, SQL migration or project setting was changed in this milestone.

Operational limits: one-second polling plus database/network latency is not a sub-frame guarantee; rapid phases can correctly arrive together. Shared-database contention and multi-node disconnect behavior have not been load-tested. No TTL/retention job or durable push broker was added; monitor table growth and define retention before high-volume operation. Initial pending outbox draining is unbounded per owner and should be load-tested at production scale. The inspector is intentionally bounded. Existing provider/native live acceptance gaps remain unchanged. No next milestone was started.
