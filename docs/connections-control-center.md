# Connections Control Center

Connections is a read-only presentation over the existing ToolDiscoveryService catalog and adapter evidence. It is not a new source of truth and does not perform provider tests automatically.

Statuses are conservative: `CONNECTED` requires recent successful evidence, `DEGRADED` reflects a recent network/provider failure, `NOT_CONFIGURED` means no usable configuration, `BLOCKED` means an external blocker such as compliance, and `UNKNOWN` means configuration exists without current live proof. Read-only capability is labeled explicitly.

The view aggregates registered tools into deterministic families while retaining the underlying tool names and reasons. Existing Calendar, Communications, Tools, Creative, Studio, Calls, Finance, and Systems screens remain authoritative for setup and execution. Secrets are never displayed.

Files added: `src/components/connections-view.tsx`, this documentation. Navigation was extended additively in `src/components/dashboard.tsx` and `src/components/nexus/destinations.ts`. Current external blockers include Twilio Trust Hub KYC and provider-dependent OAuth/local bridge availability.

The UI does not prove continuous connectivity, successful future execution, provider consent, or live hardware state. It reports only the evidence available from the existing catalog and action history.
