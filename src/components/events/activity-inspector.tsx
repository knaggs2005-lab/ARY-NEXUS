"use client";
import { useState } from "react";
import {
  eventFamilies,
  type StoredNexusEvent,
} from "../../domain/nexus-events";
import { parseEventBatch, useNexusEvents } from "./event-store";
import { useNexusMode } from "../nexus/mode";
import { api } from "../api";
import styles from "./events.module.css";
export function ActivityInspector() {
  const snapshot = useNexusEvents(),
    mode = useNexusMode();
  const [family, setFamily] = useState("all"),
    [correlation, setCorrelation] = useState(""),
    [older, setOlder] = useState<StoredNexusEvent[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [exhausted, setExhausted] = useState(false);
  const all = [
    ...new Map([...older, ...snapshot.events].map((e) => [e.id, e])).values(),
  ];
  const events = all
    .filter(
      (e) =>
        (family === "all" || e.type.startsWith(family + ".")) &&
        (!correlation ||
          e.correlation_id === correlation ||
          e.mission_id === correlation) &&
        (mode === "systems" ||
          e.visibility === "ambient" ||
          ["warning", "error", "critical"].includes(e.severity)),
    )
    .reverse();
  async function loadOlder() {
    if (loading || exhausted || older.length >= 600) return;
    setLoading(true);
    try {
      const first = [...older, ...snapshot.events].find(
        (e) => "sequence" in e,
      ) as { sequence?: string } | undefined;
      if (!first?.sequence) return;
      const page = parseEventBatch(
        await (await api(`events?before=${first.sequence}&limit=50`)).text(),
      );
      setOlder((v) => [...page.events, ...v]);
      setExhausted(!page.has_more);
      setError(page.events.length ? "" : "Beginning of recorded activity.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className={styles.inspector} aria-label="Nexus Activity inspector">
      <header>
        <div>
          <h2>Nexus activity</h2>
          <p>
            {snapshot.connection === "live"
              ? "Connected to the event journal"
              : snapshot.connection}{" "}
            ·{" "}
            {mode === "systems" ? "Technical visibility" : "Essential activity"}
          </p>
        </div>
        <label>
          Event family
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="all">All families</option>
            {eventFamilies.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
      </header>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      {correlation && (
        <button onClick={() => setCorrelation("")}>
          Clear correlation filter
        </button>
      )}
      <div className={styles.timeline}>
        {!events.length && (
          <p>
            No matching events recorded. Activity will appear when work actually
            occurs.
          </p>
        )}
        {events.map((event) => (
          <article key={event.id} data-severity={event.severity}>
            <div className={styles.row}>
              <time dateTime={event.timestamp}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </time>
              <strong>{event.type}</strong>
              <span>{event.severity}</span>
            </div>
            <p>
              {event.payload.label ?? event.payload.status ?? event.source.name}
            </p>
            {(event.correlation_id || event.mission_id) && (
              <button
                onClick={() =>
                  setCorrelation(event.mission_id ?? event.correlation_id!)
                }
              >
                Related activity
              </button>
            )}
            {mode === "systems" && (
              <details>
                <summary>Raw event</summary>
                <pre>{JSON.stringify(event, null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
      </div>
      <footer>
        <button
          disabled={loading || exhausted || older.length >= 600}
          onClick={() => void loadOlder()}
        >
          {loading
            ? "Loading history…"
            : older.length >= 600
              ? "History display limit reached"
              : "Load earlier activity"}
        </button>
        <span>
          {error ||
            "Journal metadata only · original records remain authoritative"}
        </span>
      </footer>
    </section>
  );
}
