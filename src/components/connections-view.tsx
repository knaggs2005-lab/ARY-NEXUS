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
  permission: { level: number; approvalRequired?: boolean };
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
  write: boolean;
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
function status(tools: Tool[]) {
  if (
    tools.some(
      (t) =>
        t.availability.state === "offline" || t.health.status === "degraded",
    )
  )
    return [
      "DEGRADED",
      "A recent provider attempt reported a connection problem.",
    ];
  if (tools.some((t) => /KYC|compliance/i.test(t.availability.reason ?? "")))
    return ["BLOCKED", "The external provider requires compliance approval."];
  if (
    tools.some(
      (t) =>
        t.availability.state === "connected" && t.health.status === "healthy",
    )
  )
    return [
      "CONNECTED",
      "A recent successful invocation was observed; this is not a continuous guarantee.",
    ];
  if (tools.some((t) => t.authentication.configured))
    return [
      "UNKNOWN",
      "Configuration exists, but current live connectivity is unverified.",
    ];
  return ["NOT_CONFIGURED", "No usable configuration is present."];
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
      const [s, reason] = status(ts);
      return {
        id: k,
        name,
        category,
        tools: ts,
        status: s,
        reason,
        configured: ts.some((t) => t.authentication.configured),
        read: ts.some((t) => t.permission.level > 0),
        write: ts.some((t) => t.permission.level >= 3),
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
              {f.read
                ? f.write
                  ? "READ / WRITE"
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
              <button
                onClick={() =>
                  onOpen(
                    f.category === "Google"
                      ? f.name.includes("Gmail")
                        ? "Communications"
                        : "Calendar"
                      : f.category,
                  )
                }
              >
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
