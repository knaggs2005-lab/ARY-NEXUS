"use client";
import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  desktopSchemas,
  type DesktopVerb,
  type InstalledApp,
} from "../domain/desktop";
import { api } from "./api";
import styles from "./permissions.module.css";

/** Uses the same exact-request approval dialog and action history as every other tool. */
export function DesktopPanel() {
  const [verb, setVerb] = useState<DesktopVerb>("launch_app");
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [appId, setAppId] = useState("");
  const [url, setUrl] = useState("https://example.com");
  const [player, setPlayer] = useState("music");
  const [command, setCommand] = useState("pause");
  const [level, setLevel] = useState(30);
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("I requested this Mac action.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const attempt = useRef<{
    signature: string;
    key: string;
    operation: string;
  } | null>(null);
  async function run(action: DesktopVerb, fields: Record<string, unknown>) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    const signature = JSON.stringify([action, fields, reason]);
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        key: crypto.randomUUID(),
        operation: crypto.randomUUID(),
      };
    const input = ["list_apps", "clipboard_read"].includes(action)
      ? fields
      : { ...fields, operation_id: attempt.current.operation };
    try {
      const data = await (
        await api("actions/request", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            tool: `desktop.${action}`,
            input,
            reason,
            request_key: attempt.current.key,
          }),
        })
      ).json();
      if (controller.signal.aborted) return;
      setResult(data.result);
      if (action === "list_apps") setApps(data.result.apps);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const fields: Record<string, unknown> = {};
    if (["launch_app", "hide_others", "quit_app"].includes(verb))
      fields.app_id = appId;
    if (verb === "open_website") fields.url = url;
    if (verb === "media") Object.assign(fields, { player, command });
    if (verb === "volume") fields.level = level;
    if (verb === "clipboard_write") fields.text = text;
    if (verb === "do_not_disturb") fields.enabled = enabled;
    if (verb === "create_note") Object.assign(fields, { title, body: text });
    if (verb === "create_reminder")
      Object.assign(fields, {
        title,
        notes: text,
        ...(due ? { due_at: new Date(due).toISOString() } : {}),
      });
    await run(verb, fields);
  }
  return (
    <section className={styles.card} aria-label="Mac Desktop Bridge">
      <h3>Mac Desktop Bridge</h3>
      <p>
        Disabled unless enabled on this Mac and bound to your signed-in owner
        account. Use the installed Ary app with its own local server. Mac
        actions require exact approval and appear in Action history.
      </p>
      <p>
        Clipboard text and Notes/Reminders content are retained in the private
        action audit. Only text clipboard content is supported. Media controls
        target an already-running Music or Spotify app.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          attempt.current = null;
          void run("list_apps", {});
        }}
      >
        Scan installed apps
      </button>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Mac action
            <select
              value={verb}
              onChange={(e) => setVerb(e.target.value as DesktopVerb)}
            >
              {(Object.keys(desktopSchemas) as DesktopVerb[])
                .filter((v) => v !== "list_apps")
                .map((v) => (
                  <option key={v} value={v}>
                    {v.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
          {["launch_app", "hide_others", "quit_app"].includes(verb) && (
            <label>
              Installed app
              <select
                required
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              >
                <option value="">Scan and select an app</option>
                {apps.map((a) => (
                  <option key={a.path} value={a.id}>
                    {a.name} · {a.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          {verb === "open_website" && (
            <label>
              Website
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          )}
          {verb === "media" && (
            <>
              <label>
                Player
                <select
                  value={player}
                  onChange={(e) => setPlayer(e.target.value)}
                >
                  <option value="music">Music</option>
                  <option value="spotify">Spotify</option>
                </select>
              </label>
              <label>
                Command
                <select
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                >
                  {["play", "pause", "next", "previous"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {verb === "volume" && (
            <label>
              System volume (0–100)
              <input
                type="number"
                min={0}
                max={100}
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
              />
            </label>
          )}
          {verb === "do_not_disturb" && (
            <>
              <label>
                Do Not Disturb
                <select
                  value={String(enabled)}
                  onChange={(e) => setEnabled(e.target.value === "true")}
                >
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
              <p>
                Requires the local shortcut Ary Focus On or Ary Focus Off
                containing only the corresponding Set Focus action.
              </p>
            </>
          )}
          {["create_note", "create_reminder"].includes(verb) && (
            <label>
              Title
              <input
                required
                maxLength={300}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
          )}
          {["clipboard_write", "create_note", "create_reminder"].includes(
            verb,
          ) && (
            <label>
              Text
              <textarea
                maxLength={16000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          )}
          {verb === "create_reminder" && (
            <label>
              Due date (local time, optional)
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          )}
          <label>
            Why
            <input
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="submit">
            {busy ? "Checking action…" : "Review Mac action"}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {result !== null && (
        <div role="status">
          <p>
            Recorded result. Repeating unchanged inputs returns this receipt.
          </p>
          <pre>{JSON.stringify(result, null, 2)}</pre>
          <button
            onClick={() => {
              attempt.current = null;
              setResult(null);
            }}
          >
            Start a new action
          </button>
        </div>
      )}
      <p>
        For failed or uncertain actions, inspect Action history and the Mac
        before creating another operation. No automatic replay of a possibly
        completed side effect.
      </p>
    </section>
  );
}
