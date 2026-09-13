# Ary realtime voice — overnight checkpoints

Starting commit: `2bd942c470bb5a98368b031de97f20e7e61cdee9`. Scope is the existing voice stack only. No unattended physical microphone, camera, speaker use or owner biometric enrollment.

## Baseline acceptance

Owner-reported physical input acceptance (supplied September 12): 439 frames captured and forwarded, 421,440 bytes, 30 batches, 24,000 Hz mono PCM16 with 960-byte frames, speech_start/speech_end both true, no provider/client failure, relay CLOSED and cleanup confirmed. This supersedes the earlier pending input gate. It is owner-supplied evidence, not a new unattended hardware test.

## Stage 2F — playback

IMPLEMENTED / SYNTHETICALLY VERIFIED / LIVE PROVIDER OUTPUT VERIFIED. OWNER_PLAYBACK_ACCEPTANCE_PENDING.

The existing authenticated, same-origin development relay now exposes one POST NDJSON output subscriber. Audio is ephemeral base64 on that stream only, never database/audit/memory content. Its 96 KB queued-byte bound fails the relay if a client cannot keep up; disconnect closes the original provider session. No new OpenAI connection. Status metadata remains audio-free.

Current `response.output_audio.delta` events carry base64 in `delta`. The adapter only emits canonical PCM after accepted session metadata confirms `audio/pcm` at 24,000 Hz. Assistant transcript events cannot enter the owner-transcript branch. Nested response usage is recognized. Realtime voice inherits `OPENAI_REALTIME_VOICE`, then existing `OPENAI_TTS_VOICE`, then Ary's existing `marin` default. Classic configuration is unchanged.

A dedicated output AudioContext uses the system output rate. Each source buffer is correctly tagged 24 kHz for browser resampling; it never shares the microphone context. Ordered scheduling has a 1,000 ms queued-audio cap and reports chunk/byte counts, underruns, queued duration and first scheduled-audio latency. Stage 2L adds bounded server pacing and short canonical speech fragments to absorb provider bursts while preserving this client cap. Excess beyond the explicit server bound still fails visibly. Sustained natural speech and device latency remain physical gates. No output device was opened during tests.

Validation: 1,640 tests / 100 files passed, typecheck and isolated production build passed. A bounded live output request returned 5 chunks / 86,400 bytes, verified PCM16 mono 24 kHz, first chunk at 640 ms. This measures provider reception, not audible latency or physical playback. The `/mic-test` button START ARY BRAIN VOICE + PLAYBACK requires an owner gesture and discloses microphone upload and speakers.

Protocol references: [OpenAI client events](https://platform.openai.com/docs/api-reference/realtime-client-events/conversation/item/create), [OpenAI server events](https://platform.openai.com/docs/api-reference/realtime-server-events/input_audio_buffer/committed). Only current non-beta event names are used for new output handling.

## Stage 2G — barge-in

IMPLEMENTED / SYNTHETICALLY VERIFIED; OWNER_BARGE_IN_ACCEPTANCE_PENDING. Each new provider speech-start turn requests canonical BOTH interruption on the existing session. Active response IDs fence cancellation and reject late audio/completion events from cancelled responses; duplicate speech IDs are bounded and suppressed. Cancellation preserves `cancel_external_effect: false`. The output client immediately clears its scheduled PCM on the interruption event; capture remains active. Browser capture requests echoCancellation and noiseSuppression. This uses OS/browser processing, not a claim of perfect acoustic echo rejection. Loud speakers, room echo and device permission behavior require owner tests. Wake suppression is wired with the unified runtime in the later stage.

Focused interruption/output/capture tests passed. Full regression: 1,641 tests / 100 files; typecheck and isolated build passed. No physical audio devices or extra paid provider diagnostics used in this stage.

## Stage 2H — local wake boundary

PARTIAL / SYNTHETIC LIFECYCLE VERIFIED / WAKE_MODEL_OWNER_SETUP_REQUIRED. Selected openWakeWord-compatible local ONNX boundary; custom Hey Ary model and tested engine packaging are missing. Exact asset/hash loading, shared-mic release/reacquire, startup/cooldown/playback suppression, engine failures and disabled-default configuration are implemented. No model was fabricated or installed under unsuitable licensing. The setup panel is explicit about the missing inference factory. No acoustic accuracy or idle resource claim. See [wake setup](wake-word.md).

## Stage 2I — Owner Voice Gate

INTERFACES / ENCRYPTED LOCAL STORAGE / SYNTHETIC VERIFICATION IMPLEMENTED. SPEAKER_MODEL_SETUP_REQUIRED and OWNER_VOICE_ENROLLMENT_REQUIRED.

Evaluated [WeSpeaker ONNX](https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md); model licensing follows its training dataset, so no unreviewed model/frontend or calibrated threshold is claimed. The concrete local provider reports unavailable. No biometric sample or template from the owner was collected overnight.

OwnerVoiceGate verifies version/model hash/dimensions and rejects missing/corrupt/mismatched/low-confidence enrollment. A match explicitly carries `authorizes_actions:false` and `replay_resistant:false`: a recording may fool speaker verification; device security and canonical approvals remain required. The provisional 0.85 cosine threshold is not a measured operating point. Optional per-turn verification is not enabled.

Templates are derived vectors only, encrypted with AES-GCM in a separate per-owner IndexedDB record using a non-exportable CryptoKey and owner-bound authenticated data. Re-enrollment rotates that key; deletion removes key and ciphertext together. No template is uploaded, logged, or inserted into memory/pgvector. This protects disk representation, not a compromised same-origin application or browser profile; it is not hardware-backed Keychain assurance. The existing server integration vault was not reused because doing so would move local biometric material through an HTTP path.

`/mic-test` → Owner Voice Gate offers explicit consent, local three-second enrollment/verification, Stop and Delete controls. Enrollment/verification stay disabled while the provider is unavailable. Authenticated local config supplies the existing owner ID; no identity is invented. Synthetic encrypted-store tests passed; no unattended microphone was activated.

## Stage 2J — canonical Brain delegation

IMPLEMENTED / SYNTHETICALLY VERIFIED; PHYSICAL_FULL_BRAIN_VOICE_ACCEPTANCE_PENDING.

Current input transcription events (`conversation.item.input_audio_transcription.completed`) are mapped exactly; partial/assistant transcripts never become owner turns. Server VAD uses `create_response:false` and `interrupt_response:false`, retaining transcription/VAD while suppressing autonomous Realtime answers. `OPENAI_REALTIME_TRANSCRIPTION_MODEL` defaults to the already-used `gpt-4o-mini-transcribe`; classic settings are unchanged. The updated live handshake and synthetic REAL_RELAY both passed.

The authenticated start endpoint accepts an opt-in Brain mode, used by START ARY BRAIN VOICE + PLAYBACK. The same server relay injects the existing authenticated AryBrainService into RealtimeBrainBridge. One final provider turn ID is processed once in the same Nexus conversation with `modality:voice`; at most two pending turns and 128 IDs per relay are allowed before a visible bounded failure. No partial transcript call and no new conversation store. Brain retains all canonical messages, entity resolution, memory extraction, actions, permissions, approvals and audit/outcomes. Tests include the actual Brain with an isolated local repository: duplicate final delivery produced one user message and existing memory extraction, then the fixture was deleted.

The bridge consumes the existing AsyncGenerator in order, waits for its final canonical response/complete, then sends only canonical response text to an out-of-band Realtime audio response (`conversation:none`, empty default input context). It deliberately waits rather than issuing overlapping sentence generations; this adds full-Brain/extraction latency. Responses beyond 4,000 characters fail visibly. Speech rendering is generative and exact spoken wording still needs acceptance; canonical text remains authoritative. Realtime has no exposed tools or ToolRegistry and cannot approve actions. A Brain approval message is spoken as supplied; only the established approval UI/path can execute.

Barge-in aborts active Brain reasoning using its AbortSignal; completed effects remain recorded, never implicitly undone. Provider failure/stream closure cleans up the bridge. Response-pending cancellation waits for the provider response ID and cancels it once, rejecting late output. Brain failures/timeouts do not fall back to independent Realtime reasoning. Classic STT → Brain → TTS tests remain passing.

## Stage 2K — coordinated wake/session/sleep lifecycle

The existing VoiceActivationService now sequences local wake pause/release,
optional OwnerVoiceGate verification, and a browser implementation of its existing
RealtimeVoiceActivator port. RelayVoiceActivator uses the existing authenticated
microphone relay; it does not create a second OpenAI connection. The standalone
OpenAIRealtimeVoiceActivator remains available and now closes late connecting
sessions and failed active sessions exactly once.

A configured local wake session may retain at most three seconds of local 16 kHz
PCM solely for opt-in wake verification. This is never an event payload, recording,
network upload, or memory. Taking the sample clears the ring; verification zeroes
the sample. Disabled verification retains no ring. Templates still require explicit
owner enrollment; verification never authorizes actions.

Only exact end utterances (`Ary, stop`, `go to sleep`, `that's all`, with optional
terminal punctuation) end the active session without a Brain call. The configurable
`ARY_REALTIME_INACTIVITY_MS` defaults to 90 seconds, bounded to 15–300 seconds.
Speech start, final transcripts, and generated assistant audio reset inactivity;
background microphone frames do not. The existing five-minute hard acceptance TTL
still limits every relay session. Closed streams include bounded failure codes so
provider failure cannot masquerade as a successful end. Clean remote endings discard
unsent closing audio, release capture, flush playback, close the provider, and resume
local wake; failures surface a degraded state. Runtime/page/offline shutdown stops
wake too. No automatic cloud fallback or reconnect is added.

The dedicated output context is retained across wake cycles after an explicit Start,
and closed on runtime shutdown. `/mic-test` now exposes playback counters and a gated
Hey Ary setup/session harness. It cannot recognize Hey Ary with the missing model
and inference package. Classic Chat voice remains an explicit separate entry using
the same Brain, not a silent replacement for local wake.

Synthetic acceptance covers a complete wake/owner/Brain/approval-text/audio/barge-in/
end/resume cycle, a second wake, verification rejection, inactivity, provider/mic/
playback/Brain failures, late provider connection after stop, and shutdown during
verification. Physical acceptance remains pending; no device was activated overnight.

Stage 2K validation: 92 focused tests and 1,668 full tests / 104 files passed;
TypeScript and isolated production build passed. Formatting reports only the four
unchanged pre-existing warnings in calls-panel, permissions, twilio-phone and
phone-service. `git diff --check` passed. No physical devices used.

## Stage 2L — final scoped review

IMPLEMENTED / SYNTHETICALLY VERIFIED / LIVE PROVIDER AND PACED OUTPUT VERIFIED.
Physical acceptance is still pending. Nothing was deployed and no physical device
or owner biometric sample was accessed.

The final live output check exposed a real problem with direct delivery: even a
short canonical greeting arrived faster than playback and exceeded the one-second
client buffer (1,734 ms of unpaced audio). Fixed by pacing transient PCM in at most
100 ms deliveries, with a separate 144,000-byte / three-second maximum server
prefetch queue. The first frame is delivered immediately; this is not a three-second
startup delay. Interruption drops both server prefetch and scheduled client audio.
Unread NDJSON still has a 96 KB bound. No audio is retained after delivery/end.

A small RealtimeSpeechQueue renders canonical text in word-preserving fragments
(target 24 characters; one word may be up to 40 characters). Each waits for provider
completion and paced delivery before the next. No second reasoning pass, replay or
tool authority. Very long unpronounceable tokens fail visibly instead of being
silently omitted. A 15-second per-fragment limit and the relay's hard TTL bound the
operation. This favors correct order and bounded buffers over seamless prosody;
pauses between fragments, voice consistency, echo and end-user latency need owner
acceptance. It is not certified continuous natural conversation.

Fresh real diagnostic after the pacing fix: 7 provider chunks / 127,200 bytes,
PCM16 mono 24 kHz, first provider audio at 582 ms. All bytes passed through the real
output-stream/client/playback scheduling code with a silent timing-only AudioContext
double. Final playback queue: 13 ms; peak server queue: 112,800 bytes. Unpaced virtual
queue would have reached 2,443 ms. **No speaker was opened; no audible latency or
speech quality is claimed.** The fixed diagnostic phrase is synthetic, not owner
speech, and this does not prove a real Brain/provider spoken conversation.

Other corrections: bounded output HTTP readiness, fail-closed incomplete provider
responses, bounded direct PCM appends, truthful configured adapter availability
(separate from live evidence), zeroing rejected/late biometric samples, fenced late
wake inference/startup, ordered final-turn cancellation and shutdown cleanup. The
original Brain, permissions/actions/approval logic, providers' model choices,
telephony, external integrations and schemas were not redesigned.

### Validation and performance

- `npm test`: **1,677 passed / 105 files**, including classic voice and existing action,
  memory, security and recovery coverage. Synthetic full runtime and isolated actual
  AryBrainService memory/message tests pass; the latter uses the existing development
  model for deterministic fixtures, not a real production reasoning response.
- `npm run typecheck`: **PASS**.
- `npm run build`: **PASS**, using an isolated source copy to preserve the running
  development server's `.next` output.
- Production HTTP acceptance: `/mic-test` **404**, cross-origin Realtime POST **403**.
  Built public JavaScript contained no server OpenAI/Hermes credential symbols.
- `npm run test:realtime-live`: **PASS** through SESSION_UPDATED and clean close.
- REAL_RELAY: **PASS**, 15 synthetic silence frames / 14,400 bytes / closed.
- `npm run format:check`: **nonzero for the same four baseline warnings only**:
  calls-panel.tsx, domain/permissions.ts, twilio-phone.ts, phone-service.ts. Left untouched.
- `git diff --check`: **PASS**.

`npx tsx scripts/profile-realtime-voice.ts` is entirely synthetic, without devices or
network. One measured run: in-process relay append mean 0.006 ms; final transcript to
fake Brain 0.169 ms; output stream/client scheduling overhead 0.660 ms; interruption
to cleared queue 0.176 ms. These exclude HTTP/provider/OS/device latency and are not
real speech performance. Input batch maximum wait remains 300 ms; client capture cap
600 ms; client playback cap 1,000 ms. Real wake idle CPU/accuracy cannot be measured
without the missing model/runtime. Existing constraints request browser echo
cancellation, not a guarantee of echo rejection.

### Security/privacy conclusion

Server-only provider credential construction is preserved. Owner/session/conversation
checks and same-origin writes remain required; production relay/harness routes remain
disabled. Realtime has no tools and cannot approve, cancel an executed external effect,
or alter canonical memory outside the existing Brain path. Audio/base64 is transient,
not in logs, audit records, files or memory. Biometric templates are local encrypted
IndexedDB records, separate from semantic embeddings, never uploaded. Wake audio is
local only and defaults disabled. Speaker matching is replayable convenience evidence,
never action authorization. Existing action permissions, approval decisions and
side-effect idempotency remain in force. Review was scoped code/tests/bundle validation,
not a claim of a complete independent penetration test.

## Morning owner acceptance

Start the normal app with `npm run dev` if needed. Sign in at
`http://127.0.0.1:3000/`, then open `http://127.0.0.1:3000/mic-test`.
Nothing starts automatically.

1. **Playback:** Load/select an existing test conversation. While present, click
   **START ARY BRAIN VOICE + PLAYBACK**. This sends microphone audio to OpenAI and
   permits speaker playback. Ask for a brief greeting. Confirm actual Ary speech,
   a stable voice, rising audio counters and no failure; assess fragment pauses.
2. **Interruption/end:** While Ary speaks, start speaking. Check prompt stopping of
   queued speech, continued capture and an answer to the new turn. Say **Ary, stop**.
   Confirm CLOSED/STOPPED, microphone false, cleanup true and counters no longer rise.
3. **Canonical continuity/approval:** In a fresh explicit voice start, say “Remember
   that my voice acceptance preference is concise answers.” Stop, then ask in normal
   text Chat what that preference is. Inspect evidence. For actions, request an
   internal test task; inspect and manually approve it through existing UI only when
   intended. Confirm real task/action history; voice must not approve itself.
4. **Wake gate:** **Check local wake assets — no microphone** currently reports the
   setup requirement. A licensed custom Hey Ary model plus tested inference factory
   must first be packaged; setting a flag alone is insufficient. After setup, enable
   wake explicitly and test local detection, false positives and sleep/reacquire.
5. **Owner gate/full flow:** Local speaker model/calibration must first be installed.
   Only then, while present, load owner voice controls, consent and enroll locally.
   Test match/reject/delete/re-enroll. Verify full wake → owner gate → Brain voice →
   interruption → end → wake resume. No financial or communication action is part of
   acceptance. Until these setup gates are complete, this test is BLOCKED.

Overall **HEY ARY: NOT READY**. Implemented voice/relay/Brain lifecycle is tested;
production local recognition, calibrated owner verification, physical playback and
full conversational acceptance are not complete. No unrelated milestone was started.

## Realtime HTTP hot-path correction — September 12, 2026

**IMPLEMENTED / LIVE SYNTHETIC HTTP VERIFIED. Physical acceptance pending.**
This narrow correction supersedes the earlier per-request authentication description
for relay follow-ups only. No model, Brain semantics, tools, wake recognition, owner
voice, schema, batch size, or buffer limit changed. The separately observed
`/api/events` 503 / “Nexus operational event could not be stored” issue is untouched.

### Confirmed cause and request boundaries

Source trace confirmed that `src/server/http.ts` awaited `context(request)` before
routing audio, status, output, and stop. In Supabase mode, `src/server/context.ts`
then called `auth.getUser`, upserted the user profile, constructed the repository,
loaded action context, and constructed the complete service graph on every packet
and poll. The owner-observed 339 ms batch exceeded its 300 ms production interval.
That observation was not a separately instrumented breakdown of individual DB calls.

Only `POST /api/realtime/session/start` retains that canonical authenticated path,
including the existing conversation ownership check and optional existing Brain
composition. Its successful response additionally supplies `relay_capability`.
Exact follow-up methods/paths are resolved before full context:

- `POST /api/realtime/session/:id/audio`
- `POST /api/realtime/session/:id/output`
- `GET /api/realtime/session/:id/status`
- `POST /api/realtime/session/:id/stop`

These require `X-Ary-Realtime-Relay`. A process-local locator maps a live relay ID to
its existing owner manager, which validates the capability and supplies the stored
owner identity. It contains no second relay, Brain, permission system, or repository.
No Supabase authentication/profile work or service construction occurs on these
follow-ups. Invalid capability requests fail without falling through to full context.
Unrelated API paths and their authorization are unchanged.

### Capability and cleanup

- Each successful start generates 32 cryptographically random bytes (256 bits), hex
  encoded. Only the start response contains the raw capability; it is `no-store`.
- The manager stores only SHA-256, checks the bounded format, and uses timing-safe
  digest comparison. A capability for another relay/owner cannot authorize this one.
- This is a scoped bearer credential for one relay, not a new user login. The client's
  existing `api()` may still attach its login token; follow-ups derive authority from
  the relay capability rather than re-authenticating that token.
- Lifetime inherits the existing five-minute maximum session TTL. Stop, expiry,
  provider failure/closure, output disconnection and forwarding failure remove the
  locator and clear the digest through the existing cleanup path. Wrong/missing,
  expired and already-closed capabilities receive the same bounded rejection.
- Internal owner-scoped stop stays idempotent. A repeated HTTP stop using a revoked
  capability is rejected; there is no authorization via a historical tombstone.
  `include_closed=1` does not restore revoked access. Active output streams deliver
  bounded terminal events; uncertain closure is not reported as confirmed cleanup.
- Client capability exists only in private transient memory and request headers. It
  is cleared on cleanup and is absent from health, status, output, URLs, audit, logs,
  browser storage and persisted fixtures. No audio persistence was added.
- Same-origin write enforcement remains ahead of routing. Relay routes and the
  diagnostic page stay unavailable in production. Managers/locators remain local to
  one server process; no shared or distributed authentication mechanism was added.

Development hot reload retains old manager instances. The first actual HTTP attempt
received no capability from an old pre-correction manager and failed closed without
sending audio. The dev server was restarted once to load the new lifecycle; process
shutdown also ended that old session. Restart after installing this correction before
starting a new acceptance session. No active microphone was used during this work.

### Repeatable real HTTP performance diagnostic

Run `npm run dev`, sign in at `http://127.0.0.1:3000/`, and open
`http://127.0.0.1:3000/mic-test`. Load/select an existing conversation and click
**BENCHMARK HTTP — SYNTHETIC ONLY**. This is a browser diagnostic, not a Node
in-process timing surrogate. It requires one normal authenticated session start,
sends 30 actual same-origin HTTP requests of 15 silence frames each at 300 ms
intervals, consumes a live output stream, polls status every 400 ms, and closes.
Measurements include client request/header preparation and HTTP/JSON completion;
start/handshake latency is reported separately and excluded from batch percentiles.
It never opens a microphone/speaker, requests Brain execution, or calls separate
STT/TTS APIs. It does send generated zero PCM to OpenAI Realtime. No retries.

Measured on the running signed-in Supabase development application:

| Measurement | Result |
| --- | ---: |
| Authenticated start + provider handshake | 853.5 ms |
| Audio batches / frames / bytes | 30 / 450 / 432,000 |
| Audio HTTP mean | 4.6 ms |
| Audio HTTP p50 | 4.3 ms |
| Audio HTTP p95 | 5.4 ms |
| Audio HTTP maximum | 9.3 ms |
| Concurrent status polls | 23 |
| Output connected / cleanup confirmed | true / true |
| Diagnostic result | PASS |

P95 is comfortably below 150 ms and all batches are below 300 ms. The unchanged
15-frame cadence is sustainable in this measured run. Status polling stays at 400 ms:
the measured concurrent workload no longer requires DB/service initialization, so
there was no evidence-based need to reduce diagnostic responsiveness. This does not
prove long-duration physical capture, speech processing latency, or audible response
latency. The output route's approximately nine-second server log duration describes
its streaming lifetime, not a nine-second request-readiness delay.

The existing **CHECK RELAY — SYNTHETIC ONLY** client path also passed in the browser:
15 captured/forwarded frames, 14,400 bytes, 24 kHz mono, 960 bytes per frame, no failures,
STOPPED/CLOSED, microphone false, cleanup confirmed. No physical mic was opened.

### Fresh verification

- `npm test`: **1,691 tests / 106 files PASS**. Focused coverage includes authenticated
  owned-conversation starts, unique capability scope, missing/wrong/other-owner
  credentials, every hot route bypassing a throwing `context` mock, ordered 15-frame
  forwarding, no persistence/log exposure, expiry/failure/closed revocation, client
  header propagation/clearing and no retry after uncertain audio POSTs.
- `npm run typecheck`: **PASS**.
- `npm run build`: **PASS** in an isolated source copy, preserving dev `.next`.
  Production checks: `/mic-test` 404, cross-origin voice POST 403, no server OpenAI or
  Hermes credential symbols in public JS.
- `npm run format:check`: **FAIL, baseline only** — unchanged warnings in
  `src/components/calls/calls-panel.tsx`, `src/domain/permissions.ts`,
  `src/infrastructure/phone/twilio-phone.ts`, `src/services/phone-service.ts`.
- `git diff --check`: **PASS**.
- `npm run test:realtime-live`: **PASS**, SOCKET_OPEN → SESSION_CREATED →
  SESSION_UPDATE_SENT → SESSION_UPDATED → PASS.
- `npx tsx scripts/evaluate-realtime-relay-live.ts`: **REAL_RELAY PASS**, 15 generated
  silence frames / 14,400 bytes / closed. This service-level check is separate from
  the actual HTTP benchmark above.

**PHYSICAL_ACCEPTANCE: PENDING.** Now that HTTP throughput passes, the owner can run
**START ARY BRAIN VOICE + PLAYBACK** while present, speak and interrupt, then stop and
verify microphone false, CLOSED/STOPPED, counters stable and cleanup confirmed. The
prior 31-frame BACKPRESSURE_LIMIT report has not been overwritten with a hardware
success claim. No wake/model installation or next milestone was started.

## Spoken-answer delay correction — September 13, 2026

The owner's Safari test exercised the physical microphone: 614 captured and forwarded
frames, 589,440 bytes, 41 batches, 24 kHz mono/960-byte frames, both VAD flags, no relay
failure, CLOSED and cleanup confirmed. Playback received **zero chunks / zero bytes**.
This verifies the repaired physical input transport, not spoken output.

The corresponding server log showed final speech reaching canonical Brain/entity
resolution, six embedding calls before the owner stopped, no reasoning response before
stop, then 127 further embedding calls and extraction. Source inspection identified
the broad `can you` capability-discovery trigger: a sound check can await a cold semantic
index of up to 180 tool descriptors. Separately, the Realtime bridge buffered Brain's
committed response until its entire generator (including extraction) finished.

Narrow changes:

- Complete benign voice sound checks (for example, “Ary, can you hear me? Answer
  briefly.”) omit unnecessary tool discovery. They still use the same authenticated
  Brain, memory retrieval, configured reasoning model, message storage, and extraction.
  Compound requests, real capability questions, and text behavior keep existing
  discovery. No canned reply, alternate Brain, model change, or permission bypass.
- The voice bridge starts speaking at the canonical `response` event and continues
  consuming the same generator for extraction. It does not speak speculative deltas.
  The existing interruption signal cancels speech, and the canonical-response deadline
  ends when that committed response arrives. Extraction is not deleted or duplicated.
- The harness now clearly distinguishes input-only testing from Brain voice/playback.

Fresh verification: **1,698 tests / 107 files PASS**, typecheck PASS, isolated production
build PASS, production `/mic-test` 404 / cross-origin voice POST 403 PASS, diff check
PASS. Formatting reports only the same four untouched baseline warnings.

`npx tsx scripts/evaluate-realtime-brain-live.ts` passed using the configured real
`gpt-5.6-sol` Brain and Realtime output, an injected synthetic final transcript, isolated
local repository, and silent playback scheduling: canonical response **1,652 ms**;
first provider audio **2,357 ms**; **18 chunks / 84,000 bytes**; zero tool-catalog
searches; one assistant message; extraction completed. Fixtures were removed. This is
not a measured Supabase-owner round-trip or physical speaker test. No microphone or
speaker was activated by the diagnostic. Owner spoken-playback acceptance remains
pending. General cold tool discovery latency is not redesigned by this correction.
The separate event-storage 503 and unrelated systems remain untouched.

## Room-noise tuning — September 13, 2026

Owner reported background audio keeping the turn open. This is a plausible cause,
not a verified speaker-isolation diagnosis. Audit found browser echo/noise suppression
already requested, automatic gain unspecified, and server VAD sensitivity/noise
reduction left to provider defaults.

The existing capture now requests `autoGainControl: false` to avoid boosting quiet
room audio. Browser support is best-effort. Existing 24 kHz mono framing, consent,
cleanup, echo cancellation and noise suppression are preserved. The existing Realtime
session requests `audio.input.noise_reduction: { type: "far_field" }` for laptop/room
microphones, `server_vad.threshold: 0.65`, 300 ms prefix padding and 500 ms silence.
The latter two preserve the documented default timing; this does not force a turn
to end while genuine speech continues. `create_response` / `interrupt_response`
remain false: canonical Brain and interruption handling still own the response.
See [OpenAI Realtime reference](https://platform.openai.com/docs/api-reference/realtime).

Validation: 1,699 tests / 107 files PASS; typecheck PASS after moving four byte-identical
generated `.next/dev/types/* 2.ts` duplicates out of the build tree (no source change);
production build and production harness/access checks PASS. Format check retains only
the four baseline warnings. A real no-audio handshake reached SOCKET_OPEN →
SESSION_CREATED → SESSION_UPDATED → PASS, confirming provider acceptance. No physical
microphone was activated for this change; room-noise effectiveness remains unverified.

Owner retest: refresh `/mic-test`, start Brain voice/playback, speak at normal volume
then pause. Check that she answers after the pause and does not repeatedly interrupt
herself. Compare a quiet room with ordinary background noise. Softer speech may now
need a closer microphone. This is noise suppression, not enrolled owner recognition;
other people's voices or TV speech can still trigger VAD. No speaker model, wake-word
installation, permissions, schemas, tools or classic voice path was changed.
