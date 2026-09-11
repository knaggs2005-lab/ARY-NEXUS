# Ary Edit Intelligence v1 — Test Report

September 8, 2026. **Bounded advisory implementation complete. Native Premiere acceptance remains pending.**

## Audit and preserved systems

Read `ARY_NEXUS_ROADMAP.md`; inspected PremiereProvider, all twelve UXP verbs, existing ToolRegistry composition, permission definitions, action source validation, approvals/idempotency/outcomes, owner-scoped repository access, Creative UI, transcript/voice interfaces and existing browser evaluator. No editing analysis service existed. The current Premiere adapter supports markers and whole-source selects, but not arbitrary trimmed source ranges.

Preserved the brain, model/voice providers, memories, retrieval, entities, temporal facts, graph/vgpu, existing tasks/projects, external integrations and native UXP implementation. Added no dependency, database migration, parallel memory/action system, provider call or live configuration. No real project was edited. Existing action/result storage is the durable plan archive.

## Added files

- `src/domain/edit-plan.ts`: strict transcript packages, SRT ingestion, structured recommendations/instructions and source-relative timecode.
- `src/domain/edit-audio.ts`: bounded PCM/RMS measurements across all channels, without network or microphone capture.
- `src/services/edit-intelligence-service.ts`: deterministic explainable analysis, source hashes, rankings, interval coverage, duplicate wording and duration-bounded rough cuts.
- `src/infrastructure/tools/edit-tools.ts`: advisory `edit.plan` and `edit.prepare_marker`, with owned source retrieval and existing permission checks.
- `src/components/creative/edit-intelligence-panel.tsx`: JSON import/editor, optional local audio measurement, ranked passages, provenance, plan download and reviewed marker mapping.
- `tests/edit-intelligence.test.ts`: 17 analysis, PCM, provenance, retention and action-pipeline tests.
- `EDIT_INTELLIGENCE_TEST_REPORT.md`: this report.

## Existing files extended

- `src/domain/permissions.ts`: two recommend-level capabilities; Premiere execution approval ceilings unchanged.
- `src/services/action-request-service.ts`: register edit tools; accept narrowly scoped successful edit-plan source links for preparation/marker requests, inheriting source product/entity scope. Correctly classify real planning/Premiere receipts instead of mock simulations. Block the generic “remember action as task” path for Creative records so transcripts/plans cannot be mislabeled as newly created tasks in permanent memory. Existing task/call source rules remain intact.
- `src/components/creative/premiere-panel.tsx`: mount the planner and accept its prepared marker request in the existing review/approval controls, preserving source-action linkage.
- `scripts/evaluate-premiere.ts`: extend the existing disposable browser evaluator with transcript planning and source-linked approved marker handoff. Its fake provider distinguishes bin and marker receipts.
- `README.md`: package format, explicit scoring, audio/source assumptions, limits and manual workflow.
- `ARY_NEXUS_ROADMAP.md`: bounded advisory foundation and verification; IP-10 native execution gap preserved.

## What the planner does

Timed JSON or SRT cues retain exact quotes/IDs and source references. Required FPS and source-relative seconds support explicit in/out labels. Overlapping cues use union coverage so they do not manufacture transcript gaps. Question punctuation and adjacency suggest question/answer links; supplied speaker labels remain unverified. Hook phrases, topic words, numbers, passage length and supplied confidence produce transparent scores. Complete non-overlapping cues are selected within the duration budget; no cue is silently truncated.

Transcript gaps are labeled untranscribed intervals, not silence. Optional browser-local audio decoding measures half-second RMS windows; audio bytes are not uploaded. Supplied windows can also be ingested with a source reference. Contiguous intervals at or below -45 dBFS for at least 0.8 seconds are silence candidates. The original transcript/audio measurements, source references and hashes remain in the action input; recommendations retain timing, reason, confidence and provenance links.

Repeated normalized wording of at least five words is flagged as a possible duplicate take, with the first representative considered for the cut. Questions/statements are distinguished and numeric corrections do not collapse. No takes are deleted, and delivery/visual equivalence is never claimed. Corrections generate a different input hash/new plan while old action evidence remains available.

Trimmed rough-cut ranges are explicitly `manual_range_edit_required`. Marker templates require source-to-sequence mapping; export templates require a real preset/output and reviewed sequence. `edit.prepare_marker` loads an owned successful plan, rechecks source/history/recommend permissions, checks the exact current Premiere project/sequence, and emits a valid `premiere.create_markers` request containing provenance comments. The user then invokes the existing approval flow. Preparation never calls `PremiereProvider.execute`.

## Verification

| Check                                    | Result                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Full suite, `npm test -- --maxWorkers=2` | **771 tests / 52 files passed** (754 existing + 17 new).               |
| `npm run typecheck`                      | Passed.                                                                |
| `npm run format:check`                   | Passed; no separate lint script configured.                            |
| `npm run build`                          | Passed production build.                                               |
| `npm run test:premiere`                  | **13 isolated checks passed**, including edit-plan and marker handoff. |
| Native Adobe editing                     | Not performed; IP-10 live acceptance remains pending.                  |

Automated coverage: valid/malformed SRT, ranges and duplicate IDs, Q/A relationships, hook evidence, scored explanations, transcript gaps versus measured silence, audio source requirement/continuity/overlap, overlapping transcript intervals, duplicate wording versus changed numbers, whole-cue budget, empty input content, nonmutating analysis and hash revisions, explicit unsupported range instructions, PCM amplitude/all-channel averaging/invalid samples/size limits, owner-scoped stored plans, idempotent requests, no Premiere call during analysis, permanent-memory retention guard, observe-only denial, marker provenance, exact approval requirement, source-history denial, destination mismatch and invented/missing source IDs.

The realistic browser test uses a temporary Next source copy, a credential-free LocalRepository and an injected Premiere port. It imports a timed interview, renders ranking/provenance, confirms no Premiere action/permanent memory was created by analysis, rejects then approves a bin through the existing pipeline, reviews a source-to-sequence marker mapping, approves its exact request and verifies the recorded source action/comments and receipt. There are no browser errors. The source copy, fixtures, server and browser session are removed afterward. Screenshots in `/tmp/ary-edit-intelligence-e2e.png` were visually inspected for the new panel, evidence rows and existing approval surface.

An initial evaluator attempt used an unsupported dropdown automation command; corrected to the browser CLI's `select` operation and reran successfully. Initial unit-test permission helper names were corrected to the existing `savePolicy` API. These were test harness issues, not production permission changes. Final checks include the Creative memory-retention guard and required source FPS. A later typecheck found four byte-identical `* 2.ts` duplicates in ignored `.next/types`; moved only those generated duplicates to a temporary backup and reran typecheck/format/build. Application source and configuration were not changed to hide the error.

## Limits and manual test

- Deterministic English-oriented heuristics, not a new LLM or visual editor. Hook confidence is not a prediction of audience engagement. Q/A linkage may require context across several cues; complete interview semantics, diarization and paraphrased duplicate takes are not inferred.
- Source labels and supplied transcript/confidence/measurements can be inaccurate. Hashes detect changed content, not authenticity. The local audio file must correspond to the named source clip; duration checks cannot prove identity.
- At most 20 clips, 200 cues each, 500 total, 55 KB UI package. Audio measurement accepts browser-decodable excerpts up to 25 MB / 250 seconds. Actual codec/device decoding compatibility beyond synthetic PCM tests was not certified.
- Non-drop source-relative timecodes only; source seconds remain authoritative. Mapping is explicitly user-reviewed, not inferred from clip names. This milestone does not query source placement automatically.
- Existing action history stores complete plans/inputs. No new transcript database or permanent-memory copy. Chat does not gain a separate automatic editing-intent resolver; explanations are present in the plan/evidence view and downloadable artifact.
- Real trim execution is still unavailable. Export recommends review of actual delivery requirements and an existing preset, not invented settings. AME submission is not render completion.

Manual walkthrough:

1. Open Creative; paste a real timed package using the README format. Include an answer, one repeated take and a gap.
2. Analyze; inspect each selected range's quote, source, score, confidence and destination. Confirm gap is not labeled silence without audio evidence.
3. Optionally choose matching local audio, reanalyze and listen to a measured silence suggestion before accepting it.
4. Correct a cue and reanalyze. Verify a new plan/hash and the original source action still in Action History. Download the structured plan.
5. With the separately enabled/accepted Premiere bridge, verify source placement in a disposable sequence, prepare one marker with its exact destination mapping, then review its normal approval request. Reject first; approve only a specific intended marker on a subsequent request. Confirm provenance in the action/receipt.
6. Keep rough-cut ranges advisory until a separately approved range-editing adapter is implemented and tested. No whole-clip fallback.

Recommended next step: finish the existing controlled native Premiere acceptance on a disposable project. Do not start autonomous editing or another milestone automatically.
