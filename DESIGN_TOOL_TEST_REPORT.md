# Ary Design Tool Adapter Framework v1

September 8, 2026. **Framework and Cinema 4D adapter implementation complete; native acceptance pending licensing.**

## Audit and selection

Read `ARY_NEXUS_ROADMAP.md` and the repository instructions before changes. Inspected current registry/permissions, action requests/approvals/outcomes, source-context rules, desktop authorization, HTTP security, encrypted integration vault, Premiere provider/transport and Creative UI/tests. No design/CAD adapter was present.

Installed inventory found **Maxon Cinema 4D 2026.2** with Python SDK resources and c4dpy. Blender, Fusion 360 and FreeCAD were not found in the application inventory/search. Reviewed Maxon's official MessageData, document, object, undo and c4dpy documentation, plus the installed Python API stubs. Chose that one installed application; did not install another CAD/3D tool or add an agent/model provider.

The restricted read-only SDK probe exited 139 before printing a version. The unrestricted retry reached the Maxon license-method selector. No license method/account was selected; the owned probe was stopped with TERM. No native scene was opened, changed or exported. This is a licensing/native acceptance gap, not a passing SDK execution test. The feature flag remains disabled, local environment secrets unchanged, and native plugin not installed.

## Added files

| File                                       | Purpose                                                                                                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/design-tool.ts`                | Application-neutral DesignTool port, strict verbs/inputs, capability-bearing state, unit/revision validation.                                        |
| `src/infrastructure/design/bridge.ts`      | Cinema4DDesignTool, authenticated loopback transport, owner/session/flag/path guards and durable claims/receipts using the existing vault primitive. |
| `src/infrastructure/tools/design-tools.ts` | Inspect/plan/execution registrations in the current ToolRegistry.                                                                                    |
| `src/components/creative/design-panel.tsx` | Existing-style inspection, exact JSON plan, normal approval and receipt UI.                                                                          |
| `design-plugin/ary_design.pyp`             | Fixed Cinema 4D main-thread MessageData adapter transport; disabled unless locally configured.                                                       |
| `design-plugin/ary_design_engine.py`       | Fixed SDK verbs, object/scene/units checks, undo and output safeguards.                                                                              |
| `design-plugin/bridge.example.json`        | Disabled blank local plugin configuration template.                                                                                                  |
| `design-plugin/.gitignore`                 | Exclude local bridge secret configuration and Python cache.                                                                                          |
| `design-plugin/README.md`                  | Exact capabilities, licensing/setup, acceptance checklist, recovery limits and official references.                                                  |
| `tests/design.test.ts`                     | 22 permission/registry/bridge/validation/recovery tests.                                                                                             |
| `tests/design-plugin-test.py`              | 12 injected native SDK-port tests.                                                                                                                   |
| `scripts/evaluate-design.ts`               | Disposable browser/HTTP/action/approval evaluator, without native CAD execution.                                                                     |
| `DESIGN_TOOL_TEST_REPORT.md`               | This report.                                                                                                                                         |

## Existing files extended

- `src/domain/permissions.ts`: observe/plan plus all fixed Design execution capabilities. Every change requires approval, including permission level 5.
- `src/services/action-request-service.ts`: optional DesignTool injection in the existing registry composition; real receipt classification; guard against converting design results into misleading generic task memories.
- `src/server/context.ts`: bind the adapter to the existing authenticated owner and installed desktop authorization.
- `src/server/http.ts`: authenticated native poll/result endpoints only; no independent enqueue/action backend.
- `src/components/creative/premiere-panel.tsx`: mount the new Design panel alongside the existing editing/Premiere panels. Existing Premiere behavior and plugin are unchanged.
- `.env.example`: disabled flag and blank owner/token/allowed-root settings.
- `package.json`: `test:design` and `test:design-plugin` commands; no dependency changes.
- `README.md`, `ARY_NEXUS_ROADMAP.md`: architecture, scope and verification status.

**No migrations or schema changes.** Existing permissions, exact approvals, actions/outcomes, idempotency, user scoping and audit remain authoritative. The new encrypted namespace stores transport delivery state only. No brain, memory, retrieval, entity, graph/vgpu, task/project, provider, voice or external communication system was rebuilt.

## Supported behavior

The generic interface exposes inspection and hard-coded operations for document opening, selection, creation, dimension changes, property changes, export, save, undo and preview. State advertises adapter, object IDs, unit conversion, supported formats and revision. Another adapter can implement the same port later; only Cinema 4D is implemented now.

Cinema 4D v1 handles simple scenes containing boxes/groups without materials, tags or animation. Creates top-level boxes; edits local dimensions in millimeters only on top-level boxes with no relative/frozen scaling; sets built-in display color. Documents are loaded detached and checked before activation. No caller scripts, expression setters, macros, arbitrary parameter paths or shell/menu automation.

Save always uses a new `.c4d` path. Export supports new OBJ files; STEP is rejected explicitly. The plugin rejects output and known material-sidecar collisions. Viewport preview redraws the active native view; it does not claim an offline rendered image. Undo is restricted to the latest unchanged Ary geometry/property edit using its operation token. Intervening scene changes invalidate it.

All execution passes current ToolRegistry validation → permission/approval → state/path checks → native operation → result/outcome/audit. Geometry/property edits use the SDK undo transaction API. Exact operation claims are stored before delivery; claimed edits are never redelivered. Known receipts recover without another edit after an action database failure. Partial/uncertain native effects block new operations and are not mislabeled as rolled back.

## Verification results

| Gate                                | Result                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm test -- --maxWorkers=2`        | **793/793 tests passed across 53 files**: 771 prior + 22 new.                                                                |
| `npm run test:design-plugin`        | **12/12 Python SDK-port tests passed** using an injected fake Cinema 4D API.                                                 |
| `npm run typecheck`                 | Passed.                                                                                                                      |
| `npm run format:check`              | Passed; no separate lint script or Python formatter configured. Python source was syntax-checked and exercised by its tests. |
| `npm run build`                     | Passed production build.                                                                                                     |
| `npm run test:design`               | **8/8 isolated browser checks passed.**                                                                                      |
| Real Cinema 4D SDK/plugin execution | **Pending:** licensing prompt prevented the read-only SDK probe.                                                             |

TypeScript tests cover discovery, inspect/plan permission separation, blocked and rejected actions, mandatory approval even at autonomous level, successful approved action/outcome/replay, failures, unknown verbs/script fields, missing/unsafe/incomplete state, stale/disconnected state, claim-once delivery, immutable receipt replay, operation collisions, uncertainty blocking new actions, allowed roots/symlink escapes/output overwrite and unsupported formats/units/properties/object IDs. A test expectation initially used “units” rather than the actual “unit conversion” error; corrected the test and reran successfully.

Python tests cover cm→mm conversion and 50→60 mm dimension change, unknown units, select/display property, NaN and extra script inputs, command-looking filenames, unsupported/scaled objects and tags, stale revision, single Ary undo, external-change undo invalidation, save/OBJ/viewport behavior, refused STEP and overwrite, open/path scope and partial failure with possible effects. These validate fixed adapter behavior against SDK-shaped ports, not real Maxon runtime behavior.

The browser test creates a disposable Next source copy and LocalRepository, injecting a fixture DesignTool only in that copy. It navigates to Creative, inspects a document, rejects a proposed box creation and verifies no success, then approves a 50×20×10 mm box and a change to 60×20×10 mm. It checks the actual persisted result, outcome link, two consumed approvals, rejection history and absence of browser errors. The temporary source, server, browser session and fixtures are deleted afterward. No real account/project is reused. `/tmp/ary-design-e2e.png` was visually inspected; the existing Creative styling and approval controls remain readable.

## Known limits and next verification

- Native plugin loading, handshake, actual units/GUID/dirty behavior, undo, save/OBJ output and viewport behavior must be tested on a licensed disposable Cinema 4D scene. Fixture success is not native acceptance.
- Cinema 4D is not a STEP solid-export adapter. The future “bracket 10 mm wider and export STEP” request remains unsupported as a complete workflow. No manufacturing accuracy claim.
- Only box dimensions and display color, not arbitrary mesh editing, material graphs, parametric CAD constraints or renderer automation. No natural-language geometry resolver was added to the brain.
- New-path save/export only. File validation has a local TOCTOU window; native file operations and Supabase cannot commit atomically. Unknown partial effects require operator inspection; do not erase receipt guards to retry.
- Document IDs are session-local; object GUIDs are document-scoped. Revision checks use scanned values and SDK dirty counters, not full content hashes. Undo support is deliberately one unchanged Ary edit, not a general history browser.
- Bounded 200-object/depth-20/64 KB inventory; no large-scene performance claim. Main-thread timer networking uses a short timeout but can affect responsiveness. Transport receipts are single-host and not a distributed queue.
- Local development plugin ID 1000001 needs a unique registered Maxon ID before distribution. No plugin, account, license or security settings were changed during implementation.

Recommended next step: confirm licensing, choose a disposable supported scene and narrow allowed folders, enable the bridge deliberately, and perform the native checklist in `design-plugin/README.md`. Keep this live acceptance IN PROGRESS. Do not add a second adapter or begin autonomous design automatically.
