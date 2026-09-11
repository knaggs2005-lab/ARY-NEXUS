"use client";
import {
  PremiereInspector,
  PremiereAnalysisReceipt,
} from "./premiere-inspector";
import { DesignPanel } from "./design-panel";
import {
  EditIntelligencePanel,
  type PreparedEditMarker,
} from "./edit-intelligence-panel";
import { useState, useRef } from "react";
import {
  premiereVerbs,
  type PremiereVerb,
  type PremiereState,
} from "../../domain/premiere";
import type { Json } from "../../domain/models";
import { api } from "../api";
import styles from "../gmail/gmail.module.css";
const examples: Record<PremiereVerb, Json> = {
  open_project: { path: "/path/to/project.prproj" },
  open_sequence: { sequence_id: "" },
  create_sequence: {
    name: "Ary Sequence",
    preset_path: "/path/to/preset.sqpreset",
  },
  import_media: { paths: ["/path/to/interview.mov"], bin_id: "" },
  create_bin: { name: "Ary Selects", parent_id: "" },
  rename_bin: { bin_id: "", name: "Interview" },
  select_clips: { clip_ids: [] },
  create_markers: { markers: [{ name: "Review", seconds: 0, comments: "" }] },
  create_selects: { name: "Interview Selects", media_ids: [], bin_id: "" },
  jump_timecode: { timecode: "00:00:00:00" },
  export_sequence: {
    preset_path: "/path/to/preset.epr",
    output_path: "/path/to/new-export.mp4",
  },
  save_project: {},
  set_clips_enabled: { clip_ids: [], enabled: false },
  remove_clips: { clip_ids: [], ripple: false },
};
export function PremierePanel() {
  const [state, setState] = useState<PremiereState | null>(null),
    [verb, setVerb] = useState<PremiereVerb>("create_bin"),
    [args, setArgs] = useState(JSON.stringify(examples.create_bin, null, 2));
  const [plan, setPlan] = useState<{
      source_action_id?: string;
      product_entity_ids?: string[];
      plan: string;
      request: { tool: string; input: Json };
    } | null>(null),
    [result, setResult] = useState<Json | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(false),
    requestKey = useRef("");
  async function work(fn: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  async function request(
    tool: string,
    input: Json,
    key = crypto.randomUUID(),
    source?: string,
    entities: string[] = [],
  ) {
    return (
      await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool,
          input,
          ...(source
            ? { source_action_id: source, related_entity_ids: entities }
            : {}),
          request_key: key,
          reason:
            "User requested and reviewed this Premiere operation in Ary Creative.",
        }),
      })
    ).json();
  }
  function usePreparedAnalysis(prepared: {
    plan: string;
    request: { tool: string; input: Json };
  }) {
    if (active.current) return;
    setPlan(prepared);
    setResult(null);
    setError("");
    requestKey.current = crypto.randomUUID();
  }
  function useEditMarker(prepared: PreparedEditMarker) {
    if (active.current) return;
    setVerb("create_markers");
    setArgs(JSON.stringify(prepared.request.input.args, null, 2));
    setPlan(prepared);
    setResult(null);
    setError("");
    requestKey.current = crypto.randomUUID();
  }
  return (
    <>
      {" "}
      <DesignPanel />
      <EditIntelligencePanel onPrepared={useEditMarker} />
      <section className={styles.mail} aria-label="Ary Creative Premiere">
        <span className={styles.eyebrow}>ARY / CREATIVE / PREMIERE PRO</span>
        <h2>Intent, then a deliberate edit.</h2>
        <p>
          Adobe UXP · live-state validation · every change reviewed. The bridge
          is disabled until configured and connected.
        </p>
        <div className={styles.toolbar}>
          <button
            disabled={busy}
            onClick={() =>
              void work(async () => {
                setPlan(null);
                setState((await request("premiere.inspect", {})).result);
              })
            }
          >
            Inspect Premiere
          </button>
        </div>
        {busy && (
          <p role="status" className={styles.pulse}>
            Checking Premiere state and the action pipeline…
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {state && (
          <>
            <p>
              {state.project_name || "No active project"} · Revision{" "}
              {state.revision}
            </p>
            <details>
              <summary>Current sequences, bins, media and clips</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 350,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(state, null, 2)}
              </pre>
            </details>
          </>
        )}
        <PremiereInspector
          state={state}
          disabled={busy}
          onPrepared={usePreparedAnalysis}
        />
        <div className={styles.toolbar}>
          <label>
            Premiere action
            <select
              disabled={busy}
              value={verb}
              onChange={(e) => {
                const next = e.target.value as PremiereVerb;
                setVerb(next);
                setArgs(JSON.stringify(examples[next], null, 2));
                setPlan(null);
                setResult(null);
              }}
            >
              {premiereVerbs.map((v) => (
                <option
                  key={v}
                  value={v}
                  disabled={
                    !!state &&
                    (state.supported_verbs
                      ? !state.supported_verbs.includes(v)
                      : ["set_clips_enabled", "remove_clips"].includes(v))
                  }
                >
                  {v.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        {verb === "remove_clips" && (
          <p role="note">
            This removes only the listed timeline instances, without ripple. It
            can leave gaps and separate linked audio/video. Review every
            selected track; native Undo is available.
          </p>
        )}
        <label>
          Exact action inputs
          <textarea
            disabled={busy}
            rows={8}
            value={args}
            onChange={(e) => {
              setArgs(e.target.value);
              setPlan(null);
              setResult(null);
            }}
          />
        </label>
        <p>
          Use IDs from Inspect Premiere. Timecode is non-drop HH:MM:SS:FF
          relative to sequence start. Rough selects assembles chosen media in
          order using its existing in/out marks.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            void work(async () => {
              setPlan(null);
              setResult(null);
              const r = await request("premiere.plan", {
                verb,
                args: JSON.parse(args),
              });
              setPlan(r.result);
              setState(r.result.state);
              requestKey.current = crypto.randomUUID();
            })
          }
        >
          Prepare action plan
        </button>
        {plan && (
          <article className={styles.candidate}>
            <h3>Review the exact operation</h3>
            <p style={{ overflowWrap: "anywhere" }}>{plan.plan}</p>
            <button
              disabled={busy || !!result}
              onClick={() =>
                void work(async () => {
                  const r = await request(
                    plan.request.tool,
                    plan.request.input,
                    requestKey.current,
                    plan.source_action_id,
                    plan.product_entity_ids,
                  );
                  setResult(r);
                })
              }
            >
              Request approval and execute
            </button>
          </article>
        )}
        {result && (
          <article className={styles.receipt}>
            <h3>Premiere receipt</h3>
            <PremiereAnalysisReceipt
              result={result.result as Json | undefined}
            />
            <details>
              <summary>Technical receipt</summary>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 350,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
            <p>
              Export submission is not render completion. Action History
              contains the approval, operation ID and exact receipt.
            </p>
          </article>
        )}
      </section>
    </>
  );
}
