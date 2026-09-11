# Controlled digital eyes and hands

September 9, 2026. Additive extension of the existing Ary action system.

## Audit and retained architecture

The repository already contained the authenticated macOS Desktop Bridge, a live installed-app scan, ToolRegistry, exact-input approvals, numeric and class-based permissions, an owner emergency-stop latch, action/outcome idempotency, source-approved Perception, ephemeral image storage, and persisted Nexus events/SSE. The existing Tools, command palette, Action History, and approval dialog already provided the surrounding user experience.

This milestone adds structured page/window control. It does not replace those systems, add an agent loop, change the brain, duplicate memory, attach to a personal browser profile, or migrate database tables. Launching apps and opening ordinary websites remain available through the original Desktop Bridge and command palette.

## Registered capabilities

| Capability | Behavior |
| --- | --- |
| `browser.open` | Open a fresh, isolated Playwright-controlled Chrome session at an explicitly allowed origin. |
| `browser.inspect` | Return bounded page context and up to 200 inspected interactive targets. |
| `browser.act` | Click, fill, select, check, use a fixed navigation key, upload a listed file, or download a document. |
| `browser.close` | Close only an Ary-owned session. Available as a recovery operation while emergency stop is active; permission review still applies. |
| `computer.inspect` | Scan an explicitly allowed installed app and inspect its current windows, menus and AX controls. |
| `computer.act` | Press a supported AX control, set a text field, focus a window, or use a fixed navigation key. |
| `computer.propose_visual` | When usable AX content controls are absent, capture one explicitly approved window and ask a vision provider for one point suggestion. It does not click. |
| `computer.visual_click` | Separately review a proposed point; recapture the window, compare exact pixels, check ownership/occlusion and dispatch a guarded click to the approved window. |
| `control.files` | List supported documents in the owner-configured transfer folder. |

`DigitalControlProvider`, `BrowserControlProvider`, and `VisualControlProvider` keep implementation details outside the brain. The first browser implementation uses Playwright; the first native implementation is a small Swift AXUIElement/ScreenCaptureKit helper. The visual-point adapter reuses the existing OpenAI Responses transport, environment-only credentials, configured vision/reasoning model and aggregate cost telemetry.

Playwright's structural inspection and bounded ElementHandles solve the immediate browser-control problem. Browser Use and Stagehand were not added: another planning/execution loop would overlap existing Ary orchestration. Refer to the official [locator documentation](https://playwright.dev/docs/locators), [input APIs](https://playwright.dev/docs/input), and [download lifecycle](https://playwright.dev/docs/downloads). Native control uses Apple's [Accessibility trust API](https://developer.apple.com/documentation/applicationservices/1460720-axisprocesstrusted) and [ScreenCaptureKit screenshot API](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager).

## Authority and execution

Every registered operation follows the existing ToolRegistry → validation → Permission Engine → exact approval → ActionService → result/outcome/audit path. All new operations initially require approval, including inspection. Generic interactions intersect all permission classes because a click can have many effects; a class denial cannot be bypassed merely by choosing a generic UI tool. Visual capture and click also inherit `perception.capture_window` restrictions. Agents retain their existing explicit tool and permission ceilings.

Browser/computer execution and terminal results emit normalized backend Nexus events. The new Tools → Computer & Browser surface consumes those real events. It uses the existing approval dialog and existing persistent emergency control; there is no second permission queue or stop flag. STOP CONTROL cancels cooperative actions, closes owned browser sessions, clears native snapshots/visual proposals, and keeps the existing mission pause behavior. Completed external effects cannot be undone by cancellation.

Snapshots are owner-bound, expire after two minutes, and are consumed before a mutating dispatch. Native PID, target properties, app identity and configured allowlist must still match. Browser operations use retained element identity plus a property fingerprint, not caller-provided selectors or JavaScript. Concurrent native requests cannot consume one snapshot twice. Successful request-key replay returns the original durable action result; an uncertain native/browser effect requires inspection and a new reviewed request rather than automatic repetition. Process restart discards live control targets. Durable receipts remain in the existing repository.

## Local security boundary

- macOS, installed desktop app, loopback, same-origin and existing server-derived desktop token proof only.
- Existing `ARY_DESKTOP_BRIDGE_ENABLED`, `ARY_DESKTOP_USER_ID`, and Supabase-mode guard remain necessary. `ARY_DIGITAL_CONTROL_ENABLED=true` is an additional explicit gate.
- Website origins and app bundle IDs are configured by the owner, never granted by a model or request body.
- Native control excludes browsers, terminals, code/script editors, password/security settings, and Ary's own interface. Browser sessions cannot navigate to the Nexus origin.
- Fresh browser contexts have no inherited personal cookies or profile, no arbitrary CDP attachment, no granted camera/microphone permissions, blocked service workers/WebSockets, dismissed dialogs, and closed unexpected popups. Non-read network requests are admitted only during an approved interaction. This is a bounded automation policy, not a hardened browser sandbox; an approved website remains capable of executing its own JavaScript.
- Password/payment/secret input controls are marked protected rather than automated. There is no credential-entry automation or unrestricted login workflow in v1.
- The Swift helper accepts fixed verbs and JSON over stdin. Node uses `execFile` with a fixed executable, never a caller-supplied shell command. Keyboard events verify the approved foreground app and focused AX field immediately before WindowServer routing. Mouse dispatch verifies the exact foreground app, window identity, hit-tested ownership and lack of occlusion immediately before WindowServer routing; no arbitrary shortcuts, scripts or macros are exposed.
- Controlled child processes receive a minimal environment without model or service-role credentials.
- Transfer files are limited to a dedicated absolute directory and supported text/image/PDF documents, 10 MB maximum. Traversal and symlinks are rejected. Downloads are published atomically without overwriting an existing file. Temporary partial downloads are removed. There is no general filesystem or deletion tool.
- At most three browser sessions per owner; unattended sessions close after 15 minutes. Snapshots and visual proposals are bounded. Images use the existing FrameStore, are never written to the canonical database, expire within five minutes, and are removed after use/stop. Structured inspection results and approved inputs remain in action history, so inspect only sources you intend to expose to Ary's audit context.

## Setup

The milestone does not enable control or alter existing credentials automatically.

1. Install dependencies and compile the helper on the target Mac with `npm run control:build` (Xcode command-line tools required). This installed development app retains its existing `node_modules` symlink into `~/Library/Application Support/Ary Nexus/dependencies/node_modules`, outside iCloud. Only Playwright and playwright-core were added there; existing dependency versions were preserved. A fresh checkout can use `npm install`; retain the existing symlink layout when updating this Mac.
2. The initial Playwright adapter uses the installed Google Chrome channel in a fresh controlled context. Native bundle IDs are obtained from the existing installed-app launcher, not guessed paths.
3. Set the existing Desktop Bridge flags/owner and these environment settings:

```dotenv
ARY_DIGITAL_CONTROL_ENABLED=true
ARY_BROWSER_ALLOWED_ORIGINS=https://your-approved-origin.example
ARY_CONTROL_ALLOWED_APPS=com.example.AllowedApplication
ARY_CONTROL_TRANSFER_DIR=/absolute/path/to/a/dedicated/transfer-folder
```

Use exact origins without paths or trailing slashes. No real values are included in `.env.example`. The transfer folder is optional until a file operation is requested.

4. Grant Accessibility to the actual Ary/native host in macOS Privacy & Security. Visual window capture additionally requires Screen & System Audio Recording and macOS 14+. The adapter translates missing permissions into an explicit error; it never toggles TCC settings or requests camera access silently. Grants under Codex during testing do not prove the installed Ary host has the same grants.
5. Open Tools → Computer & Browser. Choose a configured website or installed app, inspect it, choose an inspected target and review the exact interaction. Launch a closed app using the existing command palette first.
6. For a window without structural content controls, request the one-frame visual suggestion and separately review its point against the visible window. The v1 panel shows the window/point/provenance; it does not stream a remote desktop or continuously retain screenshots.
7. Use STOP CONTROL to close owned browser sessions and invalidate pending control targets. Clearing stop never automatically resumes plans or old approvals.

Existing hosted permission migration `017` and earlier documented hosted gates remain unchanged. This milestone adds no migration and does not claim to apply pending ones.

## Verification and limits

All final source checks passed. Automated tests use temporary repositories/files, a localhost-only Chromium fixture, and a disposable native application. They do not use a real account, website, document, email, payment, or camera.

The browser acceptance exercises the actual provider through the existing approval/action/outcome pipeline: text, selection, checkboxes, upload/download, one form submission, replay, stale target rejection, cross-owner isolation, origin rejection, and emergency stop. Native acceptance verifies actual Accessibility text/button operations and window/menu results. Visual-point unit tests cover separate proposal/execution, changed pixels, cross-owner/expired targets, stopped snapshots and concurrency. The final live fixture also exercises the configured OpenAI model on the synthetic window; no real app imagery is sent.

Known limits: v1 has no browser-canvas visual fallback, iframe traversal, drag-and-drop, arbitrary hotkeys, autonomous browsing, password automation, personal-profile attachment, unrestricted files, or undo guarantee. Initial native mouse fallback is a reviewed single click; dynamic/animated window pixels intentionally cause re-review. A successful dispatch is not proof that a form, transaction or application workflow succeeded; inspect the resulting state. Website failures, unsupported AX controls and permission errors remain visible outcomes.


## Final acceptance report

| Check | Result |
| --- | --- |
| Full regression suite | **1,251 tests / 74 files passed**; baseline was 1,228 / 73. Includes 23 new boundary, approval, replay, concurrency, transfer and source-scope tests. |
| TypeScript | Passed. |
| Formatting | Repository `format:check` passed. No separate lint command is configured. |
| Production build | Passed from an exact source mirror; the installed app's development output was not replaced. |
| Real browser pipeline | Passed against a disposable localhost form server through ToolRegistry, approval, ActionService, replay, outcomes and persisted browser events. Text, select, checkbox, upload, download, stale target, owner/origin rejection and STOP CONTROL verified. |
| Real native control | Passed against a disposable AppKit app: AX inspection, text modification, keyboard input/read-back, button press, window title and menu discovery. |
| Native visual fallback | Real ScreenCaptureKit capture, exact-pixel validation, window/occlusion checks, guarded mouse dispatch and observed blue-circle click outcome passed. A dispatch alone was not counted as acceptance. |
| Live visual model | Existing **gpt-5.6-sol** successfully located the synthetic target: **3,413 ms**, 297 input / 76 output tokens, estimated **$0.002708**. One live call; no real app imagery or user data. |
| Nexus UI | Normal and reduced-motion disposable browser checks passed, including visible real failure events, disabled-source enforcement, persistent STOP CONTROL/reset, no browser errors and a 900px viewport. |
| Cleanup | Browser contexts, temporary repositories/transfers and native fixture app/bundle removed. Native fixture exit was explicitly verified. |
| Production enablement | **Not enabled.** Owner/app/origin configuration and the installed Ary host's macOS privacy grants remain explicit. No real-user policy or hosted migration was changed. |

Native acceptance caught and fixed an initial ScreenCaptureKit initialization crash and incorrect input routing. The helper now initializes AppKit on the main actor and uses WindowServer routing after checking foreground/focus/point ownership. The final native tests verify actual application changes, including keyboard input and the canvas click. Source-scoped visual frames cannot be reused under a narrower project scope.

Re-run verification:

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run format:check
npm run build
node --import tsx scripts/evaluate-digital-control.ts
npm run control:build
node --import tsx scripts/evaluate-native-control.ts
# Explicitly billed, synthetic-image test using the existing configured provider:
node --import tsx scripts/evaluate-native-control.ts --live-vision
ARY_CONTROL_ONLY=1 node --import tsx scripts/evaluate-nexus-shell.ts
ARY_CONTROL_ONLY=1 ARY_PRESENCE_REDUCED=1 node --import tsx scripts/evaluate-nexus-shell.ts
```

The native acceptance may report a Screen Recording gate on a different host; that must not be presented as successful visual acceptance. Tests require installed Chrome for browser execution and macOS/Xcode plus explicit privacy access for native execution.

## Exact source changes

New files provide domain contracts, bounded adapters, the native helper, the control surface and isolated tests. Existing files only add registrations, source/cancellation/event handling, navigation, configuration or verification documentation.

- `.env.example`
- `.gitignore`
- `package.json`
- `package-lock.json`
- `src/domain/digital-control.ts`
- `src/domain/permissions.ts`
- `src/domain/tool-capabilities.ts`
- `src/infrastructure/control/security.ts`
- `src/infrastructure/control/files.ts`
- `src/infrastructure/control/playwright-browser.ts`
- `src/infrastructure/control/mac-accessibility.ts`
- `src/infrastructure/tools/control-tools.ts`
- `src/infrastructure/providers/openai-visual-control.ts`
- `src/services/action-cancellation.ts`
- `src/services/permission-service.ts`
- `src/services/action-service.ts`
- `src/services/action-request-service.ts`
- `src/server/context.ts`
- `src/components/control/control-panel.tsx`
- `src/components/control/control.module.css`
- `src/components/emergency-control.tsx`
- `src/components/dashboard.tsx`
- `src/components/nexus/destinations.ts`
- `native/ary-control.swift`
- `native/control-fixture.swift`
- `scripts/build-control-helper.mjs`
- `scripts/evaluate-digital-control.ts`
- `scripts/evaluate-native-control.ts`
- `scripts/lib/control-browser-check.ts`
- `scripts/evaluate-nexus-shell.ts`
- `tests/digital-control.test.ts`
- `README.md`
- `ARY_NEXUS_ROADMAP.md`
- `docs/nexus-digital-control.md`

No schema migration, brain/retrieval/entity redesign, provider selection change, graph/vgpu change, voice change, new external account integration, or autonomous execution was introduced. Existing hosted gates and roadmap NEXT 3 remain unchanged. The next practical step is a narrowly configured pilot in the installed Ary app with owner-selected apps and website origins; no subsequent milestone was started.
