# Universal Ary Command Palette v1

September 8, 2026. Bounded implementation complete; native Desktop Bridge effects and physical microphone acceptance are separate gates.

## Audit and preservation

Already present: spatial module definitions and persistent Dashboard, loaded project/task/entity/alias records, ToolRegistry catalog, generic action form and approval dialog/queue, ActionRequestService/ActionService, request replay/desktop operation keys, audit/outcomes, native Desktop Bridge and STT hook. There was no universal ⌘K launcher. These existing systems were extended at their UI boundaries; no second launcher backend or action pipeline was created.

## Exact files

Added:
- `src/components/commands/command-index.ts`: shared typed destinations, source index, lexical ranking, unique exact voice resolution, URL validation and sole command dispatcher.
- `src/components/commands/command-palette.tsx`: portal dialog, keyboard/mouse controls, explicit app discovery, shared STT, retained failed-attempt keys and existing memory search fallback.
- `src/components/commands/palette.module.css`: restrained dark dialog, source tags, bounded scrolling, focus and reduced motion.
- `tests/command-palette.test.ts`: 15 ranking/identity/ambiguity/URL/performance/dispatch/retry tests.
- `scripts/evaluate-command-palette.ts`: isolated browser → actual HTTP → approval → real LocalRepository task verification, fixture cleanup.
- This report.

Extended:
- `src/components/dashboard.tsx`: mount palette, existing-tab navigation, record focus, reuse existing memory search, pass chosen tool to existing action form.
- `src/components/spatial/modules.ts`: optional `ShellBridge.onReveal` UI callback.
- `src/components/spatial/spatial-shell.tsx`: implement that callback to reveal the current workspace and stop gesture navigation.
- `src/components/action-center.tsx`: optional selected-tool input, clear stale request scope/evidence when switching commands, accurate registry help text. Execution/approval code unchanged.
- `src/components/task-update-card.tsx`: stable task DOM ID and focus target.
- `package.json`: `test:commands` evaluator command.
- `README.md`, `ARY_NEXUS_ROADMAP.md`: usage, architecture, verified scope and remaining acceptance.

No migrations, new dependencies, new APIs, provider/configuration changes, permissions grants or production data writes. Memory/retrieval/graph/vgpu/temporal facts/action services/schema/tests were preserved.

## Verification

- Automated: **653 passed / 46 files**, including 15 new command tests and existing desktop/action/permissions/replay tests.
- TypeScript, configured Prettier format check, production build: passed. No separate lint script is configured.
- Isolated browser evaluator: **11 checks passed**, real HTTP/action services and disposable LocalRepository, no mocked API. Verified portal outside hidden workspace, keyboard/mouse selection, canonical project focus, existing action form handoff, no task before approval, task creation after “Approve and run,” refreshed task search/focus, audit/outcome and consumed approval ID, irrelevant-query suppression/semantic fallback entry, website source, Escape/reduced motion and no browser errors.
- Installed authenticated Mac app: ⌘K opened actual palette; `Wagtrails` resolved existing alias to canonical Wag Trails and Enter opened its existing Entity/Project view. Down-arrow changed the selected result; Escape dismissed the palette and restored the existing view. No native action, record edit or voice recording performed.
- Measured local synthetic index: 10,000 commands, ~21.5 ms initial index, ~0.88 ms mean query / 1.53 ms p95 over 100 searches. Maximum 30 rendered candidates. This is a local benchmark, not a browser/network/device SLA.
- Screenshot visually inspected: `/tmp/ary-palette-e2e.png`.
- Isolated server/session stopped; temporary fixture directory removed by evaluator `finally`. Production secrets/data were never copied.

Initial browser test assertions were corrected to expand the existing request disclosure, use its actual “Approve and run” label, and follow `metadata.approval_id` to the consumed approval. Those were test assumptions; existing approval/action interfaces were not rewritten.

## Boundaries and manual check

App inventory requires explicit Refresh in an enabled, owner-bound Desktop Bridge session; this milestone leaves that flag disabled. Website commands use recorded entity URLs or explicit HTTP(S) input and the same guarded desktop action. App inventory is cached only in component memory, refreshed explicitly and revalidated by native execution. Actions requiring parameters open the existing form; no parameter guessing or auto-approval.

Voice uses the existing press-to-record STT and this same destination resolver/dispatcher. Unique exact labels/aliases navigate; ambiguity stays visible. Automated transcript resolution passed, but no new physical-microphone accuracy claim is made. Semantic fallback opens existing Memories search rather than blending unverified semantic guesses into executable results. The index covers already-loaded owner-scoped records, not an unbounded new server search.

Manual: ⌘K → `Wagtrails` → Enter; ⌘K → `create task` → select action → fill required project/title → submit → expand request → approve/reject; search the task after success. Try an unrelated query, Escape, arrows, mouse, hidden HUD, and reduced motion. In a separately enabled desktop session, Refresh apps → choose installed app → inspect/approve exact request → check Action History. Voice: Speak a command → “Open Graph” → Finish recording; test ambiguous names remain for selection.

Recommended next milestone remains controlled Desktop Bridge live acceptance, followed by Calendar and Voice acceptance per roadmap. None was started automatically.
