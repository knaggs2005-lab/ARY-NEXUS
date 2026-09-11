"use client";
import {
  permissionClasses,
  permissionBehaviors,
  emergencyScope,
} from "../domain/permission-classes";
import { PermissionBrief } from "./permission-brief";
import { EmergencyControl } from "./emergency-control";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import { HermesDiagnostics } from "./hermes-diagnostics";
import { DesktopPanel } from "./desktop-panel";
import { MockActionsPanel } from "./mock-actions-panel";
import {
  permissionLevels,
  type PermissionPolicy,
  type ToolDefinition,
  type ActionApproval,
} from "../domain/permissions";
import type { Action, Entity } from "../domain/models";
import styles from "./permissions.module.css";
interface Settings {
  development?: boolean;
  agents: { id: string; name: string }[];
  tools: Record<string, ToolDefinition>;
  user_id: string;
  workspace: string;
  products: Entity[];
  policies: PermissionPolicy[];
  history: PermissionPolicy[];
  attempts: Action[];
  approvals: ActionApproval[];
}
const descriptions = [
  "No tool access.",
  "Read and inspect only.",
  "Observe and make recommendations.",
  "Prepare drafts without executing changes.",
  "Execution needs explicit, one-use approval.",
  "Execute within the matched scope without asking.",
];
export function PermissionsPanel() {
  const [data, setData] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<PermissionPolicy | null>(null),
    [notice, setNotice] = useState("");
  const [tool, setTool] = useState(""),
    [type, setType] = useState(""),
    [product, setProduct] = useState(""),
    [workspace, setWorkspace] = useState("ary-nexus"),
    [subject, setSubject] = useState(""),
    [level, setLevel] = useState(4),
    [permissionClass, setPermissionClass] = useState(""),
    [agent, setAgent] = useState(""),
    [behavior, setBehavior] = useState("");
  async function refresh() {
    setData(await (await api("permissions")).json());
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  function edit(policy: PermissionPolicy | null) {
    setEditing(policy);
    setPermissionClass(policy?.permission_class ?? "");
    setAgent(policy?.subject_agent_id ?? "");
    setBehavior(policy?.behavior ?? "");
    setTool(policy?.tool ?? "");
    setType(policy?.action_type ?? "");
    setProduct(policy?.product_entity_id ?? "");
    setWorkspace(policy?.workspace ?? "");
    setSubject(policy?.subject_user_id ?? "");
    setLevel(policy?.level ?? 4);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await api("permissions/policies", {
        method: "POST",
        body: JSON.stringify({
          ...(permissionClass ? { permission_class: permissionClass } : {}),
          ...(agent ? { subject_agent_id: agent } : {}),
          ...(behavior || editing?.behavior
            ? { behavior: behavior || null }
            : {}),
          tool: tool || null,
          action_type: type || null,
          workspace: workspace || null,
          product_entity_id: product || null,
          subject_user_id: subject || null,
          level,
          enabled: true,
          parent_id: editing?.id ?? null,
          reason: String(new FormData(form).get("reason")),
        }),
      });
      await refresh();
      edit(null);
      form.reset();
      setNotice("Policy saved. Future actions will use the updated rules.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable(policy: PermissionPolicy) {
    setBusy(true);
    setError("");
    try {
      const { id, scope_key, user_id, created_at, updated_at, ...input } =
        policy;
      void scope_key;
      void user_id;
      void created_at;
      void updated_at;
      await api("permissions/policies", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          parent_id: id,
          enabled: false,
          reason: "Owner disabled this policy in Settings.",
        }),
      });
      await refresh();
      setNotice("Policy disabled; its history is retained.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(action: Action, decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await api(`permissions/attempts/${action.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          reason: `Owner ${decision} the exact request in Settings.`,
        }),
      });
      await refresh();
      setNotice(
        decision === "approved"
          ? "Approved once for 10 minutes. Retry the same action from its original screen; approval does not execute it here."
          : "Rejected. Nothing was executed.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="Permissions settings">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>SETTINGS / PERMISSIONS</span>
          <h2>A clear boundary for every action.</h2>
          <p>
            Unknown tools have no access. Matching rules combine using the
            lowest permission level.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          Refresh
        </button>
      </div>
      <EmergencyControl />
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.levels}>
        {permissionLevels.map((name, i) => (
          <div key={name}>
            <b>{i}</b>
            <strong>{name.replaceAll("_", " ")}</strong>
            <small>{descriptions[i]}</small>
          </div>
        ))}
      </div>
      {!data ? (
        <p>Loading permission policies…</p>
      ) : (
        <>
          <DesktopPanel />
          {data.development && <HermesDiagnostics />}
          {data.development && (
            <details>
              <summary>Development action tests</summary>
              <MockActionsPanel products={data.products} onComplete={refresh} />
            </details>
          )}
          <div className={styles.columns}>
            <form className={styles.card} onSubmit={save}>
              <h3>{editing ? "Revise policy" : "Add a policy"}</h3>
              <p>
                Scope fields combine. Any field left as “All” matches every
                action in your account.
              </p>
              <label>
                Permission class
                <select
                  aria-label="Permission class"
                  value={permissionClass}
                  disabled={!!editing}
                  onChange={(e) => setPermissionClass(e.target.value)}
                >
                  <option value="">All classes</option>
                  {permissionClasses.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Requesting agent
                <select
                  value={agent}
                  disabled={!!editing}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="">All requesters</option>
                  {data.agents?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Decision behavior
                <select
                  aria-label="Decision behavior"
                  value={behavior}
                  onChange={(e) => setBehavior(e.target.value)}
                >
                  <option value="">Existing numeric level</option>
                  {permissionBehaviors.map((b) => (
                    <option key={b} value={b}>
                      {b.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Allow this time is granted in the exact-request approval dialog.
                Always allow cannot override a deny, an agent ceiling or a
                capability's mandatory approval.
              </p>
              <label>
                Tool
                <select
                  value={tool}
                  disabled={!!editing}
                  onChange={(e) => setTool(e.target.value)}
                >
                  <option value="">All registered tools</option>
                  {Object.keys(data.tools).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Action type
                <select
                  value={type}
                  disabled={!!editing}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="">All action types</option>
                  {[
                    ...new Set(
                      Object.values(data.tools).map((t) => t.actionType),
                    ),
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Workspace
                <select
                  value={workspace}
                  disabled={!!editing}
                  onChange={(e) => setWorkspace(e.target.value)}
                >
                  <option value="">All in my account</option>
                  <option value="ary-nexus">Ary Nexus</option>
                </select>
              </label>
              <label>
                Product / project / company
                <select
                  value={product}
                  disabled={!!editing}
                  onChange={(e) => setProduct(e.target.value)}
                >
                  <option value="">All products</option>
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                User
                <select
                  value={subject}
                  disabled={!!editing}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  <option value="">All actions in my account</option>
                  <option value={data.user_id}>
                    Me · {data.user_id.slice(0, 8)}
                  </option>
                </select>
              </label>
              <label>
                Permission level
                <select
                  value={level}
                  disabled={!!behavior}
                  onChange={(e) => setLevel(Number(e.target.value))}
                >
                  {permissionLevels.map((n, i) => (
                    <option key={n} value={i}>
                      {i} · {n.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reason
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  placeholder="Why should Ary have this level of access?"
                />
              </label>
              <div className={styles.row}>
                <button className="primary" disabled={busy}>
                  Save policy
                </button>
                {editing && (
                  <button type="button" onClick={() => edit(null)}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
            <div className={styles.card}>
              <h3>Current policies</h3>
              {!data.policies.length && (
                <p>
                  No custom policies. Registered internal actions retain their
                  documented defaults; unknown tools are always blocked.
                </p>
              )}
              {data.policies
                .filter((p) => p.scope_key !== emergencyScope)
                .map((p) => (
                  <article className={styles.policy} key={p.id}>
                    <div>
                      <strong>{p.tool ?? "All tools"}</strong>
                      <span className={styles.badge}>
                        {p.enabled
                          ? `${p.level} · ${permissionLevels[p.level]}`
                          : "Disabled"}
                      </span>
                    </div>
                    <p>
                      {p.action_type ?? "All actions"} ·{" "}
                      {p.workspace ?? "All workspaces"} ·{" "}
                      {data.products.find((e) => e.id === p.product_entity_id)
                        ?.name ?? "All products"}{" "}
                      · {p.subject_user_id ? "Me" : "Account"}
                    </p>
                    <p>
                      {p.permission_class ?? "All classes"} ·{" "}
                      {p.behavior?.replaceAll("_", " ") ?? "Numeric level"} ·{" "}
                      {data.agents?.find((a) => a.id === p.subject_agent_id)
                        ?.name ??
                        p.subject_agent_id ??
                        "All requesters"}
                    </p>
                    <p>{p.reason}</p>
                    <div className={styles.row}>
                      <button disabled={busy} onClick={() => edit(p)}>
                        Revise
                      </button>
                      {p.enabled && (
                        <button disabled={busy} onClick={() => void disable(p)}>
                          Disable
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              <details>
                <summary>Registered capability defaults</summary>
                {Object.entries(data.tools).map(([name, t]) => (
                  <p key={name}>
                    <strong>{name}</strong> · {t.mode} · default{" "}
                    {t.defaultLevel}
                    <br />
                    {t.description}
                    {t.alwaysRequiresApproval &&
                      " · Always requires approval; no autonomous execution."}
                  </p>
                ))}
              </details>
              <p className={styles.note}>
                Account-owner policy management remains available for recovery.
                Gmail sending always requires explicit approval. No
                money-movement or trading executor is registered.
              </p>
            </div>
          </div>
          <div className={styles.card}>
            <h3>Action attempts</h3>
            <p>
              Latest 100 attempts. Each retains its request, resolved
              permission, approval requirement, result and timestamp.
            </p>
            {data.attempts.map((a) => {
              const approval = data.approvals.find((r) => r.action_id === a.id);
              const executed = data.attempts.find(
                (r) => r.metadata.approval_id === approval?.id && !!approval,
              );
              const result =
                approval?.decision === "rejected"
                  ? "rejected"
                  : approval?.decision === "approved"
                    ? executed
                      ? `approved → ${executed.status}`
                      : Date.parse(approval.expires_at) < Date.now()
                        ? "approval expired"
                        : "approved; awaiting retry"
                    : a.status.replaceAll("_", " ");
              return (
                <details className={styles.attempt} key={a.id}>
                  <summary>
                    <strong>{a.tool_name}</strong>
                    <span>{result}</span>
                    <span>Level {a.permission_level}</span>
                    <time>{new Date(a.created_at).toLocaleString()}</time>
                  </summary>
                  <p>
                    {String(a.metadata.permission_reason ?? "Legacy action")}
                  </p>
                  <p>
                    Approval required: {a.approval_required ? "Yes" : "No"} ·
                    Result: {result} {a.error}
                  </p>
                  <PermissionBrief action={a} />
                  <pre>{JSON.stringify(a.input, null, 2)}</pre>
                  {Object.keys(a.output).length > 0 && (
                    <details>
                      <summary>Recorded result</summary>
                      <pre>{JSON.stringify(a.output, null, 2)}</pre>
                    </details>
                  )}
                  {approval && (
                    <p>
                      Review: {approval.decision} · {approval.reason} ·{" "}
                      {approval.consumed_at
                        ? "Used"
                        : Date.parse(approval.expires_at) < Date.now()
                          ? "Expired"
                          : "Not used"}
                    </p>
                  )}
                  {a.status === "approval_required" && !approval && (
                    <div className={styles.row}>
                      <button
                        disabled={busy}
                        onClick={() => void review(a, "rejected")}
                      >
                        Reject
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void review(a, "approved")}
                      >
                        Approve this request once
                      </button>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
          <details className={styles.card}>
            <summary>Policy history · {data.history.length} revisions</summary>
            {data.history.toReversed().map((p) => (
              <p key={p.id}>
                <time>{new Date(p.created_at).toLocaleString()}</time> ·{" "}
                {p.tool ?? "All tools"} · level {p.level} ·{" "}
                {p.enabled ? "Enabled" : "Disabled"}
                <br />
                {p.reason}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
