# Connections Control Center

Connections is a read-only presentation over the existing ToolDiscoveryService catalog and adapter evidence. It is not a new source of truth and does not perform provider tests automatically.

Statuses are conservative: `CONNECTED` requires recent successful evidence, `DEGRADED` reflects a recent network/provider failure, `NOT_CONFIGURED` means no usable configuration, `BLOCKED` means an external blocker such as compliance, and `UNKNOWN` means configuration exists without current live proof. Read-only capability is labeled explicitly.

The view aggregates registered tools into deterministic families while retaining the underlying tool names and reasons. Existing Calendar, Communications, Tools, Creative, Studio, Calls, Finance, and Systems screens remain authoritative for setup and execution. Secrets are never displayed.

Files added: `src/components/connections-view.tsx`, this documentation. Navigation was extended additively in `src/components/dashboard.tsx` and `src/components/nexus/destinations.ts`. Current external blockers include Twilio Trust Hub KYC and provider-dependent OAuth/local bridge availability.

The UI does not prove continuous connectivity, successful future execution, provider consent, or live hardware state. It reports only the evidence available from the existing catalog and action history.

## V1.1 correction pass

Capability labels now use registered tool mode and action semantics rather than permission level. Write is shown only when mutation evidence exists; otherwise it is marked unknown. Status precedence is deterministic: `BLOCKED`, `DEGRADED`, `CONNECTED`, `NEEDS_AUTH`, `NOT_LIVE`, `NOT_CONFIGURED`, then `UNKNOWN`. Family navigation uses an explicit mapping to existing Dashboard tabs. Details retain observed timestamps, evidence type, authentication state, and adapter reasons without exposing secrets.
