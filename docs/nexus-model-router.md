# Nexus ModelRouter

September 9, 2026. Bounded text-routing implementation; extra provider enablement is separate.

## Audit and preservation

The repository already had LanguageModelProvider, EmbeddingProvider, OpenAI Responses, a compatible text transport, explicit development stubs, usage telemetry, scoped agent model selection, hybrid memory retrieval and the Nexus event bus. It lacked coordinated selection/failover; a failed query embedding could stop lexical and graph retrieval too.

ModelRouter implements the existing LanguageModelProvider. Composition selects it in place, so Brain, analysis, planning and extraction share existing contracts. Explicit agent model choices remain pinned to their allowlisted model. No second brain, executor, memory store, permission system, database schema or API was created. ToolRegistry, exact approvals, execution keys, outcome accounting, graph/vgpu, voice interfaces and existing core instruction text remain authoritative.

## Selection and failures

1. Classify the call as chat, analysis, planning or extraction through the existing entry points. Analysis uses the existing analysis/board/research intent labels; it is not a new intent classifier.
2. Exclude disabled/unconfigured targets, privacy violations, missing tasks/capabilities, insufficient context capacity, cooldowns and unaffordable/unknown-price targets when an estimated cost ceiling is set.
3. Order eligible targets transparently: balanced uses declared priority (lower first) weighted by 100,000 plus measured/declared latency; latency uses measured EWMA then declared latency; cost uses declared token prices. Stable target ID breaks ties. Unknown latency defaults to 60 seconds, unknown cost sorts last. No invented quality scores.
4. Attempt at most three targets within per-attempt and total deadlines. Reserve estimated cost across attempts, including failures. Failures cool down for 15 seconds per failure up to two minutes. Cancellation propagates and never starts fallback. Once text has been delivered, a stream failure ends that answer rather than switching models mid-sentence.
5. If every permitted model fails, conversational reasoning returns an explicitly labeled, deterministic evidence-only view of at most four already-retrieved excerpts. Contested evidence stays marked. Planning/extraction fail visibly; existing extraction jobs remain retryable. No fake model success or generated updates.

Context admission uses UTF-8 payload bytes plus 12,000 reserved tokens as a conservative bound, not a provider tokenizer. Capacity/capabilities/prices must describe the configured deployment accurately. Cost ceilings are estimates, not a billing hard limit; unknown prices remain unknown. Existing OpenAI billing telemetry remains intact even if routing prices are not supplied. Compatible-primary transport telemetry currently retains unknown price; configure additional priced targets for priced compatible routing/usage. Request deadlines do not guarantee a remote provider will avoid billing work already received.

## Embeddings and offline behavior

Embedding model/version/dimensions are preserved. Query embedding failure or privacy denial falls back to existing PostgreSQL lexical and graph candidates with a zero query vector in the same dimensional space. The zero query is never saved as an embedding. New memory writes and reindexing still require real configured embeddings and fail safely otherwise. Brain response metadata records lexical_graph_only when degraded.

A global local_only policy cannot be relaxed by a task. If any task is local_only, shared cloud query embeddings are conservatively blocked too. Local endpoint classification requires both explicit locality and loopback; a localhost gateway forwarding cloud traffic must remain cloud-classified. Cloud vendor adapters cannot be relabeled local. Credentials stay in environment variables; no URLs, keys or prompts enter routing traces.

This policy covers routed text inference and guarded embeddings. STT/TTS, vision, external tools and database hosting retain their existing configurations and permissions. It is not a whole-device network firewall. Full internet loss can also make hosted Supabase unavailable: repository failures are reported and require retry; there is no new offline database/cache or promise of offline persistence.

## Provider adapters and LiteLLM decision

| Provider         | Implementation                                                | Acceptance                                                  |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| OpenAI           | Existing Responses adapter                                    | Live configured model verified                              |
| Anthropic        | Native Messages adapter with structured extraction validation | Mock HTTP/SSE contracts tested; real account pending        |
| Gemini           | OpenAI-compatible endpoint adapter                            | Factory/transport contracts tested; real account pending    |
| llama.cpp        | Explicit loopback compatible server                           | Shared transport tested; installed runtime pending          |
| MLX              | Explicit loopback compatible server                           | Browser used local HTTP fixture; actual MLX runtime pending |
| Other compatible | Server-configured chat-completions endpoint                   | HTTP/SSE, usage, truncation and cancellation tested         |

[LiteLLM routing](https://docs.litellm.ai/docs/routing) offers gateway routing, cooldowns and fallback policies. It is not added: the existing Node interfaces can handle this bounded desktop use without an extra Python/proxy service. A future operator-managed gateway can use the compatible adapter; label its locality by where inference actually occurs. No LiteLLM dependency or service was installed.

References: [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Anthropic compatibility limitations](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk), [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai), [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [MLX server](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py).

## Configuration

Existing provider variables remain the primary selection. ModelRouter is enabled for real providers unless ARY_MODEL_ROUTER_ENABLED=false. ARY_LLM_PROVIDER=mock remains an explicit development choice, never a production fallback.

- ARY_MODEL_ROUTER_POLICY: global privacy, preference, timeouts, optional max_estimated_cost_usd and required_capabilities.
- ARY_MODEL_ROUTER_TASKS: optional policy overrides keyed by chat/analysis/planning/extraction.
- ARY_MODEL_ROUTER_PRIMARY: context, price, priority and capability metadata for the existing primary. Identity/model/provider cannot change here.
- ARY_MODEL_ROUTER_TARGETS: up to eight extra targets; disabled until configured. api_key_env names an environment variable; raw keys are rejected in this JSON.
- ARY_EMBEDDING_LOCATION=local is only for genuinely local compatible embeddings on loopback. Defaults to cloud. Existing development local embeddings remain local.

Example additional local target (replace placeholder and capacity with the actual installed deployment):

```json
[
  {
    "id": "mac-local",
    "provider": "mlx",
    "model": "YOUR_INSTALLED_MODEL",
    "location": "local",
    "base_url": "http://127.0.0.1:8080/v1",
    "tasks": ["chat", "analysis"],
    "capabilities": ["reasoning", "streaming"],
    "context_tokens": 32768,
    "priority": 10
  }
]
```

Advertise planning/extraction and structured only after verifying the local model produces the required schema. Cloud Anthropic/Gemini targets need explicit model IDs/capacities and ANTHROPIC_API_KEY/GEMINI_API_KEY. Remote endpoints require HTTPS, disallow URL credentials/query/fragment and refuse redirects. No model downloads, account changes or additional credentials were made.

## UI and observability

Systems conversation responses expose Intelligence routing: selected target, actual attempted models/providers, why candidates qualified or were excluded, privacy, preference, latency, estimated cost and retrieval degradation. Existing Response metrics retains token/cost data. Sanitized model.routed events use the current persisted Nexus activity path. Aggregate cooldown/latency health is in-process only, shared across request instances, and resets on restart; distributed coordination is intentionally absent. Ambient conversation uses the existing provider-neutral surface with Systems content hidden. No new decorative motion or unrelated redesign.

## Exact changes

Added:

- src/domain/model-router.ts — normalized target, policy and diagnostic contracts.
- src/services/model-router.ts — shared selection, cancellation, cooldowns, bounded failover and evidence-only degradation.
- src/infrastructure/providers/model-router-config.ts — server composition, endpoint/privacy checks and guarded embeddings.
- src/infrastructure/providers/routed-chat.ts — native Anthropic and compatible transport adapters using existing prompts/validation.
- src/components/models/routing-detail.tsx — per-response Systems inspection.
- tests/model-router.test.ts and tests/model-router-brain.test.ts — 37 policy/transport/Brain regressions.
- scripts/evaluate-model-router.ts — disposable browser/provider fixture acceptance.
- scripts/evaluate-model-router-live.ts — explicit --live synthetic current-OpenAI check.

Extended:

- src/domain/providers.ts — optional cancellation/options and routing metadata.
- src/infrastructure/providers/openai.ts — reuse unchanged instruction constants and propagate cancellation through planning/extraction/embeddings.
- src/infrastructure/providers/compatible.ts — optional cancellation support.
- src/server/context.ts — wrap existing providers, preserve fixed agent model choices and emit routing events.
- src/services/memory-service.ts — retain lexical/graph retrieval after query embedding failure.
- src/services/ary-brain-service.ts — persist routing/retrieval diagnostics with existing message metadata.
- src/components/dashboard.tsx — include the routing inspector alongside existing metrics.
- .env.example, README.md, ARY_NEXUS_ROADMAP.md and this report — setup, scope and verification.

No migration, package change, production environment edit, new action permission or external integration activation.

## Verification

- Automated suite: 1,384 tests / 83 files passed, including all prior 1,347 tests. New cases cover privacy, task/capability/context admission, price/latency, cooldowns, failed providers, deadlines, late deltas, cancellation, stream truncation, extraction validation, endpoint locality, diagnostic sanitization and real Brain degradation without corrupting embeddings.
- Browser: nine isolated checks passed with local provider fixtures: shared Brain, streaming backup, two-attempt provenance, tokens, persisted model event, total outage, retryable extraction, Systems/Ambient separation, reduced-motion/error overlay checks. Temporary fixtures/processes cleaned up. Screenshots visually inspected.
- Live current OpenAI: gpt-5.6-sol, successful synthetic response, 3,363 ms, 241 input / 7 output tokens, recorded estimate $0.001104. One sample, not a latency benchmark. No database records or settings changed.
- Standalone TypeScript, configured whole-project Prettier check and Next.js production build all passed. No separate lint command is configured. Tests and build run in /tmp/ary-shell-dependencies to avoid iCloud file stalls; changed source files are copied back and hash-verified. Existing desktop dependency symlink and build output are preserved.

Manual acceptance: with a verified local server configured, ask a memory question in Systems; inspect the actual model and reason. Temporarily stop the primary endpoint and verify the local target answers. Stop all inference endpoints and verify evidence-only wording plus retryable extraction; no generated memories. Restore endpoints, wait for cooldown, retry. With local_only, verify no cloud target is attempted. Switch to Ambient and confirm technical routing details disappear. Existing approvals remain required for tool actions in every case.

Remaining: real Anthropic/Gemini/local runtime acceptance, distributed health state if deploying multiple workers, provider-specific tokenization, and hosted-database offline support if separately requested. No next milestone started.
