# Desktop launch recovery — September 9, 2026

The installed app failed before its local server started: Next.js attempted to extend an undefined Commander export. Its iCloud-backed dependency tree returned inconsistent module reads; restoration there also stalled. The previous milestone had validated the healthy test mirror, which did not establish native launch readiness.

Restored the same locked dependency versions from the verified tree into `~/Library/Application Support/Ary Nexus/dependencies/node_modules`. The project now links to that stable local directory. The previous dependency tree is retained beside the repository at `../.ary-nexus-dependency-backup-20260909`; it is outside TypeScript’s source scan. Source, credentials, user sessions and database data were preserved. No dependency versions were changed by this repair.

Turbopack rejected the external dependency link as outside its filesystem root. The existing desktop launcher and npm dev/build commands now use supported Webpack mode, retaining hot updates and all existing application behavior. Modified `desktop/server-manager.cjs`, `tests/desktop.test.ts`, and `package.json`; no application business logic changed.

Verification performed in the actual repository and installed app:

- Seven desktop trust/lifecycle tests passed.
- Formatting passed for changed launcher/test/package files.
- Production Webpack build passed.
- Local desktop health returned 200 with Ary identity, protocol 1 and live updates enabled.
- Used the installed app’s native Restart Ary Nexus command; fresh launch loaded the signed-in Supabase workspace, restored the saved conversation, displayed the real OpenAI response, and returned to Ready with an enabled message field.
- Network recovery initially left stale session/busy UI; a clean restart cleared it. No new message, task, approval or external action was created by this verification.

Existing operational-event persistence warnings appeared in the server log. They did not prevent the verified launch, dashboard/conversation reads or the observed real model response. The older hosted event-storage/live-acceptance gates remain separate; this repair does not mark them complete.

Keep the Application Support dependency directory in place. If reinstalling dependencies, target this local directory rather than recreating a cloud-backed dependency tree. The retained backup can be removed only through a deliberate cleanup, not as part of this repair.
