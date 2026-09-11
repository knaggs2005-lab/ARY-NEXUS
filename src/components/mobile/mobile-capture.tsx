"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LocationFix } from "../../domain/mobile";
import { BrowserLocationInput } from "./location";
import { api } from "../api";
import styles from "./mobile.module.css";
const Camera = dynamic(() =>
  import("../perception/perception-panel").then((m) => m.PerceptionPanel),
);
export function MobileCapture() {
  const [text, setText] = useState(""),
    [location, setLocation] = useState<LocationFix | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false);
  const key = useRef<string | null>(null),
    active = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const stop = () => {
      if (document.hidden) {
        abort.current?.abort();
        setLocation(null);
        key.current = null;
      }
    };
    document.addEventListener("visibilitychange", stop);
    return () => {
      abort.current?.abort();
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);
  async function work(fn: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="Mobile quick capture">
      <p className={styles.eyebrow}>CATCH THE MOMENT</p>
      <h1>Keep what matters.</h1>
      <p>A thought, a detail, a place. Review it before it becomes memory.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void work(async () => {
            if (
              location &&
              Date.now() - Date.parse(location.observed_at) > 300000
            )
              throw Error("Location expired. Remove it or capture again.");
            key.current ??= crypto.randomUUID();
            const content =
              text.trim() +
              (location
                ? `\nUser-selected approximate location: ${location.latitude}, ${location.longitude}; accuracy at least ${location.accuracy_m} m; observed ${location.observed_at}. Not a verified place or ongoing location.`
                : "");
            const r = await (
              await api("actions/request", {
                method: "POST",
                body: JSON.stringify({
                  tool: "memory.capture",
                  input: {
                    class: "EPISODIC",
                    content,
                    summary: text.slice(0, 120),
                  },
                  request_key: key.current,
                  reason:
                    "Owner reviewed this mobile quick capture and any explicitly selected coarse location",
                }),
              })
            ).json();
            setText("");
            setLocation(null);
            key.current = null;
            setNotice(`Captured in Ary memory · ${r.result.memory_id}`);
          });
        }}
      >
        <label>
          Quick capture
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              key.current = null;
            }}
            maxLength={4000}
            required
            rows={5}
            placeholder="The detail you don’t want to lose…"
            disabled={busy}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void work(async () => {
              abort.current = new AbortController();
              setLocation(
                await new BrowserLocationInput().locate(abort.current.signal),
              );
              key.current = null;
            })
          }
        >
          Add approximate location
        </button>
        {location && (
          <div className={styles.row}>
            <strong>Location preview</strong>
            <p>
              {location.latitude}, {location.longitude} · at least{" "}
              {location.accuracy_m} m uncertainty. Sent only if you approve this
              capture.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLocation(null);
                key.current = null;
              }}
            >
              Remove location
            </button>
          </div>
        )}
        <button className={styles.primary} disabled={busy || !text.trim()}>
          Review & save capture
        </button>
      </form>
      <p className={styles.fine}>
        Location is optional, approximate and one-shot. No background tracking.
        Unsaved notes stay only in this screen and are lost if you leave it.
      </p>
      <button onClick={() => setCamera((v) => !v)}>
        {camera ? "Close camera input" : "Camera or image input"}
      </button>
      {camera && <Camera mobile />}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
