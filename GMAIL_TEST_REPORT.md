# Gmail v1 — audit and verification

## Personal Gmail read-only live acceptance — September 10, 2026

**PASS: real consent, bounded search, selected-thread read, entity context and model summary. Sending/evidence-write acceptance remains pending.**

- User selected `knaggs2005@gmail.com`. Reused existing Gmail adapter, Google OAuth helper, encrypted vault, ToolRegistry/actions, permissions and outcome/audit infrastructure; no application source or schema changes.
- Added server-only `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, and `GOOGLE_GMAIL_REDIRECT_URI` to ignored `.env.local` (0600), reusing the existing Google client without printing credentials. Added only `http://127.0.0.1:3000/api/gmail/oauth/callback` to that client's redirect list; preserved Calendar callback. Enabled Gmail API in project `ary-nexus`.
- Consent requested only identity/email and `gmail.readonly`; callback reported Gmail connected. Installed app confirmed the personal account. Gmail send scope was not requested or enabled.
- Existing Find context searched `newer_than:30d Clevaryn`; returned 12 bounded matches and a notice that more exist. Opened one Google Search Console report. The selected thread displayed its source timestamp and canonical Clevaryn context.
- Existing Understand conversation produced an attributed summary, explicitly treating the report as an unverified third-party claim. It reported no supported important memory candidates. No permanent memory, draft or email send was created.
- Installed Action History independently showed `gmail.connect` succeeded, `gmail.search` and `gmail.read` succeeded at level 1, and `gmail.summarize` succeeded at level 2. Summary uses the canonical `/api/actions/request` with selected connection/thread references.
- Fresh regression: **1,529 tests / 88 files**, typecheck, configured formatting and production build passed in the existing locked-dependency mirror. Logs: `/tmp/ary-google-setup-{tests,types,format,build}.log`.

Use **WORLD → Communications → Gmail workspace**. This remains one Gmail account; the work mailbox is not connected. General Chat dispatch to Gmail has not been verified. No background mailbox ingestion or automatic learning was enabled. Reviewed evidence retention and controlled send/replay require separate acceptance; sending remains off. Source context can be retained in existing action receipts, so durable-memory exclusion is not equivalent to zero retention. Search snippets currently expose literal escaped HTML markup; this cosmetic issue was left outside setup scope. Hosted normalized event storage still reports migration 014 unavailable; canonical action auditing is functional.

Date: 2026-09-07. Repository: `/Users/austin/Documents/Clevaryn/Premiere Plugins/QACutter/ary-nexus`.

**Historical September 7 baseline:** implemented and fixture-verified only. The September 10 section above records subsequent real read-only acceptance; no email has been sent.

## Audit findings and implementation boundary

Existing working systems found before implementation:

- ToolRegistry, ActionRequestService, permission levels/scopes, exact-request approvals, approval expiry/consumption, audit logging, outcomes and execution idempotency.
- Google Calendar OAuth using Google's existing SDK, encrypted persistent credential vault, browser-bound PKCE handoff and connection identifiers.
- Canonical entity/alias resolution and MemoryService with source evidence/version history and permission-gated entity links.
- Existing configured model provider, model usage telemetry, Approvals, Action History, Settings, dashboard and spatial navigation.

These were extended in place. Gmail adds provider/service boundaries and tool definitions, not a second action, permission, credential, inbox, task or memory system. The prior full regression baseline was 505 tests across 37 files. The repository is entirely untracked in Git at this baseline; no history was reset, files replaced from another checkout, or unrelated work discarded.

## Exact files added

| File                                            | Purpose                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/domain/gmail.ts`                           | Validated Gmail inputs/structured findings and provider/intelligence interfaces.                                        |
| `src/infrastructure/gmail/google-auth.ts`       | Gmail scopes and optional configuration of the existing OAuth adapter; separate Gmail namespace.                        |
| `src/infrastructure/gmail/google-gmail.ts`      | Bounded plain-text reads, authenticated Google API adapter, MIME send encoding and durable uncertainty/recovery guards. |
| `src/infrastructure/gmail/mail-intelligence.ts` | Selected-thread summary/draft adapter using the existing LLM and telemetry.                                             |
| `src/services/gmail-service.ts`                 | Canonical linking, summary filtering, local drafts and individually reviewed attributed evidence.                       |
| `src/infrastructure/tools/gmail-tools.ts`       | Register six Gmail tools in the existing central registry.                                                              |
| `src/components/gmail/gmail-view.tsx`           | Context, summary, draft, approval state and receipt experience.                                                         |
| `src/components/gmail/gmail.module.css`         | Restrained responsive styling and reduced-motion states.                                                                |
| `src/components/gmail/mail-review.tsx`          | Human-readable exact email and evidence approval details.                                                               |
| `tests/gmail.test.ts`                           | Permissions, evidence, source linkage, send integrity, failures/recovery and MIME tests.                                |
| `tests/gmail-oauth.test.ts`                     | Gmail scope, state, credential separation, callback and consent checks.                                                 |
| `tests/gmail-intelligence.test.ts`              | Selected-context boundary and strict model-output validation.                                                           |
| `scripts/evaluate-gmail.ts`                     | Isolated browser flow; every Ary API call is intercepted.                                                               |
| `GMAIL_TEST_REPORT.md`                          | This audit, verification and live test report.                                                                          |

## Exact files extended

| File                                             | Necessary extension                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/domain/permissions.ts`                      | Gmail observe/recommend/draft actions and mandatory approval ceilings for send/evidence.                                                                                                                     |
| `src/services/action-request-service.ts`         | Register Gmail through the existing factory; validate owned draft/analysis references, derive entity scope, classify real actions, require idempotency keys and block whole-email memory copying.            |
| `src/infrastructure/calendar/google-calendar.ts` | Optional OAuth client/scope/path/namespace configuration so Gmail reuses the existing implementation. Calendar defaults and public constructor remain compatible. Calendar API execution logic is unchanged. |
| `src/server/calendar-oauth.ts`                   | Optional Gmail cookie/path/label configuration in the existing OAuth response handler.                                                                                                                       |
| `src/server/context.ts`                          | Inject the existing LLM and MemoryService into Gmail tool instances.                                                                                                                                         |
| `src/server/http.ts`                             | Gmail connection/status/handoff routes and injected registry for existing action routes.                                                                                                                     |
| `src/components/dashboard.tsx`                   | Lazy-load Communications and add its existing-style workspace entry.                                                                                                                                         |
| `src/components/spatial/modules.ts`              | Activate the pre-existing Communications orbit slot.                                                                                                                                                         |
| `src/components/permissions-panel.tsx`           | Disclose mandatory email-send approval.                                                                                                                                                                      |
| `src/components/approval-dialog.tsx`             | Show exact sending account/recipients/text or evidence quote; collapse Gmail technical details only.                                                                                                         |
| `src/components/action-center.tsx`               | Show email review in the existing action/approval UI; hide the unsupported whole-email memory shortcut.                                                                                                      |
| `tests/spatial-state.test.ts`                    | Update the expected Communications card state now that the integration exists.                                                                                                                               |
| `.env.example`                                   | Empty Gmail OAuth client credentials and the local callback example. No secret values.                                                                                                                       |
| `package.json`                                   | Add `test:gmail` browser verification command. No new dependency.                                                                                                                                            |
| `README.md`                                      | Setup, scopes, API/tool boundary, source retention, approval/recovery behavior and limitations.                                                                                                              |

No SQL migration is required. Existing tables, RLS, memory/retrieval/temporal facts, provider interfaces, graph/vgpu, task/project tools, voice, ROI, board meetings and unrelated screens remain intact. The existing private `.env.local` was inspected for variable presence only and was not modified for Gmail.

## Final verification results

| Check                              | Result                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Full regression suite              | **542 passed across 40 files**.                                                |
| Gmail-specific automated tests     | **37 passed**: 31 service/provider/pipeline, 4 OAuth, 2 intelligence boundary. |
| Typecheck                          | **Passed**.                                                                    |
| Production build                   | **Passed**.                                                                    |
| Repository formatting              | **Passed**.                                                                    |
| Isolated browser flow              | **14 passed**, no browser errors.                                              |
| Real Google OAuth / mailbox / send | **Not run: credentials and user consent unavailable.**                         |

Automated coverage includes permission levels 0–5, mandatory approval even at 5, rejected/changed approvals, sender-account binding, project-scoped denial recovered from source context, invalid drafts/headers, cross-user credential isolation, read restrictions on summaries/drafts/captured evidence, candidate importance/confidence/quote filtering, truncated/HTML/attachment handling, exact source attribution, repeated evidence capture, no automatic memory writes, and local-only drafting.

Send tests prove one POST across replay and across a simulated local action/outcome commit failure after Google acceptance. Timeout recovery searches Sent and never blindly resends; mismatched content cannot reuse an operation ID. A provider receipt is not asserted to prove delivery. Unicode subject encoding preserves text and folds encoded words/lines according to [RFC 2047](https://www.rfc-editor.org/rfc/rfc2047).

Browser checks cover canonical project chips, selected conversation context, summary with zero automatic memories, individual evidence approval, empty explicit recipients, local draft behavior, exact sender/recipient/edited-text approval, rejection without sending, approved receipt/Sent state, source draft and operation keys, mobile fit, reduced motion, clearing context on a denied search, no full page reload and no console errors. Screenshots were inspected at `/tmp/ary-gmail-understanding.png` and `/tmp/ary-gmail-approval.png` using fixture data.

One intermediate test incorrectly assumed that revoking a nested read policy invalidated an already approved outer evidence request. The actual nested read gate correctly blocked execution; the test was corrected to assert that behavior. This was a test assumption issue, not a permission bypass. Final checks above passed after all code changes.

Reproduce with:

```sh
npm test
npm run typecheck
npm run build
npm run format:check
npm run test:gmail
```

## Live setup status

`GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` and `GOOGLE_GMAIL_REDIRECT_URI` are not configured in the private local environment. The existing integration encryption key is present and was preserved. Desktop inspection reported that the Mac is locked and automatic unlock failed. Google Cloud setup and account consent therefore require the user to unlock the Mac before we can continue them together. No secret needs to be pasted into chat.

## Manual live verification after consent

1. Configure Gmail API, Web OAuth client, authorized callback and test user following README. Connect read-only from Communications in the system browser, then refresh connection. Confirm the displayed sending account is correct.
2. Search for a known Wag Trails conversation. Compare displayed sender/date/plain-text context with Gmail; verify canonical project/entity chips. Check Action History for read attempts and confirm no new permanent memory.
3. Ask for a summary. Verify it reflects the selected thread and that every offered important decision/fact/task quote appears verbatim in its source message. Routine email should produce no durable candidates.
4. Select one candidate, inspect its quote and reject. Verify no memory. Submit again and approve; verify one episodic memory with source account/message/thread/sender/date/quote and project link. Repeat capture: the same memory ID should be returned. Existing confirmed facts must remain unchanged.
5. Prepare a concise draft. Verify recipients are empty and Gmail has received nothing. Edit the text and enter an address you control. Enable sending consent, refresh, and prepare a fresh draft because reconnecting invalidates old connection-bound drafts.
6. Request send and inspect the exact From/To/Cc/subject/body. Reject: verify no sent message. Submit again and approve: compare the single real message in Sent with the reviewed contents and the Action History provider message ID/approval/outcome.
7. Retry the completed action key: verify no second send. If a send is uncertain, preserve its operation ID and inspect Gmail Sent; do not change the content or start a new operation until the first attempt is understood.
8. Test no-access policy, a restricted linked project, and level 5: denial must block access/execution, while level 5 must still require explicit approval to send. Changing recipients after approval must require a fresh review.
9. Disconnect: future reads/sends require reconnecting. Existing attributed memories and action audit records remain; disconnect is not deletion of historical evidence.

## Intentional limitations

- One connected Gmail account per Ary user, one persistent encrypted vault host. Managed shared storage is needed before multi-host/serverless deployment.
- Context-focused search/selection only; no background inbox mirroring or unsolicited email ingestion. Chat does not infer and dispatch Gmail sends.
- Plain-text bodies only, bounded conversations, no HTML/attachment fetching, Bcc, reply-all, Gmail Drafts synchronization, deletion/labeling, or guaranteed threaded replies. Outbound mail is a new message with Nexus source linkage.
- Summaries/drafts reuse the configured real provider; local deterministic tests inject a fixture implementation. Gmail-specific real-model quality and account-specific Google behavior remain part of live verification.
- Model importance/confidence scores and sender headers are not independently verified business truth. Evidence is explicitly reviewed episodic reporting, not an automatic correction/supersession or real task creation.
- Action audit receipts contain bounded email context. They are distinct from long-term semantic memories, but still persist; retention policy is an explicit deployment decision.
- No distributed transaction with Gmail and no automatic external rollback. Sent indexing/Message-ID normalization can leave status uncertain; recovery fails closed and needs operator review. Crash-left vault locks require safe manual recovery after the server is stopped.

Next step: finish read-only Google consent and the controlled live test before considering additional Gmail capabilities.
