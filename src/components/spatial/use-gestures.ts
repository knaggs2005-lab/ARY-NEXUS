"use client";
import { useEffect, useRef, useState } from "react";
import { GestureEngine, type GestureFrame } from "./gesture-engine";
import { modules } from "./modules";
import type { SpatialEvent } from "./interaction-state";
import type { HandTrackingSession } from "./hand-tracking";
export function useGestures(
  dispatch: (event: SpatialEvent) => void,
  expanded: boolean,
  fps: number,
) {
  const [enabled, setEnabled] = useState(false),
    [status, setStatus] = useState("off"),
    [frame, setFrame] = useState<GestureFrame | null>(null),
    [latency, setLatency] = useState(0),
    [target, setTarget] = useState<string | null>(null);
  const sessionRef = useRef<HandTrackingSession | null>(null);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  useEffect(() => {
    sessionRef.current?.setFps(fps);
  }, [fps]);
  const callback = useRef(dispatch);
  callback.current = dispatch;
  const active = useRef(expanded);
  active.current = expanded;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let session: HandTrackingSession | undefined;
    const engine = new GestureEngine();
    let origin: { x: number; y: number } | null = null;
    void import("./hand-tracking")
      .then(({ HandTrackingSession }) => {
        if (cancelled) return;
        session = new HandTrackingSession(setStatus, (points, ms) => {
          if (cancelled) return;
          const next = engine.update(points, performance.now());
          setFrame(next);
          setLatency(Math.round(ms));
          const hit =
            next.tracked && !active.current
              ? document
                  .elementFromPoint(
                    next.cursor.x * innerWidth,
                    next.cursor.y * innerHeight,
                  )
                  ?.closest<HTMLButtonElement>("button[data-module]")
              : null;
          const targetIndex = modules.findIndex(
            (m) =>
              m.id === hit?.dataset.module && !hit?.disabled && !hit?.inert,
          );
          setTarget(targetIndex >= 0 ? modules[targetIndex].name : null);
          // An expanded application receives no gesture clicks, approvals or actions.
          if (active.current) {
            origin = null;
            if (next.gesture === "push") callback.current({ type: "return" });
            return;
          }
          if (next.gesture === "swipe_left")
            callback.current({ type: "rotate", direction: -1 });
          if (next.gesture === "swipe_right")
            callback.current({ type: "rotate", direction: 1 });
          if (next.gesture === "pinch") {
            // A missed pinch does nothing. Never focus whatever happened to be selected.
            origin = targetIndex >= 0 ? next.cursor : null;
            if (targetIndex >= 0)
              callback.current({ type: "select", index: targetIndex });
          }
          if (next.pinched && origin)
            callback.current({
              type: "drag",
              x: (next.cursor.x - origin.x) * 600,
              y: (next.cursor.y - origin.y) * 400,
            });
          if (next.gesture === "release") {
            origin = null;
            callback.current({ type: "release" });
          }
          if (next.gesture === "pull" && origin) {
            origin = null;
            callback.current({ type: "expand" });
          }
          if (next.gesture === "push") callback.current({ type: "return" });
          callback.current({
            type: "freeze",
            value: next.gesture === "steady_palm",
          });
        });
        sessionRef.current = session;
        void session.start(fpsRef.current);
      })
      .catch(() => setStatus("Tracking unavailable"));
    const hide = () => {
      if (document.hidden) setEnabled(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelled = true;
      session?.stop();
      sessionRef.current = null;
      setTarget(null);
      setStatus("off");
      setFrame(null);
      setLatency(0);
      callback.current({ type: "release" });
      callback.current({ type: "freeze", value: false });
      document.removeEventListener("visibilitychange", hide);
    };
  }, [enabled]);
  return { enabled, setEnabled, status, frame, latency, target };
}
