"use client";
import { useEffect, useRef, useState, useId } from "react";
import { api } from "./api";
import styles from "./permission-engine.module.css";
type State = {
  active: boolean;
  revision: string | null;
  reason: string | null;
};
export function EmergencyControl() {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const headingId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const observed = useRef<string | null>(null);
  async function refresh() {
    const next: State = await (await api("permissions/emergency-stop")).json();
    setState(next);
    setError("");
    if (next.active && next.revision !== observed.current)
      window.dispatchEvent(new Event("ary:emergency-stop"));
    observed.current = next.revision;
  }
  useEffect(() => {
    const update = () => {
      void refresh().catch(() =>
        setError("Emergency state unavailable; retry before resuming work."),
      );
    };
    update();
    const interval = setInterval(update, 15000);
    window.addEventListener("ary:emergency-changed", update);
    return () => {
      clearInterval(interval);
      window.removeEventListener("ary:emergency-changed", update);
    };
  }, []);
  async function change(active: boolean) {
    setBusy(true);
    setError("");
    try {
      const current: State = await (
        await api("permissions/emergency-stop")
      ).json();
      const next = await (
        await api("permissions/emergency-stop", {
          method: "POST",
          body: JSON.stringify({
            active,
            revision: active ? current.revision : (state?.revision ?? null),
            reason: active
              ? "Owner activated emergency stop from Nexus."
              : "Owner explicitly cleared emergency stop; no work resumes automatically.",
          }),
        })
      ).json();
      setState(next);
      window.dispatchEvent(new Event("ary:emergency-changed"));
      if (active) window.dispatchEvent(new Event("ary:emergency-stop"));
      dialog.current?.close();
    } catch (e) {
      setError((e as Error).message);
      dialog.current?.showModal();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className={styles.stop}
        data-active={state?.active}
        disabled={busy}
        onClick={() =>
          state?.active ? dialog.current?.showModal() : void change(true)
        }
        aria-label={state?.active ? "Emergency stop active" : "Emergency stop"}
      >
        {busy
          ? "Updating safety state…"
          : state?.active
            ? "Stopped · review"
            : "STOP CONTROL"}
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={headingId}
      >
        <h2 id={headingId}>
          {state?.active ? "New work is stopped" : "Emergency controls"}
        </h2>
        <p>
          New non-read actions are blocked. Cooperative running actions receive
          a cancellation request. Reads and owner recovery remain available.
        </p>
        <p>
          Already completed external actions cannot be undone here. Tools
          without cancellation support may finish; inspect Activity for their
          actual results.
        </p>
        <p>
          Clearing the stop does not resume plans or restore old approvals.
          Review and restart work explicitly.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button onClick={() => dialog.current?.close()}>Close</button>
          {state?.active && (
            <button disabled={busy} onClick={() => void change(false)}>
              Clear stop · keep work paused
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
