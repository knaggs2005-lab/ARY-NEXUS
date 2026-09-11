"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import type { Entity } from "../../domain/models";
import type { CalendarEvent, CalendarProvider } from "../../domain/calendar";
import type { CalendarService } from "../../services/calendar-service";
import { api } from "../api";
import { CalendarReview } from "./calendar-review";
import styles from "./calendar.module.css";
type ReadResult = Awaited<ReturnType<CalendarService["read"]>>;
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export function CalendarView({
  entities,
  focusId,
  focusConnectionId,
}: {
  entities: Entity[];
  focusId?: string | null;
  focusConnectionId?: string | null;
}) {
  const [status, setStatus] = useState<Awaited<
      ReturnType<CalendarProvider["status"]>
    > | null>(null),
    [data, setData] = useState<ReadResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [launch, setLaunch] = useState("");
  const [accountId, setAccountId] = useState(focusConnectionId ?? "");
  const connection =
    status?.accounts?.find((item) => item.connection_id === accountId) ??
    (accountId ? null : status);
  const [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [receipt, setReceipt] = useState<CalendarEvent | null>(null);
  const [blocks, setBlocks] = useState<
    { start: string; end: string; reason: string }[]
  >([]);
  const [start, setStart] = useState(() => localInput(new Date())),
    [end, setEnd] = useState(() =>
      localInput(new Date(Date.now() + 7 * 86400000)),
    );
  const [title, setTitle] = useState("Focus time"),
    [description, setDescription] = useState(""),
    [eventStart, setEventStart] = useState(() =>
      localInput(new Date(Date.now() + 3600000)),
    ),
    [eventEnd, setEventEnd] = useState(() =>
      localInput(new Date(Date.now() + 7200000)),
    ),
    [project, setProject] = useState(""),
    [reason, setReason] = useState("Reserve focused time for this project.");
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const panel = useRef<HTMLDivElement>(null),
    active = useRef(true);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const event = data?.events.find((e) => e.id === selected);
  useEffect(() => {
    active.current = true;
    void refreshStatus();
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (focusId) setSelected(focusId);
  }, [focusId]);
  useEffect(() => {
    if (focusId && status?.connected && connection?.connection_id) void load();
  }, [focusId, connection?.connection_id]);
  useEffect(() => {
    if (selected && data) {
      panel.current?.focus({ preventScroll: true });
      document.getElementById(`calendar-event-${selected}`)?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
    }
  }, [selected, data]);
  async function refreshStatus() {
    try {
      const value = await (await api("calendar/status")).json();
      if (active.current) {
        setStatus(value);
        setEditing(false);
        setReceipt(null);
        setData((current) =>
          current &&
          !(value.accounts ?? [value]).some(
            (item: { connection_id: string }) =>
              item.connection_id === current.connection_id,
          )
            ? null
            : current,
        );
      }
    } catch (e) {
      if (active.current) setError((e as Error).message);
    }
  }
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function request(
    tool: string,
    input: unknown,
    extra: Record<string, unknown> = {},
  ) {
    return (
      await (
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify({
            tool,
            input,
            reason: tool.endsWith("read")
              ? "Read upcoming calendar context"
              : reason,
            request_key: crypto.randomUUID(),
            ...extra,
          }),
        })
      ).json()
    ).result;
  }
  async function load(recommend = false) {
    setData(null);
    setBlocks([]);
    await perform(async () => {
      const input = {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        ...(connection?.connection_id
          ? { connection_id: connection.connection_id }
          : {}),
      };
      const value = await request(
        recommend ? "google_calendar.recommend" : "google_calendar.read",
        { ...input, ...(recommend ? { minutes: 60 } : {}) },
      );
      if (active.current) {
        setData(value);
        setBlocks(value.blocks || []);
      }
    });
  }
  function choose(e: CalendarEvent) {
    setSelected(e.id);
    setEditing(false);
    setReceipt(null);
  }
  function prepare(e?: CalendarEvent, block?: { start: string; end: string }) {
    setTitle(e?.summary || "Focus time");
    setDescription(e?.description || "");
    setEventStart(
      localInput(new Date(e?.start || block?.start || Date.now() + 3600000)),
    );
    setEventEnd(
      localInput(new Date(e?.end || block?.end || Date.now() + 7200000)),
    );
    setProject(e?.entity_ids[0] || "");
    setEditing(true);
    if (!e) setSelected(null);
    setOperation(crypto.randomUUID());
    setReceipt(null);
  }
  const fields = {
    summary: title,
    description,
    start: eventStart ? new Date(eventStart).toISOString() : "",
    end: eventEnd ? new Date(eventEnd).toISOString() : "",
    time_zone: zone,
  };
  const proposed = {
    connection_id: data?.connection_id || connection?.connection_id,
    operation_id: operation,
    event: fields,
    ...(event
      ? {
          event_id: event.id,
          etag: event.etag,
          before: {
            summary: event.summary,
            description: event.description,
            start: event.start,
            end: event.end,
            time_zone: event.time_zone,
          },
        }
      : {}),
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    await perform(async () => {
      const value = await request(
        event ? "google_calendar.update" : "google_calendar.create",
        proposed,
        {
          reason,
          related_entity_ids: [
            ...new Set([
              ...(event?.entity_ids ?? []),
              ...(project ? [project] : []),
            ]),
          ],
        },
      );
      if (active.current) {
        setReceipt(value.event);
        setEditing(false);
        setNotice(
          value.recovered
            ? "Existing external operation recovered; no duplicate write."
            : "Google Calendar confirmed this event. Action History has the receipt.",
        );
        setData(null);
        setBlocks([]);
      }
    });
  }
  return (
    <section className={styles.calendar} aria-label="Ary Calendar">
      <header>
        <span className={styles.eyebrow}>ARY / CALENDAR</span>
        <h2>Space for what matters.</h2>
        <p>
          Personal and work accounts, connected to Nexus. Each view reads the
          selected account’s primary calendar. Every change is reviewed.
        </p>
        <div className={styles.toolbar}>
          <span>
            {status?.connected
              ? `${connection?.account} · ${connection?.writable ? "Approved editing available" : "Read-only connection"}`
              : "Google Calendar is not connected"}
          </span>
          <button disabled={busy} onClick={() => void refreshStatus()}>
            Refresh connection
          </button>
        </div>
      </header>
      {!!status?.accounts?.length && (
        <label className={styles.toolbar}>
          Google account
          <select
            aria-label="Google Calendar account"
            disabled={busy}
            value={connection?.connection_id ?? ""}
            onChange={(e) => {
              setAccountId(e.target.value);
              setData(null);
              setBlocks([]);
              setSelected(null);
              setEditing(false);
              setReceipt(null);
              setLaunch("");
              setNotice("");
              setError("");
              setOperation(crypto.randomUUID());
            }}
          >
            {status.accounts.map((item) => (
              <option key={item.connection_id} value={item.connection_id}>
                {item.account} ·{" "}
                {item.writable ? "Approved editing" : "Read-only"}
              </option>
            ))}
          </select>
        </label>
      )}
      {!status?.configured && (
        <p className={styles.banner}>
          Google OAuth setup is required. Configure the Calendar client and
          encrypted credential storage on the Ary server. No account or events
          have been simulated.
        </p>
      )}
      <div className={styles.toolbar}>
        <button
          disabled={busy || !status?.configured}
          onClick={() =>
            void perform(async () => {
              setLaunch(
                (
                  await (
                    await api("calendar/connect", {
                      method: "POST",
                      body: JSON.stringify({ write: false }),
                    })
                  ).json()
                ).launch_url,
              );
            })
          }
        >
          {status?.connected
            ? "Add / reconnect account read-only"
            : "Connect read-only"}
        </button>
        <button
          disabled={busy || !status?.configured}
          onClick={() =>
            void perform(async () => {
              setLaunch(
                (
                  await (
                    await api("calendar/connect", {
                      method: "POST",
                      body: JSON.stringify({ write: true }),
                    })
                  ).json()
                ).launch_url,
              );
            })
          }
        >
          Enable approved editing
        </button>
        {status?.connected && (
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const result = await (
                  await api("calendar/disconnect", {
                    method: "POST",
                    body: JSON.stringify({
                      connection_id: connection?.connection_id,
                    }),
                  })
                ).json();
                setData(null);
                setReceipt(null);
                setBlocks([]);
                setEditing(false);
                setLaunch("");
                await refreshStatus();
                setNotice(
                  result.revoked
                    ? "Calendar disconnected."
                    : "Disconnected locally. Google revocation failed; remove Ary access in your Google account settings.",
                );
              })
            }
          >
            Disconnect selected account
          </button>
        )}
        {launch && (
          <a href={launch} target="_blank" rel="noreferrer">
            Continue securely in Google →
          </a>
        )}
      </div>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          From ({zone})
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Until
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button disabled={busy || !status?.connected}>Read events</button>
        <button
          type="button"
          disabled={busy || !status?.connected}
          onClick={() => void load(true)}
        >
          Suggest 60-minute blocks
        </button>
        <button
          type="button"
          disabled={busy || !connection?.writable}
          onClick={() => prepare()}
        >
          Propose event
        </button>
      </form>
      {busy && (
        <p role="status" className={styles.pulse}>
          Checking context and permissions…
        </p>
      )}
      {error && (
        <p role="alert" className={styles.banner}>
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <p>
          {data.events.length} events · {data.conflicts.length} overlapping
          pairs ·{" "}
          {data.complete
            ? "Complete for this window"
            : "Incomplete result — availability is unknown"}
          . Transparent and declined events do not block time.
        </p>
      )}
      <div className={styles.layout}>
        <div className={styles.timeline} aria-label="Event timeline">
          {data?.events.length === 0 && <p>No events in this window.</p>}
          {data?.events.map((e) => (
            <button
              id={`calendar-event-${e.id}`}
              key={e.id}
              aria-pressed={e.id === selected}
              className={styles.event}
              onClick={() => choose(e)}
            >
              <time>
                {new Date(e.start).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {e.all_day ? " · All day" : ""}
              </time>
              <strong>{e.summary}</strong>
              <span>
                {new Date(e.end).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · {e.busy ? "Busy" : "Available"}
              </span>
              <span className={styles.chips}>
                {e.entities.map((entity) => (
                  <span key={entity.id}>{entity.name}</span>
                ))}
              </span>
              {data.conflicts.some((c) => c.event_ids.includes(e.id)) && (
                <small className={styles.conflict}>Overlapping event</small>
              )}
            </button>
          ))}
          {blocks.map((block) => (
            <article className={styles.suggestion} key={block.start}>
              <strong>
                {new Date(block.start).toLocaleString()} →{" "}
                {new Date(block.end).toLocaleTimeString()}
              </strong>
              <p>{block.reason}</p>
              <button
                disabled={busy || !connection?.writable}
                onClick={() => prepare(undefined, block)}
              >
                Review this block
              </button>
            </article>
          ))}
        </div>
        <div
          ref={panel}
          tabIndex={-1}
          className={styles.context}
          aria-label="Calendar context panel"
        >
          {event && !editing && (
            <>
              <span className={styles.eyebrow}>EVENT CONTEXT</span>
              <h3>{event.summary}</h3>
              <p>{event.description || "No description"}</p>
              <p>{event.people.join(" · ")}</p>
              <div className={styles.chips}>
                {event.entities.map((entity) => (
                  <span key={entity.id}>
                    {entity.type} · {entity.name}
                  </span>
                ))}
              </div>
              <p>
                {new Date(event.start).toLocaleString()} →{" "}
                {new Date(event.end).toLocaleString()}
              </p>
              {event.resolution.length > 0 && (
                <details>
                  <summary>Entity evidence</summary>
                  {event.resolution.map((r, i) => (
                    <p key={i}>
                      {r.mention}: {r.reason}
                    </p>
                  ))}
                </details>
              )}
              <button
                disabled={busy || !event.editable || !connection?.writable}
                onClick={() => prepare(event)}
              >
                Propose changes
              </button>
              {!event.editable && (
                <p>
                  Read-only in v1: all-day, recurring, shared, or special event.
                </p>
              )}
            </>
          )}
          {!event && !editing && !receipt && (
            <p>
              Select an event to see its people, projects, conflicts, and
              evidence.
            </p>
          )}
          {editing && (
            <form
              onSubmit={submit}
              className={styles.editor}
              onChange={() => setOperation(crypto.randomUUID())}
            >
              <h3>{event ? "Review event changes" : "Propose focused time"}</h3>
              <label>
                Title
                <input
                  required
                  maxLength={300}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  maxLength={4000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                Start ({zone})
                <input
                  type="datetime-local"
                  required
                  value={eventStart}
                  onChange={(e) => setEventStart(e.target.value)}
                />
              </label>
              <label>
                End
                <input
                  type="datetime-local"
                  required
                  value={eventEnd}
                  onChange={(e) => setEventEnd(e.target.value)}
                />
              </label>
              <label>
                Linked Nexus entity
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">None</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Why Ary should do this
                <textarea
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <CalendarReview input={proposed} />
              <button disabled={busy || !connection?.writable}>
                Request approval
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </form>
          )}
          {receipt && (
            <article className={styles.receipt}>
              <span>GOOGLE CONFIRMED</span>
              <h3>{receipt.summary}</h3>
              <p>{new Date(receipt.start).toLocaleString()}</p>
              <small>Event ID: {receipt.id}</small>
              <p>Refresh events to inspect the current version.</p>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
