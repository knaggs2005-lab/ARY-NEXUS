"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import styles from "./tools/tools.module.css";
type Tool = {
  name: string;
  description: string;
  origin: string;
  availability: {
    state: string;
    reason?: string;
    checked_at?: string | null;
    evidence?: string;
  };
  authentication: { configured: boolean };
  health: { status: string; observed_at?: string | null; reason?: string };
  permission: { level: number; approvalRequired?: boolean; mode?: string };
};
type Family = {
  id: string;
  name: string;
  category: string;
  tools: Tool[];
  status: string;
  reason: string;
  configured: boolean;
  read: boolean;
  write: boolean | null;
  destination: string;
};
const labels: Record<string, [string, string]> = {
  openai: ["OpenAI", "AI"],
  embedding: ["Embeddings", "AI"],
  voice: ["Voice STT / TTS", "AI"],
  worker: ["Hermes", "AI"],
  supabase: ["Supabase", "Data"],
  google_calendar: ["Google Calendar", "Google"],
  gmail: ["Gmail", "Google"],
  phone: ["Calls / Twilio", "Communication"],
  desktop: ["Mac Desktop Bridge", "Computer"],
  browser: ["Browser control", "Computer"],
  mcp: ["MCP", "Computer"],
  premiere: ["Premiere", "Creative"],
  design: ["Cinema 4D / Design", "Creative"],
  perception: ["Perception", "Creative"],
  studio: ["Studio / devices", "Physical"],
  finance: ["Finance", "Finance"],
};
function familyFor(t: Tool) {
  const n = t.name;
  const key = n.startsWith("google_calendar")
    ? "google_calendar"
    : n.startsWith("openai")
      ? "openai"
      : n.split(".")[0];
  return labels[key] ? [key, ...labels[key]] : [key, key, "Tools"];
}
export function normalizeConnectionStatus(tools: Tool[]) {
  // Deterministic precedence: BLOCKED > DEGRADED > CONNECTED > NEEDS_AUTH > NOT_LIVE > NOT_CONFIGURED > UNKNOWN.
  if (
    tools.some((t) =>
      /KYC|compliance|blocked by/i.test(
        `${t.availability.reason ?? ""} ${t.health.reason ?? ""}`,
      ),
    )
  )
    return ["BLOCKED", "The external provider requires compliance approval."];
  if (
    tools.some(
      (t) =>
        t.availability.state === "offline" || t.health.status === "degraded",
    )
  )
    return ["DEGRADED", "A recent provider or network attempt failed."];
  if (
    tools.some(
      (t) =>
        t.availability.state === "connected" && t.health.status === "healthy",
    )
  )
    return [
      "CONNECTED",
      "Recent successful live evidence was observed; this is not a continuous guarantee.",
    ];
  if (
    tools.some(
      (t) => t.authentication.configured === false && t.origin === "oauth",
    )
  )
    return [
      "NEEDS_AUTH",
      "Provider configuration exists but user consent/authentication is missing or expired.",
    ];
  if (
    tools.some(
      (t) =>
        ["local_mac", "browser", "device"].includes(
          (t as Tool & { execution_location?: string }).execution_location ??
            "",
        ) && t.availability.state !== "connected",
    )
  )
    return [
      "NOT_LIVE",
      "The adapter is registered, but its local runtime is not active or verified.",
    ];
  if (
    tools.every(
      (t) =>
        !t.authentication.configured && t.availability.state === "unconfigured",
    )
  )
    return ["NOT_CONFIGURED", "Required provider configuration is missing."];
  return [
    "UNKNOWN",
    "Configuration exists, but available evidence cannot establish current connectivity.",
  ];
}
export const connectionDestinations: Record<string, string> = {
  openai: "Settings",
  embedding: "Settings",
  voice: "Chat",
  worker: "Tools",
  supabase: "Settings",
  google_calendar: "Calendar",
  gmail: "Communications",
  phone: "Calls",
  desktop: "Computer & Browser",
  browser: "Computer & Browser",
  mcp: "Tools",
  premiere: "Creative",
  design: "Creative",
  perception: "Perception",
  studio: "Studio",
  finance: "Finance",
};
export function capabilityAccess(tools: Tool[]) {
  const readable = tools.some(
    (t) =>
      t.permission.mode === "observe" ||
      /read|inspect|list|status|search|fetch|discover/i.test(t.name),
  );
  const mutating = tools.some(
    (t) =>
      t.permission.mode === "execute" ||
      t.permission.mode === "draft" ||
      /create|update|delete|send|write|launch|invoke|control|set|call|export|save/i.test(
        t.name,
      ),
  );
  return {
    read: readable,
    write: mutating ? true : tools.length ? null : false,
  };
}

export function ConnectionsView({
  onOpen,
}: {
  onOpen?: (tab: string) => void;
}) {
  const [tools, setTools] = useState<Tool[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("tools/catalog")
      .then((r) => r.json())
      .then(setTools)
      .catch((e) => setError(e.message));
  }, []);
  const families = useMemo(() => {
    const m = new Map<string, Tool[]>();
    for (const t of tools ?? []) {
      const [k] = familyFor(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return [...m].map(([k, ts]) => {
      const [, name, category] = familyFor(ts[0]);
      const [s, reason] = normalizeConnectionStatus(ts);
      const access = capabilityAccess(ts);
      return {
        id: k,
        name,
        category,
        tools: ts,
        status: s,
        reason,
        configured: ts.some((t) => t.authentication.configured),
        read: access.read,
        write: access.write,
        destination: connectionDestinations[k] ?? "Tools",
      };
    });
  }, [tools]);
  if (error) return <p role="alert">{error}</p>;
  if (!tools) return <p>Reading connection evidence…</p>;
  const counts = {
    connected: families.filter((f) => f.status === "CONNECTED").length,
    attention: families.filter((f) =>
      ["DEGRADED", "UNKNOWN"].includes(f.status),
    ).length,
    blocked: families.filter((f) => f.status === "BLOCKED").length,
    missing: families.filter((f) => f.status === "NOT_CONFIGURED").length,
  };
  return (
    <section aria-label="Connections control center">
      <div className={styles.filters}>
        <strong>{counts.connected} CONNECTED</strong>
        <strong>{counts.attention} NEEDS ATTENTION</strong>
        <strong>{counts.blocked} BLOCKED</strong>
        <strong>{counts.missing} NOT CONFIGURED</strong>
      </div>
      <div className={styles.workspace}>
        {families.map((f) => (
          <details key={f.id} open={f.status === "CONNECTED"}>
            <summary>
              <b>{f.name}</b> · {f.category} · <span>{f.status}</span>
            </summary>
            <p>{f.reason}</p>
            <small>
              {f.tools.some(
                (t) => t.availability.checked_at || t.health.observed_at,
              )
                ? `Observed ${f.tools.find((t) => t.availability.checked_at || t.health.observed_at)?.availability.checked_at ?? f.tools.find((t) => t.health.observed_at)?.health.observed_at}`
                : "Last checked: unknown"}{" "}
              ·{" "}
              {f.tools.some((t) => t.availability.evidence)
                ? `Evidence: ${f.tools.find((t) => t.availability.evidence)?.availability.evidence}`
                : "Evidence: unknown"}
              <br />
              {f.read
                ? f.write === true
                  ? "READ / WRITE"
                  : f.write === null
                    ? "READ / WRITE UNKNOWN"
                    : "READ ONLY"
                : "NO READ ACCESS"}{" "}
              · {f.tools.length} registered capabilities
            </small>
            <ul>
              {f.tools.slice(0, 8).map((t) => (
                <li key={t.name}>
                  {t.name}:{" "}
                  {t.availability.reason ??
                    t.health.reason ??
                    "No additional evidence"}
                </li>
              ))}
            </ul>
            {onOpen && (
              <button onClick={() => onOpen(f.destination)}>
                {f.status === "NOT_CONFIGURED"
                  ? "Open setup"
                  : "Open workspace"}
              </button>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}
