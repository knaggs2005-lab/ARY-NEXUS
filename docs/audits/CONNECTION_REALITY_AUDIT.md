# Executive Summary

This audit distinguishes implementation, configuration, authentication, live provider evidence, and user reachability. It is audit-only: no code, credentials, permissions, integrations, dependencies, or external state were changed.

The repository contains 16 identifiable connection/capability families. Source wiring and UI coverage are broad, but live state is fragmented: ToolDiscovery computes a configuration/connection projection, individual adapters own their own status methods, and several local bridges report configured/permission-gated rather than actually connected. The strongest verified live evidence is OpenAI/Supabase repository operation and the existing automated provider tests. Twilio is currently blocked by unapproved Trust Hub KYC; Hermes, Google OAuth services, and local bridges cannot be called “live” from source/configuration alone.

# Master Connection Matrix

| Connection | Category | Impl | Config | Auth | Live | Read | Write | Ary chat reachability | Palette | UI | Health | Reconnect | Test | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OpenAI reasoning | model | YES | configured | VERIFIED by prior successful app/model tests | VERIFIED | yes | n/a | DIRECT | yes | yes | partial/router telemetry | n/a | yes | LIVE_VERIFIED |
| OpenAI embeddings | model | YES | configured | VERIFIED by prior embedding tests | VERIFIED by tests; runtime health per request | yes | n/a | DIRECT via memory | no | Systems/model detail | partial | n/a | yes | LIVE_VERIFIED |
| OpenAI STT/TTS | voice | YES | configured | VERIFIED by prior voice acceptance evidence | PARTIAL/live evidence exists, session-dependent | yes | yes | DIRECT after STT text joins Brain | no | yes | telemetry | n/a | yes | PARTIAL |
| Supabase | persistence | YES | configured | VERIFIED by prior database/integrity tests | VERIFIED in test/runtime evidence | yes | yes | INDIRECT | no | status through app | partial | n/a | yes | LIVE_VERIFIED |
| Hermes | cloud worker | YES | env names present; endpoint/key not independently rechecked here | UNVERIFIED | NOT_VERIFIED | yes | proposed jobs only | MISSION_ONLY / dedicated diagnostics | no | dev diagnostics | yes | no | yes | CONFIGURED_UNVERIFIED |
| Google Calendar personal | external calendar | YES | OAuth config present | UNVERIFIED/current consent state not proven | NOT_VERIFIED | yes | approved only | DOMAIN_INTENT (calendar phrases) | yes | yes | status endpoint | yes | yes | CONFIGURED_UNVERIFIED |
| Google Calendar work | external calendar | YES (multi-account model) | partial/account-dependent | UNVERIFIED | NOT_VERIFIED | yes | approved only | DOMAIN_INTENT | yes | yes | status endpoint | yes | yes | CONFIGURED_UNVERIFIED |
| Gmail | external mail | YES | OAuth config present | UNVERIFIED/current grant not proven | NOT_VERIFIED | yes | draft/approved send | DOMAIN_INTENT (mail phrases) | yes | yes | status endpoint | yes | yes | CONFIGURED_UNVERIFIED |
| Twilio Calls | telephony | YES | configured number/credentials | credentials verified; KYC blocked | BLOCKED | yes | outbound call approved | DOMAIN_INTENT / calls panel | yes | yes | provider read | no | yes | BLOCKED_EXTERNAL |
| macOS Desktop Bridge | local control | YES | env/user/OS gated | local privacy unverified | NOT_VERIFIED | yes | yes (approved) | DOMAIN_INTENT / command palette | yes | yes | configured-only/bridge | no | yes | IMPLEMENTED_NOT_LIVE |
| Browser control | local/browser | YES | allowed origins + control flags required | unverified | NOT_VERIFIED | yes | yes (approved) | DOMAIN_INTENT / palette | yes | control panel | partial | no | yes | IMPLEMENTED_NOT_LIVE |
| MCP | external/local tools | YES | server config-dependent | per-server unverified | NOT_VERIFIED | varies | varies (approved) | MISSION_ONLY / discovery | yes | Tools | partial | config-based | yes | IMPLEMENTED_NOT_LIVE |
| Premiere | creative/local | PARTIAL | bridge/plugin dependent | local bridge unverified | NOT_VERIFIED | yes | approved operations | DOMAIN_INTENT / dedicated screen | yes | yes | bridge poll/result | no | yes | PARTIAL |
| Cinema 4D/Design | creative/local | PARTIAL | bridge dependent | unverified | NOT_VERIFIED | yes | approved geometry/export | DEDICATED_UI_ONLY / tool intent | yes | yes | bridge only | no | yes | PARTIAL |
| Studio/Amaran/Home Assistant | physical devices | PARTIAL | adapter/scene dependent | unverified | NOT_VERIFIED | yes | approved scenes | DOMAIN_INTENT (studio/podcast) | yes | yes | DeviceRegistry inspection | no | yes | PARTIAL |
| Perception/OpenAI vision | vision | YES | provider/env gated | unverified per request | NOT_VERIFIED | yes | n/a | DOMAIN_INTENT / dedicated capture | no | yes | action telemetry | n/a | yes | IMPLEMENTED_NOT_LIVE |
| Finance | financial read lens | YES | source/account dependent | unverified | NOT_VERIFIED | yes | no money movement | DOMAIN_INTENT / Finance UI | yes | yes | source-backed only | n/a | yes | READ_ONLY |
| GitHub | external integration | NO dedicated adapter found | missing | unknown | NOT_VERIFIED | no | no | NOT_REACHABLE | no | no | no | no | no | UNKNOWN |

Exact source families: `src/server/context.ts`, `src/services/tool-discovery-service.ts`, `src/infrastructure/providers/*`, `src/infrastructure/calendar/*`, `src/infrastructure/gmail/*`, `src/infrastructure/phone/*`, `src/infrastructure/desktop/*`, `src/infrastructure/control/*`, `src/infrastructure/mcp/*`, `src/infrastructure/premiere/*`, `src/infrastructure/design/*`, `src/infrastructure/studio/*`, `src/services/perception-service.ts`, and `src/services/finance-service.ts`.

# Chat Reachability Matrix

| Capability | Natural-language result | Classification | Reason |
|---|---|---|---|
| Reasoning/memory | ordinary chat | NATURAL_LANGUAGE_WORKS | `AryBrainService` canonical path |
| Calendar read/conflicts | calendar/schedule phrasing | LIMITED_NATURAL_LANGUAGE | `CalendarConversationService` has explicit recognition and account disambiguation |
| Gmail read/summarize/draft | mail/email phrasing | LIMITED_NATURAL_LANGUAGE | `GmailService` is reached through communication/domain adapters; exact account/thread may be required |
| Calls | call phrasing | LIMITED_NATURAL_LANGUAGE | phone request is permission/approval and provider/KYC dependent |
| Create/update task | task phrasing | NATURAL_LANGUAGE_WORKS | task conversation adapter and canonical entity resolution |
| Studio/podcast mode | exact scene-oriented phrasing | REQUIRES_EXACT_PHRASE | `StudioConversationService` recognizes bounded scene commands |
| Desktop/browser | command/palette or bounded control intent | REQUIRES_COMMAND_PALETTE | capabilities are discoverable, but not a general natural-language fallback |
| Premiere/Design | dedicated panel or exact tool intent | REQUIRES_DEDICATED_SCREEN | bridge state and operation schemas must be visible/reviewed |
| Hermes | diagnostics/delegation flow | MISSION_ONLY | delegated-job lifecycle and worker review approval |
| MCP | tool discovery/mission | MISSION_ONLY | server capability must be registered and permissioned |
| Perception | capture/review flow | REQUIRES_DEDICATED_SCREEN | explicit source permission and visual verification |
| Finance | finance questions | LIMITED_NATURAL_LANGUAGE | finance conversation service is read-only/source-backed |

# Connection State Architecture

ToolRegistry exposes declared capability, permission, risk, origin, and availability metadata. `ToolDiscoveryService` augments this with a per-tool `{configured, connected}` callback and recent action history; it can report “connected” after a recent successful invocation, which is explicitly not a continuous connection guarantee (`src/services/tool-discovery-service.ts`). `ModelRouter.describe()` exposes configured target eligibility, cooldown, and observed latency, but it is a model health projection rather than a general connection registry.

Individual adapters also own status: Gmail/Calendar providers read their encrypted vault connection; `TwilioPhoneProvider` exposes provider reads but current writes are KYC-blocked; control tools mostly validate OS/env/privacy gates; DeviceRegistry inspects configured adapters; Hermes has diagnostics; event SSE has a separate client connection state. There is no single canonical connection registry/health service shared by all domains. “Configured” and “connected” are therefore not equivalent, and a configured adapter can remain unavailable at invocation time.

# UI Discovery

The shell exposes Tools & connections, command palette, Systems/activity, model detail, Communications, Calendar, Calls, Gmail, Studio, Creative, Control, Finance, Hermes diagnostics, and Permissions. Calendar and Gmail have refresh/connect/disconnect states; Gmail explicitly distinguishes not connected. Tools uses ToolDiscovery availability projections. Desktop/Browser and Studio screens emphasize permission/configuration requirements. Some capabilities are only discoverable through dedicated screens or Systems Mode, and Hermes diagnostics is development-only. There is no single owner-facing “all connections” surface that shows every row with the same vocabulary (`CONNECTED`, `DEGRADED`, `NEEDS AUTH`, `BLOCKED`, `NOT CONFIGURED`).

# Health Checks

Health/status implementations exist for Gmail, Calendar, Hermes, ToolDiscovery, ModelRouter telemetry, DeviceRegistry, MCP configuration, and action/event streams. They are heterogeneous and mostly on-demand. Model provider health is cooldown/latency state, not a provider ping. Local bridges report environment/privacy eligibility and bridge polling rather than continuous reachability. No universal heartbeat or normalized last-success/last-failure record was found.

# Owner Experience

| Question after restart | Discovery path | Interactions | Friction |
|---|---|---:|---|
| Is Ary online? | open app + shell/event indicator | 1–2 | low |
| Is OpenAI working? | Systems/model detail or send a chat | 2–4 | DISCOVERY_FRICTION |
| Is Supabase working? | app operation or diagnostics | 3+ | DISCOVERY_FRICTION |
| Is Hermes working? | Systems → dev Hermes diagnostics → health/test | 3+ | DISCOVERY_FRICTION |
| Are both Calendars connected? | Calendar → refresh/account selector | 2–3 | moderate |
| Is Gmail connected? | Communications/Gmail → refresh | 2–3 | moderate |
| Can Ary use the Mac/browser? | Control/Desktop → permission/configuration | 3+ | DISCOVERY_FRICTION |
| Can Ary control Premiere? | Creative → Premiere inspector/bridge | 3+ | DISCOVERY_FRICTION |
| Can Ary make calls? | Calls → provider/KYC state | 2–3 | moderate |
| Is MCP active? | Tools → configured servers | 2–3 | moderate |
| Is Studio hardware connected? | Studio → DeviceRegistry inspection | 2–3 | moderate |

# External Blockers

- Twilio outbound calls are blocked until the Primary Trust Hub compliance profile is approved; current source/test evidence records provider rejection rather than a credential failure.
- Google Calendar/Gmail require valid OAuth consent and account grants; environment presence alone does not prove an active connection.
- Hermes requires a reachable HTTPS endpoint and valid access key; diagnostics are available only in development.
- Desktop, Browser, Premiere, Design, and Studio require local OS permissions, bridge processes, allowed origins/apps, and/or installed software.
- MCP is dependent on each configured server’s availability and credentials.

# Root Causes of "No Connections" Feeling

1. **UI_DISCOVERY:** statuses are distributed across Tools, Systems, domain screens, and development diagnostics rather than one owner-facing connection truth surface.
2. **HEALTH_VISIBILITY:** most health is on-demand/configuration-derived; there is no normalized last-success/last-failure heartbeat across domains.
3. **AUTHENTICATION:** Calendar/Gmail/Hermes/local bridges can be configured without current consent, credentials, privacy grants, or reachable endpoints.
4. **EXTERNAL_PROVIDER:** Twilio is concretely blocked by external KYC; other providers were not live-verified in this audit.
5. **CHAT_ROUTING:** some capabilities are domain-intent or exact-phrase/panel driven, so implementation does not always translate into natural conversational reachability.

# Safe Small-Model Tasks

- **SAFE_FOR_SMALL_MODEL:** produce a read-only inventory projection from existing ToolDiscovery/status APIs; standardize labels in documentation; add tests that assert unavailable providers are described honestly.
- **SAFE_FOR_SMALL_MODEL:** improve command-palette source tags for already registered tools without changing execution.

# Strong-Model Tasks

- **REQUIRES_STRONG_REASONING:** design a normalized connection-state projection that preserves each adapter’s authority; define chat capability discovery and routing rules without bypassing permissions; unify health semantics and live evidence.

# Owner-Required Tasks

- **REQUIRES_OWNER_INPUT:** choose which integrations should be enabled and visible by default; approve OAuth reconnection or local privacy grants; decide whether a single Connections screen should be primary navigation.
- **BLOCKED_BY_EXTERNAL_PROVIDER:** complete Twilio KYC; approve Google OAuth access; supply/validate Hermes endpoint credentials; grant macOS/bridge permissions and install required creative/studio software.
