# Ary Nexus desktop verification

Date: 2026-09-06

- Built and installed `~/Applications/Ary Nexus.app` for Apple Silicon using Electron 44.2.0 and packager 20.3.0.
- Local ad-hoc code signature applied; the installed app opened successfully as **Ary Nexus — Live**.
- The native app displayed the authenticated Supabase workspace, including the existing memories, entities and ROI screen. No credentials or database were copied into the app package.
- Live update verified directly through the native accessibility tree: adding a temporary footer marker to `dashboard.tsx` changed the visible native window without a restart. Removing the marker changed it back. The temporary change was fully reverted.
- 167 tests passed across 16 files, including five desktop ownership/security tests and the desktop health endpoint test.
- TypeScript, formatting, and production web build passed.
- The installed launcher contains only bootstrap code and the local project/Node locations. Application UI, backend and desktop shell source stay in the repository.

## Behaviors checked

- Exact local origin allowed; other origins and non-web external protocols rejected.
- Only known audio-capture requests from Ary qualify; video/unknown media and unrelated permissions rejected.
- Existing development server reused and never terminated by app quit.
- Unrelated and production servers refused without spawn/termination.
- Controlled startup test verifies loopback-only Next.js invocation, no shell interpolation, and termination limited to the owned process group.

## Limits

This is a live development app for this Mac and depends on its project folder, dependencies and Node installation. It is not a notarized standalone distribution and has no remote release updater. The observed launch reused the already-running server; cold-start invocation and ownership were exercised with controlled process tests. Microphone permission behavior is implemented but no recording was made during this task. No authentication tokens were transferred from another browser.
