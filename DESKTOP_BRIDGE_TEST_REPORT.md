# Ary Desktop Bridge v1 — September 8, 2026

## Current live setup — September 10, 2026

**PASS for bounded owner/session enablement, installed-app scan, approved Calculator launch, receipt replay, rejection auditing and final launcher startup. Full native-control acceptance remains IN PROGRESS.**

- Audited the current roadmap, desktop schemas/provider/guard, fixed subprocess implementation, registry, existing approval UI, operation vault, launcher/bootstrap and test conventions. Reused everything in place.
- Added only `ARY_DESKTOP_BRIDGE_ENABLED=true` and the existing authenticated owner's `ARY_DESKTOP_USER_ID` to ignored `.env.local` (0600). No launcher session token was hardcoded. The owning native launcher supplies the session proof. No numeric permission policy, external connection, schema, model or memory change.
- Restarted the installed Ary app. A real `desktop.list_apps` request passed owner/session/origin gates and returned the installed-app inventory. Selected Calculator from that inventory.
- Existing Review Mac action → one-time exact approval → execution opened Calculator. Native UI independently showed the Calculator window. Result: operation `3987a238-8c9a-4a0e-9a84-a0578da48a16`, bundle `com.apple.calculator`, completed `2026-09-11T02:51:33.693Z`.
- Repeating unchanged inputs returned the same operation ID and original completion timestamp without another approval. Native dispatch-count assertions remain covered by the fixture tests; live evidence is the unchanged durable receipt.
- Submitted a separate Calculator proposal with an explicit rejection-test reason and clicked Reject, operation `e3b8a00d-0e81-42bb-b492-fe0ff03c2eb5`. After final restart, Action History independently confirmed the rejected proposal and separate successful launch/replay records. No unrelated pending task approval was touched.
- Fresh regression: **43 desktop tests / 3 files** and **1,529 full tests / 88 files passed**; typecheck, configured formatting and production build passed in the existing locked-dependency mirror. Logs: `/tmp/ary-mac-live-{focused,tests,types,format,build}.log`.

### Installed launcher and startup recovery

The installed bundle lacked Apple Events and Reminders privacy descriptions already declared in `desktop/build.mjs`. The existing desktop build succeeded; strict signing verification identified resource-fork/Finder metadata in the generated iCloud-backed output. A clean staged copy was re-signed and verified. Startup then waited before loading source code. The old launcher showed the same behavior, so the new package was not retained as a runtime upgrade.

Restored the working launcher archive/runtime and added only its two existing usage-description keys (`NSAppleEventsUsageDescription`, `NSRemindersFullAccessUsageDescription`), then re-signed and strictly verified. The rebuilt diagnostic bundle is preserved outside installed-app discovery at `~/Library/Application Support/Ary Nexus/launcher-backups/rebuilt-diagnostic-20260910.app`. Temporary bootstrap/main tracing was removed; repository `desktop/main.cjs` matches its original bytes. No application source change remains.

macOS TCC logs confirm that signing identity changes invalidated the earlier Documents-folder grant and triggered a fresh consent request; the app waits opening the existing Documents project. Computer Use explicitly refused access to `com.apple.UserNotificationCenter`, so the owner was asked to click Allow. No TCC database edits, Full Disk Access grants, security bypasses or unrelated permission changes were attempted. The macOS prompt subsequently cleared. Final `/api/desktop/health` returned the expected live Ary protocol and the installed authenticated interface loaded successfully. Fresh command-palette app scanning passed in that final session; selecting Calculator required a new exact approval and then completed successfully at 20:06:19 PDT, operation `b8acd21c-2f0c-47f0-b4f3-52d35158b90b`. Action History verified both approval and successful execution. No further Documents consent is currently pending.

Still unverified: Automation/Accessibility/Reminders permissions and actual media/volume/clipboard/Notes/Reminders/Focus/hide/quit/lock/display effects. No private clipboard read, note/reminder creation or disruptive device test was performed. Existing command palette supports discovered-app and website actions; broader conversational Mac intent is not claimed. No next integration was started.

## Historical September 8 status

Implementation is present behind explicit enablement. **Live native-write acceptance remains IN PROGRESS.** The working account was not enabled, privacy access was not granted automatically, and no clipboard content was read, settings toggled, apps launched/quit, or native Notes/Reminders created during verification. Existing DONE milestones are preserved.

## Audit and reuse

The existing Electron launcher already bound its child Next server to loopback and used sandboxed/context-isolated rendering, exact-origin navigation, microphone/camera permission controls and owned-server lifecycle. It did not have a desktop action bridge. The existing ToolRegistry, scoped PermissionService, ActionRequestService, ActionService, immutable approvals, action/outcome storage, execution keys, encrypted vault, and Settings/Approvals/Action History screens were extended rather than duplicated. No migration, new permission store, alternate brain, IPC execution endpoint, generic command handler, or new TCP listener was added.

## Exact file changes

Added:

- `src/domain/desktop.ts`: strict schemas, closed action/player/command enums and provider contract.
- `src/infrastructure/desktop/security.ts`: explicit flag, macOS, authenticated owner and exact loopback launcher-session checks.
- `src/infrastructure/desktop/apps.ts`: live installed-bundle scan, strict exact ID resolution, ambiguity/symlink protections.
- `src/infrastructure/desktop/process.ts`: bounded `execFile`, fixed executable paths supplied by the adapter, sanitized subprocess environment and privacy error translation.
- `src/infrastructure/desktop/scripts.ts`: fixed JXA programs; caller values enter only through argv; Notes text is HTML-escaped.
- `src/infrastructure/desktop/mac-desktop.ts`: fixed native dispatch, durable operation receipt/recovery and uncertain-result refusal using the existing encrypted vault primitive.
- `src/infrastructure/tools/desktop-tools.ts`: registrations in the existing registry.
- `src/components/desktop-panel.tsx`: scoped Settings controls using existing styling and approval API; audit-retention disclosure, app scan, explicit operation state.
- `tests/desktop-bridge.test.ts`, `tests/desktop-bridge-http.test.ts`: validation, permissions, proof boundaries, approval/replay, failure and recovery checks.
- `scripts/evaluate-desktop-bridge.ts`: isolated real read-only native scan evaluator.
- This test report.

Extended:

- `src/domain/permissions.ts`: desktop capability definitions and optional server-derived launcher proof in ActionContext. Mutations and clipboard reads retain a mandatory approval ceiling at level 5.
- `src/domain/tool-registry.ts`: optional preflight hook, preserving existing synchronous schema validation and execute interfaces.
- `src/server/action-context.ts`: derive proof from authenticated HTTP request headers, never the caller's JSON.
- `src/server/context.ts`: compose the real adapter with the authenticated user/scope.
- `src/services/action-request-service.ts`: register desktop tools, run preflight before approvals/replays, require existing request keys, mark real effects correctly, prohibit copying raw desktop receipts into general memory.
- `src/components/permissions-panel.tsx`: mount the new section; existing controls remain intact.
- `desktop/server-manager.cjs`: private random session proof shared only with its owned loopback child. A reused server gets no launcher proof.
- `desktop/security.cjs`: remove spoofed headers and add proof only for the owning webContents and exact-origin API POST.
- `desktop/main.cjs`: attach that header filter; no privileged preload/renderer command access.
- `desktop/build.mjs`: Apple Events and Reminders privacy usage descriptions for future packaging.
- `.env.example`, `README.md`, `ARY_NEXUS_ROADMAP.md`: disabled defaults, owner configuration, operation recovery, setup and acceptance limits.

The native adapter never calls exec, accepts a program/script path, or interpolates caller data into source. The pre-existing server-manager process cleanup remains untouched; its owned-server lifecycle is not registered as a desktop tool. No shutdown, restart, delete, force-kill, arbitrary shell, Premiere or CAD capability exists in the bridge.

## Verification

- **638/638 tests across 45 files passed**, including **36 new bridge tests**. TypeScript, configured Prettier check and production Next build passed. There is no separate lint command. Logs: `/tmp/ary-bridge-tests.log`, `/tmp/ary-desktop-bridge-typecheck.log`, `/tmp/ary-bridge-format.log`, `/tmp/ary-bridge-build.log`.
- Real macOS read-only scan: **111 installed apps**, **646 ms** (repeat **609 ms**), verified Music/TextEdit identifiers, action/outcome capture and exact-key replay. Isolated LocalRepository and explicit test harness authority; this is not a live authentication test. Fixture directory was removed successfully.
- Real installed app: Settings rendered the new controls alongside existing permissions. Clicking Scan installed apps while disabled produced the expected explicit enablement error. Action History displayed `desktop.list_apps failed · level 1` on September 8 at 11:17 AM. This durable real-account denial audit is intentionally retained. No native command was dispatched.
- HTTP end-to-end fixture: existing actions/request → pending approval → existing permissions/attempts/:id/review → execution → action/history → exact replay. Actual handlers, registry, policy/approval service and local persistence; auth and native process execution are test doubles, not Supabase/OS write certification.
- A real macOS JXA execution returned shell-looking argv input unchanged, verifying the native stdin/argv transport without executing that input or causing native writes.
- Injection inputs containing semicolons, `$()`, backticks, newlines, quote breaks, paths, unknown action names and extra shell fields were rejected without dispatch. Literal malicious-looking note/clipboard strings remained argv data. Fixed-program compilation and Notes HTML escaping/newlines were tested.
- Permission levels 0–3 denied changes; levels 4 and 5 required exact approval; rejection, changed inputs and revoked policies prevented execution.
- Disabled host, wrong owner/demo identity, missing/wrong launcher token, null/foreign/missing Origin, remote/forwarded host and non-POST proof checks fail closed.
- Retry tests: completed replay invokes the native runner once; database commit failure recovers a durable receipt under a newly approved request key; changed operation input is rejected; timeout/native failure and receipt-save failure remain uncertain and are not re-executed.

## Remaining live acceptance

1. Enable the flag and pin the authenticated owner locally, then restart the installed app with an owned server. Rebuild/install the bundle if its privacy usage descriptions need updating. These were not automatically performed.
2. Approve a harmless launch/website operation; verify exact target, native result, audit/outcome and replay with no duplicate dispatch. Verify a rejected action does nothing.
3. Grant only needed macOS Automation/Accessibility/Reminders permissions and validate media with the selected running player, absolute volume, clipboard with disposable non-sensitive text, Notes and Reminders in the intended native account/list. Verify returned record IDs against those apps.
4. Create the two fixed Focus shortcuts containing only Set Focus. Shortcut internals are operator-owned and not certified by the bridge. Verify the visible Focus state after an approved operation.
5. Validate hide/quit with disposable app state, then lock/display sleep last while the owner is present. Command receipts report dispatch where the OS cannot return independently verified visible state.

Notes/Reminders may sync through their configured default account. No delete tool was added to clean native test records; future owner-approved fixture cleanup must be performed manually in those apps. No voice/Chat intent extension was added. macOS privacy prompts, native writes and cold-start proof injection in the updated installed launcher still need hands-on acceptance. Single-host vault lock recovery is manual and fail-closed.

### How to use the enabled bridge

In the installed Ary app, press **⌘K**, choose **Refresh installed apps**, search an app name, select it and approve the exact launch. Other fixed operations are in **SYSTEM → Mac Desktop Bridge** and still require their existing approvals and any applicable macOS privacy permissions. This acceptance does not certify those untested operations.
