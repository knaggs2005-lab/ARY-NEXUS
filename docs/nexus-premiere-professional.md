# Premiere professional integration

September 9–10, 2026. Implementation and isolated acceptance complete. Native Adobe host acceptance remains pending (IP-10).

## Audit before implementation

Read the canonical roadmap and AGENTS.md, then reviewed the current Premiere bridge/provider, tool definitions, ActionRequestService/ActionService, permission/approval/idempotency/receipt flow, native UXP engine, Creative UI, edit planner, audio measurements, transcription interface, tests and QACutter source.

| Component                                         | Decision               | Existing behavior / extension                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PremiereProvider / UxpPremiereProvider            | KEEP / EXTEND contract | Existing inspect/execute adapter behind Nexus Tools. PremiereAdapter is now the named interface; PremiereProvider remains a compatibility alias.                                                                                                                                                                                                      |
| PremiereBridge                                    | KEEP                   | Owner/native-session checks, loopback authenticated polling, encrypted transport receipts, revision validation, at-most-once claims and uncertain-result blocking already exist. No second bridge or executor.                                                                                                                                        |
| Native UXP engine                                 | EXTEND                 | Already supports project/sequence opening, preset sequence creation, import, bins, selection, markers, whole-source selects, seek, queued export and save. Added richer inspection and reviewed native clip operations.                                                                                                                               |
| EditIntelligenceService / edit.plan               | KEEP                   | Timed transcript ingestion, hooks, question/answer signals, silence windows, ranking, selects and export recommendations already exist. Media analysis now supplies measured source evidence.                                                                                                                                                         |
| QACutter                                          | KEEP, unchanged        | Reviewed sequenceService, timelineApplyService, transcriptImportService and analysis code. Native locked transactions, source ranges and separate output sequences are useful patterns. QACutter's standalone direct execution is not routed into Nexus because it would bypass Nexus approvals. Its 25 tests remain green. No whole-extension merge. |
| Actions / permissions / audit / outcomes / events | KEEP                   | Existing requests, exact approvals, operation IDs and durable outcomes are authoritative. Existing action-record events drive the new activity view.                                                                                                                                                                                                  |
| Creative UI                                       | EXTEND                 | Adds project/timeline inspection, source analysis review, findings and scoped activity using existing styles, dialog and event infrastructure.                                                                                                                                                                                                        |

Installed Premiere is 26.3.2; UXP Developer Tools is present. The native plugin was not loaded or connected during this milestone, and no real Adobe project was edited. Existing production enable flags, owner IDs, tokens, presets and allowed roots remain unchanged.

## Technology decisions

- **Adobe UXP and Premiere APIs:** primary native boundary. The existing plugin uses project and timeline SDK objects, undoable transactions and EncoderManager, without coordinate clicks, menu IDs, eval or arbitrary scripts. [Premiere UXP](https://developer.adobe.com/premiere-pro/uxp/) and [SequenceEditor](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequenceeditor/) provide the native integration surface.
- **Existing extension:** preserve QACutter and extend Ary Creative Bridge. Its transaction/source-reference patterns are reused, not its unaudited standalone orchestration.
- **FFmpeg:** adopted for bounded local decoding of approved compressed/video excerpts. Installed through Homebrew (9.0.1; formula 9.0.1_1 and dependencies). No npm dependency added. Fixed execFile arguments restrict protocols/demuxers and output PCM to memory; there is no user filter, command, executable or network URL input. [Official FFmpeg documentation](https://ffmpeg.org/ffmpeg.html).
- **WhisperX:** evaluated for forced alignment/word timing and optional diarization. Deferred: no local WhisperX model/runtime is installed, and its runtime/model setup is not necessary for an honest first excerpt transcription. Current transcription reuses SpeechToTextProvider/OpenAI and explicitly does not claim word alignment. Imported timed SRT/JSON remains available through the existing edit planner. [WhisperX](https://github.com/m-bain/whisperX).
- **OpenTimelineIO:** useful for editorial interchange; not required for current live inspection/transactions. Native UXP avoids introducing another timeline representation. Reconsider when reviewed import/export interchange is requested. [OTIO adapters](https://opentimelineio.readthedocs.io/en/v0.15/tutorials/adapters.html).
- **PySceneDetect:** useful for visual cut detection, not acoustic silence or semantic hook judgments. No scene-detection requirement justifies a new runtime here. [PySceneDetect](https://www.scenedetect.com/docs/latest/index.html).

## Capabilities

Existing `premiere.inspect` returns project, bins, sequences and active timeline. Optional additive snapshot fields now include media paths/offline flags, source IDs/in/out ticks, track kind/index, disabled state, ticks-per-second, timebase and native supported verbs. Scan revisions include this evidence. Positions remain exact tick strings in the transport; the UI shows seconds. Timeline IDs remain revision-scoped positional IDs; never reuse one against a new revision.

New read tools:

- `premiere.read_timeline`: bounded active-sequence context from the existing native inventory.
- `premiere.find_clips`: literal, case-insensitive source/timeline name search with bounded results and completeness information. No regex, code or arbitrary project query execution.

Existing native operations remain: inspect/open project, inspect/open sequences, preset-based sequence creation where exposed by the host, media import, bins/rename, selection, markers, ordered whole-media selects, seeking, saving and queued export. Host capability data gates unavailable operations; old snapshots remain accepted but cannot enable new timeline operations.

New reviewed native operations:

- `premiere.set_clips_enabled`: exact selected timeline instances only. Creates native disabled-state actions in one undoable transaction and reads back the requested state.
- `premiere.remove_clips`: exact timeline instances, **ripple=false only**. Uses SequenceEditor/TrackItemSelection and verifies surviving clip fingerprints/count against the approved removal. No source files are deleted. Linked A/V not explicitly selected remains unchanged; gaps and loss of synchronization are possible and explained before approval.

Both retain mandatory approval even with autonomous user policy. A rejected transaction is not successful; partial/uncertain results block blind native retries. Premiere Undo is available, but the service does not falsely promise cross-process rollback or automatically undo other user work. Unknown track-lock state is not presented as unlocked: this SDK's documented track interface lacks a general reliable lock query, so native transaction rejection/read-back and exact review remain required. No automatic ripple, trimming, transitions, effect edits, sequence deletion or autonomous editing.

Native references: [ClipProjectItem source media](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/clipprojectitem/), [VideoClipTrackItem](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videocliptrackitem/), [VideoTrack](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/videotrack/).

## Source analysis and transcription

`premiere.prepare_analysis` resolves an online media ID from a fresh complete native snapshot, validates the path under the existing allowed roots and pins a fingerprint of canonical path/device/inode/size/mtime/ctime. It proposes `premiere.analyze_media` with an exact range, source fingerprint and explicit transcription choice. Analysis always requires approval, including local-only acoustic analysis.

Execution rechecks the revision/file fingerprint, decodes at most 60 seconds, verifies that decoding stayed within the approved range and rechecks the source before transcription. Decoded audio is hashed (SHA-256), measured, optionally transcribed, and supplied to the existing EditIntelligenceService. PCM/audio buffers are not written to retained storage. The receipt retains source path/IDs/revision, file fingerprint, excerpt hash/range, transcript, model/provider, timing limitations, measured recommendations, latency and unknown cost. Audio model pricing/usage is not invented; cost is null when unavailable. Creative transcripts are explicitly excluded from automatic permanent-memory conversion by existing policy.

Small 16-bit PCM WAV files (up to 64 MB) work without FFmpeg. Other supported audio-bearing media requires ARY_PREMIERE_FFMPEG_PATH. FFmpeg decodes the first audio stream to mono 16 kHz; this is a mix measurement and can hide individual-channel behavior. PCM WAV analysis chooses the strongest channel sample to avoid cancellation. Silence uses the existing half-second RMS windows (≤ -45 dBFS sustained ≥ 0.8 seconds), not absence of transcript text. Hooks are transparent editorial heuristics, not audience-performance predictions.

Transcription currently covers the full approved excerpt, not individual words. Source seconds are authoritative; display timecode uses a clearly unverified 30fps rate because source frame-rate metadata has not been validated. No recommendation outside the observed excerpt is generated from missing transcript coverage. Precise source-to-sequence mapping and word-aligned range cutting require further work; current recommendations never silently execute edits.

## Setup and visual workflow

Follow [the existing native setup](../premiere-plugin/README.md); its owner/session/loopback gates remain unchanged. Reload the updated **Ary Creative Bridge 0.2.0** alongside this server. An older plugin can still supply the old snapshot, with the new media/clip capabilities unavailable.

For compressed/video decoding, configure this server-only value after checking the installed path:

```dotenv
ARY_PREMIERE_FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
```

The example file documents it; no real environment was edited. Transcription uses the existing STT setting/key and requires exact approval to send the selected audio excerpt. Cloud inference is not silently enabled or used for local-only analysis.

Open **SKILLS → Creative → Premiere**. Inspect to see project/bin/sequence totals, source-linked timeline rows and clip search. Select a source, choose its range and whether to transcribe, prepare the analysis, inspect its plan and approve/reject through the existing dialog. Findings show actual transcript, silence/hooks and evidence; raw receipts collapse into technical details. Recent real Premiere action events appear in the activity timeline. Existing typography/glass/pulse styles, keyboard forms and reduced-motion behavior are reused; no separate animation library or fake activity.

## Exact files

Added:

- src/infrastructure/premiere/media-analysis.ts — decoder interface, PCM/FFmpeg path, pinned-source preparation, speech reuse and edit-planner evidence.
- src/components/creative/premiere-inspector.tsx — timeline/source search, analysis controls, readable findings and event activity.
- tests/premiere-media.test.ts — fourteen evidence/decoder/approval/security cases.
- scripts/evaluate-premiere-media.ts — real synthetic decoder and optional live speech acceptance through the action pipeline.
- docs/nexus-premiere-professional.md — this audit and acceptance report.

Extended:

- src/domain/premiere.ts — adapter name alias, optional snapshot metadata and two strict native verbs.
- src/domain/permissions.ts — read/recommend definitions and mandatory reviewed media/timeline execution.
- src/infrastructure/tools/premiere-tools.ts — register additional operations in the same registry.
- src/components/creative/premiere-panel.tsx — integrate inspection/analysis, capability-aware choices, destructive warning and readable receipts.
- premiere-plugin/engine.js — richer native scan, capability detection, undoable state/removal and read-back checks.
- premiere-plugin/manifest.json — plugin version 0.2.0, permissions unchanged.
- tests/premiere-plugin.test.ts — six added native SDK fixture cases; existing cases preserved.
- scripts/evaluate-premiere.ts — extend existing isolated browser acceptance and fix its stale test-only adapter-injection pattern.
- .env.example, README.md, premiere-plugin/README.md, PREMIERE_TEST_REPORT.md, ARY_NEXUS_ROADMAP.md — configuration/status and verification.

The generic bridge implementation needed no code change; its existing dispatch, receipt and owner checks accept the extended contracts. No database migration, package/lockfile change, production data, real provider key, core memory/brain, graph/vgpu, model routing, voice implementation or unrelated UI was changed. QACutter code remains unchanged.

## Acceptance

- Nexus suite: **1,404 tests / 84 files passed**, including the previous 1,384 plus 20 new Premiere cases.
- QACutter: **25 existing tests passed**, unchanged; native API fixtures, not actual Adobe execution.
- Focused Premiere: **60 tests passed**, including strict inputs, stale state/source, paths/symlink escape, missing decoder, cancellation, unsupported host, rejection, exact approval, replay, failed transactions and read-back uncertainty.
- Browser: **17 checks passed**, covering existing Creative/edit workflow plus clip search/ranges, pinned media approval, real WAV silence/evidence/outcome, activity and reduced motion. Final screenshots inspected. Temporary source copy, local repository, browser and server were cleaned up. An initial run caught the old test harness's indentation-sensitive fixture injection; fixed with an explicit replacement assertion. No production guard was weakened.
- Real FFmpeg compressed-media acceptance passed: generated audio, decode, exact approval, excerpt evidence, outcomes and idempotent replay. A command-looking filename remained inert. Local analysis sample: 27 ms.
- Live synthetic transcription passed: generated speech → compressed audio → FFmpeg → existing approved action → OpenAI gpt-4o-mini-transcribe → sourced transcript/hook. Measured analysis latency **2,329 ms**, one sample; no precise word timing or cost claim. Generated media and isolated repository removed. No user recordings or production data sent.
- Standalone typecheck, configured whole-project formatting and production build passed. No separate lint script exists. Verification used /tmp/ary-shell-dependencies to avoid iCloud stalls; changed sources are copied back and hash-verified. The installed desktop dependency symlink/build artifacts were preserved.

## Remaining native acceptance / recommended next step

Native UXP handshake and real operations in Premiere 26.3.2 remain **unverified**, including non-ripple behavior on linked clips, Undo, live UI responsiveness and actual export completion. Use an owner-selected disposable project and allowed media/preset/export folder. Connect the existing plugin, inspect native source/timeline data, reject one action, approve one clip-state change and verify Undo. Then test a reviewed non-ripple removal and exact replay. Finally import/create/select/export to a new destination and verify AME's actual output separately from queue submission. Do not mark IP-10 DONE until those real checks pass.

Inventory is still bounded (500 sequences, 2,000 items/clips, 100 tracks per type, depth 20) and subject to the existing 64 KB HTTP request ceiling. Larger projects may exceed the bridge payload limit well before row limits; no large-project acceptance claim. Revision snapshots do not fingerprint all effects or files, lock state is not guaranteed, and filesystem changes during native operations remain possible. Future improvements: precise word alignment, channel-aware measurements, exact source-to-sequence mapping and safely reviewed range edits. No next milestone was started.
