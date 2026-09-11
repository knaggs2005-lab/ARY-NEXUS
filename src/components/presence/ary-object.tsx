"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { type PresenceEvent } from "../../domain/presence";
import { type VoiceState } from "../voice/voice-state";
import { usePresence } from "./store";
import { appearance } from "./appearance";
import styles from "./presence.module.css";
const voiceEvents: Partial<Record<VoiceState, PresenceEvent>> = {
  listening: {
    operation: "voice",
    state: "listening",
    label: "Listening · microphone on",
  },
  speaking: { operation: "voice", state: "speaking", label: "Speaking" },
  transcribing: {
    operation: "voice",
    state: "understanding",
    label: "Transcribing speech",
  },
  requesting: {
    operation: "voice",
    state: "waiting",
    label: "Microphone permission",
  },
  buffering: {
    operation: "voice",
    state: "waiting",
    label: "Preparing speech",
  },
  review: {
    operation: "voice",
    state: "waiting",
    label: "Transcript ready to review",
  },
  interrupted: { operation: "voice", state: "waiting", label: "Interrupted" },
  error: { operation: "voice", state: "error", label: "Needs attention" },
};
export function AryObject({
  state,
  level,
  label,
  stage = false,
  approvalCount = 0,
}: {
  state: VoiceState;
  level?: RefObject<number>;
  label?: string;
  stage?: boolean;
  approvalCount?: number;
}) {
  const activity = usePresence();
  const voice = voiceEvents[state];
  const event =
    voice ??
    (activity.state !== "idle"
      ? activity
      : approvalCount > 0
        ? {
            operation: "queue",
            state: "approval" as const,
            label: `${approvalCount} action${approvalCount === 1 ? "" : "s"} awaiting approval`,
          }
        : activity);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state: event.state, energy: 0 });
  latest.current.state = event.state;
  const renderer = useRef<{ dispose(): void; update(): void } | undefined>(
    undefined,
  );
  const [gpu, setGpu] = useState("static");
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)"),
      forced = matchMedia("(forced-colors: active)");
    const update = () => setMotion(!media.matches && !forced.matches);
    update();
    media.addEventListener("change", update);
    forced.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      forced.removeEventListener("change", update);
    };
  }, []);
  useEffect(() => {
    if (
      !stage ||
      !motion ||
      !("gpu" in navigator) ||
      navigator.hardwareConcurrency <= 2 ||
      !canvas.current
    ) {
      setGpu("static");
      return;
    }
    const abort = new AbortController();
    void import("./renderer")
      .then(({ createPresenceRenderer }) =>
        createPresenceRenderer(
          canvas.current!,
          () => ({
            state: latest.current.state,
            energy:
              latest.current.state === "listening" ? (level?.current ?? 0) : 0,
          }),
          abort.signal,
          () => setGpu("static"),
        ),
      )
      .then((value) => {
        if (abort.signal.aborted) {
          value?.dispose();
          return;
        }
        renderer.current = value;
        setGpu(value ? "active" : "static");
      })
      .catch(() => {
        if (!abort.signal.aborted) setGpu("static");
      });
    return () => {
      abort.abort();
      renderer.current?.dispose();
      renderer.current = undefined;
    };
  }, [stage, motion, level]);
  useEffect(() => {
    renderer.current?.update();
  }, [event.state]);
  const shape = appearance(event.state);
  return (
    <div
      className={`${styles.presence} ${stage ? styles.stage : ""}`}
      data-ary-presence={event.state}
    >
      <div
        className={styles.object}
        data-state={event.state}
        data-gpu={gpu}
        aria-hidden="true"
      >
        <svg viewBox="0 0 320 120" preserveAspectRatio="none">
          {Array.from({ length: 8 }, (_, i) => (
            <path
              key={i}
              d={`M 28 60 C 80 ${28 + i * 3 - shape.fold * 8}, 116 ${95 - i * 4}, 160 60 S 245 ${25 + i * 6}, 292 60`}
            />
          ))}
        </svg>
        {stage && <canvas ref={canvas} aria-hidden="true" />}
      </div>
      <span
        className={styles.label}
        role="status"
        aria-live="polite"
        title={event.label}
      >
        {activity.state === "idle" && label ? label : event.label}
      </span>
    </div>
  );
}
