"use client";
import { useEffect, useRef, useState } from "react";
import type { EffectsBridge } from "./effects/bridge";
import type { EffectsStatus } from "./effects/vgpu-renderer";
import styles from "./brain.module.css";

const descriptions: Record<EffectsStatus, string> = {
  loading: "Preparing GPU effects",
  active: "GPU effects active",
  low: "GPU effects using reduced quality to preserve responsiveness",
  unavailable: "GPU effects unavailable. Standard graph remains active.",
  off: "GPU effects off",
  "reduced-motion": "Static graph: reduced motion preference respected",
};
export function BrainEffects({
  bridge,
  knowledgeEvents = true,
}: {
  bridge: EffectsBridge;
  knowledgeEvents?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [preference, setPreference] = useState<"auto" | "off" | null>(null);
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [status, setStatus] = useState<EffectsStatus>("loading");
  useEffect(() => {
    try {
      setPreference(
        localStorage.getItem("ary.brain.effects.v1") === "off" ? "off" : "auto",
      );
    } catch {
      setPreference("auto");
    }
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReduced(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (preference === null || reduced === null) return;
    if (preference === "off") {
      setStatus("off");
      return;
    }
    if (reduced) {
      setStatus("reduced-motion");
      return;
    }
    if (!("gpu" in navigator)) {
      setStatus("unavailable");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    void import("./effects/vgpu-renderer")
      .then(async ({ createVgpuRenderer }) => {
        if (controller.signal.aborted || !canvas.current) return;
        await createVgpuRenderer(canvas.current, bridge, {
          signal: controller.signal,
          knowledgeEvents,
          onStatus(next) {
            if (!controller.signal.aborted) setStatus(next);
          },
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });
    return () => controller.abort();
  }, [bridge, preference, reduced, knowledgeEvents]);
  return (
    <>
      <canvas
        ref={canvas}
        className={styles.effectsCanvas}
        aria-hidden="true"
        data-effects={status}
      />
      <div className={styles.effectsControl}>
        <label>
          Effects{" "}
          <select
            aria-label="Brain visual effects"
            value={preference ?? "auto"}
            onChange={(e) => {
              const next = e.target.value === "off" ? "off" : "auto";
              setPreference(next);
              try {
                localStorage.setItem("ary.brain.effects.v1", next);
              } catch {
                /* Optional preference persistence. */
              }
            }}
          >
            <option value="auto">Auto</option>
            <option value="off">Off</option>
          </select>
        </label>
        <span
          role="status"
          title={descriptions[status]}
          aria-label={descriptions[status]}
        >
          {status === "active"
            ? "GPU"
            : status === "low"
              ? "GPU · low"
              : status === "loading"
                ? "Loading"
                : status === "off"
                  ? "Off"
                  : "Static"}
        </span>
      </div>
    </>
  );
}
