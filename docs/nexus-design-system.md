# ARY Nexus visual and interaction system

**Version:** 1.0 design specification · September 8, 2026  
**Status:** proposed next-generation presentation contract; not an implemented redesign.  
**Grounding:** [current-state audit](nexus-current-state.md) and [canonical roadmap](../ARY_NEXUS_ROADMAP.md).

**Implementation update:** The first application shell now implements the two modes, shared presentation primitives, navigation and attention access. See [shell implementation and verification](nexus-shell-report.md). Remaining domain-screen treatment is still a specification, not a completed redesign.

**September 10 cohesion update:** Base material/focus/font tokens now live in `src/app/globals.css` and are shared by the Nexus shell, mobile and global controls. Heavy screens share loading treatment. Economics ambient drift and static Finance relationship flow were removed; genuine busy/voice/mission transitions remain. This is incremental adoption, not a claim that every domain screen is visually uniform. See [cohesion evidence](nexus-cohesion.md).

## 1. Product identity and governing principles

Ary is the intelligence. Nexus is the workspace in which its understanding, evidence and actions become visible. There is one identity and one system, expressed at two levels of detail: **Ambient** and **Systems**.

The defining experience is a quiet field of attention: one clear subject, contextual information at its edges, and a precise account of what is happening. Depth explains relationships and focus. Light acknowledges change. Motion makes a transition understandable and then settles.

### Required character

| Quality     | Design consequence                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Premium     | Controlled typography, consistent spacing, excellent focus behavior and restrained materials; ornament never substitutes for functionality. |
| Spatial     | Position and depth communicate scope, focus and dependency. Working content stays readable and largely front-facing.                        |
| Intelligent | Relevant context appears when useful, with provenance. The system explains uncertainty and requests the missing decision.                   |
| Quiet       | One dominant visual event at a time. Idle is genuinely still. Routine background work does not demand attention.                            |
| Cinematic   | Composed light and hierarchy, not theatrical timing or imitation film props. Controls respond immediately.                                  |
| Precise     | Exact objects, state labels, timestamps and before/after effects. No invented progress, business impact or certainty.                       |
| Alive       | Ary responds to actual input, speech, focus and work events. Fake scanning, perpetual breathing and decorative activity are excluded.       |

### Explicit exclusions

The following are release failures, not alternative themes:

- A generic SaaS dashboard, template layout or collection of equally weighted cards.
- ChatGPT-style conversation bubbles and a central chat log as the entire product identity.
- Discord-style server/channel rails, badges and constant unread noise.
- Crypto-dashboard tickers, trading colors, flashing metrics or unsupported financial emphasis.
- Gaming HUD crosshairs, radars, faux targeting, beveled sci-fi chrome or dense telemetry decoration.
- Iron Man/arc-reactor imagery, rotating machinery, mechanical intelligence metaphors or character cosplay.
- Direct copying of Zoey OS or another operating-interface composition, assets or animation signatures.
- Neon outlines around every object, constantly moving particle fields, holographic text distortion or decorative 3D objects.

Functional tables, lists and bounded panels remain valid when they serve the task. The prohibition is against turning every piece of information into its own ornamental container.

## 2. What remains authoritative

This specification changes presentation and interaction conventions, not intelligence or authority.

Preserve the existing Brain, canonical entities/aliases, memory/evidence/versioning, hybrid retrieval, providers, tasks/projects/goals, ToolRegistry, permissions, approvals, audit, outcome records and idempotency. Preserve **Canvas2D Brain Graph interaction**, with **vgpu as an optional effect layer**, and reuse the existing CSS spatial/spring infrastructure.

Visual states are projections of current services and records. They must not become a second persisted execution state machine. A mode switch, gesture, animation, role label, node selection or spoken acknowledgment never grants permission. Existing exact-request approvals remain authoritative.

The audit found fragmented global/scoped CSS, not a finished shared component library. The token/component names below are **future implementation contracts**, not claims that those components already exist. No font package, icon package, animation framework or renderer is installed by this document.

## 3. Information architecture: one continuous workspace

Use five functional regions rather than a dashboard grid:

1. **Orientation:** current scope, selected object and mode. A compact top edge, not a large branded header.
2. **Working field:** the dominant object—conversation, graph neighborhood, project, mission or evidence document.
3. **Context:** optional supporting detail attached to the selected object. One inspector at a time.
4. **Command surface:** persistent access to typing, microphone state, stop speaking and ⌘K. It is mounted outside hideable HUD/content.
5. **Attention:** approvals, blocking decisions and uncertain outcomes. These remain discoverable even when other chrome is hidden.

A project, person or mission is a stable destination across modes. Selecting one changes context while retaining its ID, source relationships, current conversation, work status and authorization. Focus transitions reveal what was selected; they do not create a new copy of the object.

### Layout contracts

| Window width              | Arrangement                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1440 CSS px and above     | 32–48 px outer gutter; optional 176–200 px scope rail; flexible main field with a 560 px starting minimum; optional 320–360 px inspector; 24–32 px region gaps. No fixed requirement to fill unused space. |
| 1024–1439 px              | 24 px gutters, compact navigation. Inspector opens only on request and either replaces a secondary region or uses a clearly dismissible detail surface. Main reading content remains usable.               |
| Below 1024 px / high zoom | One main column; scope in a menu; inspection as a full-width detail view with Back. Approval review becomes a full-width focused view, never a tiny floating modal.                                        |
| Short windows             | Command and attention access remain reachable; evidence/body scroll independently where necessary. No fixed-height region may trap controls below the viewport.                                            |

Reading width: 60–72 characters for explanations, 48–64 for approval summaries. Graph/timeline views use available width; long text belongs in the inspector. Tables scroll within a labeled region and offer readable object details. At 200% zoom, collapse columns before shrinking type.

## 4. Ambient Mode

**Purpose:** interact with Ary and stay oriented without managing a dashboard. Voice-first means easy access to voice; it never means automatic microphone activation or reduced functionality for keyboard users.

### Composition

- A near-black continuous environment with one static, soft light field.
- A small Ary presence mark beside a readable status label.
- One current intent or selected subject, with one concise response/brief in an open reading plane.
- A quiet command line near the lower working edge: type, explicit microphone control, transcript preview, stop speaking and launcher.
- A restrained context handle such as “3 sources” or “View execution plan”; counts come from current records.
- Pending approvals and uncertainty remain visible in the attention region. They are never hidden behind the promise of calmness.

The reading plane is part of the environment: typography, spacing and occasional rules establish sections. Avoid a feed of rounded assistant cards, repeated avatars, suggested-prompt tiles and large glowing microphone buttons. Conversation history is available as an expandable transcript with author/time/source landmarks rather than chat bubbles.

### Behavior

- IDLE is still; show “Ready” rather than simulated activity.
- Listening makes the capture boundary unmistakable, with editable transcript review after transcription.
- A response may reveal one supporting source or next decision. Additional evidence is deliberately opened, not sprayed into the scene.
- Running work shows the current objective, current phase and stop/pause access. Detailed steps remain one action away.
- Approval expands into a focused, readable decision surface containing the complete required review. It does not force a wholesale transition into Systems.
- Returning from a detail restores the same intent, selection and conversation position.
- No nonessential notification sounds or decorative voice effects by default.

## 5. Systems Mode

**Purpose:** inspect reasoning evidence, operational state and dependencies at depth.

### Composition

- The same environment, typography and presence mark; slightly firmer, more opaque working surfaces.
- A compact scope rail for owned work, entities and modules. It has restrained grouping, not a channel/chat-server metaphor.
- One dominant workspace: execution plan, graph, task/project detail, communication context or sourced economics.
- An optional contextual inspector: evidence, exact tool inputs, before/after changes, source timestamps and receipt IDs.
- A lower activity/transcript region opened on demand, not a permanently flashing log terminal.
- Mission status and attention stay in predictable positions while detail changes.

Use aligned rows, connected stages, split views and readable documents. Metrics belong next to the decisions they inform; they are not an obligatory row of KPI cards. Model/token/cost telemetry is inspectable technical detail, not the permanent face of Ary.

### Mode-switch invariants

| Invariant        | Requirement                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/context | Preserve the selected entity/project/mission, conversation, graph camera where applicable, filters and draft text.                                      |
| Authority        | Preserve all permissions, pending approvals and exact reviewed inputs. Never approve or execute on switching.                                           |
| Capture/playback | Do not activate capture, change voice/provider or interrupt audio just to transition modes. Capture and stop controls remain visible.                   |
| Work             | Running actions continue under existing rules. Neither mode implies autonomous execution.                                                               |
| Focus            | Move focus to the corresponding region heading only when layout navigation requires it; never lose an in-progress form edit.                            |
| Motion           | 240–360 ms opacity/region transition; reduced motion uses an immediate layout change with a short opacity change at most.                               |
| Discoverability  | Labeled Ambient/Systems control plus the existing command palette. Do not introduce an undocumented keyboard shortcut that conflicts with current ones. |

## 6. Typography

Use a **native system sans** initially. Precision comes from hierarchy and spacing, not a novelty typeface. On macOS this uses the installed system UI face; do not package a proprietary system font. The current Arial-based UI is a migration input, not a reason to import multiple new families.

Proposed stacks:

```css
--nx-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--nx-font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
```

| Token           | Size / line height                           | Weight / tracking  | Role                                                                         |
| --------------- | -------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `type.presence` | 40 / 48 px; clamp to 32 / 40 on narrow views | 450–500 / −0.025em | Ambient intent or major selected subject; one per view.                      |
| `type.title`    | 28 / 36 px                                   | 500 / −0.02em      | Systems workspace title.                                                     |
| `type.section`  | 20 / 28 px                                   | 500 / −0.01em      | Object/section hierarchy.                                                    |
| `type.body`     | 16 / 24 px                                   | 400 / normal       | Explanations, transcript and approval consequence.                           |
| `type.control`  | 14 / 20 px                                   | 500 / normal       | Buttons, navigation, field labels.                                           |
| `type.dense`    | 13 / 20 px                                   | 400 / normal       | Optional Systems rows and metadata.                                          |
| `type.caption`  | 12 / 18 px                                   | 400–500 / normal   | Secondary timestamps; never the only expression of a warning or consequence. |
| `type.code`     | 13 / 20 px                                   | 400 / normal       | IDs, paths, exact technical values; reveal on demand.                        |

Use sentence case. Uppercase is limited to short orientation labels with at most 0.06em tracking; no wall of spaced HUD labels. Prefer weights 400/500/600; avoid ultra-light body text. Use tabular numerals for comparable figures and timelines. Never animate individual digits in costs, balances, dates or permissions. Truncated names expose their full value on keyboard focus or detail; approval inputs must not depend on hover to be understood.

## 7. Spacing and density

Base unit: **4 CSS px**. Permitted spacing scale: **4, 8, 12, 16, 24, 32, 48, 64, 96**. Reserve 2 px for optical adjustment, not layout.

| Relationship             | Ambient                                            | Systems                                                 |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| Outer content inset      | 32–64 px, responsive                               | 24–32 px                                                |
| Between major regions    | 48–64 px                                           | 24–32 px                                                |
| Related text groups      | 16–24 px                                           | 12–16 px                                                |
| Label→value / icon→label | 8 px                                               | 8 px                                                    |
| Inspector padding        | 24–32 px                                           | 24 px                                                   |
| Row height               | 48–56 px                                           | 40–48 px; optional dense 36 px for pointer tables       |
| Controls                 | Minimum 40 px visual height, 44×44 px touch target | Same; density never removes keyboard/touch alternatives |

Whitespace describes grouping. Use a separator only when space and alignment are insufficient. Do not put a border around each row, metric or text group. Dense mode reduces gaps and secondary repetition; it does not lower the minimum readable size or hide evidence.

## 8. Color and semantic tokens

These are proposed implementation values. Contrast must be measured on the actual composited surface during implementation, not inferred from a token name or screenshot.

| Token                  | Value     | Meaning                                                        |
| ---------------------- | --------- | -------------------------------------------------------------- |
| `color.environment`    | `#080C12` | Quiet base field.                                              |
| `color.floor`          | `#0D131B` | Stable workspace plane.                                        |
| `color.surface`        | `#121B26` | Reading/work surface.                                          |
| `color.raised`         | `#182331` | Focused inspector/control surface.                             |
| `color.text.primary`   | `#EBF0F5` | Main text and exact values.                                    |
| `color.text.secondary` | `#AEBBCC` | Explanations and secondary labels.                             |
| `color.text.tertiary`  | `#8594A7` | Nonessential metadata; check contrast per use.                 |
| `color.text.disabled`  | `#626C7A` | Disabled affordance only; provide the reason in readable text. |
| `color.focus`          | `#B8CAE3` | Selection and keyboard focus, never “success.”                 |
| `color.ambient`        | `#ADA8CD` | Optional low-opacity violet light; nonsemantic.                |
| `color.success`        | `#9BC4B0` | Evidenced successful result only.                              |
| `color.attention`      | `#E7B97A` | Uncertainty, stale context or decision attention.              |
| `color.error`          | `#E59B9E` | A reported failure, used locally.                              |

Normal text target: at least **4.5:1** against its final background. Essential focus/status boundaries target at least **3:1** against adjacent surfaces. These are release requirements to test, not a conformance certification. Never lower important text opacity to make the interface look quiet. Scope opacity to a decorative plane, not its children.

Neutral surfaces should occupy most of the view. Semantic color belongs to a small marker, label or affected path. Approval is a **neutral decision state**, not automatically an amber warning. Risk, stale evidence and errors receive their own separate semantic indicator. Color never carries state alone.

## 9. Surface hierarchy, materials and depth

| Level                 | Material / purpose                                                     | Rules                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0 — Environment       | Opaque near-black field with one optional static broad light gradient. | No starfield, grid noise, repeated particles or information behind ambient decoration.                                    |
| 1 — Working plane     | Opaque floor or surface, often borderless.                             | Main reading/graph/task region. Content aligns to shared baselines rather than individual card boxes.                     |
| 2 — Context plane     | Dark translucent veil over controlled internal backgrounds.            | Inspector, compact command surface or contextual expansion. At most one backdrop-blurred context plane in a local region. |
| 3 — Decision plane    | Opaque raised surface, clearly separated.                              | Approval, uncertain effect or important input. Exact values remain legible independent of the graph behind it.            |
| 4 — Temporary overlay | Opaque menu, tooltip or bounded dialog.                                | Short-lived; semantic HTML layering/focus takes priority over cinematic depth.                                            |

### Glass and blur

- Glass is a relationship between a foreground plane and a known background. Use it sparingly on context/navigation, not every content block.
- Context background starting value: `rgba(18, 27, 38, 0.92)` with **12 px maximum** backdrop blur. If contrast suffers, increase opacity or use the solid token.
- Decision surfaces are opaque by default. No live graph, device feed or moving text may bleed through an approval.
- At most **two backdrop-blurred regions per viewport**, never nested. Do not animate blur or animate the area of a full-window blur.
- Ambient light may use a pre-rendered/static gradient; no enormous per-frame blur filters. Reduced-transparency or forced-colors preferences, unavailable filters and low-power mode use solid surfaces.

### Borders, radius and shadows

- Default separator: 1 px `rgba(184, 202, 227, 0.14)`; stronger context boundary: 1 px at 0.24. Critical boundary visibility must meet the contrast target rather than rely on these decorative defaults.
- Selection uses a clear 1–2 px focus boundary or short edge accent. Keyboard focus is a **2 px ring with 3 px offset**, visibly distinct from selected state.
- Corner radius: 6 px fields, 8 px controls, 12 px contextual surfaces, 16 px decision/dialog surfaces. Pill shapes only for short status/context tags, never all containers.
- Context shadow: `0 12px 32px rgba(0,0,0,0.24)`.
- Decision shadow: `0 20px 56px rgba(0,0,0,0.40)` plus a readable border.
- Selected graph halo: soft focus-color wash at ≤0.16 opacity, spatially local. It must not merge adjacent node labels or imply task success.

### Spatial depth

Depth order means environment→work→context→decision. It is not a literal distance scale or a reason to tilt dense content. Working text and controls stay front-facing. Optional pointer parallax affects only noninteractive background planes, maximum **4 px** displacement; disable for touch, coarse pointer and reduced motion. Do not move targets under the cursor. Use DOM layering for panels and the existing graph renderer for graph positions; no second scene graph for application state.

## 10. Ary's presence mark

The presence mark is a small **horizontal seam of light with a soft, shallow field behind it**. It is not a face, reactor, eye, globe or spinning orb. Its defining qualities are a stable center, restrained breadth and exact responsiveness.

Starting footprint: 48×12 px visible mark inside a 56×32 px reserved layout area; status text sits beside it. Ambient may use a 96×24 px visible mark near the current intent, with the same silhouette. The mark never replaces the microphone indicator, approval label or status text.

Only a real event may change its light, width or texture. A still mark can be fully alive because it responds immediately when the user acts. Do not simulate neural activity while idle. The presence mark itself is not an unlabeled hidden button; explicit controls sit adjacent.

## 11. Motion system

Reuse `components/spatial/motion.ts` and its shared focus/camera lifecycle. Use CSS opacity/transform for surface transitions. Avoid installing GSAP/Rive or another motion engine just for this vocabulary.

| Semantic token         | Starting duration / envelope       | Purpose                                                                |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `motion.acknowledge`   | 80–120 ms                          | Press/focus response; never delay the actual action.                   |
| `motion.state`         | 140–180 ms                         | Label/emphasis/material state change.                                  |
| `motion.reveal`        | 180–240 ms; 4–8 px travel          | Reveal related evidence or an inspector.                               |
| `motion.focus`         | 240–360 ms                         | Move attention between related objects or modes.                       |
| `motion.navigateGraph` | 300–480 ms maximum                 | Existing graph camera flies to a known node; interrupted by new input. |
| `motion.reorder`       | 200–280 ms                         | Change rank/order while retaining object identity and showing why.     |
| `motion.completion`    | One 180–240 ms settling transition | Receipt verified; no confetti, bounce or repeated celebration.         |

Existing springs are the first implementation option: focusing `{stiffness:160,damping:25}`, acknowledging `{220,27}`, reporting `{140,26}`. These are starting values from the repository, not a universal duration guarantee. Maintain bounded travel and settle criteria. For non-spring opacity transitions use `cubic-bezier(0.2,0,0,1)`; entering/exiting should feel related, not elastic.

Rules:

- Update semantic state immediately; animation illustrates the already-received event.
- No fake percentages, timed “analysis steps,” looping mission progress or pulsing completed nodes.
- At most one primary transition and one subordinate data effect compete for attention.
- Newly retrieved evidence reveals once; it does not repeatedly appear as if newly learned.
- On new input, interrupt the visual transition and head toward the latest valid target; do not play a backlog of animation.
- Exact financial values render immediately. If emphasis changes, fade the surrounding label/background; never roll digits or interpolate a fictitious balance.
- Reduced motion: remove parallax, graph travel, reordering travel, particles and activity sweeps. Update position directly, retain textual “moved from 4 to 2”/reason where applicable, and use ≤100 ms opacity changes if helpful.

### Performance budgets (targets, not current measurements)

- Idle: no continuous decorative animation loop. Pause hidden surfaces and optional GPU effects.
- Input/focus feedback: visible within 100 ms of local interaction; server progress is event-driven and may take longer.
- Direct manipulation: target smooth 60 Hz rendering on the agreed reference Mac, with no preventable long task above 50 ms introduced by this layer.
- Optional ambient GPU work: at most 24–30 fps while visibly active, capped resolution/DPR and no per-node DOM filters. Prefer one shared effects layer.
- Keep the existing 240-node/900-edge cap until a separately measured scale change. Do not animate every edge or move every node on selection.
- Validate a reference machine and constrained/low-power profile during implementation. If budgets fail, remove effects before sacrificing text, input or state correctness.

## 12. Ary behavior by state

The following are **presentation states**, derived from the active foreground workflow. They do not replace existing voice/action/orchestration enums. “Understanding” and “Thinking” describe observable processing stages; no private chain of thought, invented cognition or fake reasoning trace is displayed.

| State                 | Visual behavior                                                                                                                          | Honest language / entry evidence                                                                                                                          | Controls and exit                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **IDLE**              | Still seam, neutral label, static ambient field. No pulse.                                                                               | “Ready.” Foreground capture/playback/work has settled. Background jobs may retain a separate factual status.                                              | Type, explicitly start microphone, open scope or Systems.                                                                |
| **LISTENING**         | Local low-amplitude seam deformation driven by actual input level; persistent microphone icon and “Listening.” No room-wide glow.        | Enter only when a live microphone stream is acquired. Permission request itself is WAITING.                                                               | Finish recording and Cancel capture always available. Mute Ary is not Stop microphone.                                   |
| **UNDERSTANDING**     | One restrained transition from transcript toward the current subject; subtle activity treatment only while processing.                   | “Transcribing your recording” or “Resolving project context,” backed by that actual phase. No entity highlight until resolved.                            | Cancel where supported; editable transcript before Send. Ambiguity becomes WAITING, not a confident guess.               |
| **THINKING**          | Presence broadens slightly and holds; a small local sweep may indicate an outstanding response, not progress. Main content stays stable. | “Preparing a response” or a known retrieval phase. Show sources as returned. No fabricated substeps.                                                      | Stop response; text appears as received. Resolve to speaking, response-ready, waiting, action or error from real events. |
| **ACTING**            | Illuminate only the currently executing step and its outbound dependency path. The presence remains secondary to the work object.        | “Creating ‘Finish edit’” after the action is actually dispatched. Verification is separately labeled “Checking the result.”                               | Pause/cancel semantics match the adapter; disclose that in-flight effects may finish. Completion needs evidence.         |
| **DELEGATING**        | One brief source→assigned-role/step transition; then stable role rows with current stages.                                               | “Research Ary is reviewing the supplied sources,” only after an actual role/step assignment event. A draft plan alone is not delegation.                  | Inspect assignments, pause future work. No theatrical agents arriving or duplicate Ary personalities.                    |
| **WAITING**           | Still open marker and concise reason; no spinner for human decisions. Context stays in place.                                            | “Waiting for microphone access,” “Choose a project,” “Waiting for Premiere,” or “Task depends on verification.” Include last observed time when relevant. | Provide the missing input, inspect connection, safely retry if allowed, or cancel. Never promise an ETA without data.    |
| **APPROVAL_REQUIRED** | Opaque decision plane, precise before/after preview, neutral focus boundary. Risk/uncertainty receives a separate label.                 | “Approval required: create this Calendar event.” Pending status is linked to the exact existing request.                                                  | Approve named effect, Reject, Modify or inspect evidence. No countdown, default approval or gesture grant.               |
| **SPEAKING**          | Soft seam movement tied to actual playback envelope where available; otherwise a static speaking marker, not an invented waveform.       | “Speaking.” Enter on actual playback start, not TTS request dispatch. Buffering is WAITING with “Preparing audio.”                                        | Stop speaking and Mute Ary always visible; transcript remains available.                                                 |
| **ERROR**             | Local error marker and readable explanation; ambient field does not flash red. Preserve the prior successful work and evidence.          | “Premiere did not respond. The result is unknown” differs from “Request rejected before execution.”                                                       | Appropriate recovery, evidence inspection and support detail; no blind Retry on uncertain external effects.              |

### Concurrent-state arbitration

Capture, playback, work and attention are distinct signals; a single animation must not conceal another.

1. Always show actual microphone/camera activity indicators, independent of the presence state or mode.
2. Keep approval-required and uncertain-effect items pinned in Attention until handled. They can coexist with speech or background work; they do not falsely stop or complete it.
3. The main presence label follows the user's current foreground activity: active capture → active playback → foreground action/role assignment → understanding/reasoning → waiting → idle. A foreground failure replaces that label with ERROR once the affected phase stops; a background failure remains a visible scoped attention item.
4. With no live capture/playback, an approval blocking the foreground mission takes the primary label APPROVAL_REQUIRED. Other pending decisions remain counted and inspectable.
5. Never change microphone or execution state merely to satisfy this visual precedence. Do not announce high-frequency waveform/telemetry changes through a live region.

### Mapping to today's implementation

| Existing evidence                              | Proposed presentation                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Voice `requesting` / permission prompt         | WAITING + “Waiting for microphone access”; not LISTENING.                                                                 |
| Voice `listening` with acquired stream         | LISTENING + independent capture indicator.                                                                                |
| `transcribing`; entity resolution in progress  | UNDERSTANDING with the actual stage label.                                                                                |
| Voice `review`                                 | WAITING + editable transcript and Send; nothing submitted yet.                                                            |
| Brain generation / voice `thinking`            | THINKING; retrieved sources are evidence, not a reasoning transcript.                                                     |
| Playback `buffering` / `speaking`              | WAITING “Preparing audio” / SPEAKING when playback starts.                                                                |
| Running orchestration execute / verify phase   | ACTING “Executing…” / ACTING “Checking result…”; preserve phase distinction.                                              |
| Board role-stage event                         | DELEGATING when assigning; role “Reviewing” while running.                                                                |
| Existing approval-required record              | APPROVAL_REQUIRED; exact request ID/fingerprint remains behind review.                                                    |
| Voice `saving` / extraction job after response | Scoped “Checking for durable memories.” Do not keep Ary globally THINKING when the foreground response has finished.      |
| Voice `interrupted`                            | Brief “Audio stopped” acknowledgment, then current foreground state. An interrupted response is not a rolled-back action. |

## 13. Icons and status language

Use one coherent **outline icon family**, with a 24-unit design grid, nominal 1.5-unit stroke, rounded joins and 16/20/24 px rendered sizes. Use an already-approved consistent library if implementation supplies one; otherwise select and license one family during the first scoped UI pass. Do not add a library or fake an asset in this document. Avoid emoji, mixed Unicode navigation symbols, decorative logos and bespoke sci-fi glyphs.

- 16 px: compact metadata; 20 px: ordinary controls; 24 px: key orientation/capture actions.
- Icon-only controls require accessible names and visible tooltips on hover/focus. Critical decisions use text labels.
- Outline circle: queued/ready; short active segment: running; open pause bars: waiting/paused; check: verified success; horizontal dash: skipped/cancelled with text; exclamation: needs attention; broken connection: unknown/offline.
- Approved is a labeled authorization receipt, not a completion check. A check beside an action outcome is reserved for verified success.
- Avoid abbreviations such as “exec,” “err” or “auth req” in ordinary UI. IDs and machine codes belong under Details.

Wording patterns: **object + observed state**, then **reason + available decision**. Examples: “Task created · verified at 14:32”; “Calendar disconnected · connect to read events”; “Result unknown · inspect Premiere before retrying.” Do not use “All systems nominal,” “Neural core engaged” or other ungrounded status theater.

## 14. Graph and node language

The graph explains relationships, not neural mysticism. The current Canvas renderer owns positions, hit testing, selection and camera. vgpu reads a presentation snapshot and adds optional local illumination; it cannot become the interaction/data owner.

### Nodes

- Use one stable node silhouette, a circle, with a small interior type glyph and readable name. Type is not encoded by glow or an arbitrary color rainbow.
- Base visual diameter 14–28 px depending on normalized importance; selected node may reach 32 px. Importance affects area within this bounded scale, not perceived truth or permission.
- Screen-space hit area at least 32 px for pointer and 44 px for touch where practical; provide the existing searchable HTML list/detail alternative in dense regions.
- People, companies, projects, products, goals, decisions, tasks and memory objects receive distinct glyph/label semantics. Do not invent stored nodes: memory currently linked as evidence should remain evidence in the inspector unless the existing graph API explicitly returns it as a node.
- Selected node: soft local halo plus firm outline and visible label. Connected nodes retain clear labels; unrelated structure recedes. Unrelated text, essential warnings and keyboard focus must remain readable—do not fade the whole scene to illegibility.
- Recency: one subtle acknowledgment on a newly observed update, then stillness. “Recently accessed” is not “recently changed”; distinguish them in detail.
- Blocker: small attention marker plus explanation. Do not enlarge it to imply importance when its importance score is low.

### Edges and paths

| Meaning                       | Visual grammar                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current recorded relationship | Quiet solid path, 1–1.5 px default; direction marker where direction is meaningful.                                                                           |
| Strength                      | Bounded width 1–2.5 px, explained in the legend/inspector. Strength is not confidence, recency or activity.                                                   |
| Selected neighborhood         | Firm, localized focus color; maintain source/target labels.                                                                                                   |
| Actual action flow            | One restrained traversal on the relevant path when the underlying event occurs. Not continuous energy on every relationship.                                  |
| Proposed relationship         | Dashed path labeled “Proposed,” only if proposal data exists; no suggestion made to look persisted.                                                           |
| Historical relationship       | Muted dashed path plus valid-time interval in detail; explicit historical filter.                                                                             |
| Conflict/blocked dependency   | Distinct break/marker and textual reason, not red color alone.                                                                                                |
| Cluster expansion             | Preserve known node positions where possible, reveal additions once, announce count/limit. Aggregation is labeled as an aggregate, never a fabricated entity. |

Search resolves an existing node and uses the current camera to focus it. Preserve orientation; no full-world reset or layout explosion on selection. At reduced motion, jump directly to the target with a selected outline and label. Keep “why included,” source, valid time, observed time and canonical identity available in the inspector.

## 15. Domain state vocabularies

Use consistent grammar across Ambient summaries and Systems detail. Exact existing backend states remain unchanged; the display adapter maps them without discarding distinctions.

### Agent/role states

Agents are **roles working through Ary**, not independent personas with separate memories. Prefer role name + assigned objective + stage/evidence. No character avatars, personality colors or theatrical roll calls.

| Display state      | Meaning / presentation                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| Available          | No assigned run; quiet outline and no activity animation.                        |
| Assigned           | Concrete role/step assignment exists; show objective and shared scope.           |
| Reviewing          | Role call is actually running; restrained local activity marker.                 |
| Waiting            | Dependency, permission, source or user input needed; show which.                 |
| Findings ready     | Structured findings exist; show source count only if known.                      |
| Incorporated       | Analyst/CEO or mission has actually incorporated cited findings; link to result. |
| Failed / cancelled | Preserve partial findings and reason; no invented final contribution.            |

### Mission states

“Mission” is the user-facing concept for the existing execution plan, not a new backend system. The existing screen may retain **Execution Plans** until a separately scoped navigation change.

| Existing/derived state         | Display treatment                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Planned / ready                | Quiet numbered step and objective; no implied execution.                                                    |
| Waiting for dependency         | Open connector, named prerequisite; not an error.                                                           |
| Waiting for approval           | Neutral decision marker and exact review entry point.                                                       |
| Approved                       | “Approved · not executed”; grant state may expire or require renewed review.                                |
| Running                        | Active step receives the strongest emphasis; unrelated future steps remain still.                           |
| Verifying / needs verification | “Checking result” or “Verification needed”; no success check.                                               |
| Completed/verified             | One settling transition and evidenced result/receipt.                                                       |
| Failed                         | Local fault, scope, reason and safe next decision.                                                          |
| Skipped                        | Muted dash with reason and consequence for dependants.                                                      |
| Cancelled                      | “Cancelled before execution” or “Future steps cancelled; running effect may finish,” according to evidence. |
| Partial plan result            | Verified/skipped/failed counts and concise outcome; never a global green “Complete” that hides failures.    |

Progress is “3 of 5 steps verified” only when those counts are true. Planning, executing and verification remain distinguishable. Re-plans show changed steps and why; completed evidence stays anchored. Do not animate a rewrite as if it were the original plan.

### Memory states

| State                                | Required language and evidence                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Candidate / proposed                 | “Proposed memory,” source quote/reference, confidence and review status. Not current truth.                                        |
| Current / active                     | “Current,” with source and validity context. Active does not automatically mean user-confirmed.                                    |
| Confirmed                            | Use only when explicit confirmation evidence exists, not merely a high confidence score.                                           |
| Conflicted / contested               | Show both claims, sources and the unresolved review. Do not visually pick a winner.                                                |
| Superseded                           | Historical treatment, “Replaced by…” link, old/new validity and source. Keep readable and retrievable in history.                  |
| Archived                             | “Archived,” separate from deletion or disproval.                                                                                   |
| Extraction queued / running / failed | Job status beside the conversation; no “Remembered” until persistence succeeded.                                                   |
| Retrieval match                      | Explain semantic/text/entity/graph inclusion separately from factual confidence. A high retrieval score is not truth verification. |

Avoid numerical “truth meters.” Confidence may appear as a labeled value with method/source; use no trophy, green halo or fake certainty bar. Show “known at” and “valid at” distinctly when both are available.

### Tool states

Represent **availability**, **authority** and **execution** independently.

| Axis         | States / display                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability | Disabled, unconfigured, available, unavailable, last observed. A configuration file alone does not mean connected.                          |
| Authority    | No access, observe, recommend, draft, execute with approval, autonomous within scope. Show user/workspace/tool/product context in detail.   |
| Request      | Invalid input, ready, approval required, approved, expired/stale approval, rejected.                                                        |
| Execution    | Queued, running, result received, verifying, verified, failed before dispatch, uncertain after dispatch, cancelled/skipped where supported. |
| Provenance   | Real provider, explicit development stub, fixture or historical receipt. Never hide simulated status in tiny metadata.                      |

A single green “online” dot cannot summarize these axes. High-risk or externally constrained tools retain their mandatory approval ceiling even when a generic policy displays level 5.

### Device states

| State                      | Presentation rule                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Configured                 | Device record/adapter settings exist; no live connection claim.                                                            |
| Observed / reachable       | Show reported state and exact observation time. “Live” requires an actual continuing feed with a defined freshness policy. |
| Stale                      | Retain last known value, label “Last observed…”; never display it as current power/recording state.                        |
| Unavailable / disconnected | Broken-link indicator and setup/reconnect path; preserve last-known context.                                               |
| Changing                   | Requested value and observed value are separate until read-back.                                                           |
| Verified state             | Actual read-back matches the requested condition within stated scope. A command receipt alone is insufficient.             |
| Partial / uncertain        | Affected devices listed individually, exact known successes retained, retry blocked where delivery is uncertain.           |
| Privacy blocked            | Name the denied source/permission and how to recover; do not silently use another camera/window.                           |

Freshness thresholds belong to the adapter/source contract. If no freshness policy exists, show the observation timestamp without inventing a universal “healthy” status. A prepared recording scene does not mean recording has started.

## 16. Warnings, errors and attention

Attention is a small, persistent, actionable region—not a noisy notification feed.

| Severity                    | Treatment                                                                                                                           | Examples                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Informational               | Neutral inline text; may settle into history.                                                                                       | Read completed, context changed, source loaded.                   |
| Needs attention             | Local amber marker, persistent reason and next step.                                                                                | Ambiguous person, stale input, disconnected tool, unknown effect. |
| Failed                      | Local error marker; retain last valid content and error details.                                                                    | Request rejected, failed extraction, verification mismatch.       |
| Critical to current mission | Firm boundary around affected plan/decision, concise dependency consequence, explicit stop/recovery. No flashing/full-screen siren. | A critical prerequisite failed; later effects cannot run.         |

Toasts are allowed only for nonessential acknowledgments. Approval, destructive consequences, uncertainty and privacy state never exist only in a toast. Repeated identical faults should group by source, with count/time and history; grouping must not erase attempts.

Error copy contains: what was requested, what is known to have happened, what is unknown, and the safe available next action. Never label an uncertain external operation simply “Failed, retry.” Preserve partial successes. Show technical code/request ID on demand without exposing secrets.

## 17. Approvals and permission interaction

Approval is a decision about a specific effect. It is not consent to “let Ary help,” a cosmetic checkpoint or a general trust slider.

### Required decision content

1. Named action and affected object/destination/account/device.
2. Why Ary proposes it, distinguished from source facts.
3. Exact meaningful inputs and the before/after effect; time zone, recipient, amount, scope and file destination where relevant.
4. Data that will be used or transmitted, with source links where available.
5. Relevant permission scope, risk, and meaningful limitations/uncertain prerequisites.
6. Whether it can be undone, based on actual tool support; do not promise rollback for external effects.
7. Explicit **Approve [effect]**, **Reject**, and **Modify** where supported, plus details/evidence.

The primary label names the effect: “Approve creating event,” not “Continue” or “Looks good.” No prechecked approval, timed auto-accept, approval-by-dismissal, gesture approval or decorative progress to push consent. Focus starts on the heading or review content, not a button that Enter can accidentally execute. Escape/dismiss returns to the still-pending queue unless the user explicitly rejects.

Modifying material inputs invalidates prior review. Stale/expired grants display what changed and require the existing fresh authorization. On approval, show **Approved, awaiting execution** until dispatch; after dispatch, show result received, then verified or uncertain according to evidence. Keep the exact reviewed snapshot accessible in history.

Related bundles list every included effect and retain each individual grant. Current coordinator limits—up to three related non-high-risk pending actions—remain the ceiling. Unrelated/high-risk actions are reviewed separately. Partial grant recording is shown honestly; no visual “all approved” before the records exist.

### Voice and Ambient approvals

Voice can inspect and explicitly approve using the same authenticated conversation/action path. Read or display the exact meaningful inputs, then request confirmation of that snapshot. Misheard/ambiguous step names require clarification. If the user cannot inspect a materially important input through the current modality, keep it pending and offer the visual review. “Okay” during unrelated speech or mode switching must not become approval.

The attention region and capture indicator remain visible during review. Muting output does not hide approval text or stop a live microphone. Privacy controls must name their effect: **Stop microphone**, **Stop camera**, **Stop speaking**, **Mute Ary**.

## 18. Accessibility and graceful degradation

- Semantic HTML controls, headings, form labels and stable focus order are primary. Canvas/visual presence is supplementary.
- Every state has readable text and an icon/shape distinction. Success, uncertainty, approval and failure are never color-only.
- Do not move focused controls when priorities re-rank or content streams. Preserve the focused object; announce meaningful changes once.
- Live-region announcements are concise: new foreground stage, completed result, required approval or failure. No per-token, per-frame or continuous agent-status chatter.
- Source links, long names and exact approval details work without hover. Time zone and units accompany values; relative time exposes exact time in details.
- Reduced motion and reduced transparency are independent: remove movement for the former, use solid materials for the latter. Forced colors retains borders, labels and focus; unsupported media queries still get a usable opaque baseline.
- WebGPU unavailable/device lost: retain the current Canvas/HTML system immediately. Canvas unavailable: use searchable node/relationship list and inspector. No capability error should strand the user outside their work.
- Camera/microphone denial: show a text-first workflow and the exact recovery path. Voice-first is never voice-only.
- At 200% zoom and narrow widths, read/approve/reject/cancel/stop controls remain reachable without a page-wide horizontal scroll.

## 19. Reusable presentation contracts and migration boundary

Future implementation should introduce a small set of reusable primitives **around existing components**, not a new app framework:

| Proposed contract   | Responsibility / current integration point                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `NexusMode`         | Ambient/Systems presentation preference and focus restoration; extend existing SpatialShell/ShellBridge. No backend mode/permission state. |
| `NexusSurface`      | Work/context/decision materials with semantic variants and opaque fallback; gradually extract current feature-scoped glass rules.          |
| `AryPresence`       | Derived foreground state + truthful label; consumes existing voice/Brain/plan events, stores no mission truth.                             |
| `CommandSurface`    | Existing typed chat, transcript and voice/launcher controls; mounted outside hideable HUD.                                                 |
| `ContextInspector`  | One selected owned object with source/history details; reuse existing Brain/entity/task/finance detail data.                               |
| `StatusMark`        | State label, icon and tone; separate authorization, availability and outcome semantics.                                                    |
| `AttentionRegion`   | Pending decisions/faults linking to existing approvals/history, without a new approval queue.                                              |
| `MissionTimeline`   | Existing orchestration steps/dependencies/evidence; phase transitions tied to receipts.                                                    |
| `EvidenceReference` | Existing memory/source/action links, valid/observed time and uncertainty.                                                                  |
| `ApprovalReview`    | Existing exact-request approval data and callbacks with the decision contract above.                                                       |

Token layering: primitive values → semantic purpose → component usage → optional density/mode overrides. Suggested namespace: `--nx-*`; do not repurpose unrelated legacy tokens globally in the first pass. Mode changes may vary spacing and emphasis, but must not remap success/error/approval meanings or reduce contrast.

### First implementation slice, only after a separate request

1. Map semantic tokens onto **one** existing workspace surface and its opaque/reduced-motion alternatives.
2. Apply AryPresence and the command/attention layout to a focused Chat/Execution Plans path; preserve current behavior and API contracts.
3. Validate an Ambient→approval→Systems evidence→Ambient sequence with keyboard, real state fixtures and cancellation.
4. Extract shared primitives only after the first slice proves coherent; then migrate additional screens incrementally. Do not theme every screen in one global CSS pass.

No code migration, feature addition, library installation, screen replacement or generated-type cleanup is included in this design stage. The audit's standalone typecheck defect remains a known baseline issue, unrelated to this specification.

## 20. Design acceptance scenarios

These are future release checks, **not tests claimed to have run for this document**.

| Scenario                         | Pass condition                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Idle Ambient                     | One calm working subject, static field, clear type/mic/launcher access; no activity fabricated to fill space.                   |
| Mic permission denied            | WAITING/denial is clear; never falsely says Listening; typing remains usable.                                                   |
| Speech transcript                | LISTENING reflects acquired capture; transcription is UNDERSTANDING; editable review and explicit Send remain.                  |
| Slow reasoning/TTS               | Actual phase labels distinguish reasoning from audio buffering; no fake progress or promised ETA; Stop remains available.       |
| Concurrent work and speech       | Current playback/capture and pending approvals remain visible; background state never disappears behind the presence animation. |
| Task create with approval        | Exact task preview→approved→running→result→read-back; only verified success receives the completion check.                      |
| Interrupted external action      | Audio stops separately; in-flight action may finish; receipt/unknown state persists; no false rollback or blind retry.          |
| Memory correction                | Both versions and sources remain accessible; proposed, current, confirmed and superseded labels are not conflated.              |
| Graph search                     | Focuses known node without losing context; connected paths clarify relationships; keyboard/HTML/reduced-motion fallback works.  |
| Role delegation                  | Names real assigned roles/stages and cited findings; no invented agents, autonomous authority or performed work.                |
| Stale device state               | Last observation time visible; requested and observed state remain separate until verification.                                 |
| Mode switch                      | Same IDs, selected scope, draft, pending grant and conversation retained; no effect dispatched by transition.                   |
| Large graph / constrained device | Inputs remain responsive; optional effects degrade first; labels, inspection and current caps remain intact.                    |
| Narrow/high-zoom/forced-colors   | Important content and decisions are legible and operable without motion, transparency, hover or color inference.                |

A successful visual system lets the user answer three questions immediately: **What is Ary doing? What evidence supports it? What needs my decision?** Everything else earns its place through relevance.
