"use client";
import { useEffect, useState } from "react";
import { api } from "../api";
import { EmergencyControl } from "../emergency-control";
import { useNexusEvents } from "../events/event-store";
import {
  controlKeys,
  type ControlSnapshot,
} from "../../domain/digital-control";
import styles from "./control.module.css";
export function ControlPanel() {
  const [surface, setSurface] = useState<"browser" | "computer">("browser"),
    [destination, setDestination] = useState(""),
    [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null),
    [selected, setSelected] = useState(""),
    [verb, setVerb] = useState("click"),
    [value, setValue] = useState(""),
    [key, setKey] = useState<string>("Enter"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [question, setQuestion] = useState(""),
    [proposal, setProposal] = useState<{
      proposal_id: string;
      point: { x: number; y: number; reason: string; confidence: number };
    } | null>(null),
    [files, setFiles] = useState<{ id: string; bytes: number }[]>([]);
  const events = useNexusEvents();
  const rows = events.events
    .filter(
      (e) =>
        /^(browser|computer)\./.test(e.type) && e.source.kind === "backend",
    )
    .slice(-12)
    .reverse();
  const element = snapshot?.elements.find((e) => e.id === selected);
  useEffect(() => {
    const stop = () => {
      setSnapshot(null);
      setProposal(null);
      setNotice(
        "Control stopped. Inspect again after explicitly clearing the stop.",
      );
    };
    window.addEventListener("ary:emergency-stop", stop);
    return () => window.removeEventListener("ary:emergency-stop", stop);
  }, []);
  async function request(
    tool: string,
    input: Record<string, unknown>,
    reason: string,
  ) {
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
            reason,
            request_key: crypto.randomUUID(),
          }),
        })
      ).json();
      const data = result.result;
      if (data?.surface) {
        setSnapshot(data);
        setSelected("");
      } else if (data?.snapshot) {
        setSnapshot(data.snapshot);
        setSelected("");
      } else if (
        tool === "computer.act" ||
        tool === "computer.visual_click" ||
        tool === "browser.close"
      ) {
        setSnapshot(null);
        setProposal(null);
      }
      if (data?.proposal_id && data?.point) setProposal(data);
      if (tool === "control.files") setFiles(data);
      setNotice(
        `${tool} completed · ${result.action_id ?? "See Action History"}. ${data?.verification ?? ""}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function choose(id: string) {
    setSelected(id);
    const e = snapshot?.elements.find((e) => e.id === id);
    setVerb(e?.actions[0] ?? "click");
    setValue("");
    setProposal(null);
  }
  const expired = !!snapshot && Date.parse(snapshot.expires_at) <= Date.now();
  return (
    <section
      className={styles.control}
      aria-label="Computer and browser control"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CONTROLLED WORKSPACE</p>
          <h2>Eyes on the work. You hold control.</h2>
          <p>
            Inspect a specific app or website. Review every interaction. No
            continuous screen capture.
          </p>
        </div>
        <EmergencyControl />
      </header>
      <div className={styles.layout}>
        <div className={styles.workspace}>
          <div className={styles.row}>
            <label>
              Surface
              <select
                value={surface}
                disabled={busy}
                onChange={(e) => {
                  setSurface(e.target.value as typeof surface);
                  setSnapshot(null);
                  setDestination("");
                  setProposal(null);
                }}
              >
                <option value="browser">Isolated browser</option>
                <option value="computer">Mac Accessibility</option>
              </select>
            </label>
            <label className={styles.grow}>
              {surface === "browser"
                ? "Allowed website URL"
                : "Allowed application bundle ID"}
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={
                  surface === "browser"
                    ? "https://your-approved-site.example"
                    : "com.example.Application"
                }
              />
            </label>
            <button
              disabled={busy || !destination.trim()}
              onClick={() =>
                void request(
                  surface === "browser" ? "browser.open" : "computer.inspect",
                  surface === "browser"
                    ? { url: destination }
                    : { app_id: destination },
                  "Inspect the explicitly selected control destination",
                )
              }
            >
              {surface === "browser" ? "Review & open" : "Review & inspect"}
            </button>
          </div>
          {snapshot && (
            <>
              <div className={styles.row}>
                <div className={styles.grow}>
                  <h3>{snapshot.title}</h3>
                  <p>
                    Inspected{" "}
                    {new Date(snapshot.observed_at).toLocaleTimeString()} ·{" "}
                    {expired ? "Expired" : "Valid for two minutes"}
                    {snapshot.truncated ? " · First 200 targets" : ""}
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    void request(
                      `${snapshot.surface}.inspect`,
                      snapshot.surface === "browser"
                        ? { session_id: snapshot.target_id }
                        : { app_id: snapshot.target_id },
                      "Refresh the selected target inspection",
                    )
                  }
                >
                  Inspect again
                </button>
                {snapshot.surface === "browser" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void request(
                        "browser.close",
                        { session_id: snapshot.target_id },
                        "Close this Ary-owned browser",
                      )
                    }
                  >
                    Close browser
                  </button>
                )}
              </div>
              {snapshot.text_preview && (
                <details>
                  <summary>Read page context · bounded inspection</summary>
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    {snapshot.text_preview}
                  </p>
                </details>
              )}
              <div
                className={styles.targets}
                role="group"
                aria-label="Inspected targets"
              >
                {snapshot.elements.map((e) => (
                  <button
                    aria-pressed={selected === e.id}
                    disabled={busy}
                    className={styles.target}
                    data-selected={selected === e.id}
                    key={e.id}
                    onClick={() => choose(e.id)}
                  >
                    <span>{e.role}</span>
                    <strong>{e.label || "Untitled control"}</strong>
                    <small>
                      {e.protected
                        ? "Protected · control unavailable"
                        : e.actions.join(" · ") || "Inspect only"}
                    </small>
                  </button>
                ))}
              </div>
              {element && (
                <div className={styles.editor}>
                  <h3>{element.label || element.role}</h3>
                  <p>Target {element.id} · request bound to this inspection</p>
                  {element.actions.length > 0 && (
                    <>
                      <div className={styles.row}>
                        <label>
                          Operation
                          <select
                            value={verb}
                            onChange={(e) => setVerb(e.target.value)}
                          >
                            {element.actions.map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </label>
                        {["fill", "select"].includes(verb) && (
                          <label className={styles.grow}>
                            Value
                            <input
                              value={value}
                              onChange={(e) => setValue(e.target.value)}
                              maxLength={8000}
                            />
                          </label>
                        )}
                        {verb === "key" && (
                          <label>
                            Key
                            <select
                              value={key}
                              onChange={(e) => setKey(e.target.value)}
                            >
                              {controlKeys.map((k) => (
                                <option key={k}>{k}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        {verb === "check" && (
                          <label>
                            Checked
                            <select
                              value={value || "true"}
                              onChange={(e) => setValue(e.target.value)}
                            >
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          </label>
                        )}
                        {verb === "upload" && (
                          <>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void request(
                                  "control.files",
                                  {},
                                  "Inspect the dedicated transfer folder for an upload",
                                )
                              }
                            >
                              List transfer files
                            </button>
                            <label>
                              File
                              <select
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                              >
                                <option value="">Select a listed file</option>
                                {files.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.id} · {f.bytes} bytes
                                  </option>
                                ))}
                              </select>
                            </label>
                          </>
                        )}
                      </div>
                      <button
                        disabled={
                          busy || expired || (verb === "upload" && !value)
                        }
                        onClick={() =>
                          void request(
                            `${snapshot.surface}.act`,
                            {
                              snapshot_id: snapshot.id,
                              element_id: element.id,
                              verb,
                              ...(["fill", "select"].includes(verb)
                                ? { value }
                                : {}),
                              ...(verb === "key" ? { key } : {}),
                              ...(verb === "check"
                                ? { checked: value !== "false" }
                                : {}),
                              ...(verb === "upload" ? { file_id: value } : {}),
                            },
                            `Use ${verb} on ${element.label || element.role} in ${snapshot.title}`,
                          )
                        }
                      >
                        Review interaction
                      </button>
                    </>
                  )}
                  {snapshot.surface === "computer" &&
                    element.role === "AXWindow" && (
                      <details>
                        <summary>
                          Visual fallback · only when structural controls are
                          unavailable
                        </summary>
                        <label>
                          What should Ary locate?
                          <input
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            maxLength={1000}
                          />
                        </label>
                        <button
                          disabled={busy || !question || expired}
                          onClick={() =>
                            void request(
                              "computer.propose_visual",
                              {
                                snapshot_id: snapshot.id,
                                element_id: element.id,
                                question,
                              },
                              "Capture this window once and propose a visual target for separate review",
                            )
                          }
                        >
                          Review capture & suggestion
                        </button>
                        {proposal && (
                          <div>
                            <p>{proposal.point.reason}</p>
                            <p>
                              Point: {(proposal.point.x * 100).toFixed(1)}%
                              across, {(proposal.point.y * 100).toFixed(1)}%
                              down · confidence{" "}
                              {Math.round(proposal.point.confidence * 100)}%
                            </p>
                            <button
                              disabled={busy || proposal.point.confidence < 0.5}
                              onClick={() =>
                                void request(
                                  "computer.visual_click",
                                  {
                                    proposal_id: proposal.proposal_id,
                                    x: proposal.point.x,
                                    y: proposal.point.y,
                                  },
                                  "Click the reviewed point in the unchanged captured window",
                                )
                              }
                            >
                              Review exact click
                            </button>
                          </div>
                        )}
                      </details>
                    )}
                </div>
              )}
            </>
          )}
          {!snapshot && (
            <div className={styles.empty}>
              <h3>No active inspection</h3>
              <p>
                Desktop control must be enabled for this Mac and owner. Websites
                and applications must be explicitly configured. Launch apps
                through the existing command palette.
              </p>
            </div>
          )}
          {busy && (
            <p className={styles.busy} role="status">
              Request in progress · review may be required
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
        <aside className={styles.activity}>
          <p className={styles.eyebrow}>LIVE ACTIVITY · {events.connection}</p>
          <h3>Observed execution</h3>
          <p>
            Real action events. Detailed inputs, approvals and outcomes remain
            in Action History.
          </p>
          {rows.length ? (
            rows.map((e) => (
              <article key={e.id}>
                <strong>{String(e.payload.tool ?? e.type)}</strong>
                <span>{e.type}</span>
                <time>{new Date(e.timestamp).toLocaleTimeString()}</time>
              </article>
            ))
          ) : (
            <p>No computer or browser activity received.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
