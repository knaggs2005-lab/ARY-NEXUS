"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Entity } from "../domain/models";
import { mockToolDefinitions } from "../domain/permissions";
import { api } from "./api";
import styles from "./permissions.module.css";

export function MockActionsPanel({
  products,
  onComplete,
}: {
  products: Entity[];
  onComplete: () => Promise<void>;
}) {
  const [tool, setTool] =
    useState<keyof typeof mockToolDefinitions>("mock.execute");
  const [message, setMessage] = useState("Review the example project plan");
  const [product, setProduct] = useState("");
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const response = await api("actions/request", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          tool,
          product_entity_id: product || null,
          input:
            tool === "mock.observe"
              ? {}
              : tool === "mock.execute"
                ? { message, simulate_failure: failure }
                : { message },
        }),
      });
      const data: unknown = await response.json();
      if (!controller.signal.aborted) setResult(data);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        try {
          await onComplete();
        } catch {
          setError(
            (value) =>
              value ||
              "Could not refresh the audit history. Use Refresh to retry.",
          );
        }
        setBusy(false);
      }
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <form
      className={styles.card}
      onSubmit={submit}
      aria-label="Mock action playground"
    >
      <h3>Try an action safely</h3>
      <p>
        Simulations only. These tools save action and approval records, but do
        not change memories, create tasks, call a model, or contact external
        services.
      </p>
      <label>
        Mock tool
        <select
          value={tool}
          disabled={busy}
          onChange={(e) =>
            setTool(e.target.value as keyof typeof mockToolDefinitions)
          }
        >
          {Object.entries(mockToolDefinitions)
            .filter(([name]) =>
              [
                "mock.observe",
                "mock.recommend",
                "mock.draft",
                "mock.execute",
              ].includes(name),
            )
            .map(([name, definition]) => (
              <option key={name} value={name}>
                {name} · default level {definition.defaultLevel}
              </option>
            ))}
        </select>
      </label>
      <p>
        {mockToolDefinitions[tool].description}. Your matching policies still
        apply.
      </p>
      <label>
        Action scope
        <select
          value={product}
          disabled={busy}
          onChange={(e) => setProduct(e.target.value)}
        >
          <option value="">Workspace only</option>
          {products.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
      </label>
      {tool !== "mock.observe" && (
        <label>
          Example request
          <textarea
            required
            maxLength={500}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
      )}
      {tool === "mock.execute" && (
        <label>
          Simulation result
          <select
            value={failure ? "failure" : "success"}
            disabled={busy}
            onChange={(e) => setFailure(e.target.value === "failure")}
          >
            <option value="success">Success</option>
            <option value="failure">Intentional failure</option>
          </select>
        </label>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Request in progress…" : "Run mock action"}
      </button>
      {error && <p role="alert">{error}</p>}
      {result !== null && (
        <div role="status" className={styles.attempt}>
          <p>
            Simulation completed. Its result is saved in the action audit below.
          </p>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </form>
  );
}
