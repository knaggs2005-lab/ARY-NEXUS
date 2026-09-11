# Ary Calls v1 — implementation and isolated acceptance

## Live setup attempt — September 10, 2026, 20:32 Pacific

**PARTIAL — credentials and number validation work; no successful call.** The owner approved one short test to their verified number ending 9113. Twilio's free 30-day trial is active, with its assigned Voice trial caller ending 3742.

- Configured the existing server-only `.env.local` pattern: Twilio account/auth token, provider, owner pin, enable flag, caller and a one-number destination allowlist. File mode is `0600`; no credentials were printed or committed. Temporary loopback-only, nonce-path, same-origin credential handoff server was stopped and its script removed after saving. Installed Ary restarted successfully and reports `twilio configured`.
- Native Ary Calls → exact automated-disclosure script → one-time approval → existing ActionService/ToolRegistry/provider execution was exercised. Approval-request action `b049f7f9-eb6e-40d7-b939-7777b71821eb`; failed execution action `78d4261e-c62a-4023-a9d0-e4f07c63c8be` at 20:32:30 Pacific. Failure appears in canonical Call activity/audit history: provider HTTP 400.
- Authenticated read-only Twilio Calls API returned no calls. Provider Lookup succeeded: valid US mobile, no validation or line-type errors. Trial Voice Logs also remained empty. No successful delivery, audio, duration or recipient response is claimed.
- Twilio Debugger UI requires upgrade; Monitor Alerts API returned 401/code 20003 explicitly stating that this feature is unavailable on a trial account. No upgrade, purchase, call outside Ary, or automated redial was performed.
- Current provider adapter discards upstream error bodies. Exact rejection code for the initiation is therefore unavailable. Official Voice trial documentation lists a restricted request contract and custom TwiML constraints; trial request compatibility is a suspected cause, not a verified diagnosis. See https://www.twilio.com/docs/usage/trials/try-out-voice.
- Existing durable pending/uncertain receipt was preserved. No ledger deletion or permission/idempotency bypass was used to force a retry. Resolving rejected initiation safely and obtaining useful sanitized provider errors remain prerequisites to another controlled attempt.
- Fresh **37/37 focused tests passed**, two files; `/tmp/ary-calls-live-tests.log`. No application source/schema/dependency changes, so no new full-suite/build claim. Previous full baseline remains historical evidence.

## Current setup audit — September 10, 2026

Owner selected Calls after bounded Desktop Bridge acceptance. Audited the canonical roadmap, current PhoneService/provider, schemas, existing approval/audit flow, and local environment variable presence (no secret values printed). The existing Twilio adapter remains a one-way, exact-approved script caller with recording/transcription disabled. No duplicate integration is needed.

- Local Twilio credentials, caller number, owner pin, destination allowlist and enable flag are absent. Calls remain disabled.
- Fresh **37/37 phone service/provider tests passed** in the existing verification mirror; log `/tmp/ary-calls-setup-tests.log`. No application source, schema or dependency change; no new build claim for this audit (the immediately preceding Mac pass completed the full 1,529-test/typecheck/format/build baseline).
- Opened the official Twilio Console; it requires sign-in. Asked whether the owner already has an account. Provider account/verified caller and an explicitly agreed test destination are the current setup dependencies.
- No provider account was created, no number purchased, no credential set or exposed, and no call/verification SMS was initiated. Live provider authentication, lookup, delivery, cancellation and charges remain unverified.

September 8, 2026. **Implemented; live provider acceptance remains pending. No real phone call was placed.**

## Audit and boundaries

Existing entity/alias records, ToolRegistry, permission levels, approval/revision UI, action/audit/outcome records, durable request replay, encrypted single-host vault primitive, real transactional `create_task`, command palette and dashboard were reused. No telephony service existed. No second brain, task store, contact book, action pipeline, SQL schema or provider dependency in AryBrainService was introduced.

Calls currently deliver a reviewed script once; this is not a live two-way phone agent. Twilio is the first replaceable adapter. Provider selection was offered to the user; no live account setup or credentials were supplied during this milestone. The implementation and default example remain disabled.

## Exact changes

Added:

- `src/domain/phone.ts`: provider contract, structured inputs/status/transcript schema, exact automated introduction, number validation, transparent summary and terminal states.
- `src/services/phone-service.ts`: saved-contact revalidation, owner/configuration guard, provider checks, allowlist, rate limits, durable call ledger, uncertain-result protection, status/cancel and attributed outcome staging.
- `src/infrastructure/phone/twilio-phone.ts`: fixed REST/Lookup endpoints, environment credentials, escaped inline TwiML, timeouts/duration cap, status/stop/cost normalization. Recording and transcript capture disabled in this adapter.
- `src/infrastructure/tools/phone-tools.ts`: PhoneTool registrations (`phone.initiate`, `phone.refresh`, `phone.cancel`).
- `src/components/calls/calls-panel.tsx`: preparation, explicit intent, existing approval flow, call activity, refresh, stop and separately approved follow-up task.
- `src/components/calls/call-review.tsx`: exact number/script/transcription disclosure in existing approval surfaces.
- `tests/phone.test.ts`, `tests/phone-provider.test.ts`: 37 new behavior and adapter checks.
- `scripts/evaluate-calls.ts`: disposable browser/HTTP/action/task acceptance with test-only injected provider.
- This report.

Extended:

- `src/domain/permissions.ts`: phone capability definitions; initiation always requires approval, even at level 5.
- `src/domain/tool-registry.ts`: optional source action ID in existing execution context.
- `src/services/action-request-service.ts`: register PhoneTool, validate inherited entity/source scopes, require request keys, correctly mark phone audits as external/non-simulated, prevent bulk transcript-to-memory copying, pass follow-up evidence.
- `src/infrastructure/tools/create-task.ts`: preserve optional source action ID in the existing task metadata; transactional creation unchanged.
- `src/server/context.ts`: compose one PhoneService shared by registered tools/configuration.
- `src/server/http.ts`: guarded configuration read and phone category on existing paginated action history; no separate execution API.
- `src/components/dashboard.tsx`, `src/components/commands/command-index.ts`: Calls screen and palette destination.
- `src/components/approval-dialog.tsx`, `src/components/action-center.tsx`: reuse exact-call review and preserve source-action evidence during follow-up revision.
- `.env.example`, `package.json`, `README.md`, `ARY_NEXUS_ROADMAP.md`: blank configuration, evaluator command, usage/limits and status.

**Migrations: none. New dependencies: none.** Existing SQL, memory/retrieval/entity resolution/graph/vgpu/voice/model integrations remain unchanged. No live configuration, provider permissions or native settings were changed. Installed-app read verification produces normal audited configuration/history reads, not calls or business fixtures.

## Safety and persistence

- Initiation requires `user_intent: true`, the full script with Ary's fixed automated-assistant introduction, and exact approval at permission level 4 or 5. Lower permission levels cannot execute.
- Known deceptive identity phrases are rejected; this is not a general semantic deception classifier. The exact human-reviewed script and mandatory truthful introduction are the central safeguards. No cloned voice, user caller-ID override, script-generation agent, live LLM improvisation or automated initiation is present.
- Operator allowlist plus live provider lookup: only valid US mobile/landline destinations. Short codes, emergency/service/premium prefixes, toll-free, VoIP, foreign/invalid/unknown lines fail closed. Lookup itself occurs only after initiation approval.
- Fixed rolling limits: 3 dial attempts/hour, 10/day, one per number/24h, one active or uncertain initiation. Receipt is saved before provider invocation.
- Errors/timeouts after claiming an operation retain an uncertain marker; neither that operation nor a new request key redials automatically. An exact known provider receipt can recover after a database commit failure with fresh approval. A changed operation payload is rejected.
- Cancellation targets an owned existing call, never an arbitrary provider SID. It passes through the same action/permission/audit pipeline. Default cancellation level 5 permits a direct user stop; stricter configured policies still apply. Closing a view or aborting HTTP is not call termination.
- Call metadata/snapshots/transcript source live in existing immutable action/outcome history; encrypted receipt state tracks provider execution. Nothing is automatically permanent memory. Follow-up tasks use existing transactional action creation with `source_action_id` and inherited entity scope.
- Provider "completed" is not proof of recipient identity, script comprehension, agreement or financial impact. Summary is status text plus a bounded unverified transcript excerpt, not fabricated AI conclusions. Unknown duration/cost stays unknown; reported provider cost remains raw amount/currency and is not booked as ROI.

## Verification

- **690 tests passed / 48 files** (653 preserved + 37 Calls checks).
- TypeScript, configured Prettier check and production build passed. No separate lint script configured.
- New tests: valid contact; invalid/short/emergency/service/premium numbers; missing intent/disclosure; known deceptive claims; changed contact after approval; level-5 mandatory approval; no access and linked-project denial; provider line-type refusal; destination allowlist; rejection without provider dispatch; provider failure/uncertainty; idempotent replay; failed database commit/receipt recovery; rate limits; missing durable storage; wrong owner; cancellation; transcript consent/provenance; unsolicited transcript discard; real approved follow-up task with evidence and no duplicated task/memory; foreign call reference; TwiML escaping; fixed endpoints; ringing/active/terminal stop behavior; sanitized provider errors; reported cost normalization.
- **Nine browser acceptance checks passed**, real browser → real HTTP → existing permissions/approval/ToolRegistry → disposable LocalRepository. Only telephony was replaced with a test port in a temporary source copy. Checked Calls palette navigation, exact script review, rejection/no dial, one approved fixture initiation, consented transcript/status summary, separate task approval/source linkage, stop call, persisted audits/outcomes/approvals and no browser errors.
- Temporary server/browser session and fixture directory removed in evaluator cleanup. No production credentials/data copied and no real call made.
- Installed authenticated Ary app: ⌘K → Calls opened the new screen; live calls showed disabled/unconfigured, transcript control and request button disabled, call activity empty. No phone/contact/task write was attempted.
- Screenshot `/tmp/ary-calls-e2e.png` was visually inspected. Existing design system reused; no ambient animation or unrelated screen redesign added.

Initial acceptance failures exposed a configuration endpoint composition typo (fixed and typechecked) and an unsupported browser-test select command (corrected to the supported control). No permission or approval weakening was used to make tests pass.

Logs: `/tmp/ary-calls-tests.log`, `/tmp/ary-calls-typecheck.log`, `/tmp/ary-calls-format.log`, `/tmp/ary-calls-build.log`, `/tmp/ary-calls-e2e.log`.

## Live gate and limitations

Before real use, the owner must choose/configure telephony credentials, an eligible verified caller number, pinned user and explicit destination allowlist, then approve a specific controlled call to an agreed recipient. Provider trial/geographic restrictions, Lookup availability, actual script delivery, stop/status and actual charges remain unverified. No account creation, number purchase or real dial is authorized by the fixture test.

Twilio v1 records no audio and captures no recipient transcript. A future provider supporting transcripts must honor the approved transcription/consent flags and source IDs. No webhook, background polling, independent worker, automatic redial, multi-host locking, interactive conversation or standalone source-receipt recovery UI is claimed. Refresh status explicitly. Uncertain initiation requires provider-console inspection; unsafe guard deletion/reset is intentionally not exposed. The 120-second cap can end long scripts; completion is not a delivery guarantee.

Next milestone recommendation: controlled Ary Calls live acceptance. Roadmap NEXT 3: Calls acceptance, Desktop Bridge acceptance, Calendar acceptance. None started automatically.
