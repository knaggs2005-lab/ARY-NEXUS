# Persistent conversation verification — 2026-09-09

Current implementation and full evidence: [Persistent Ary conversation and Ambient Mode](docs/nexus-conversational-interface.md).

- **Passed:** 1,272 tests / 77 files in the isolated single-worker suite, typecheck, formatting, production build, normal/reduced-motion browser scenarios, real AudioWorklet/VAD, synthetic barge-in (~212–230 ms), background lifecycle handling, microphone teardown, real local memory/task/mission/approval/outcome continuity, and account-change cleanup.
- Browser speech endpoints were fixtures; Brain, actions and persistence were real local implementations. Temporary fixtures/sessions were removed.
- Separate **live OpenAI synthetic-audio** evaluation passed: STT 2,457 ms; TTS generation 2,527 ms; first Brain text 5,442 ms; response 5,953 ms; one memory extracted without warnings; same-conversation paraphrased recall passed. These are single samples, not average or first-audible latency. Existing audio token/cost gaps remain explicit.
- **Pending:** physical microphone accuracy, speaker echo/false interruptions, actual installed-app hidden/lock acceptance, and live first-audible latency. Wake detection is not enabled. Current STT starts on a completed local turn; no continuous cloud audio transport was added.
- Earlier report sections below are historical records; their model-access failures do not describe the successful September 9 synthetic provider check. Existing unrelated deployment gates remain unchanged.

---

# Ary Voice v1 verification — 2026-09-06

Implemented microphone capture, confirmed transcript submission, streaming reasoning, sentence-level speech, cancellation, mute, visible states, and provider interfaces. No schema migration or new non-voice integration.

| Check                         | Result                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated suite               | 110 tests passed (101 existing + 9 voice tests)                                                                                                      |
| TypeScript / production build | Passed                                                                                                                                               |
| Real Responses streaming      | Passed: 14 deltas, first text at 2.292 s, response at 2.526 s                                                                                        |
| Memory extraction             | Passed with real provider: 1 memory from a synthetic confirmed voice transcript, no warnings                                                         |
| Conversation continuity       | Passed: follow-up reused the same conversation ID                                                                                                    |
| Paraphrased recall            | Passed: “At what hour should we schedule my meetings?” retrieved the stored morning preference and answered 9:00 AM                                  |
| Cancellation                  | Automated test: partial answer not saved, original user message retained, extraction job completed and fact saved                                    |
| Playback queue                | Automated tests: ordered playback, prefetch, cancellation discards late audio, long segments bounded                                                 |
| Browser controls              | Chat rendered; microphone, stop speaking, mute/unmute, read aloud and model labels visible. Mute toggled correctly. Existing context panel retained. |
| Live TTS                      | Blocked: OpenAI HTTP 403 `model_not_found`; ARY project does not allow `gpt-4o-mini-tts`                                                             |
| Live STT / audio round trip   | Pending speech-model access; not claimed successful                                                                                                  |
| Physical microphone           | Not recorded during verification; browser/device permission and acoustic quality remain a user check                                                 |

The project allowlist currently includes `gpt-4o-mini-2024-07-18`, `text-embedding-3-large`, and `gpt-5.6-sol`. Automatic approval review rejected adding `gpt-4o-mini-transcribe` and `gpt-4o-mini-tts` because explicit user permission is required for that project permission change. An approval question is pending. No allowlist change was made.

`npm run test:voice -- --text-only` passed using real OpenAI reasoning/embedding/extraction providers in a temporary isolated repository. It did not use microphone audio or modify live Supabase memories. Mean reasoning-call latency across its two turns: **1.418 s**; mean response latency including retrieval: **2.089 s**. These are two synthetic samples, not a production benchmark. TTS latency and speech-to-speech latency remain unverified.

After permission is granted, enable only the two speech models and run `npm run test:voice` for synthetic TTS → STT → Brain → extraction → recall. The reusable evaluator is already implemented. Aggregate details are in ignored `.data/voice-evaluation.json`.

V1 limits: transcription begins after recording stops, transcript review requires Send, and TTS buffers each short sentence while prefetching one ahead. Browser autoplay policies can require Read aloud. Audio cost/token metrics are null, not zero. Server extraction continues on cancellation within host request lifetime; timeout/crash recovery uses the existing durable extraction-job retry flow. Public deployments should add a distributed speech usage limiter.

## September 7, 2026 — presence and interruption extension

### Audit and preserved implementation

Speech ports, OpenAI adapters, voice service, permission-protected endpoints,
editable transcript submission, streamed Brain responses, sentence speech queue,
stop/mute, cancellation and conversation/memory continuity already existed.
They were extended in place. No provider settings, API contracts, migrations,
Brain/action/graph services, model choices or unrelated UI were changed.

### Exact changes

Added:

- `src/components/voice/voice-state.ts`: deterministic presentation state and
  accessible labels from existing capture/playback/Brain signals.
- `src/components/voice/voice-presence.tsx`: native orb/state presentation; microphone
  amplitude updates via a ref/CSS variable without rerendering Chat.
- `src/components/voice/input-meter.ts`: local RMS meter with bounded sampling,
  silent audio graph, resource cleanup and graceful metering fallback.
- `tests/voice-presence.test.ts`: 15 state/accessibility, metering, streaming prefetch
  and active playback cancellation checks.
- `tests/voice-capture.test.ts`: 2 lifecycle harness tests for late microphone grants
  and stale recorder callbacks. This harness tests cleanup; it is not a browser
  microphone hardware test.

Extended:

- `src/components/voice/use-ary-voice.ts`: actual capture-level feed, interrupted
  state, Interrupt Ary, cancellation cleanup, stale callback guards. An old
  recording's delayed stop/error/data event can no longer stop a new capture.
- `src/components/voice/voice-controls.tsx`: shared presence state, single interrupt
  control, existing transcript/stop/mute controls retained; Read aloud hidden
  during capture so it cannot interfere with a recording.
- `src/components/voice/speech-queue.ts`: prefetch new sentences while earlier
  speech plays; retain ordering, bounded lookahead, and cancellation guarantees.
- `src/components/voice/voice.module.css`: scoped presence, listening/thinking/
  speaking/paused states and reduced-motion treatment.
- `README.md` and this report: usage, audit, implementation and verification limits.

No Rive dependency: native state-derived CSS plus local input metering provides
all required transitions without another runtime. Speaking animation conveys
playback state; it does not pretend to measure output audio amplitude.

### Verification

- Full suite: 361 tests passed (344 previous + 17 new).
- Typecheck, production build and formatting check passed. An initial test-only
  nullable-ref typing error was fixed before the final passing build.
- Existing nine voice tests retained, including streamed reasoning, input limits,
  provider ports, permission boundaries, ordered/late audio, and extraction after
  reasoning cancellation.
- Live authenticated browser: presence panel renders in Chat, readable ready state,
  microphone/stop/read-aloud controls, mute toggled on and restored to off;
  existing transcript/chat/context UI preserved, no visible error overlay.
- No physical microphone was recorded. Acoustic performance, device permissions,
  and autoplay remain manual device checks.
- Live synthetic evaluator used the existing locally configured credential, no
  microphone and no live Supabase memory writes. OpenAI rejected configured TTS:
  `gpt-4o-mini-tts` is not allowed for this project. STT and a full audio round trip
  were not reached and are not claimed successful. A request to enable only the
  two existing speech models is awaiting the owner's decision; no allowlist
  setting was changed.
- Initial sandbox execution could not start tsx's IPC listener; invoking the
  existing evaluator with `node --import tsx` avoids that launcher requirement.
  Network-enabled verification then confirmed the project-model restriction.

Perceived latency improvement is verified by a controlled test: a second sentence
is synthesized before the first finishes playing. No production audio latency or
quality numbers are claimed while live TTS remains blocked.

## September 7, 2026 — Voice Live Acceptance audit

**Status: IN PROGRESS — live speech access blocked.** Recovery + Deployment Integrity remains DONE. This acceptance pass preserved all application source, provider models/interfaces, memory, actions, permissions, schema and UI. No replacement voice system or new integration was added.

### Existing implementation

Audited `domain/voice.ts`, OpenAI speech adapters, `voice-service.ts`, `server/context.ts`, protected speech routes in `server/http.ts`, dashboard transcript/stream lifecycle, voice hook/controls/state/meter/speech queue, desktop media policy and existing tests. Confirmed text enters the same Brain with `modality: voice`; it does not have a separate memory or action executor. Internal action intent uses the existing pipeline after transcript submission.

Recording starts only on Microphone, stops on Finish recording or the 60-second limit, and requires transcript review/Send. Starting capture stops playback and cancels the previous response. Therefore **hands-free spoken barge-in while the microphone is off is not supported**; click Microphone/Interrupt Ary first. This was not changed into an always-on microphone. Sentence TTS is buffered and prefetched, not raw streaming audio. There is no dedicated device selector or offline voice mode. Presentation maps text generation to thinking, audio waiting to buffering, and playback to speaking; there is no separate streaming enum. Reduced-motion CSS remains present.

### Fresh live checks

| Check                                            | Result                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing synthetic TTS → STT → Brain evaluator   | Blocked at TTS: configured `gpt-4o-mini-tts` denied by project allowed-model settings; no audio returned                                                                                                                                                                    |
| Independent configured STT access                | Blocked: `gpt-4o-mini-transcribe` also denied; input was one second of digitally silent PCM, not microphone audio                                                                                                                                                           |
| Installed app Read aloud                         | After refresh, same clear allowed-model error surfaced in Chat; no stuck speaking/thinking state; Read aloud and microphone controls available                                                                                                                              |
| Provider failure audit                           | Action History shows failed `voice.speak` attempts through the existing level-5 action gate. Queue may prefetch multiple distinct sentence segments; these entries are not evidence of duplicate chat responses                                                             |
| Error-state controls                             | Mute changed to Unmute and back; original unmuted setting restored. Text entry remained available; no new chat/model reasoning request submitted                                                                                                                            |
| Initial app request                              | One earlier Read aloud attempt returned “Could not initialize user profile; apply database migrations.” Refresh loaded the existing authenticated workspace and subsequent playback reached the provider. Cause not established; no migration was applied to guess at a fix |
| Basic spoken Wag Trails question                 | Not run: speech access blocked; physical microphone not recorded                                                                                                                                                                                                            |
| Pronoun follow-up / correct contextual retrieval | Not run live in voice. Existing history reaches reasoning, but current-input entity resolution alone does not prove pronoun-aware retrieval                                                                                                                                 |
| Interruption / Clevaryn switch                   | Existing automated cancellation checks pass; physical interruption threshold and new spoken request remain unmeasured                                                                                                                                                       |
| Rapid consecutive spoken requests                | Existing stale callback/late grant/queue cancellation tests pass; real audio sequence not run                                                                                                                                                                               |
| Silence / background noise / accidental audio    | STT silence probe denied before transcription. Safety/recognition quality is unverified; existing preview requires Send and empty transcripts do not auto-dispatch. No acoustic-confidence or speech-activity classifier is present                                         |
| Permissioned task by voice                       | Existing action/permission regression suite passes; no voice-created task or live approval was fabricated for acceptance                                                                                                                                                    |
| Voice fact → evidence → later text recall        | Prior synthetic confirmed-text evidence retained above; fresh audio-backed continuity not run and not claimed passed                                                                                                                                                        |
| Microphone, echo, device, playback quality       | Awaiting the user's physical participation; no recording or acoustic claims                                                                                                                                                                                                 |

### Observed timings

- Synthetic TTS request failed after **1,967 ms** (2026-09-08 01:16 UTC).
- Independent STT request failed after **482 ms**.
- These are **time-to-error**, not successful speech latency.
- Microphone start, STT completion, voice request dispatch, model first token, first spoken audio and physical interruption latency: **not measured** because successful live voice flow was not reached. Earlier synthetic text timings above are historical and are not substituted for these acceptance measurements.
- Audio token usage/cost remains unknown (`null`). No financial value was invented.

### Validation and files

Fresh gates: **580/580 tests across 42 files passed**, including **26 voice tests** (9 core, 15 presence/queue, 2 capture lifecycle). Typecheck, configured formatting and production build passed. There is no separately configured lint command. No source changes were needed to reproduce the access restriction; the build was not treated as speech acceptance.

Only `VOICE_TEST_REPORT.md` and `ARY_NEXUS_ROADMAP.md` were edited. Ignored `.data/voice-evaluation.json` contains the fresh failed evaluator aggregate. Logs: `/tmp/ary-voice-live-evaluation.log`, `/tmp/ary-voice-stt-access.log`, and `/tmp/ary-voice-acceptance-{tests,typecheck,format,build}.log`. The temporary evaluator repository was removed in its finally block. No new accounts or synthetic production facts/tasks were created. Real failed playback audits were preserved.

### Required continuation

Explicit permission to enable only the two existing speech models was requested. An earlier automatic approval review had rejected this project permission change without explicit authorization; the current attempt did not change any allowlist, key or model. Physical microphone/playback participation was also requested. Once authorized/available, rerun the existing evaluator, then all eight live acceptance cases; resolve only demonstrated compatibility defects. **Do not mark DONE until those checks pass.**

**NEXT 3 remains:** Voice live acceptance; Calendar live acceptance; Gmail live acceptance and retention policy. Calendar was not started.

## September 7, 2026 — approved speech access and successful provider verification

**Current status: IN PROGRESS. Speech access is enabled and the real synthetic-audio round trip passed. Physical/device and live action acceptance are still required.** This section supersedes the earlier allowed-model blocker; it does not retroactively mark the earlier failed calls successful.

### Exact project change

With the user's explicit approval, added **only** `gpt-4o-mini-tts` and `gpt-4o-mini-transcribe` to project `proj_QTaP86I07eneaTujIUIfOPVH` (ARY). Preserved the original allowed entries: `gpt-4o-mini-2024-07-18`, `text-embedding-3-large`, and `gpt-5.6-sol`. The saved list contains exactly those five entries. No other model permission, rate limit, spend setting, API key, environment setting or application provider changed.

### Fresh successful tests and timings

The existing `scripts/evaluate-voice.ts` ran unchanged with real OpenAI adapters and a disposable LocalRepository, which it removed afterward. **This is real provider acceptance with synthetic speech, not a physical microphone or Supabase-backed voice acceptance claim.**

| Measurement/check                           | Observed result                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| TTS                                         | Passed: 57,600 bytes of real MP3 audio; **2,748 ms** to the complete buffered audio response                                              |
| STT                                         | Passed: **1,764 ms**; recognized “Remember, my preferred meeting time is 9 in the morning.”                                               |
| Brain streaming                             | Passed: **31 deltas**, first text **4,051 ms** after Brain dispatch including retrieval; response at **4,517 ms**                         |
| Isolated memory extraction                  | Passed: **1 memory**, no extraction warnings                                                                                              |
| Follow-up continuity / paraphrased recall   | Passed: same conversation; “At what hour should we schedule my meetings?” retrieved one memory and answered 9:00 AM                       |
| Independent provider first-token probe      | Passed: **7,344 ms** from reasoning-provider invocation to first delta; **8,293 ms** to completion; synthetic greeting, no database write |
| One-second synthetic silence                | Recheck passed: empty transcript, **911 ms**                                                                                              |
| One-second synthetic low-level noise        | Passed: empty transcript, **829 ms**                                                                                                      |
| Short synthetic accidental click            | Passed: empty transcript, **1,057 ms**                                                                                                    |
| Physical microphone start / capture quality | Not measured; awaiting user participation                                                                                                 |
| First spoken audio / acoustic output        | Not measured. Complete TTS response latency is not first audible playback                                                                 |
| Interruption/cancel latency                 | Physical timing not measured; existing automated cancellation/stale-callback checks pass                                                  |

One silence request initially still received the project allowed-model error after the successful evaluator; subsequent noise/click calls and a single silence recheck succeeded. Propagation/cache inconsistency is a possible explanation, not an established diagnosis. No additional setting was changed. The variation between the two reasoning samples is insufficient to locate a bottleneck or justify a provider refactor.

Synthetic noise transcripts were never submitted to the Brain and created no memory/action intent. The evaluator's spoken preference existed only in its temporary local repository. Successful model calls use the already-configured production adapters; these tests did not select a development fallback. Speech cost remains unknown in the existing telemetry contract.

### Physical and application acceptance remaining

The installed app was inspected and navigation/playback was attempted. Accessibility and screenshot state disagreed during the latest attempt, and an offscreen-control error occurred. **No successful installed-app playback or interruption is claimed from that attempt.** No microphone capture was started while waiting for the user's readiness response.

Still required: physical Wag Trails question and transcript, contextual follow-up, click-to-interrupt followed by the Clevaryn request, rapid recordings, microphone permission/echo checks, real first-audio and cancel timing, a voice-created task with required approval/audit/actual task receipt, and a voice-created confirmed fact with source evidence and later text recall in the live application. Existing v1 remains press-to-record with explicit transcript review. There is no hands-free detection while the mic is off, device selector or offline voice mode.

Existing voice endpoints continue through ActionService, and confirmed transcripts use the shared Brain/ToolRegistry/action pipeline. Regression tests pass, but they do not replace the pending real voice-action approval test. No production task or confirmed fact was fabricated to mark that case passed.

### Validation / modifications / continuation

- **580/580 tests across 42 files passed**, including the existing 26 voice tests and action/memory/permission regressions.
- Fresh **typecheck, configured formatting and production build passed**. No separate lint script exists.
- Only repository files edited: `VOICE_TEST_REPORT.md` and `ARY_NEXUS_ROADMAP.md`; fresh Markdown formatting also checked. No application source, schemas, interfaces, UI or provider models changed.
- Evidence: ignored `.data/voice-evaluation.json`; `/tmp/ary-voice-live-enabled.log`, `/tmp/ary-voice-first-token.log`, `/tmp/ary-voice-enabled-silence.log`, `/tmp/ary-voice-silence-recheck.log`, and `/tmp/ary-voice-enabled-{tests,typecheck,format,build}.log`.
- **NEXT 3 remains Voice live acceptance → Calendar live acceptance → Gmail live acceptance and retention policy.** Recovery remains DONE. No Calendar work started. Awaiting the user's physical microphone/playback participation before the remaining end-to-end acceptance.

### Physical session continuation — first confirmed microphone turn

The user operated the installed app's Microphone/Finish recording controls and confirmed the recognized text matched their speech. The visible unsent transcript was “Ary, what do you know about wag trails?” It was submitted unchanged through Send.

Observed installed-app sequence: transcript review → thinking → one new `openai / gpt-5.6-sol` answer → Speaking → idle. The existing conversation was retained. Ary cited the Wag Trails scope/ownership fact and high-priority tracking-fix request, and explicitly identified unknown details. Extraction completed with no new durable memories, appropriate for this question. The UI showed no duplicate answer. Hearing/playback quality confirmation was requested and remains pending; visual Speaking state alone does not establish audible quality.

Persisted response metrics shown in the UI: **6,071 ms response latency**, **2,732 ms model latency**, **1,303 input / 88 output tokens**, **7 retrieved memories**, **$0.006972 estimated reasoning cost**. These are not first-token/first-audio measurements. The retrieval snapshot includes the two directly useful Wag Trails facts plus broader Ary Nexus graph-derived context; this is a relevance weak spot, not evidence that all seven memories were necessary.

Physical microphone recognition is now user-confirmed. Follow-up context, audible output quality, interruption timing, rapid recordings, voice-created approved task, and live voice-fact/evidence/text-recall checks remain pending. Voice Live Acceptance remains IN PROGRESS.

### Physical playback confirmed; follow-up wording differs

The user confirmed the first answer was clearly audible and sounded good through the physical playback setup. Basic microphone → transcript review → real Brain response → spoken output is now observed in the installed app and user-confirmed audibly. First-audio and interruption timings remain unmeasured.

The next already-submitted visible message was “Bri, what was the last decision we made today?”, rather than the requested “What was the last decision we made about it?” Ary answered from the earlier daily-board conversation about prioritizing the Wag Trails tracking fix and retrieval-validation tests. The response showed zero detected entities, zero retrieved memories and completed extraction without new memories. This demonstrates retained conversation history, but **does not pass pronoun-based entity retrieval or latest confirmed-decision evidence acceptance**. The answer described advisory board content as a decision without a retrieved decision record; that distinction needs validation. The user was asked to repeat the exact follow-up and review the unsent transcript before submission. No source code changed.

### Exact physical follow-up confirmed

The user confirmed the corrected follow-up worked. Installed-app inspection showed the exact saved input “What was the last decision we made about it?” and a single OpenAI response about prioritizing the Wag Trails tracking fix and retrieval-validation tests. The same conversation remained selected and extraction completed without new memories. This passes topical conversation continuity. Both entity detection and retrieved-memory count were **zero**, so pronoun-aware canonical resolution, fresh entity-linked retrieval and independently evidenced latest-decision truth are **not** marked passed. The answer continues to rely on earlier conversation/board wording. Physical interruption is the next guided check.

### Clevaryn interruption request: transcription failure; glossary experiment rejected

Installed-app inspection showed the submitted voice text “show me cleveryn and instead.” Ary detected zero entities/retrieved memories, interpreted “Cleveryn” and “Instead” as unknown names and asked for clarification. Controls returned to idle. The intended Clevaryn switch **failed**; prompt stopping/no-overlap confirmation was requested separately and is not inferred from idle state.

Audited the existing speech port/service/adapter and tried a bounded spelling glossary for Ary/Ary Nexus/Clevaryn/Wag Trails. No database, aliases, entity matching or permissions were changed. A real synthetic-speech comparison returned “Show me Cleveren instead.” both without hints (567 ms) and with hints (1,007 ms). Worse, one second of silence with hints returned the glossary text. This failed the acceptance goal, so **all experimental source and associated test additions were removed**, restoring the existing implementation. One temporary unit-test fixture also failed by reusing an already-consumed Response; that test belonged solely to the rejected experiment. No existing regression test was deleted.

The experiment made no Brain requests, fact/task writes or permanent model/project changes. Its audio/transcripts stayed in the isolated provider test; the real failed user conversation remains visible. Evidence: `/tmp/ary-voice-vocabulary-live.log`. Original three source files (`domain/voice.ts`, `services/voice-service.ts`, `infrastructure/providers/openai-voice.ts`) and `tests/voice.test.ts` were restored; net repository changes are the two reports only. Final restored-code gates are recorded below.

The immediate safe path is to review/edit the visible transcript to “Show me Clevaryn instead.” before Send. This validates the manual correction path, not improved raw speech recognition. Proper-name recognition remains an acceptance weakness; no automatic similarity merge or silent transcript rewrite was introduced. Voice Live Acceptance remains IN PROGRESS.

Restored-code release gates passed: **580/580 tests across 42 files**, typecheck, configured formatting, production build and report formatting. Logs: `/tmp/ary-voice-restored-{tests,typecheck,format,build}.log`. The rejected glossary is not present in the application.

### Physical task request failure and narrow command repair — September 7, 2026

The user confirmed click-to-interrupt stopped playback, but the following phrase was misheard. This passes user-observed stopping, not a measured interruption latency or hands-free barge-in test.

The next saved microphone transcript was “I create a task for me to review Wagtrails live tomorrow.” The model answered that it could not create tasks directly. Inspection found the real task implementation already present; the anchored command adapter rejected “I create,” and the canonical resolver found no entity for “Wagtrails.” The request fell through to ordinary reasoning. The UI showed one extracted memory and nine total memories; extraction is not evidence of a created task. No permission was raised or bypassed to address this failure.

Extended only `src/services/task-conversation-service.ts`: natural requests such as “Could you please create a task for me to…” use the existing ActionRequestService pipeline. Terminal question marks are handled consistently with periods for due-date parsing. The specific unclear voice prefix “I create/add a task…” returns an internal clarification, never silently changes the transcript or executes a declarative statement. Unresolved projects receive a clear correction request. No similarity-based entity matching, new aliases, model instructions, speech prompts, APIs, schemas or UI were added.

Extended `tests/create-task.test.ts` with eight cases: four natural request variants require existing approval and preserve original request evidence; narrative/negative/quoted text does not dispatch; and the complete shared Brain scenario verifies the exact failed transcript → clarification → unresolved-name clarification → corrected canonical project → pending approval with no task → approved real local task/outcome → grounded task-ID recall. This is an isolated LocalRepository end-to-end regression, not a physical microphone or live Supabase execution claim. Existing permission/rollback/replay tests remain passing.

Release gates: **588/588 tests across 42 files passed**, typecheck passed, configured Prettier check passed, production build passed. No separate lint script exists. Logs: `/tmp/ary-voice-task-full-tests.log`, `/tmp/ary-voice-task-typecheck.log`, `/tmp/ary-voice-task-format.log`, `/tmp/ary-voice-task-build.log`. An initial new-test assertion used the wrong expected status name; corrected it to the existing `approval_required` contract without changing application status semantics.

Installed-app inspection confirmed the original failure and the live-development window. Attempting to enter a corrected request encountered a clipboard timeout and then `noWindowsAvailable`; no Send or approval was performed. Live task execution remains pending. Only the service, existing test file, this report and roadmap changed. Voice Live Acceptance remains IN PROGRESS; Recovery remains DONE. Calendar was not started.

### Mid-response voice variation — bounded speech grouping

The user reported the task interaction worked but the voice changed midway. Installed-app inspection showed that the new task handler correctly returned a project-name clarification for “Ary, create a task to review Wagtrails live tomorrow.” There was no task proposal/receipt for this turn; the app requested the exact project name and extraction completed without a new durable memory. This verifies routing/clarification, not approved task execution.

Audited speech queue, browser playback, provider selection and OpenAI adapter. The adapter retains one configured voice (default `marin`); no browser speech fallback or alternating voice selection was found. The queue previously synthesized each sentence independently, including when the complete short internal reply was already available. Independent audio generation is a plausible source of audible delivery variation, not a proven acoustic diagnosis.

Changed only `src/components/voice/speech-queue.ts` to combine already-queued sentences into utterances of at most 600 characters before synthesis. It never waits for future text: first streamed sentence timing, one-clip prefetch, API limits, provider interfaces and cancellation remain intact. Short complete task replies now use one clip, eliminating inter-clip boundaries for those replies. Longer/slowly streamed responses can still span calls and are not guaranteed to have identical vocal delivery. No model/voice setting or provider prompt changed.

Updated the existing playback-order test to use genuinely separate long clips and added two regression tests for single-utterance task approval speech and bounded lossless multi-clip playback. **590/590 tests across 42 files, typecheck, configured formatting and production build passed.** Existing early streaming, active-playback cancellation and stale-audio tests still pass. Logs: `/tmp/ary-voice-continuity-{tests,typecheck,format,build}.log`.

Native Read aloud replay was attempted, but no playback-state transition was observed; improved audible consistency is awaiting user verification. No successful acoustic/end-to-end replay is claimed. Voice Live Acceptance remains IN PROGRESS. Unchanged: tasks, permissions, approvals, memory/extraction, entity matching, provider configuration, graph, schemas and UI.

### Owner-confirmed spelling: Wagtrails

The user clarified that the project name is one word, **Wagtrails**. The earlier instruction to correct the transcript to two words was wrong. Using the existing installed-app Entities → Add alias control, saved `wagtrails` against the existing Wag Trails project and verified the persisted alias in the directory. This goes through the existing authenticated `entity.alias` action route. No duplicate entity, identity merge, source rewrite or code change was introduced. The legacy display name remains Wag Trails; the owner-confirmed one-word name is now recognized through existing alias resolution. Physical task approval/execution acceptance remains pending.

### Transcription latency: streamed preview after Finish recording

User reported slow dictation compared with Wispr Flow. Audit found Ary buffered the whole recording, then waited for full provider text, model telemetry and action/outcome persistence before returning JSON. No while-speaking STT path existed. This pass extends the current provider/service/HTTP path; it does not claim parity with another app or implement live microphone transcription.

Changes:

- `src/domain/voice.ts`: additive optional STT delta callback; existing providers/callers remain compatible.
- `src/infrastructure/providers/openai-voice.ts` and new `transcription-stream.ts`: request file SSE only for streaming callers; bounded UTF-8/CRLF decoder, final-result validation, cancellation and stream errors. Existing model/key/voice unchanged; no spelling prompt or silent fallback added.
- `src/services/voice-service.ts`: forward optional deltas while retaining limits and awaited telemetry.
- `src/server/http.ts` and new `voice-stream.ts`: same authenticated endpoint supports NDJSON by Accept header. Existing permission resolution and requested-action logging precede provider work. Partials are ephemeral; completion follows successful action/outcome persistence. Existing JSON and permission HTTP errors remain available. Cancellation propagates upstream. Aggregate first-text/total timings contain no transcript/audio.
- `src/components/voice/use-ary-voice.ts`, new `transcript-stream.ts`, and `voice-controls.tsx`: partial preview outside the editable Chat box, authoritative final callback only, cancellation/epoch guards, development first-text/ready timings. Send, approvals, memory and task execution remain unchanged.
- `scripts/evaluate-transcription-latency.ts`, `tests/transcription-stream.test.ts`, and `tests/voice-capture.test.ts`: real provider comparison and regression checks; README and roadmap documented.

Real `gpt-4o-mini-transcribe` comparison used two synthetic recordings, four requests each in buffered/stream/stream/buffered order. Every transcript retained the checked project/time content; this is a bounded content check, not a complete accuracy score.

| Recording                  | Buffered full text, ms | Stream first text, ms | Stream full text, ms |
| -------------------------- | ---------------------- | --------------------- | -------------------- |
| Short (60,288 MP3 bytes)   | 1719, 882              | 723, 824              | 891, 938             |
| Longer (340,992 MP3 bytes) | 1317, 1456             | 1643, 969             | 2024, 1257           |

Short sample means: **1,300.5 ms buffered vs 773.5 ms first text** (about 40% earlier); longer sample means: **1,386.5 vs 1,306 ms**, with one streamed request slower. Across this small sample, first text averaged 1,039.75 ms versus 1,343.5 ms buffered; streamed full completion averaged 1,277.5 ms. Provider variability prevents a speed guarantee. These measurements exclude browser upload, authentication, Supabase audit and physical recording; they do not establish the cause or full extent of the user's perceived wait.

A separate real-provider → permission-gated streamed response → browser-parser end-to-end check with a disposable LocalRepository passed: **1,163 ms first text, 1,190 ms complete**, successful action/outcome and model telemetry, no messages or memories. Temporary store deleted in finally. This verifies real protocol integration, not installed-app/Supabase microphone acceptance.

**602/602 tests across 43 files passed**, typecheck, configured formatting and production build passed. New cases cover split Unicode/CRLF, malformed/truncated streams, silence, optional provider streaming, partial/final separation, denied permission before provider invocation, delayed audit before completion, callback cancellation, and actual action/outcome persistence in isolated tests. Existing 590 regressions remain passing. An initial parameterized test shape was corrected without changing production behavior.

Evidence: ignored `.data/transcription-latency.json`, `/tmp/ary-transcription-latency-live.log`, `/tmp/ary-transcription-pipeline-live.log`, `/tmp/ary-stt-stream-{tests,typecheck,format,build}.log`. Installed app inspected; user asked to perform a short recording and report displayed timings. New physical result remains pending. No database migration, new external integration, provider/model switch, raw audio retention, automatic task execution or memory write was added. Voice Live Acceptance stays IN PROGRESS; Recovery remains DONE.
