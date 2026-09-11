# Ary Studio Control v2 — implementation and acceptance

September 8, 2026. **Scene/control foundation implemented. Physical acceptance pending.** User explicitly authorized a fresh studio implementation after confirming that the earlier ARYN source is on another computer. No old studio assistant, voice stack or brain was imported.

## Audit and reuse

Read the canonical roadmap and inspected registry, strict request validation, permission policy resolution, exact approvals, idempotency, action/outcome commits, native owner/session authorization, existing domain conversation adapters, approval UI and Action history. Existing systems were extended in place. See `STUDIO_CONTROL_AUDIT.md` for the initial source-location audit; its source blocker was superseded by the user's rebuild instruction.

## Added

- `src/domain/studio.ts`: strict bounded configuration, device categories, fixed commands, scene dependencies, observations, plans, reports and explicit not-sent errors. No raw network addresses, shell commands or macros in caller inputs.
- `src/services/studio-service.ts`: canonical scene IDs/aliases, readiness/capability checks, dependency validation, exact config/state revisions, ten-minute plans, serialized execution, durable per-step progress/receipts, conservative uncertain-delivery handling and current observations.
- `src/infrastructure/studio/amaran.ts`: first real adapter implementation, using the official Amaran Desktop OpenAPI v2, Node's built-in WebSocket and crypto. Fixed `ws://127.0.0.1:12345`; environment-only key; per-request AES-GCM timestamp token; correlated responses; bounded messages/timeouts; individual configured fixture IDs; intensity, sleep and device-supported CCT. Writes are spaced at least 250ms apart. Provider acknowledgment is explicitly distinct from physical confirmation. No third-party runtime dependency added.
- `src/infrastructure/tools/studio-tools.ts`: `studio.inspect`, `studio.plan_scene`, `studio.execute_scene` behind ToolRegistry. Planning respects observe permission. Execution requires an unchanged owner-scoped saved plan and its source action. Level 5 cannot bypass approval; policies are checked again between steps.
- `src/services/studio-conversation-service.ts`: narrow explicit “Ary, podcast mode” / “recording setup” intent adapter. Plans through the same registry, shows steps and queues the existing approval. It does not start recording, intercept general task conversations or introduce another model.
- `src/components/studio/{studio-panel.tsx,studio.module.css}`: Studio inventory, scene plan/readiness, existing approval dialog, step results, recovery-required notice and timestamped observations. Scoped glass panels, restrained entrance motion, reduced-motion support, native labels/buttons. No continuous animation or hardware polling.
- `studio.example.json`, `tests/studio.test.ts`, `scripts/evaluate-studio.ts` and `npm run test:studio`.

## Existing files extended and why

| File                                                                       | Reason                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/permissions.ts`                                                | Three Studio capabilities and mandatory execution approval. Existing policy system remains authoritative.                                                                                                                                                                                 |
| `src/services/action-request-service.ts`                                   | Register Studio, inherit saved-plan product/entity scope, require execution source linkage/request keys, label real-domain actions correctly, retain physical state in action evidence rather than the generic task-memory conversion.                                                    |
| `src/services/action-service.ts`                                           | Optional typed outcome summary/status callback. Existing tools retain their exact defaults. Studio partial/failure maps to failure, uncertain maps to pending, success maps to success. The action's `succeeded` means the executor produced its report, not that every device succeeded. |
| `src/server/context.ts`                                                    | Share the same composed registry with Studio chat intent and bind the adapter to the existing installed-app session.                                                                                                                                                                      |
| `src/services/ary-brain-service.ts`                                        | Optional Studio domain intent hook with accurate provider labels; normal reasoning/retrieval/extraction unchanged.                                                                                                                                                                        |
| `src/components/dashboard.tsx`, `src/components/commands/command-index.ts` | Add the Studio destination to existing navigation and command search.                                                                                                                                                                                                                     |
| `src/components/action-center.tsx`                                         | Show Studio's device report alongside existing approval/audit details.                                                                                                                                                                                                                    |
| `.env.example`, `package.json`, README, roadmap                            | Disabled configuration, verification command and explicit deployment limits.                                                                                                                                                                                                              |

No database migration, new table, permission schema, dependency or API execution endpoint. `.env.local`, credentials, native apps and real devices were not changed.

## Execution semantics

1. Inspect configured devices. Unconfigured/unauthorized/unavailable devices are clearly marked; no live fallback to mock success.
2. Resolve one configured scene. Required unavailable steps or dependencies block execution; optional unavailable steps remain visible.
3. Save a plan in existing action output. Approval binds exact values, evidence, source and entity/product scope. Tampering, owner mismatch, changed configuration/state or expiry require a new plan.
4. Persist a write-ahead operation guard before device effects. Execute in validated dependency order and recheck permission before each dispatch. Stop after uncertain delivery; retain preceding successful effects. Never claim physical rollback.
5. Save the complete report and action/outcome evidence. Replaying the same action or even the same plan with a newly approved key returns its receipt without device execution. A database failure after effects can recover that receipt.
6. Current state is timestamped adapter-reported observation; last requested scene is not asserted as permanent physical truth. No automatic permanent-memory extraction of transient device state.

## Verification

- **826 tests / 54 TypeScript test files passed**, including **33 Studio tests**. Cases: exact/alias/ambiguous/injected scenes, invalid dependencies and commands, disabled controls, missing devices, all permission levels, mandatory approval at level 5, rejection, valid execution, owner/source validation, plan tampering/expiry/state changes, partial failure, dependency skips, uncertain delivery, crash guards, replay/new-key replay, policy checking, pre-dispatch storage failure, post-effect database failure/recovery, chat continuity and Amaran crypto/protocol mapping/correlation.
- **Eight isolated browser checks passed** using an injected fixture adapter only: Studio command-palette navigation, inventory, rejection without effects, approved mixed-success scene, dependency skip, truthful failure outcome, duplicate replay without effects, successful recording-lighting setup. No recording or physical hardware was contacted. Temporary source/repository/receipts and owned browser/server were removed.
- **Typecheck, configured Prettier and production build passed.** No separate lint script is configured. Previous Python Cinema 4D SDK-port tests are unrelated and were not represented as Studio tests.
- Evidence logs: `/tmp/ary-studio-tests.log`, `/tmp/ary-studio-typecheck.log`, `/tmp/ary-studio-format.log`, `/tmp/ary-studio-build.log`, `/tmp/ary-studio-e2e.log`. Browser screenshot: `/tmp/ary-studio-e2e.png`.

## Physical configuration and limits

Amaran Desktop is not installed on this Mac. No Amaran API key, paired light model/ID or live operation was verified. The API implementation is based on the [official usage guide](https://tools.sidus.link/openapi/docs/usage) and [protocol reference](https://tools.sidus.link/openapi/docs/protocol), inspected September 8. It requires the manufacturer's OpenAPI access and app setup. No keys from documentation were copied.

Default Podcast/Recording scenes are **unconfigured templates**, not claims about the user's room. The lighting-only example must be reviewed and edited with real individual fixture IDs and supported settings. 1000 intensity units = 100%; 450 = 45%. CCT is kelvin, sleep is an explicit boolean. No toggle/increment commands, group-wide/all-fixture addressing, recording start/stop, camera motion, audio capture or arbitrary device endpoints.

Camera, teleprompter, display, LED wall and audio categories have typed slots and a provider boundary, but **no live adapters are claimed for these devices yet**. Exact models and supported APIs are needed. `preset` is a reserved typed command and the Amaran adapter rejects it.

Single-host encrypted receipt storage is reused. A process crash may leave its filesystem lock; uncertain operations deliberately block subsequent execution until a reviewed operator recovery is performed. There is no automatic lock stealing, retry worker, automatic rollback or self-service uncertainty-clear button. Preserve original receipts during recovery. This safety limitation must be exercised before live rollout; do not delete guards just to make a command run.

Hardware can change outside Ary between observations. Readback reflects the vendor app, not independent sensors. Live verification must check the physical effect. Approval does not authorize an unattended recording or external outreach.

## Manual acceptance plan

1. Open Studio or use ⌘K → Studio. With defaults, verify unavailable slots and blocked scenes.
2. After deliberate app/key/owner configuration, inspect one paired Amaran light. Review its supported range and current state.
3. Create a lighting-only Podcast plan at a modest owner-selected intensity. Reject once and verify the light does not change.
4. Plan again, approve, inspect the physical light and compare the provider report and Action history.
5. Retry the exact approved request; verify no second dispatch. Disconnect a disposable second light to test partial reporting. Do not induce a production recording failure.
6. Say/type “Ary, podcast mode.” Review the saved plan in Approvals; confirm source conversation linkage and actual light behavior.

Next recommended Studio step: controlled acceptance with one Amaran light, then choose the camera/audio adapter by actual model. No next milestone starts automatically.
