# ARY Communications

Implemented September 10, 2026. Shared preparation and evidence review are working; two-way telephony and messaging delivery are not enabled or accepted.

## Audit: extend the existing system

The repository already had `PhoneProvider`/`PhoneService` with a Twilio adapter, explicit disclosure, approved scripted calls, destination validation, encrypted operation receipts, no blind redial, rate limits, refresh/cancel and call outcomes. Gmail already had OAuth, thread reads, summarization, drafts, exact send approvals and reviewed email evidence. The Communications Hub already projected Gmail/call/Calendar source references, contact relationships, open follow-ups and approvals without duplicating email storage.

The existing ToolRegistry, ActionRequestService, numeric/class/agent permissions, one-use approvals, immutable audit, execution keys, outcomes, model telemetry, real tasks and classified memory capture remain authoritative. No parallel executor, contact store, inbox, memory system or permission engine was created. Existing APIs and schemas remain intact. No package, migration, credential, production flag or provider selection changed.

## What is now available

Open **WORLD → Communications → Plan a communication · review what happened**.

1. Choose a known person/company by canonical name, alias or ID, an objective and proposed message. Optionally select a project by ID. Ambiguous names, partial matches and unresolved pronouns require clarification; planning cannot guess a recipient.
2. Prepare a channel plan. It records the canonical contact, objective, message, source conversation when supplied, channel limitations and exact proposed tool inputs in the existing action receipt. Nothing is sent.
3. Review the proposed request. Phone delivery goes to `phone.initiate`, retaining its mandatory exact approval and existing configuration/number/rate checks. Email prepares `gmail.draft`, with a later send review in the existing Gmail screen. Messaging and two-way phone requests report unavailable, with no executable delivery request.
4. Select a recorded call/email action for a debrief. Only captured consented terminal-call transcripts or complete selected email messages are eligible. An outbound script, call completion, transport success or empty transcript cannot establish recipient agreement.
5. Review extracted statements. Exact quote/source matching, importance ≥0.7 and confidence ≥0.65 filter candidates. At most five are proposed. Summary/interpretations remain unverified; confidence is a model estimate.
6. Independently approve eligible `memory.capture` and `create_task` requests. Memory is an attributed episodic statement, not a silent update to confirmed truth. Follow-ups require an existing project and leave due dates unset rather than inventing dates or speakers. Existing task, memory, activity, outcomes and Hub follow-up views display the results.

The planner/debrief tools are registered in the same catalog used by discovery and orchestration. This does not add a separate natural-language router or guarantee that an ambiguous “call them” can execute. The current phone transport speaks the approved script and hangs up; it cannot negotiate availability.

## Adapter and permission contracts

`CommunicationAdapter` is a preparation interface: channel, transport, conversational capability and typed preparation result. `CommunicationAdapterRegistry` permits server-owned registration and rejects duplicates/unknown channels. It deliberately exposes no direct send method. Phone/email delivery stays in their established provider interfaces. Messaging is an explicit unavailable adapter, not a mock successful sender. Future channels require a reviewed domain extension, registered tools and a tested delivery adapter.

| Capability                     | Authority                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `communications.plan`          | Draft level 3; READ/WRITE classes; scoped entity access                       |
| `communications.debrief`       | Recommend level 2; READ; rechecks source and entity access                    |
| `phone.initiate`, `gmail.send` | Existing COMMUNICATE class and mandatory exact approval, including at level 5 |
| `gmail.draft`                  | Existing draft/read permissions; no delivery                                  |
| `memory.capture`               | Existing memory permission parent and mandatory approval                      |
| `create_task`                  | Existing real-task permission/approval/transaction/outcome pipeline           |

A plan is not permission to contact anyone. Prepared requests must match the recorded tool/input fingerprint. Modified inputs need a new plan/review. Source receipts are immutable and additionally SHA-256 pinned. Source permission revocation, contact address drift and changed evidence invalidate dependent requests. Existing PhoneService also revalidates the saved number at execution. Email preparation requires a previously read thread containing the exact saved email address; recipient/send review remains separate.

Every new tool requires an execution key. The UI uses stable `communication:<proposal-action-id>:<index>` keys for dependent actions; retry returns the same receipt without another delivery/task/memory. Existing external-operation uncertainty rules still forbid blind retries. This is per-action idempotency, not deduplication of separately authored plans or separately approved facts.

Plans, debriefs and exact requests live in action outputs. Child audit records link their source proposal and canonical entities. Debriefs point to the original provider/source action and its hash. Captured memory text retains the exact quote, source record, source action and evidence hash; existing memory provenance/version infrastructure remains unchanged. Task descriptions and metadata preserve the same source trail. No new body-storage table exists.

Only selected evidence (≤30,000 characters; at most ten complete email messages) reaches the configured model. Unrelated memory/entities/history are empty. Provider telemetry records model, tokens, cost estimate and latency against the current action. Model output is untrusted structured data, never a dispatch instruction. Cancellation propagates through providers supporting `reasonWithUsage`; fallback providers are checked before/after reasoning. Shared emergency stop/approval boundaries remain intact.

## LiveKit SIP evaluation

Recommended future route for **two-way calls**: a separately deployed LiveKit SIP/voice worker behind the existing PhoneProvider/action lifecycle, using a configured SIP trunk. LiveKit documents creating an agent dispatch and adding an outbound SIP participant to a room. This provides an appropriate media/session layer; it does not provide Ary's authority, durable memory or business-outcome truth. See [outbound calls](https://docs.livekit.io/telephony/making-calls/outbound-calls/), [workflow setup](https://docs.livekit.io/telephony/making-calls/workflow-setup/) and [explicit agent dispatch](https://docs.livekit.io/agents/server/agent-dispatch/).

Twilio remains appropriate for the existing scripted outbound adapter. Its [bidirectional Media Streams](https://www.twilio.com/docs/voice/media-streams) could also support conversational audio, but would require Ary to manage the WebSocket/media lifecycle. See [Connect/Stream](https://www.twilio.com/docs/voice/twiml/stream). Neither approach is installed merely to declare an untested feature available.

Before enabling a conversational adapter:

- Provision a real trunk, caller identity and owner-scoped configuration; keep exact destination/objective/script/allowed-conversation boundaries visible in approval.
- Dispatch one bounded call session with automated-assistant disclosure, cancellation/hangup, silence/max-duration limits and no automatic redial. Persist dispatch/call IDs before effects and reconcile uncertain outcomes.
- Route voice turns into existing Ary reasoning with a restricted call context. Third-party speech is evidence, not authenticated owner instruction; it must never gain the owner's tool permissions or approve actions.
- Gate recording/transcripts explicitly, validate signed provider callbacks and owner/session correlation, minimize retained media and record source/time/speaker uncertainty.
- Use existing mission/action permissions for any follow-up, memory change or external effect. Approval for a call never grants permission for unrelated commitments, purchases or outreach.
- Run controlled consented live acceptance: answer/no-answer, invalid number, disclosure, barge-in/cancel, disconnect/restart, transcript/outcome linkage and duplicate callback/retry behavior. [LiveKit testing guidance](https://docs.livekit.io/telephony/testing/) describes the provider/room/participant/agent boundaries to inspect.

No live call, email or message was sent in this milestone.

## Exact files

Added:

- `src/domain/communication-plan.ts` — shared contracts and bounded schemas.
- `src/infrastructure/communications/adapters.ts` — existing phone/email preparation adapters and unavailable messaging adapter.
- `src/services/communication-planning-service.ts` — canonical planning, source gates, debrief/exact evidence proposals.
- `src/infrastructure/tools/communication-tools.ts` — registration in the current registry.
- `src/components/communications/communication-planner.tsx` — existing Hub planning/debrief surface.
- `tests/communication-planning.test.ts` — new safety/integration cases.
- `scripts/evaluate-communication-intelligence.ts` — optional synthetic live-model acceptance.
- `docs/nexus-communications.md` — this audit/evaluation/report.

Extended:

- `src/domain/permissions.ts` — two explicit capability definitions.
- `src/server/context.ts` — compose the service using the existing configured model and registry.
- `src/services/action-request-service.ts` — derive canonical scope, validate exact communication source requests, require keys, accurate simulation/model-cost metadata.
- `src/services/communications-service.ts` — project reviewed debrief follow-ups through the original source's visibility rules.
- `src/components/communications/communications-hub.tsx` — mount the additive panel.
- `scripts/evaluate-communications.ts` — preserve original checks and add the new real local UI workflow.
- `README.md`, `ARY_NEXUS_ROADMAP.md` — discovery and current status.

## Verification

- Full automated suite: **1,435 tests / 85 files passed**, including **31 new communication-planning cases**. A preceding run hit the unchanged `nexus-events-database.test.ts` requested/succeeded ordering assertion; the final full rerun passed at original timeouts with two workers. The event implementation/test was intentionally not modified; intermittent source-event ordering remains a known pre-existing weak spot.
- Focused coverage includes alias/canonical/ambiguous contacts, invalid input, identity disclosure, no silent conversational downgrade, unavailable messaging, declined/denied/mandatory approval, scoped permission and source revocation, provider failure, exact proposal/source checks, immutable audit, bounded context, cancellation, unverified/no-transcript cases, fabricated quote rejection, reviewed real local memory/task creation, source linkage and replay.
- Browser acceptance: **16 checks passed**. Synthetic transcript → debrief → visible memory approval → real local episodic memory → visible task approval → real local follow-up → replay without duplicates; existing Hub/source-redaction/approval/task behavior preserved. Normal/reduced-motion renders inspected; no browser errors. Initial harness invocation used an unsupported `find … select` command; corrected to documented `select`, then passed. Disposable server, browser and all fixtures removed.
- Live configured model: **gpt-5.6-sol succeeded**, exact commitment extracted from synthetic email text; **3,675 ms model / 3,695 ms end-to-end**, 409 input / 83 output tokens, **$0.003296 estimated cost**. Metric linked to the action; replay made zero additional model calls. No memory write or external delivery. One sample, not a latency benchmark. Temporary local repository/identity/evidence cleaned up.
- Standalone TypeScript, configured Prettier check and isolated production build: **passed**. No separate lint script is configured.

Commands: `npx vitest run --maxWorkers=2`, `npm run typecheck`, `npm run format:check`, `npm run build`, `npm run test:communications`. Optional: `node --import tsx scripts/evaluate-communication-intelligence.ts --live`; `ARY_TEST_ENV_DIR` may point to the existing private env directory without copying secrets.

Verification uses an isolated dependency/build workspace because this iCloud checkout has previously stalled builds. Exact changed source is copied back and hash-verified; the installed app's dependency symlink and active build output are preserved.

## Limits and next step

Existing Twilio cannot converse or return transcripts; messaging has no transport. Email starts from an observed thread, not cold compose, and sending uses the existing Gmail screen. Model summaries remain unverified and quote validation cannot prove speaker identity or real-world truth. Newly reviewed episodic evidence does not silently supersede confirmed facts. Project/thread/source ID fields are a minimal Systems workflow; richer pickers and a unified delivery receipt presentation can be added later. Existing owner-scoped list reads remain a scaling limit. Hosted/native acceptance gates are unchanged.

The recommended next step is controlled conversational-telephony acceptance after choosing/provisioning a provider, not autonomous outreach. Existing roadmap NEXT 3 remain unchanged; no subsequent milestone or external setup was started.
