# Ary Studio Control v2 — integration audit

September 8, 2026. **Historical initial audit. The user subsequently authorized a fresh studio implementation because the earlier project is on another computer. See STUDIO_CONTROL_TEST_REPORT.md for the implemented scope and physical acceptance gaps.**

## Existing systems to reuse

- `src/domain/tool-registry.ts`: typed executable registration, strict input validation, discovery metadata and server-owned handlers.
- `src/domain/permissions.ts`: capability levels and mandatory approval ceilings.
- `src/services/action-request-service.ts`: tool composition, exact request/reason/reference binding, owner/entity validation and persisted execution results.
- `src/services/action-service.ts` and `permission-service.ts`: policy resolution, approvals, audit, outcomes and request-key replay. Successful replay does not execute a device again.
- `src/server/context.ts`: owner-bound composition and existing desktop-session authorization.
- `src/infrastructure/calendar/vault.ts`: existing encrypted, locked single-host storage primitive where device credentials or durable delivery receipts require it. Do not put secrets in action inputs.
- Existing `/api/actions/request`, approval dialog and Action History: reuse for studio operations rather than adding an execution endpoint or approval system.

No StudioTool, studio scene planner or studio device adapter was located in the current Nexus repository. Memory, entities, providers, desktop, Creative and graph implementations remain unchanged.

## Earlier project location

The existing **New Studio Setup** task references `/Users/austinknaggs/Developer/ARYN`, an Electron/React/TypeScript project with deterministic studio routing. That location is historical task evidence, not inspected source. The current Mac has `/Users/austin`; the referenced user/project folder is absent.

Bounded searches of current Documents, Downloads, Desktop, home and mounted-volume directory names did not locate ARYN or studio-control source. Searches for studio-control/Amaran source references in Documents/Codex, Documents/ChatGPT and Downloads also returned no matches. This does not establish that the source cannot exist elsewhere or on another computer.

The planner, executor, real adapter protocols, configured devices and scene definitions therefore have **not** been audited. Installed applications alone are not evidence of connected hardware. No network discovery or device commands were sent.

## Proposed additive integration, pending source audit

1. Add `src/domain/studio.ts` only for the Nexus-facing StudioTool contract: bounded device inventory/capabilities, scene plan, state observations and device-by-device execution report. Adapt existing source types where practical.
2. Add `src/services/studio-service.ts` as a thin wrapper around the earlier planner/executor. Resolve podcast/recording aliases to configured scene IDs; reject ambiguity. Do not port its assistant, voice stack or model router.
3. Add `src/infrastructure/studio/` adapters only after identifying existing supported transports. Reuse earlier device packages/modules where practical. No invented device addresses, generic arbitrary commands or claimed support for unavailable devices.
4. Add `src/infrastructure/tools/studio-tools.ts`; extend existing permission metadata, registry composition and owner-bound context. Proposed capabilities: `studio.inspect`, `studio.plan_scene`, `studio.execute_scene`. Planning must respect observe permissions. An approved scene must not bypass stricter device/action/product policies.
5. Execution must bind the exact reviewed device list, bounded arguments, scene/config revision and execution key. Validate again before effects. Persist per-step delivery/results; represent succeeded, failed, skipped and uncertain separately. Do not automatically retry a possibly delivered command or pretend physical effects rolled back with a database transaction.
6. Derive displayed studio state from timestamped observations and receipts, distinguishing desired from confirmed state. Reuse action/outcome evidence; do not create another brain or automatically make transient device state permanent memory.
7. Add a scoped Studio scene/plan/report panel using existing UI/approval components. Extend existing module/command discovery only as needed. Natural-language scene intent must enter the current Ary command/action path.

Likely existing files to extend: `src/domain/permissions.ts`, `src/services/action-request-service.ts`, `src/server/context.ts`, `src/components/dashboard.tsx`, `src/components/commands/command-index.ts`, `.env.example`, README and roadmap. Brain intent integration will be identified against its existing router after concrete scene capabilities are known. No schema change is proposed before inspecting the old store and proving one is needed.

## Required acceptance

- Scene resolution and ambiguity; malformed/injected inputs; missing/unsupported devices.
- Denied observe/execute; exact approval; rejected or modified plans; stricter per-device policy; policy changes before execution.
- Full success, mixed failures, dependency skips, stale state, timeout/uncertain delivery, duplicate request and restart recovery without repeating successful steps.
- Owner isolation, source/entity links, complete action/outcome evidence and truthful current-state rendering.
- Realistic isolated UI → plan → approval → executor → partial report → state/history test with adapters explicitly labeled fixtures.
- Regression suite, typecheck, configured formatting and production build after implementation. Controlled physical verification only for specified available devices and an approved plan.

No implementation tests or build were run during this initial documentation-only audit. The user then authorized a fresh Studio implementation. The source-location request below the initial audit is no longer a blocker; see `STUDIO_CONTROL_TEST_REPORT.md` for the new implementation, passing checks and outstanding physical acceptance.
