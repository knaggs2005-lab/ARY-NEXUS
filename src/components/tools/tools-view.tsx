"use client";
import { useEffect, useState } from "react";
import { api } from "../api";
import { NexusState } from "../nexus/primitives";
import type { ToolDiscoveryService } from "../../services/tool-discovery-service";
import { capabilityOrigins } from "../../domain/tool-capabilities";
import styles from "./tools.module.css";
type Catalog = Awaited<ReturnType<ToolDiscoveryService["catalog"]>>;
type Discovery = Awaited<ReturnType<ToolDiscoveryService["search"]>>;
export function ToolsView({ onSelect }: { onSelect: (name: string) => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [query, setQuery] = useState(""),
    [origin, setOrigin] = useState(""),
    [state, setState] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [result, setResult] = useState<Discovery | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [argumentsText, setArgumentsText] = useState("{}"),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void api("tools/catalog", { signal: c.signal })
      .then((r) => r.json())
      .then((r) => {
        if (!c.signal.aborted) setCatalog(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [revision]);
  const search = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api("tools/discover", {
        method: "POST",
        body: JSON.stringify({ query, limit: 10 }),
      });
      setResult(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const request = async (check = false) => {
    if (!tool) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = check
        ? {
            server: tool.request_defaults.server,
            configuration_hash: tool.request_defaults.configuration_hash,
          }
        : { ...tool.request_defaults, arguments: JSON.parse(argumentsText) };
      const response = await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool: check ? "mcp.inspect" : "mcp.invoke",
          input,
          request_key: crypto.randomUUID(),
          reason: check
            ? "Inspect the configured MCP connection and pinned tool schemas"
            : "Run the selected MCP capability with the reviewed inputs",
        }),
      });
      const receipt = await response.json();
      setNotice(
        `Recorded ${receipt.tool} · action ${receipt.action_id}. Inspect Action History for the result.`,
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rows = (
    result
      ? result.matches.map((m) => m.tool)
      : (catalog ?? []).toSorted(
          (a, b) =>
            Number(a.simulated) - Number(b.simulated) ||
            a.id.localeCompare(b.id),
        )
  ).filter(
    (t) =>
      (!origin || t.origin === origin) &&
      (!state || t.availability.state === state),
  );
  const tool =
    (catalog ?? []).find((t) => t.id === selected) ??
    result?.matches.find((m) => m.tool.id === selected)?.tool;
  const match = result?.matches.find((m) => m.tool.id === selected);
  return (
    <section className={styles.tools} aria-label="Nexus Tools intelligence">
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="Find tools by meaning"
          placeholder="What are you trying to accomplish?"
          maxLength={500}
          required
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button disabled={busy || !query.trim()}>
          {busy ? "Finding relevant capabilities…" : "Discover"}
        </button>
        {result && (
          <button type="button" onClick={() => setResult(null)}>
            All capabilities
          </button>
        )}
      </form>
      <div className={styles.filters}>
        <select
          aria-label="Tool source"
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
        >
          <option value="">Every source</option>
          {capabilityOrigins.map((o) => (
            <option key={o} value={o}>
              {o.replaceAll("_", " ")} ·{" "}
              {(catalog ?? []).filter((t) => t.origin === o).length}
            </option>
          ))}
        </select>
        <select
          aria-label="Tool availability"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="">Every state</option>
          {["connected", "available", "offline", "unconfigured", "unknown"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
        <button onClick={() => setRevision((v) => v + 1)}>
          Refresh evidence
        </button>
        <small>
          {rows.length} capabilities · connections are observed, never assumed
        </small>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {result && (
        <p className={styles.note}>
          {result.ranking}{" "}
          {result.model ? `Embeddings: ${result.model}` : "Lexical fallback"}.{" "}
          {result.warnings.join(" · ")}
        </p>
      )}
      {!catalog && !error ? (
        <NexusState title="Reading tool capabilities…" />
      ) : (
        <div className={styles.workspace}>
          <nav aria-label="Capability results" className={styles.list}>
            {rows.map((t) => (
              <button
                key={t.id}
                aria-pressed={selected === t.id}
                onClick={() => {
                  setSelected(t.id);
                  setArgumentsText("{}");
                  setNotice("");
                }}
              >
                <i data-state={t.availability.state} />
                <div>
                  <strong>
                    {t.id.startsWith("mcp:")
                      ? t.id.split(":").slice(1).join(" / ")
                      : t.name}
                  </strong>
                  <p>{t.description}</p>
                  <small>
                    {t.origin.replaceAll("_", " ")} ·{" "}
                    {t.execution_location.replaceAll("_", " ")} ·{" "}
                    {t.availability.state}
                  </small>
                </div>
                <span>
                  Level {t.permission.level}
                  <small>{t.risk_level} risk</small>
                </span>
              </button>
            ))}
            {!rows.length && (
              <NexusState title="No matching capabilities">
                Try another goal or clear a filter. Unconnected integrations are
                not invented.
              </NexusState>
            )}
          </nav>
          <aside aria-label="Capability inspector">
            {tool ? (
              <>
                <span className={styles.eyebrow}>
                  CAPABILITY / {tool.origin.toUpperCase()}
                </span>
                <h2>{tool.id}</h2>
                <p>{tool.description}</p>
                <div className={styles.state}>
                  <i data-state={tool.availability.state} />
                  {tool.availability.state} · health {tool.health.status}
                </div>
                <p>{tool.availability.reason}</p>
                <dl>
                  <dt>Execution</dt>
                  <dd>{tool.execution_location.replaceAll("_", " ")}</dd>
                  <dt>Authentication</dt>
                  <dd>
                    {tool.authentication.method} ·{" "}
                    {tool.authentication.configured === null
                      ? "not inspected"
                      : tool.authentication.configured
                        ? "configured"
                        : "not configured"}
                    <small>{tool.authentication.note}</small>
                  </dd>
                  <dt>Authority</dt>
                  <dd>
                    Level {tool.permission.level} ·{" "}
                    {tool.permission_requirements.mode}
                    <small>{tool.permission.reason}</small>
                  </dd>
                  <dt>Approval</dt>
                  <dd>
                    {tool.always_requires_approval
                      ? "Always required"
                      : tool.permission.approvalRequired
                        ? "Required by policy"
                        : "Existing policy applies"}
                  </dd>
                  <dt>Risk</dt>
                  <dd>{tool.risk_level}</dd>
                  <dt>Recent use</dt>
                  <dd>
                    {tool.recent_use
                      ? `${new Date(tool.recent_use.at).toLocaleString()} · ${tool.recent_use.status} · ${tool.recent_use.latency_ms} ms`
                      : "No visible recorded attempt"}
                    <small>{tool.health.reason}</small>
                  </dd>
                </dl>
                {match && (
                  <p className={styles.note}>
                    Why matched: {match.reasons.join(" + ")} · semantic{" "}
                    {match.semantic?.toFixed(3) ?? "unavailable"} · lexical{" "}
                    {match.lexical.toFixed(3)} · RRF {match.score.toFixed(4)}
                  </p>
                )}
                <details>
                  <summary>Input / output schemas</summary>
                  <pre>
                    {JSON.stringify(
                      { input: tool.input_schema, output: tool.output_schema },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                {tool.id.startsWith("mcp:") ? (
                  <div className={styles.proposal}>
                    <label>
                      MCP arguments
                      <textarea
                        aria-label="MCP arguments"
                        value={argumentsText}
                        onChange={(e) => setArgumentsText(e.target.value)}
                        spellCheck={false}
                      />
                    </label>
                    <p>
                      Server, tool and schema fingerprint are pinned. Approval
                      will show the exact request.
                    </p>
                    <button
                      disabled={busy || tool.permission.level === 0}
                      onClick={() => void request()}
                    >
                      Review MCP action
                    </button>
                    <button disabled={busy} onClick={() => void request(true)}>
                      Review connection check
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={tool.permission.level === 0}
                    onClick={() => onSelect(tool.name)}
                  >
                    Review action
                  </button>
                )}
              </>
            ) : (
              <>
                <span className={styles.eyebrow}>
                  CAPABILITIES, WITH BOUNDARIES
                </span>
                <h2>Choose the means.</h2>
                <p>
                  Find the capability that fits the task. Inspect its inputs,
                  health, and authority before requesting an action.
                </p>
                <p className={styles.note}>
                  MCP, API and local adapters share the same action pipeline.
                  Browsing this view does not contact endpoints or launch
                  programs.
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
