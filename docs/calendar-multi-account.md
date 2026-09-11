# Calendar: personal and work accounts

September 10, 2026. Implemented and locally verified; live read-only acceptance passed for both personal and work accounts.

## Audit and architecture

The existing Calendar OAuth provider overwrote `connection:<Ary user>` on every consent. The existing provider, ToolRegistry, actions/approval/audit/outcomes, encrypted vault and UI were extended; no second integration or database schema was introduced. The same Google OAuth helper is reused by Gmail, so its non-Calendar path deliberately retains existing behavior.

Connections remain in one encrypted, atomically replaced record under the original user-scoped key. The original fields remain the default connection, with an optional additional-account array. Existing records require no migration. Locking serializes connection updates, disconnects and in-flight operations. Verified email identity deduplicates reconsent; rotating a connection ID invalidates only that account's pending writes. At most eight accounts are retained. Public status projects only account labels, connection IDs and read/edit consent status, never tokens.

Reads and recommendations accept an optional connection_id; omission preserves legacy default-account behavior. Writes retain their required connection ID and exact existing approval. A read-only account cannot inherit editing consent from another account. Unknown/stale/other-user IDs fail closed. Disconnect removes one connection locally and attempts revocation of that account's token; other accounts remain available even if revocation fails. Removing the default promotes the remaining account without rotating its ID.

## Exact changed files

- `src/infrastructure/calendar/google-calendar.ts`: preserve multiple accounts on OAuth completion, safe public account status, selected-account token routing and independent disconnect.
- `src/domain/calendar.ts`: additive optional read selector and public account list/result metadata.
- `src/services/calendar-service.ts`: preserve selected account through nested recommendation reads and audit metadata.
- `src/server/http.ts`: validate/log optional selected connection for the existing owner-only disconnect route.
- `src/components/calendar/calendar-view.tsx`: account selector, account-specific consent state, read/recommend/disconnect target, clearing stale events/drafts/receipts on switching; existing styles and approval flow reused.
- `tests/calendar-oauth.test.ts`: multi-account preservation, reconsent, credential selection, owner isolation, selective disconnect/revocation failure, rollback and per-account write consent.
- `tests/calendar.test.ts`: selected-account read/recommend pipeline and audit.
- `scripts/evaluate-calendar.ts`: existing isolated browser acceptance extended for account selection and read-only boundaries; current WORLD navigation used.
- `README.md`, `ARY_NEXUS_ROADMAP.md`, this report and learning-source audit: documentation and factual status.

## Verification

- Full existing suite plus additions: **1,516 tests / 87 files passed** in the isolated verification checkout containing the changed files.
- Focused Calendar/OAuth/Gmail: **44 passed**.
- TypeScript, full configured formatting check and production build: passed. Script formatting/typecheck were repeated after extending the browser evaluator.
- Existing fixture browser workflow: **17 checks passed**. Two-account selector, stale timeline clearing, exact account request, read-only write controls, approved/rejected writes, recommendation pipeline, responsive/reduced-motion presentation and no reload/browser errors verified. Every provider/API fixture was intercepted; no Google write occurred. `/tmp/ary-calendar-timeline.png` visually inspected.
- Live installed app: personal Google OAuth callback succeeded and the account appears read-only in the selector. An actual audited seven-day read returned one event and complete results; event details are not copied into this report. Work OAuth initially failed with developer-approved-testers access_denied. Added only the work account to the existing Google project tester list, preserved the personal tester and Testing status, and completed work read-only OAuth successfully. Both accounts appear in the installed app selector. An audited work-account read failed with Google 403 notACalendarUser. Opening Google Calendar directly under the work account showed Service Not Allowed and explicitly stated that the Google Workspace subscription was cancelled and must be renewed for Calendar. This was the initial blocker; no subscription or billing changes were made by Ary. After the owner reported resolving it, a fresh audited work-account read succeeded: zero events, complete results for September 10–17. A subsequent personal-account read also succeeded: one event, complete results for the same window. Both existing connections remain read-only. Live selected-account read acceptance now passes; no further code/configuration change or renewed OAuth was required. Temporary reason-only diagnostic logging was removed. No tokens or event details were retained in this report.

## Limits / unchanged systems

This is simultaneous connection support with a selected-account view. The Calendar screen remains a selected-account timeline. Chat now reads all connected primary calendars by default and supports personal/work, exact email and exact company-domain labels. Shared/secondary calendars and Gmail multi-account support are not implemented. Unspecified chat windows retain the existing seven-day default; today/tomorrow use the conversation time zone. Other date phrases are not a general date parser. No new permissions, autonomous scheduling, external event changes, migrations, deployment, provider-model change, memory redesign, or expanded Google scopes. Existing hosted event-journal unavailability remains a separate deployment gate. Local encrypted-file vault remains single-host storage.

## Chat across accounts — September 10 follow-up

Extended `src/services/calendar-conversation-service.ts` in place. Chat discovers the existing owner-scoped connection list, then issues one existing `google_calendar.read` ActionRequest per selected account, sequentially to respect the shared vault lock. General Calendar questions check every connected account. Personal/Gmail targets a Gmail-domain account; work/business targets a non-Gmail domain. Multiple matching role accounts require an exact email. Exact company-domain labels (such as Clevaryn) are supported. No credentials or account aliases are copied to memory. These role heuristics are not claims about ownership.

Each response names the accounts checked, labels each event, includes account-specific action IDs and counts in message metadata, and reports individual failures. Events are chronologically merged, the earliest sixteen are shown, and account-namespaced IDs prevent cross-account ID collisions in conflict checks. Partial reads never imply complete combined availability. Request keys include message and connection IDs; the source-message timestamp fixes the time window for idempotent replay. Writes still direct the user to the existing approval form.

`src/components/dashboard.tsx` and `src/components/calendar/calendar-view.tsx` additionally carry the selected event's connection ID into the existing focus navigation. A stale requested account cannot silently fall back to another account. Existing layouts, providers, schemas, permissions and calendar APIs remain unchanged.

`tests/calendar-conversation.test.ts` adds thirteen tests covering combined reads, account targeting, plural/schedule questions, conflicts, partial failure, denial/audit, ambiguity, write boundaries, replay, incomplete results and legacy status compatibility. Live installed-app chat was verified with the real connected accounts: an unqualified seven-day question checked both, returned one personal event and zero work events, and preserved source labels. No external writes occurred.

Final follow-up verification: **1,529 tests / 88 files passed**, standalone TypeScript, full configured formatting and production build passed in the isolated locked-dependency checkout after the final UI changes. Live work-only “tomorrow” chat checked only the work account and returned complete empty results for local midnight-to-midnight. Live event-focus navigation opened the personal source account and selected the actual returned event. The two chat requests completed normal memory extraction with no new durable memories. No live work event existed to exercise a work event-focus click; provider selection is covered by automated tests, but that particular live click remains untested.

## Subsequent bounded approved editing check — September 10

Work Calendar completed approved-editing consent; personal remains read-only. One temporary Ary Nexus-linked event was created and updated through exact approvals, then deleted through Google Calendar UI; fresh Ary read confirmed cleanup. See [bounded live report](../CALENDAR_TEST_REPORT.md). General conflict/replay/voice acceptance remains open. No application code changed in this setup pass.
