# Google Calendar v1 — implementation and verification

## Bounded live create/update/cleanup — September 10, 2026

**PASS for this bounded owner-authorized test; broader Calendar Live Acceptance remains IN PROGRESS.**

- Reused the installed app, existing Google client/vault, ToolRegistry, permissions, exact approvals, action records and outcomes. No application source, schema, dependency or policy change.
- Work account `austin@clevaryn.com` completed approved-editing consent; personal `knaggs2005@gmail.com` retains read-only Calendar access. Both remain connected.
- Fresh work read showed zero events in the test window. Created one clearly labeled temporary event, with no guests or invitations, linked to Ary Nexus. September 10, 18:33–19:33 America/Los_Angeles. Title: `ARY NEXUS TEST — temporary calendar verification 20260910`.
- Existing request approval → approve once → execution returned GOOGLE CONFIRMED. Event ID: `b0d5b19aa8960d3ce43f489c7069297b40cb4743bd7f65b5346c22a691397788`.
- Approved exact before/after changes to title (`ARY NEXUS TEST — update verified 20260910`) and description. The same event ID returned GOOGLE CONFIRMED; actual Google Calendar displayed the changed event.
- Deleted only that uniquely identified test event through Google Calendar UI because the existing adapter has no delete tool. A fresh Ary Calendar read at 17:37 PDT returned zero events, complete for the window. No other event was changed. Historical audit/source observations remain intentionally retained.
- Installed Action History independently showed `google_calendar.create` approved/succeeded at level 4 (17:34:48), `google_calendar.update` approved/succeeded at level 4 (17:36:21), approval review records, and successful post-cleanup read at level 1 (17:37:46).
- Fresh regression in the existing locked-dependency verification mirror: **1,529 tests / 88 files passed**, TypeScript, configured formatting and production build passed. Logs: `/tmp/ary-google-setup-{tests,types,format,build}.log`.

Limits: live replay, rejection, voice writes and collision handling were not exercised in this test. Existing fixture tests do not replace those live checks. Fresh conflict preflight bound to approval and richer attendee/location handling remain unresolved; this controlled empty-window test does not certify autonomous scheduling or general double-booking prevention. The historical September 7 no-live-write checkpoint is superseded only for this explicitly authorized bounded test. Communications can still show an earlier event observation after Google deletion, labeled as unverified later state. The separate hosted event-journal migration 014 gate remains; canonical Action History works.

Date: 2026-09-07.

## Audit first

Existing working components were reused: `ToolRegistry`, `ActionRequestService`, `ActionService`, permission levels/policies, exact-input approvals, approval expiry/consumption, action execution keys, transactional local receipts/outcomes, entity/alias resolution, reviewed memory recording, approval UI, Action History, and the existing Calendar orbit placeholder.

No Calendar/OAuth provider existed. No new task/project/calendar database was created. The credential vault is isolated server-only storage, not a replacement for Ary's persistent memory or Postgres repository.

## What changed

| File                                             | Purpose                                                                                                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/calendar.ts`                         | Provider contract, strict event inputs, bounded windows, conflicts and time-block calculations.                                                                                    |
| `src/infrastructure/calendar/google-calendar.ts` | Google OAuth and Calendar provider: primary events, pagination, encrypted connection binding, deterministic create IDs, operation recovery, ETag updates, safe event restrictions. |
| `src/infrastructure/calendar/vault.ts`           | Replaceable credential/state storage interface and encrypted single-host file adapter with one-time state and operation locks.                                                     |
| `src/infrastructure/tools/calendar-tools.ts`     | Registers observe/recommend/create/update implementations in the existing registry.                                                                                                |
| `src/services/calendar-service.ts`               | Calendar context, conflict detection and suggestions, using the existing canonical entity resolver over a request-local snapshot.                                                  |
| `src/services/calendar-conversation-service.ts`  | Bounded Chat reads for upcoming/today/tomorrow events and focus references; scheduling writes use the reviewed form.                                                               |
| `src/domain/permissions.ts`                      | Calendar capability definitions and optional mandatory-approval ceiling.                                                                                                           |
| `src/domain/tool-registry.ts`                    | Exposes that approval ceiling in existing discovery metadata.                                                                                                                      |
| `src/services/permission-service.ts`             | Enforces mandatory approval for Calendar writes even at level 5. Existing internal behavior remains.                                                                               |
| `src/services/action-request-service.ts`         | Adds Calendar to default composition, real/external audit metadata, required write request keys, and accurate reviewed-memory descriptions.                                        |
| `src/services/ary-brain-service.ts`              | Calls the small Calendar conversation bridge and labels its returned context accurately. Existing memory extraction/orchestration remains.                                         |
| `src/server/calendar-oauth.ts`                   | System-browser launch/callback with one-time ticket, browser cookie, no-store responses and fixed redirect configuration.                                                          |
| `src/server/http.ts`                             | Authenticated connection status/setup/disconnect routes; public OAuth handoff only. Event operations retain `/api/actions/request`.                                                |
| `src/components/calendar/calendar-view.tsx`      | Native timeline, entity chips, context panel, recommendations, event editor, approval requests and provider receipts.                                                              |
| `src/components/calendar/calendar-review.tsx`    | Shared exact before/after Calendar review.                                                                                                                                         |
| `src/components/calendar/calendar.module.css`    | Scoped restrained glass/lighting, focus/reveal transitions, responsive layout and reduced motion.                                                                                  |
| `src/components/dashboard.tsx`                   | Calendar navigation and Chat-to-event focus links.                                                                                                                                 |
| `src/components/spatial/modules.ts`              | Activates the existing Calendar slot.                                                                                                                                              |
| `src/components/approval-dialog.tsx`             | Adds Calendar comparison to existing approval dialog.                                                                                                                              |
| `src/components/action-center.tsx`               | Adds Calendar comparison to existing queue/history. Existing result JSON includes Google event IDs and receipts.                                                                   |
| `src/components/permissions-panel.tsx`           | Displays the mandatory approval ceiling beside capability defaults.                                                                                                                |
| `tests/calendar.test.ts`                         | Calendar domain, provider, permission, entity-link, failure and external-success/local-failure recovery tests.                                                                     |
| `tests/calendar-oauth.test.ts`                   | Consent/state/browser binding, replay, expiry, partial consent, and disconnect failure tests.                                                                                      |
| `tests/spatial-state.test.ts`                    | Changes the disabled-slot assertion from newly enabled Calendar to still-disabled Communications; preserves original test meaning.                                                 |
| `scripts/evaluate-calendar.ts`                   | Isolated browser verification with all API calls intercepted.                                                                                                                      |
| `package.json`, `package-lock.json`              | Official `google-auth-library` dependency and `test:calendar` command. No graph/model dependencies changed.                                                                        |
| `.env.example`                                   | Empty Google credentials, redirect/vault settings, and encryption-key requirements.                                                                                                |
| `.env.local` (ignored/private)                   | Prepared a random encryption key and local callback URI only when absent; preserved all existing provider keys and never printed secret values.                                    |
| `README.md`, `CALENDAR_TEST_REPORT.md`           | Setup, scope, recovery, accounting/audit boundaries, tests and limitations.                                                                                                        |

## Verification

- Full regression suite: **505 tests across 37 files** (final run).
- Calendar-specific tests: **32** covering permission levels 0–5, mandatory approval at 5, rejection, invalid input, recommendation/read separation, canonical aliases, incomplete reads, failures/retries, successful replay, conflict boundaries, DST, shared/recurring restrictions, encrypted state, account replacement, Google read-only consent, pagination, operation collisions, stale ETags, and retaining links for scoped policies.
- External-success/local-failure recovery: provider-backed test confirmed **one Google POST** across an initial local receipt failure and a freshly approved recovery request.
- Typecheck: **passed**.
- Production build: **passed**.
- Repository formatting: **passed**.
- Isolated browser: **13 checks passed** — timeline/chips, focus/panel, before/after review, no preapproval write, rejection, approved update receipt, recommendations without writes, approved block creation, mobile fit, reduced motion, clearing denied reads, no page reload, no browser errors.
- Screenshot: `/tmp/ary-calendar-timeline.png`, using clearly isolated fixture data.

One browser rerun was delayed by an automatic approval-review timeout. The permitted retry ran successfully. The initial browser script also had an incorrect CLI label selector; corrected before the successful run. Neither issue caused any live Google calls. Four byte-identical `* 2.ts` duplicates reappeared in generated `.next/types` during the last typecheck; only those generated copies were moved to a temporary backup before rerunning verification. Source and compiler configuration were preserved.

## Live status and migrations

**Google is not connected yet.** No Google OAuth client ID/secret was present locally, and the Mac is locked, so the signed-in Google Cloud setup and user consent cannot be completed from this task. This report does not claim a successful call to the user's real Calendar. No real events were created or modified.

No database migration is required for Calendar. Existing actions, outcomes, approvals, permissions, entity records and database schemas remain in use. The previously pending Economics migration is unrelated and was not changed.

## Manual live test plan

1. Unlock the Mac. Configure the Google Cloud Calendar API and Web OAuth client using the exact redirect in README, then complete read-only consent from Calendar → Continue securely in Google.
2. Refresh connection, select a short known date window, and read events. Compare event times/all-day dates with Google. Verify observed conflicts and canonical entity chips without any write.
3. Set a daytime window and request a 60-minute block. Verify the suggestion is explicitly limited to primary-calendar context and creates no event.
4. Enable editing consent. Prepare a personal test event with a project link and inspect the exact approval details. Reject it; confirm Google is unchanged and the audit records rejection.
5. Submit again and approve. Confirm one real event in Google, a provider receipt in Nexus, and action/outcome/approval records with the resulting event ID.
6. Select that event and propose a title/time change. Inspect before/after, approve, and compare with Google. Try changing the Google event before approval execution: Ary must reject the stale version and require a new review.
7. Set a tool or project policy to no-access and verify creation/update is blocked. A level-5 Calendar write policy must still request approval.
8. Retry an already successful action key and verify no second event. For a deliberately simulated local-receipt failure, keep the operation ID but use a fresh request key and approval; verify recovery returns the existing event.
9. Ask Chat for upcoming Calendar events or tomorrow's Calendar conflicts, then use an event focus link. Disconnect and verify subsequent reads/writes require reconnecting.

## Deliberate limits

Only the connected primary calendar is considered. No attendee invitations, recurring-series edits, all-day edits, deletion, calendar sharing, autonomous scheduling, Gmail, finance, payments, Drive, or additional agents were added. Existing linked Nexus entities are retained on updates; v1 may add links but does not remove them.

Chat supports bounded read/context requests; free-form natural-language writes are directed to the exact-details Calendar form. Time-block recommendations require an explicit window and never infer work hours or other people's availability.

OAuth scopes are wider than exposed tool capabilities; server registration and approval ceilings remain the actual execution boundary. Credentials use a single-host encrypted persistent vault. Multi-host/serverless deployment requires a managed vault adapter; stale file locks after a crash require operator review after stopping the server.

Google writes and local PostgreSQL receipts cannot share an atomic transaction. Provider operation markers support recovery, but an interrupted write remains uncertain until verified; no automatic external rollback is attempted. Google-side verification, OAuth publishing/test-user configuration, quotas, and account-specific behavior remain part of the pending live check.

Memory/retrieval/temporal facts, graph/vgpu, task/project execution, model providers, ROI calculations, voice, board meetings and unrelated screens were intentionally preserved. Calendar reuses the existing extraction/review and action/outcome mechanisms.

## Live acceptance audit — September 7, 2026 continuation

Read the requested Calendar Live Acceptance prompt and canonical roadmap before inspecting the current implementation. This is an acceptance pass over the existing integration, not a replacement. Voice remains IN PROGRESS in the actual roadmap despite the new prompt's assumption that it is DONE. The owner explicitly requested proceeding with Calendar, so Calendar is the active milestone; no voice completion evidence was invented.

### Existing implementation verified by inspection

The existing CalendarProvider, Google OAuth with PKCE/one-use browser-bound state, encrypted single-host token vault, primary-calendar list/create/update adapter, CalendarService, ToolRegistry registrations, mandatory-approved external writes, exact request fingerprints, deterministic Google create IDs, operation markers, ETag update checks, local action/outcome records, event editor/review, entity linking and audited reviewed-memory path are present. These systems were preserved. All-day DST conversion, recurring instance expansion, cancelled-event filtering, declined/transparent event availability, connection-bound approvals and incomplete-result suppression already have implementations.

### Connection blocker and browser state

A safe environment presence check confirmed **Google Calendar client ID and secret are missing**; redirect URI and integration encryption key are present. Values were not printed or changed. Google Cloud opened to its first-time account/terms setup with no project selected. Account/project confirmation was requested from the owner. No terms acceptance, project creation, OAuth client creation, consent grant, token change or provider permission change was performed. The setup tab was shown and retained for continuation. This supersedes the historical locked-Mac explanation; credentials/account setup are the current blockers.

### Acceptance gaps found before any live write

1. `calendar-conversation-service.ts` currently requires calendar/events/time-block words. Several requested phrases (next meeting, tomorrow's schedule, work on a project) do not reliably enter that bridge. Natural-language writes currently direct the user to the existing form; no voice-created Calendar proposal was verified.
2. `GoogleEvent` normalization drops locations and reduces attendees to display names or emails; the requested rich attendee/location preservation is not fully covered.
3. Conflict detection exists for reads/recommendations, but the actual create/update path has **no fresh availability check or explicit conflict acknowledgement bound to approval**. Existing review is insufficient to claim double-booking protection. No live writes will be used to demonstrate safety until this gap is addressed.
4. Suggestions are chronological primary-calendar gaps, without combined task/goal/priority ranking. No cross-calendar availability or business priority inference is claimed.
5. No Calendar delete tool exists. Cleanup of approved temporary test events must use explicit Google Calendar UI deletion, restricted to the exact created IDs; do not add a general deletion tool merely for the test.

### Planned narrow changes after account setup

If confirmed necessary by the live path, extend the existing files: `services/calendar-conversation-service.ts` for bounded supported phrases/clarification and reviewed proposals; `domain/calendar.ts`, `infrastructure/calendar/google-calendar.ts`, `infrastructure/tools/calendar-tools.ts`, `services/calendar-service.ts` for source-field preservation and conflict preflight/recheck; `components/calendar/calendar-view.tsx` and `calendar-review.tsx` for exact conflict review using the existing design. Add regression cases beside the existing Calendar tests and preserve provider/action interfaces. Any Chat proposal wiring must reuse the existing Brain/action approval pipeline, not add privileged voice execution. This is a plan, **not implemented or verified work**. No unrelated services or migrations are planned.

### Fresh validation and live results

- **32/32 Calendar-specific tests passed** across Calendar and OAuth tests.
- **602/602 total tests passed** across 43 files.
- Typecheck, configured Prettier check and production build passed; no separate lint command exists.
- Logs: `/tmp/ary-calendar-acceptance-{specific,tests,typecheck,format,build}.log`. These are baseline regression gates; fixture success is not live Google certification.
- Live connection, read/account comparison, create/update, conflict handling, voice action, live entity linking and external idempotency: **not run / blocked by setup and identified gaps**.
- Temporary Google events created: **0**. Removed: **0**. No live fixture cleanup is needed yet.
- Files modified in this audit: **CALENDAR_TEST_REPORT.md and ARY_NEXUS_ROADMAP.md only**. No application code, schema, credentials, providers, UI or permissions changed.

**Google Calendar Live Acceptance remains IN PROGRESS, not DONE.** NEXT 3: Calendar live acceptance (owner-selected active task), finish remaining Voice live acceptance, then Gmail live acceptance/retention. No Gmail work started.


### Google Cloud project created; OAuth audience approval pending

The owner created project **ARY NEXUS**, ID `ary-nexus`. Credentials page confirmed no OAuth clients and an unconfigured consent screen. Local client ID/secret remain absent; the existing callback is `http://127.0.0.1:3000/api/calendar/oauth/callback`. Entered Ary Nexus app name and selected the signed-in owner support email in the consent setup wizard; no branding/client creation was submitted.

The audience step disables Internal for this account and offers External in testing mode. Automatic approval review rejected selecting External because it is a persistent access configuration choice not explicitly approved by the owner. The audience setting was not changed; no workaround attempted. Requested approval for External testing restricted to the owner's test account. Setup tab retained at the audience step. No tokens, scopes, real Calendar calls or events were created/changed.


### OAuth branding and local client created

The user completed consent configuration; Google showed “OAuth configuration created.” Created one Web application OAuth client named **Ary Nexus Calendar — Local** in `ary-nexus`, with the existing exact callback `http://127.0.0.1:3000/api/calendar/oauth/callback` and no additional JavaScript origins. Google confirmed “OAuth client created.” Credential values were not printed.

The generated JSON download did not appear in Downloads; a browser download-event wait timed out. The creation dialog is retained for the owner to download the configuration directly. Local client ID/secret are still unset. Test-user membership, Calendar API enablement and actual Calendar consent remain unverified. No Calendar events or live provider requests were made. Application source and permissions remain unchanged.


### Download installed and API enabled — September 7, 2026

- Validated the downloaded OAuth Web client for project `ary-nexus` and redirect `http://127.0.0.1:3000/api/calendar/oauth/callback`. Saved only Calendar client ID/secret into the existing ignored `.env.local`, preserving other settings; mode 0600. No credential values displayed. No additional client created.
- Existing `googleCalendarConfigured()` returns true and `calendarRedirect()` returns the expected callback. Local HTTP server returns 200.
- Google Audience verified External / Testing; saved and verified the owner as the sole test user. Google Calendar API activation verified with Status Enabled. Other APIs, billing and publishing settings untouched.
- Branding still reports incomplete in Audience despite populated required app name/support email/developer contact fields. No invented public URLs or domains were added. Consent must establish whether this blocks local testing.
- Installed Calendar view displayed Failed to fetch; no successful consent or live Calendar read yet. The Mac subsequently locked and native automation explicitly reported automatic unlock failed. User unlock is required to continue interactive sign-in.
- Application source, schemas, permissions and tests unchanged in this setup step. Prior 602-test/typecheck/format/build baseline remains the latest source verification. No events created, edited or deleted. Calendar Live Acceptance remains IN PROGRESS.
