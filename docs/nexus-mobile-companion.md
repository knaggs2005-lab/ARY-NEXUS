# ARY Mobile Companion v1

September 10, 2026. A dedicated mobile presentation sharing Ary Nexus intelligence and authority. Implemented as a mobile web companion; not an App Store binary or a claim of physical-phone acceptance.

## Audit and architecture decision

Existing: Next.js/React, authenticated same-origin HTTP APIs, Supabase sessions/RLS, streamed Brain conversations, provider-agnostic STT/TTS, voice interruption/VAD, missions, exact approvals, emergency stop, real task/memory tools, scoped perception capture, StudioTool, bounded graph queries, shared command ranking and the Nexus Event Bus. The desktop Electron launcher remains a development host. No SwiftUI mobile app, React Native/Capacitor project, mobile manifest, location provider, push subscription storage or mobile companion shell existed.

| Approach                              | Strength                                                                                                                                            | Cost / limit                                                                                                                        | Decision                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Native SwiftUI                        | Native Apple presentation and access to platform notification, camera, audio and location frameworks; best long-term fit for deeper iOS integration | Separate client/release/signing lifecycle; Apple-specific; would need to reproduce client state and approval presentation carefully | Evaluate as a future client over the same APIs, not a new brain |
| Existing Next.js/React mobile web app | Reuses the actual conversation, auth, voice, approvals, memory, event and tool paths; reaches iOS and Android through a dedicated UI                | Browser/OS lifecycle and media limits; requires reachable HTTPS; background push needs extra infrastructure                         | **Chosen for v1**                                               |
| React Native / Capacitor              | Potential shared web/native ecosystem                                                                                                               | Neither exists here; adds bridge/dependency/release work without solving current core requirements                                  | Not added                                                       |

[Apple's SwiftUI overview](https://developer.apple.com/documentation/swiftui/) explains native framework interoperability. [WebKit's Home Screen Web Push documentation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) establishes that installable mobile web apps can receive permissioned push; that capability is not implemented merely by adding a manifest. [Apple's Web Push guide](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) describes the additional delivery setup.

The architecture is a presentation branch in the existing Dashboard controller. It does not copy the Brain streaming/extraction/cancellation handlers or create a mobile executor. The dedicated `/mobile` route skips the desktop spatial shell. Phone-width entry at `/` routes once to `/mobile`; `/?systems=1` preserves explicit desktop access. Resizing never destroys a running conversation.

## Interaction language

Five thumb destinations replace the deep desktop navigation:

- **Ary:** actual voice presence, one prominent Talk action, typed command, streamed answer, transcript and conversation continuity. The shared command palette is reachable from the header; its duplicate floating desktop launcher is hidden.
- **Missions:** concise objective/state/recent progress and valid plan/start/pause/resume/cancel/retry controls and explicit checkpoint processing through the existing MissionEngine tools. Mission creation starts with a draft in the same Ary conversation. No automatic action from navigation.
- **Capture:** short note → exact review → existing episodic memory capture. Optional approximate location and separately permissioned image/camera input.
- **Nexus:** focused real entity neighborhood, memory search/provenance and device/scene requests. Tap or keyboard-focus an entity to traverse; desktop remains the full graph/Systems experience.
- **Updates:** current approval queue, shared explanatory approval dialog, real important events, install/privacy access and sign-out.

Design: dark ink surfaces, a restrained blue-gray light field, existing event-driven Ary presence, large text entry, 44px controls, safe-area-aware dock and independent content scrolling. Activity is never synthesized. Motion respects reduced-motion preferences. Spatial display is deterministic SVG; at most 18 nodes and 36 relationships, one hop at a time, with overflow/truncation messaging. It is a focused neighborhood viewer, not a force-layout simulation or full orbit editor.

## Data, permissions and privacy

- `GET /api/dashboard?surface=mobile` is an additive startup projection on the current API. It returns at most 20 conversations, 100 entity command entries, 200 aliases and 30 task command entries; description/metadata are stripped from entity/task entries. It sends no memory/action/outcome bodies. Deep surfaces fetch their existing APIs on demand.
- Existing repository list methods remain in this projection. Payload is bounded; server-side list scans and the shared controller's legacy imports remain optimization work. This is not a claim of fully indexed mobile pagination or a bundle benchmark.
- Voice uses `useAryVoice` and the same Dashboard `send` handler, messages, extraction and permissions. No microphone activation on entry. Hiding the companion stops voice; there is no mobile background-listening control or wake word. Physical audio/autoplay/echo behavior still needs device acceptance.
- Quick captures go through `memory.capture` with mandatory review and a stable retry key. They are explicit episodic notes, not silent updates to confirmed facts. Unsaved notes stay in screen memory only; switching away or reloading discards them. There is no offline write queue.
- `MobileLocationProvider` isolates sensor access. `BrowserLocationInput` uses a user-triggered, secure-context, one-shot browser request with low accuracy, no watcher and a ten-second timeout. Coordinates are rounded to two decimals and reported with at least 1,500m uncertainty. Only the preview is held locally; a separately reviewed memory capture can include it. No place inference, geofence, automatic action or background tracking. Hiding the page discards location; readings expire after five minutes. Abort/denial cannot commit late coordinates.
- Mobile Perception narrows inputs to selected image or webcam. A capture hint requests the rear camera where the browser supports it. Existing per-source approval, preview, separate model-analysis approval and temporary image retention remain intact. Opening camera choices does not activate a camera.
- Approvals are the existing `ApprovalDialog`, exact request envelopes, current permission check and replay-safe execution. Merely opening the companion never approves anything. STOP CONTROL remains accessible in the dock.
- Device inspection/scene planning/execution uses the existing `studio.inspect`, `studio.plan_scene` and returned `studio.execute_scene` request. No direct device endpoint or host bypass was created. **Remote phones cannot bypass the current Mac/loopback restrictions.** A securely authorized execution host/remote-device transport remains a separate live gate; unavailable requests report errors instead of pretending devices changed.
- Updates use existing authenticated Nexus realtime events and the current approval queue. These are **foreground in-app notifications**. There is no APNs/Web Push registration, delivery server, lock-screen notification or background badge promise in v1.

## Installation and offline behavior

Deploy the existing application to an authenticated reachable HTTPS origin, then open `/mobile`. A phone's `127.0.0.1` refers to the phone, not the Mac. This milestone does not expose the Mac development server, weaken loopback checks, create a tunnel or deploy publicly.

On iPhone, use the browser's Share → Add to Home Screen option; on supported Android browsers, use Install/Add to Home Screen. A scoped manifest, 192/512 PNG icons and Apple web-app metadata provide the companion launch surface. Actual install prompts vary by browser.

The `/mobile` service worker provides **network-only navigation** with a small offline explanation. It does not cache private pages, API responses, conversations, images or audio, and never queues/replays actions. Online data requires authentication. Existing session persistence remains the current Supabase client behavior; service-worker caching does not replace or duplicate it.

A future native client can implement location/capture/notification transports while retaining the same authenticated APIs. Real background push requires owner-bound subscriptions, expiry/logout cleanup, minimal notification payloads, notification permission requested from a user gesture, and a tested delivery backend. Do not ask for notification permission before that pipeline exists.

## Exact changes

Added:

- `src/domain/mobile.ts`: destination mapping, valid mission controls, bounded graph projection, location contract/precision rules.
- `src/components/mobile/entry.tsx`: phone entry routing, explicit desktop override.
- `src/components/mobile/mobile-companion.tsx`: dedicated presentation around existing conversation/voice/approvals/commands/events.
- `src/components/mobile/mobile-capture.tsx`: reviewed ephemeral quick capture and optional location.
- `src/components/mobile/location.ts`: explicit browser location adapter.
- `src/components/mobile/mobile-nexus.tsx`: compact real graph, memory retrieval and existing device requests.
- `src/components/mobile/mobile.module.css`: isolated mobile materials/layout/accessibility.
- `src/app/mobile/page.tsx`, `src/app/mobile/layout.tsx`: route, viewport and metadata.
- `public/mobile/manifest.webmanifest`, `public/mobile/sw.js`, `public/mobile/icon-192.png`, `public/mobile/icon-512.png`: scoped install/offline assets.
- `tests/mobile.test.ts`: domain, location, safety and install-contract tests.
- `scripts/evaluate-mobile.ts`: isolated mobile/desktop browser acceptance.
- `docs/nexus-mobile-companion.md`: this report.

Extended:

- `src/app/page.tsx`: delegate entry choice without replacing desktop behavior.
- `src/components/dashboard.tsx`: optional mobile presentation and lightweight startup query; existing handlers untouched.
- `src/components/perception/perception-panel.tsx`: optional mobile input selection/camera hint; default unchanged.
- `src/server/http.ts`: additive mobile startup projection using existing authentication/permissions.
- `README.md`, `ARY_NEXUS_ROADMAP.md`: usage and status.

No schema, dependency, provider, credential, physical-device configuration or desktop build output changes. Memory/retrieval/entities/temporal facts, mission runtime, graph logic/vgpu, approvals, permissions, action/outcome infrastructure, existing APIs and tests remain authoritative.

## Verification

**September 10 cohesion update:** The full 18-check mobile browser run now passes, including the previously interrupted manifest and desktop-entry checks. Shared materials and supported command destinations were verified with the same local flows. Unsupported deep task/Skill/action detail commands are hidden; entity selections retain focus. Current full suite: 1,463 tests. Physical-phone, HTTPS, push and remote-device acceptance remain pending. See [cohesion report](nexus-cohesion.md). The original milestone evidence follows for history.

- **1,460 tests / 86 files passed**, including **25 new mobile cases**. Location precision/denial/abort, explicit sensor entry, bounded actual graph, valid mission controls, scoped install assets and non-caching/non-replay behavior covered.
- An initial isolated browser pass completed 17 checks, including desktop preservation. Expanded acceptance found and fixed a duplicate desktop launcher and a missing explicit mission checkpoint control. The latest run verified phone routing/layout, shared text Brain, reviewed local capture and later recall, camera choices without activation, task approval/idempotency, DRAFT → PLANNING → READY through existing mission tools, graph, commands, reduced motion and offline no-replay. It then stopped on a localhost `ECONNRESET` in the harness manifest fetch; the final complete browser pass is **not claimed**. The harness now fetches that asset in the browser context, but this harness-only adjustment has not been rerun. Manifest/assets are covered by passing automated tests.
- Uses disposable LocalRepository, local embeddings and the development reasoning fixture; no real phone, external device, camera, microphone or communication endpoint is contacted. Browser, server and all fixtures were removed after every run. Final home/graph screenshots were inspected for layout and launcher overlap.
- Typecheck, configured Prettier check and production build **passed**. `/mobile` is prerendered alongside the preserved desktop entry and existing API. There is no separate lint script in this repository.
- Verification is run in the isolated dependency/build mirror to avoid known iCloud stalls. Changed files are copied back exactly and hash-verified; the installed desktop dependency symlink/build state are preserved.

Commands: `npx vitest run --maxWorkers=2`, `npm run typecheck`, `npm run format:check`, `npm run build`, `node --import tsx scripts/evaluate-mobile.ts`.

## Remaining acceptance and recommendation

HTTPS deployment and real iPhone/Android install, audio, microphone, camera, background/suspension and permission-denial testing are not completed here. Push delivery and a safe remote physical-control host are not implemented by this UI. The compact graph focuses by tap/search; desktop retains zoom/orbit, full relationship inspection and deeper controls. Mobile currently exposes bounded command records; full record-navigation parity and richer source pickers can be improved later.

Recommended next milestone: deploy an authenticated companion preview, then run a controlled physical-phone acceptance pass before native push/background work. Do not mark physical mobile acceptance DONE from browser emulation. Existing roadmap NEXT 3 and all earlier DONE statuses remain preserved; no subsequent milestone is started automatically.
