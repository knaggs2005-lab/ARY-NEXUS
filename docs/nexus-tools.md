# Nexus ToolRegistry

## Audit and preserved systems

The repository already had one executable `ToolRegistry`, static permission definitions, Zod input validation, a scoped `ActionRequestService`, exact approval fingerprints, durable execution keys, action/outcome receipts, and internal, Google, desktop, phone, creative, studio and perception adapters. The prior Tools view listed those declarations alongside Skills. These systems remain authoritative.

This milestone extends that registry. It does not add an alternative execution pipeline, permissions database, memory store, OAuth vault or agent runtime. Existing tool names and call signatures remain compatible. No SQL migration is needed.

## Capability contract

`ToolRegistry.describe()` now includes source, capability phrases, authentication method/configuration, execution location, availability evidence and optional output schema alongside its existing input schema, actions, risk and permission/approval declarations. Unspecified output schemas are explicitly `null`; legacy adapters are not falsely advertised as output-validated.

Sources are normalized as MCP, API, OAuth, local program, macOS, browser, computer control, internal service, device, Home Assistant and plugin. Desktop app operations map to local programs; opening a website maps to browser capability but still executes on the local Mac through Desktop Bridge. There is no new arbitrary browser automation implementation. Home Assistant uses the same optional owner-configured MCP adapter; no devices or connections are invented.

`GET /api/tools/catalog` uses `tools.read`. It joins existing permissions and visible action receipts. Existing Google connection status reads the owner vault without network traffic; Desktop Bridge reflects its environment enablement. Other external adapters remain unknown until observed. Availability and health are separate: a stored connection is not an endpoint health guarantee. Successful execution within five minutes supplies a recent receipt; network failure can mark offline. Disabled configuration remains unconfigured. Health includes its evidence time and never runs silent probes.

`POST /api/tools/discover` uses `tools.discover` and accepts `{ "query": "the user's goal", "limit": 6 }` (maximum 12). It excludes denied and simulated capabilities, uses the configured embedding interface plus lexical overlap, and merges rankings with equal-weight reciprocal rank fusion (`k=60`, cosine floor 0.35). Returned reasons include semantic/lexical rank and raw scores; these are not confidence estimates. Provider failure falls back explicitly to lexical matching. Descriptor embeddings are ephemeral, owner/model/version/dimension/content-keyed, cached for 15 minutes (512 entries), with concurrency four. Query vectors are not persisted. No learned memory is created for tool definitions. First search may incur descriptor embedding latency and provider cost; subsequent searches reuse those vectors.

Discovery currently considers a bounded window of 180 permitted registered descriptors. Existing catalog receipt reads still use owner-scoped repository lists; pagination/indexed recent-action queries are future scaling work. This is not a claim of unlimited catalog scale.

The existing Brain receives up to five advisory capabilities for capability/help questions. The existing planner combines discovered and legacy selected tools, deduplicates descriptors and sends at most 80 bounded schema declarations / 85,000 serialized characters. Neither discovery nor planning authorizes execution.

## First-class MCP adapter

Production dependency: official `@modelcontextprotocol/client` 2.0.0, with `ajv` 8.20.0 for pinned JSON Schema 2020-12 validation. Supported transports: stdio and Streamable HTTP. SDK protocol negotiation/listing/call/error/session handling is reused rather than copied. No sampling, elicitation, filesystem roots, arbitrary client-supplied server URLs or commands are exposed.

MCP is disabled by default. Setup is an operator configuration step:

1. Copy `config/mcp.example.json` to a server-owned configuration path outside public assets. Replace the placeholder owner UUID, target, allowlisted tool descriptions and **exact** input/output JSON schemas with the trusted server's declarations. Do not put API keys in this file or commit private configuration.
2. Set `ARY_MCP_ENABLED=true` and `ARY_MCP_CONFIG_PATH` to that file in the existing server environment. Optional `token_env` identifies a separate environment secret. HTTP uses it as a Bearer token; stdio passes only that named value and normal process launch environment, without ambient application API keys. Existing Gmail/Calendar OAuth stays in its existing providers; automatic MCP OAuth enrollment is not implemented.
3. For stdio, configure `transport: "stdio"`, an absolute `command` and fixed `args`; omit `url`. Only trusted installed executables belong here. This starts a native process, so even inspection requires approval. Stdio and loopback HTTP/HTTPS require the existing authorized desktop session. Remote HTTP requires HTTPS; unencrypted HTTP is restricted to literal loopback addresses. Redirects are refused.
4. Open Tools and choose the configured capability. **Review connection check** prepares `mcp.inspect`; **Review MCP action** prepares `mcp.invoke`. Both use existing approvals, history and outcome tracking.

The UI never connects on catalog load. Each invocation includes owner target, tool, schema hash, configuration hash and arguments. Hashes bind destination/executable/arguments/credential-reference configuration and schema to the approved request, without exposing credential values. Pure validation runs before transport. After approval, live schema comparison must match the pinned declaration before `tools/call`; any drift requires a new reviewed request. JSON Schema validates arguments and declared structured outputs. Protocol annotations such as read-only/destructive hints never grant authority or lower risk.

All MCP connection/execute operations are conservatively high risk and **always require approval**, including under level 5. Existing user/workspace/product policies still apply to canonical `mcp.inspect` / `mcp.invoke` and action type `mcp_external`. Individual server/tool names are bound in exact approval inputs; separate per-remote-capability policy rows are not yet implemented. Requested targets are owner scoped, not globally registered dynamic permission definitions.

Inputs are capped at 32 KB, results at 64 KB, configuration at 256 KiB / 12 servers / 32 allowlisted tools each, observed catalog at 128 tools. Sessions close after use; whole-session deadline is 30 seconds, list 10 seconds, call 20 seconds. The SDK/transport receives cancellation. There is no new user-facing cancellation button or connection pool. Existing execution-key replay prevents successful duplicates. Remote failures may have completed an effect; they produce failed receipts and are not blindly reissued. Arbitrary MCP providers do not offer a distributed exactly-once guarantee or rollback, and Ary does not claim one.

## Tools experience

The existing Tools destination now presents a quiet text-led capability list and contextual inspector using the Nexus palette and shell. Source/availability filters, semantic reasons, schemas, authentication status, risk, effective permission, approval requirement, recent usage and health are visible. MCP proposals use the existing global approval dialog; other tools open the existing action form. Skills, all other screens, global navigation and graph interaction remain unchanged. Selection/focus transitions are restrained and disabled under reduced motion. The layout supports narrow desktop widths without a logo marketplace.

## Exact implementation files

Added:

- `src/domain/tool-capabilities.ts`
- `src/infrastructure/mcp/config.ts`
- `src/infrastructure/mcp/adapter.ts`
- `src/services/tool-discovery-service.ts`
- `src/components/tools/tools-view.tsx`
- `src/components/tools/tools.module.css`
- `config/mcp.example.json`
- `tests/tool-discovery.test.ts`
- `tests/helpers/mcp-server.mjs`
- `scripts/lib/tools-browser-check.ts`
- `docs/nexus-tools.md`

Extended:

- `src/domain/tool-registry.ts`: additive descriptors/output schema/pure validation hook.
- `src/domain/permissions.ts`: tools read/discovery and approval-only MCP definitions.
- `src/services/action-request-service.ts`: MCP uses real audited dispatch and required execution keys.
- `src/services/ary-brain-service.ts`, `src/domain/providers.ts`, `src/infrastructure/providers/openai.ts`: bounded advisory capabilities; existing models/providers preserved.
- `src/services/orchestrator-service.ts`: discover relevant declarations and bound/deduplicate planner inputs.
- `src/server/context.ts`, `src/server/http.ts`: owner-scoped adapter/service composition and two endpoints.
- `src/components/dashboard.tsx`: use the new Tools view at its existing destination.
- `scripts/evaluate-nexus-shell.ts`: focused Tools browser acceptance branch; other scenarios preserved.
- `package.json`, `package-lock.json`: pinned client/validator dependencies.
- `.env.example`, `README.md`, `ARY_NEXUS_ROADMAP.md`: opt-in configuration and acceptance documentation.

## Verification

September 9 acceptance: **1,185 tests across 71 files passed**, including **29 new capability/MCP/discovery cases**. Standalone TypeScript, configured formatting and production build passed. No separate lint command is configured. Normal and reduced-motion browser acceptance passed at 1440px and 900px, with real HTTP discovery, schema/policy inspection, truthful MCP state, filters and handoff to the existing action form. Screenshots: `/tmp/ary-tools-discovery.png` and `/tmp/ary-tools-compact.png`. Browser APIs were not mocked; no external server or real account was connected. The full suite and build used the existing healthy exact-lock mirror because prior iCloud dependency reads in the checkout can stall; final source files and the newly required dependency directories are synchronized back and byte-verified.

The initial Ajv 8.17.1 selection was replaced with patched 8.20.0 after the dependency audit. No existing dependency version was upgraded. The final production dependency audit reports zero vulnerabilities; existing development-only advisories are not auto-fixed.

Commands:

```sh
npm test -- --maxWorkers=1
npm run typecheck
npm run format:check
npm run build
ARY_TOOLS_ONLY=1 node --import tsx scripts/evaluate-nexus-shell.ts
ARY_TOOLS_ONLY=1 ARY_PRESENCE_REDUCED=1 node --import tsx scripts/evaluate-nexus-shell.ts
```

Transport tests include a real isolated stdio process and the official Streamable HTTP client against protocol response fixtures. These are not acceptance of an unconfigured external account. Browser tests run an actual temporary demo HTTP server with no production credentials, verify discovery/inspection/action navigation and remove all fixtures afterward. Hosted MCP, real external OAuth/server configuration and previously pending native/live gates remain intentionally untouched.
