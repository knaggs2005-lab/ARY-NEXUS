# Nexus application shell — implementation and verification

September 8, 2026. Implements the shell layer of [Stage 2](nexus-design-system.md). Existing domain screens remain the source of their content and behavior.

## What already existed

- A CSS spatial/orbital launcher wrapping the persistent Dashboard, plus a large Dashboard sidebar.
- The shared command index, ⌘K portal, voice destination resolution and permission-protected dispatcher.
- Real conversation/voice state, evidence inspection, ActionCenter, exact-request ApprovalDialog, permissions and immutable action/outcome history.
- Canvas2D Brain Graph with optional vgpu, existing screen layouts and responsive fallbacks.

## What changed

The new default shell removes the permanent sidebar and redundant orbital header. It uses a compact orientation/command edge, primary destinations, scoped secondary navigation, a central working field and a persistent status/attention edge. The status edge occupies reserved layout space; the central working field scrolls independently so action buttons cannot be covered. Spatial navigation remains explicitly accessible through **System → Open spatial navigation**. It retains its existing controls, gestures, fallback and services.

Ambient uses a compact explorer and a narrower conversation reading plane. Systems exposes the destination strip on wide windows and optional retrieved context. A mode change does not remount the active workspace, discard its draft, change authority or activate capture. Below 1200 px the destination strip becomes an on-demand explorer; below 900 px secondary regions stack. Native OS window controls are unchanged.

### Destinations

| Primary destination | Existing views or bounded addition                                                    |
| ------------------- | ------------------------------------------------------------------------------------- |
| NEXUS               | Brain graph                                                                           |
| ARY                 | Conversation, existing voice controls, optional retrieved context                     |
| MISSIONS            | Priority, Execution Plans, Tasks & outcomes                                           |
| AGENTS              | Daily advisory Board                                                                  |
| MEMORY              | Memories, Memory review, dev-only Reflection                                          |
| WORLD               | Entities, Relationships, Communications, Calendar, Finance, Economics                 |
| SKILLS              | Read-only capability view of the existing ToolRegistry, Creative, Perception          |
| TOOLS               | Registered tool catalog, Studio, Calls                                                |
| AUTOMATIONS         | Explicit scheduling boundary and link to existing execution plans                     |
| ACTIVITY            | Action history and Approvals                                                          |
| SYSTEM              | Existing Permissions/settings; shell controls provide spatial navigation and sign-out |

Skills is a presentation of registered capabilities, not another skill registry. Automations does not imply a recurring scheduler exists. Selecting a capability opens the existing action-request form; it does not execute the tool. Current permission metadata, simulation status and risk are visible in the catalog.

### Reusable presentation components

- `NexusShell`: orientation, responsive navigation, modes, status, notifications and workspace controls.
- `AryPresence`: restrained horizontal light seam with readable state. Capture intensity uses the existing microphone level; idle is static; other activity is derived from actual voice state.
- `NexusDrawer`: native modal context surface with focus containment, Escape dismissal and return to its invoker.
- `NexusSurface` and `NexusState`: shared content/loading/empty/error treatment.
- `destinations`: shared presentation map used by both the shell and existing command index.

The shell owns scoped `--nx-*` tokens and compatibility styling, rather than replacing global CSS or independently redesigning every domain page. Native system typography, dark working surfaces, subdued borders, limited shadows and reduced-motion rules follow Stage 2. Existing voice status text and live announcements are preserved through the shared presence primitive.

## Attention, approvals and status

Attention reads the existing pending action history endpoint. It shows the queue count, the latest Dashboard notice/error, and direct access to review and history. The count refreshes every 30 seconds while the document is visible, on return/focus, on approval prompts and on navigation; an unavailable count is shown as unknown, never zero. No notification database or second event/action pipeline was introduced.

ApprovalDialog still loads and reviews the existing exact action, with the same permission/review endpoints and approval semantics. Opening it now focuses its review heading rather than a decision button, and closing restores its invoker. ActionCenter retains modification, approval, rejection, execution, audit, outcome and idempotency behavior.

The shell presence describes the existing conversation/voice lifecycle. Per-tool and per-plan execution stages remain in their authoritative panels; the footer does not fabricate a global execution/agent state. Module-specific errors remain in the relevant modules. Notifications are in-app and are not OS push notifications.

## Exact application files

Added:

- `src/components/nexus/destinations.ts`
- `src/components/nexus/primitives.tsx`
- `src/components/nexus/nexus-shell.tsx`
- `src/components/nexus/nexus.module.css`
- `src/components/nexus/capability-view.tsx`

Modified:

- `src/components/dashboard.tsx`: wraps existing content in the shell; adds bounded catalog/scheduling views; moves global notification presentation; makes retrieved context opt-in and opens it from a source link; shell destinations reuse the existing navigation adapter, and Talk to Ary focuses the existing composer.
- `src/components/spatial/spatial-shell.tsx`: defaults to the new workspace, exposes explicit orbit access and hides its redundant header in default mode.
- `src/components/spatial/modules.ts`: additive `onOrbit` presentation callback; original module IDs and tabs remain.
- `src/components/spatial/spatial.module.css`: hides the unused return bar in default mode.
- `src/components/commands/command-index.ts`: adds primary destinations to the same command index; distinguishes the Tasks & outcomes alias from ACTIVITY/audit navigation. Entity aliases and ambiguous-name refusal are unchanged.
- `src/components/commands/command-palette.tsx`: accepts an optional launcher visibility prop and a shell-open event; the same portal, search and dispatcher remain.
- `src/components/voice/voice-presence.tsx`: uses the shared seam primitive while retaining its interface and status copy.
- `src/components/approval-dialog.tsx`: review-heading focus, focus restoration and heading copy; no permission changes.

Verification/documentation:

- Added `tests/nexus-shell.test.ts` and `scripts/evaluate-nexus-shell.ts`.
- Extended `tests/command-palette.test.ts` to account for the new NEXUS destination while still asserting two separate same-named projects and ambiguous spoken-command refusal.
- Updated `scripts/evaluate-command-palette.ts` and `scripts/evaluate-spatial.mjs` to enter the preserved orbit explicitly now that it is not the startup view.
- Updated this report, the design specification implementation note and the canonical roadmap.

## Verification

| Check                               | Result                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Existing + additive automated tests | **912 passed / 58 files**, including permission/action/idempotency, database, native adapter engine, voice state, command ambiguity and shell routing tests. |
| TypeScript                          | **Passed.**                                                                                                                                                  |
| Formatting                          | **Passed.** No separate lint command is configured.                                                                                                          |
| Production build                    | **Passed**, Next.js 16.3.4; existing root and API routes.                                                                                                    |
| Isolated browser acceptance         | **Passed: 13 checks.** Real HTTP → approval → one local task → consumed approval → audit/outcome → command focus; no browser JavaScript errors.              |

The repository's existing generated `.next/types/cache-life.d 2.ts` and `routes.d 2.ts` were first verified byte-identical to their corresponding originals, then moved to `/tmp/nexus-shell-generated-duplicates/` to remove the previously documented duplicate-type failure. Application schemas were not changed.

The initial repository production build passed. Later verification was impeded by iCloud/dataless dependency reads, including Next commander and PostCSS loading failures. The final deterministic checks use an isolated copy of the exact same `src` and `tests`, database/native test fixtures and a fresh **`npm ci` from the unchanged package lock**, with installation scripts disabled. No credentials, `.env.local`, live accounts or production data were copied. Source parity was checked against the repository. This isolates dependency-file availability from application behavior; it does not claim the original iCloud folder is now pinned locally.

The browser evaluator uses disposable LocalRepository fixtures and mock AI, real HTTP/services/approvals, and the existing Canvas fallback with GPU disabled for deterministic shell checks. Earlier combined visual runs hit browser-verifier restarts/timeouts during viewport/media changes. The passing functional evaluator keeps a fixed viewport. Separate fresh browser sessions validate the final 1024, 800 and 640 px layouts; all have no horizontal overflow and the workspace bottom equals the status-bar top. The 640 px session confirms reduced-motion media is active; Talk to Ary focuses the existing composer and leaves the microphone button fully inside the scrollable working region. These are browser layout checks, not a native Mac resizing certification. Physical microphone, native Mac window controls and live GPU/hardware acceptance are not certified by this shell milestone.

## Visual evidence

- [Systems workspace](evidence/nexus-shell/systems.png)
- [Ambient workspace](evidence/nexus-shell/ambient.png)
- [1024 px window](evidence/nexus-shell/1024.png)
- [800 px window](evidence/nexus-shell/800.png)
- [640 px reduced-motion window](evidence/nexus-shell/640.png)
- [Real isolated task receipt](evidence/nexus-shell/task-receipt.png)
- [Narrow command focus and microphone access](evidence/nexus-shell/command-focus.png)

The automated Systems → Ambient → Systems screenshot comparison measured **0.42% (6,047 / 1,440,000 pixels) difference**. The before/after images were inspected: the visible difference is focus/hover treatment moving from the composer/Talk control to Systems. This is an interaction round-trip check, not a zero-difference golden-image certification. Desktop and narrow layouts were also inspected visually. A real footer-overlap regression discovered during the approval test was fixed and the task flow then passed.

The successful evaluator exited normally and removed its disposable server/data directory in `finally`. The isolated task was not created in Supabase or a real account. Earlier failed verifier runs are not included in the passing count. The interrupted fixture copy and both preview servers/demo stores were also removed, with cleanup verified. A credential-free locked-dependency cache remains in `/tmp/ary-shell-dependencies` for reproducibility.

## Manual check

1. Open Ary. Type an unsent message, switch Ambient → Systems and confirm the draft remains. Open/close retrieved context.
2. Open ⌘K, navigate to a project, then inspect Skills/Tools. Choosing a capability should open an action review form without execution.
3. Review a task request in Approvals. Confirm exact inputs before approving, then inspect the resulting task and its audit/outcome link.
4. Open Attention, dismiss with Escape, and confirm focus returns to Attention. Verify System exposes permissions and explicit spatial navigation.
5. Resize between a wide desktop and a narrow window. The explorer, command entry, approval access and microphone controls must remain reachable by keyboard and scrolling.

## Intentionally untouched / remaining

No backend, schemas, authentication, model providers, memory, retrieval, entity resolution, temporal facts, ToolRegistry execution, permissions, idempotency, graph renderer or external adapter implementation was redesigned. No package dependency was added. No remote deployment or packaged desktop release was performed.

Domain-specific layouts retain their existing structure and some legacy styling. Shell modes are session-local presentation state. Navigation still uses the existing workspace tabs rather than introducing URL routing. This milestone does not supply a new persistent automation engine, skill installer, global agent runtime or notification service. Live provider/native acceptance gaps and the canonical NEXT ordering are preserved.

Recommended next step: refine one central Nexus working surface against this shell, with real graph/context density and representative data, before redesigning more domain screens.
