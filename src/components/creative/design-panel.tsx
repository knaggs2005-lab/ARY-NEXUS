"use client";
import { useRef, useState } from "react";
import {
  designVerbs,
  type DesignVerb,
  type DesignState,
} from "../../domain/design-tool";
import type { Json } from "../../domain/models";
import { api } from "../api";
import styles from "../gmail/gmail.module.css";
const examples: Record<DesignVerb, Json> = {
  open_document: { path: "/allowed/example.c4d" },
  select_object: { object_id: "" },
  create_object: {
    kind: "box",
    name: "Bracket blank",
    dimensions_mm: [50, 20, 10],
  },
  modify_dimensions: { object_id: "", dimensions_mm: [60, 20, 10] },
  change_property: {
    object_id: "",
    property: "display_color",
    rgb: [0.3, 0.5, 0.7],
  },
  export: { path: "/allowed/new-export.obj", format: "obj" },
  save: { path: "/allowed/new-version.c4d" },
  undo: { undo_token: "" },
  preview: { mode: "viewport" },
};
export function DesignPanel() {
  const [state, setState] = useState<DesignState | null>(null),
    [verb, setVerb] = useState<DesignVerb>("create_object"),
    [input, setInput] = useState(
      JSON.stringify(examples.create_object, null, 2),
    ),
    [plan, setPlan] = useState<{
      plan: string;
      request: { tool: string; input: Json };
    } | null>(null),
    [result, setResult] = useState<Json | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(false),
    key = useRef("");
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
    args: Json,
    requestKey = crypto.randomUUID(),
  ) {
    return (
      await api("actions/request", {
        method: "POST",
        body: JSON.stringify({
          tool,
          input: args,
          request_key: requestKey,
          reason:
            "User reviewed this exact Design adapter operation in Creative.",
        }),
      })
    ).json();
  }
  return (
    <section className={styles.mail} aria-label="Ary Design Tools">
      <span className={styles.eyebrow}>ARY / DESIGN / CINEMA 4D</span>
      <h2>Inspect, measure, then change.</h2>
      <p>
        Fixed native operations behind Ary approvals. Box primitives and local
        dimensions in millimeters; object display color, OBJ export and viewport
        preview. STEP and arbitrary scripts are unsupported. Bridge disabled
        until deliberately configured.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void work(async () => {
            setPlan(null);
            setState((await request("design.inspect", {})).result);
          })
        }
      >
        Inspect design document
      </button>
      {busy && (
        <p role="status" className={styles.pulse}>
          Validating design state…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {state && (
        <details open>
          <summary>
            {state.adapter} · {state.document_name} ·{" "}
            {state.safe_scene ? "Supported scene" : "Unsupported scene content"}
          </summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              maxHeight: 300,
              overflow: "auto",
            }}
          >
            {JSON.stringify(state, null, 2)}
          </pre>
        </details>
      )}
      <label>
        Design operation
        <select
          disabled={busy}
          value={verb}
          onChange={(e) => {
            const v = e.target.value as DesignVerb;
            setVerb(v);
            setInput(JSON.stringify(examples[v], null, 2));
            setPlan(null);
            setResult(null);
          }}
        >
          {designVerbs.map((v) => (
            <option key={v} value={v}>
              {v.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        Design inputs
        <textarea
          disabled={busy}
          rows={6}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setPlan(null);
            setResult(null);
          }}
        />
      </label>
      <button
        disabled={busy}
        onClick={() =>
          void work(async () => {
            setPlan(null);
            setResult(null);
            const r = await request("design.plan", {
              verb,
              args: JSON.parse(input),
            });
            setPlan(r.result);
            setState(r.result.state);
            key.current = crypto.randomUUID();
          })
        }
      >
        Prepare design plan
      </button>
      {plan && (
        <article className={styles.candidate}>
          <h3>Review design change</h3>
          <p style={{ overflowWrap: "anywhere" }}>{plan.plan}</p>
          <button
            disabled={busy || !!result}
            onClick={() =>
              void work(async () =>
                setResult(
                  await request(
                    plan.request.tool,
                    plan.request.input,
                    key.current,
                  ),
                ),
              )
            }
          >
            Request design approval
          </button>
        </article>
      )}
      {result && (
        <article className={styles.receipt}>
          <h3>Design receipt</h3>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
          <p>
            Action History retains exact inputs, approval, result and outcome.
            Reinspect before another change. File writes always require a new
            path.
          </p>
        </article>
      )}
    </section>
  );
}
