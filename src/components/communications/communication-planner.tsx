"use client";
import { useRef, useState } from "react";
import type { Json } from "../../domain/models";
import type { PreparedCommunicationRequest } from "../../domain/communication-plan";
import { api } from "../api";
import styles from "../gmail/gmail.module.css";

export function CommunicationPlanner({ onHistory }: { onHistory: () => void }) {
  const [channel, setChannel] = useState("phone");
  const [receipt, setReceipt] = useState<{
    action_id: string;
    result: Json;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  async function request(
    tool: string,
    input: Json,
    key: string,
    source?: string,
  ) {
    const response = await api("actions/request", {
      method: "POST",
      body: JSON.stringify({
        tool,
        input,
        request_key: key,
        reason:
          "User reviewed this communication objective or evidence proposal",
        ...(source ? { source_action_id: source } : {}),
      }),
    });
    return response.json();
  }
  async function prepare(form: HTMLFormElement, debrief = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setReceipt(null);
    const data = new FormData(form);
    try {
      const project_id = String(data.get("project_id") || "") || null;
      const input: Json = debrief
        ? { source_action_id: String(data.get("source_action_id")), project_id }
        : {
            channel,
            contact: String(data.get("contact")),
            objective: String(data.get("objective")),
            message: String(data.get("message")),
            project_id,
            mode: data.get("conversation") ? "conversation" : "script",
            ...(channel === "email" && data.get("thread_id")
              ? {
                  email_thread: {
                    connection_id: String(data.get("connection_id")),
                    thread_id: String(data.get("thread_id")),
                  },
                }
              : {}),
          };
      setReceipt(
        await request(
          debrief ? "communications.debrief" : "communications.plan",
          input,
          crypto.randomUUID(),
        ),
      );
      setNotice("Proposal recorded. Nothing was sent or saved to memory.");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not prepare communication",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function submit(proposal: PreparedCommunicationRequest, index: number) {
    if (!receipt || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await request(
        proposal.tool,
        proposal.input,
        `communication:${receipt.action_id}:${index}`,
        receipt.action_id,
      );
      setNotice(
        `Recorded ${proposal.tool} result · ${JSON.stringify(result.result)}. Inspect Action History for the full receipt.`,
      );
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Action did not complete; inspect history before retrying",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const result = receipt?.result;
  const proposals = (result?.requests ??
    []) as unknown as PreparedCommunicationRequest[];
  return (
    <details className={styles.candidate} aria-label="Communication planning">
      <summary>Plan a communication · review what happened</summary>
      <p>
        Prepare → review → existing tool → evidence → reviewed follow-up.
        Delivery always requires its own permission decision.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void prepare(e.currentTarget);
        }}
      >
        <fieldset disabled={busy}>
          <legend>Communication objective</legend>
          <div className={styles.toolbar}>
            <label>
              Channel
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value);
                  setReceipt(null);
                }}
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="messaging">Messaging · not connected</option>
              </select>
            </label>
            <label>
              Contact name, alias or ID
              <input
                name="contact"
                required
                maxLength={200}
                placeholder="Choose a known person or company"
              />
            </label>
            <label>
              Project ID · optional
              <input name="project_id" />
            </label>
          </div>
          <label>
            Objective
            <textarea
              name="objective"
              required
              maxLength={2000}
              placeholder="Find out whether Thursday works"
            />
          </label>
          <label>
            Proposed message
            <textarea
              name="message"
              required
              maxLength={1500}
              placeholder="Would Thursday work? Please reply to the account owner."
            />
          </label>
          {channel === "phone" && (
            <label>
              <span>
                <input type="checkbox" name="conversation" /> Requires a two-way
                conversation
              </span>
            </label>
          )}
          {channel === "email" && (
            <div className={styles.toolbar}>
              <label>
                Gmail connection ID
                <input name="connection_id" />
              </label>
              <label>
                Previously read thread ID
                <input name="thread_id" />
              </label>
            </div>
          )}
          <button type="submit">Prepare communication plan</button>
        </fieldset>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void prepare(e.currentTarget, true);
        }}
      >
        <fieldset disabled={busy}>
          <legend>Review captured evidence</legend>
          <div className={styles.toolbar}>
            <label>
              Call/email source action ID
              <input name="source_action_id" required />
            </label>
            <label>
              Follow-up project ID · optional
              <input name="project_id" />
            </label>
            <button type="submit">Prepare communication debrief</button>
          </div>
        </fieldset>
      </form>
      <p role="status" style={{ overflowWrap: "anywhere" }}>
        {busy ? "Ary is preparing the reviewed action…" : notice}
      </p>
      {result && (
        <section aria-label="Communication proposal">
          <h3>{String(result.objective ?? result.summary)}</h3>
          {Boolean(result.contact) && (
            <p>
              Contact: {String((result.contact as Json).name)} ·{" "}
              {String(result.state)}
            </p>
          )}
          {((result.limitations as string[]) ?? []).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {proposals.map((proposal, index) => (
            <article className={styles.candidate} key={index}>
              <strong>{proposal.label}</strong>
              <small> · {proposal.tool}</small>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 260,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(proposal.input, null, 2)}
              </pre>
              <button
                disabled={busy}
                onClick={() => void submit(proposal, index)}
              >
                {proposal.label}
              </button>
            </article>
          ))}
          <button onClick={onHistory}>
            Inspect communication action history
          </button>
        </section>
      )}
    </details>
  );
}
