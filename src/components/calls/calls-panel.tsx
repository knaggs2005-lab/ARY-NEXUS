"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ARY_CALL_DISCLOSURE,
  phoneNumber,
  type CallSnapshot,
} from "../../domain/phone";
import type { Action, Entity, Json } from "../../domain/models";
import { api } from "../api";
import { CallReview } from "./call-review";
import styles from "../permissions.module.css";
interface Receipt {
  call_action_id: string;
  provider: string;
  to: string;
  entity_ids: string[];
  contact_entity_id: string | null;
  snapshot: CallSnapshot;
  summary: string;
  observed_at: string;
}
export function CallsPanel({
  entities,
  onTaskCreated,
}: {
  entities: Entity[];
  onTaskCreated: () => Promise<unknown>;
}) {
  const [config, setConfig] = useState<{
      enabled: boolean;
      provider: string;
      supports_transcript: boolean;
      reason?: string;
    } | null>(null),
    [contact, setContact] = useState(""),
    [number, setNumber] = useState(""),
    [message, setMessage] = useState(""),
    [project, setProject] = useState(""),
    [intent, setIntent] = useState(false),
    [transcript, setTranscript] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState<Action[]>([]),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [followTitle, setFollowTitle] = useState("Follow up on the call");
  const attempt = useRef<{
    signature: string;
    operation: string;
    key: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    const [settings, rows] = await Promise.all([
      api("calls/config").then((r) => r.json()),
      api(`actions/history?category=phone&offset=${offset}`).then((r) =>
        r.json(),
      ),
    ]);
    setConfig(settings);
    setHistory(rows.items);
    setTotal(rows.total);
  }, [offset]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  const to = contact
    ? String(entities.find((e) => e.id === contact)?.metadata.phone ?? "")
    : number.trim();
  const preview = {
    operation_id:
      attempt.current?.operation ?? "00000000-0000-4000-8000-000000000001",
    to,
    contact_entity_id: contact || null,
    entity_ids: project ? [project] : [],
    script: `${ARY_CALL_DISCLOSURE}\n\n${message.trim()}`,
    user_intent: true,
    capture_transcript: transcript,
    recording_consent_confirmed: consent,
  };
  async function perform(
    tool: string,
    input: Json,
    requestKey = crypto.randomUUID(),
    source?: Action,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await (
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify({
            tool,
            input,
            request_key: requestKey,
            reason:
              tool === "phone.initiate"
                ? "I explicitly requested this exact call and script."
                : tool === "phone.cancel"
                  ? "I requested this call to stop."
                  : "User requested call review or follow-up.",
            ...(source
              ? {
                  source_action_id: source.id,
                  related_entity_ids: source.metadata.related_entity_ids ?? [],
                }
              : {}),
            ...(project ? { product_entity_id: project } : {}),
          }),
        })
      ).json();
      setNotice(
        tool === "create_task"
          ? `Created task ${result.result.task_id}.`
          : `${tool} recorded. See call history for the provider result.`,
      );
      if (tool === "create_task") await onTaskCreated();
      if (tool === "phone.initiate" || tool === "phone.reconcile") attempt.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void refresh().catch((e) => setError(e.message));
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!intent || !message.trim()) return;
    const signature = JSON.stringify([
      to,
      contact,
      project,
      message,
      transcript,
      consent,
    ]);
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        operation: crypto.randomUUID(),
        key: crypto.randomUUID(),
      };
    await perform(
      "phone.initiate",
      { ...preview, operation_id: attempt.current.operation },
      attempt.current.key,
    );
  }
  return (
    <section className={styles.panel} aria-label="Ary Calls">
      <div className={styles.heading}>
        <h2>Ary Calls</h2>
        <button
          disabled={busy}
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          Refresh call history
        </button>
      </div>
      <p>
        {config?.enabled
          ? `${config.provider} configured`
          : `Live calls disabled or unconfigured${config?.reason ? ` · ${config.reason}` : ""}`}{" "}
        · Exact script delivery · no live conversational agent
      </p>
      <p>
        US mobile/landline numbers only, verified by the provider and explicitly
        allowlisted by the operator. One attempt per destination per 24 hours;
        3/hour and 10/day. Every call requires approval.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className={styles.card} onSubmit={submit}>
        <h3>Prepare a call</h3>
        <label>
          Saved contact
          <select
            value={contact}
            disabled={busy}
            onChange={(e) => {
              setContact(e.target.value);
              setIntent(false);
            }}
          >
            <option value="">Use an explicit number</option>
            {entities
              .filter(
                (e) =>
                  ["person", "company"].includes(e.entity_type) &&
                  typeof e.metadata.phone === "string",
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {String(e.metadata.phone)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Phone number (E.164)
          <input
            value={to}
            disabled={!!contact || busy}
            onChange={(e) => {
              setNumber(e.target.value);
              setIntent(false);
            }}
            placeholder="+1…"
            required
          />
        </label>
        <label>
          Related project / company
          <select
            disabled={busy}
            id="call-related-project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          >
            <option value="">None</option>
            {entities
              .filter((e) =>
                ["project", "company", "product"].includes(e.entity_type),
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>
        <p>{ARY_CALL_DISCLOSURE}</p>
        <label>
          Approved message
          <textarea
            required
            maxLength={1800}
            value={message}
            disabled={busy}
            onChange={(e) => {
              setMessage(e.target.value);
              setIntent(false);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={transcript}
            disabled={!config?.supports_transcript || busy}
            onChange={(e) => setTranscript(e.target.checked)}
          />
          Capture transcript when supported
        </label>
        {transcript && (
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I confirm the required recording/transcription consent.
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={intent}
            onChange={(e) => setIntent(e.target.checked)}
            disabled={busy}
          />
          I explicitly want Ary to call this destination with this script.
        </label>
        <CallReview input={preview} />
        <button
          className="primary"
          disabled={
            busy ||
            !config?.enabled ||
            !intent ||
            !phoneNumber.safeParse(to).success ||
            !message.trim()
          }
        >
          {busy ? "Request in progress…" : "Review and request call"}
        </button>
      </form>
      <div className={styles.card}>
        <h3>Follow-up task</h3>
        <label>
          Follow-up title
          <input
            value={followTitle}
            onChange={(e) => setFollowTitle(e.target.value)}
            maxLength={2000}
          />
        </label>
        <p>
          Select a project above, then propose a follow-up from a recorded call
          below. Task creation uses its own existing permission and approval
          policy.
        </p>
      </div>
      <h3>Call activity · {total}</h3>
      {history.map((action) => {
        const r = action.output.result as unknown as Receipt | undefined;
        return (
          <article className={styles.card} key={action.id}>
            <strong>
              {action.tool_name} · {action.status}
            </strong>
            <p>{new Date(action.created_at).toLocaleString()}</p>
            {action.error && <p>{action.error}</p>}
            {action.tool_name === "phone.initiate" && action.status === "failed" && (action.error?.includes("HTTP 400") || action.error?.includes("No call placed") || action.error?.includes("active or uncertain")) && (
              <button disabled={busy || !config?.enabled} onClick={() => void perform("phone.reconcile", { call_action_id: action.id })}>
                Review rejected call recovery
              </button>
            )}
            {r?.snapshot && (
              <>
                <p>
                  {r.to} · {r.provider} · {r.snapshot.status}
                </p>
                <p>{r.summary}</p>
                <p>
                  Duration: {r.snapshot.duration_seconds ?? "unknown"} seconds ·
                  Provider cost:{" "}
                  {r.snapshot.cost
                    ? `${r.snapshot.cost.amount} ${r.snapshot.cost.currency} (provider reported)`
                    : "unknown"}
                </p>
                <p>
                  Observed {r.observed_at}. Project/entities:{" "}
                  {r.entity_ids
                    .map((id) => entities.find((e) => e.id === id)?.name ?? id)
                    .join(", ") || "None"}
                </p>
                {r.snapshot.transcript && (
                  <details>
                    <summary>
                      Provider transcript · {r.snapshot.transcript.source_id}
                    </summary>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {r.snapshot.transcript.text}
                    </p>
                  </details>
                )}
                <button
                  disabled={busy || !config?.enabled}
                  onClick={() =>
                    void perform("phone.refresh", {
                      call_action_id: r.call_action_id,
                    })
                  }
                >
                  Refresh provider status
                </button>
                <button
                  disabled={busy || !config?.enabled}
                  onClick={() =>
                    void perform("phone.cancel", {
                      call_action_id: r.call_action_id,
                      user_intent: true,
                    })
                  }
                >
                  Stop this call
                </button>
                <button
                  disabled={busy || !project || !followTitle.trim()}
                  onClick={() =>
                    void perform(
                      "create_task",
                      {
                        title: followTitle,
                        project_id: project,
                        description: `Follow-up requested after call ${r.call_action_id}. Recorded summary: ${r.summary}`,
                      },
                      `call-followup-${action.id}-${project}-${followTitle}`.slice(
                        0,
                        128,
                      ),
                      action,
                    )
                  }
                >
                  Propose follow-up task
                </button>
              </>
            )}
            <details>
              <summary>Audit evidence · {action.id}</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(action, null, 2)}
              </pre>
            </details>
          </article>
        );
      })}
      <div className={styles.row}>
        <button
          disabled={offset === 0 || busy}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous calls
        </button>
        <button
          disabled={offset + 50 >= total || busy}
          onClick={() => setOffset(offset + 50)}
        >
          Next calls
        </button>
      </div>
    </section>
  );
}
