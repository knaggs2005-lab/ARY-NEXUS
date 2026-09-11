"use client";
import { useEffect, useState } from "react";
import styles from "./spatial.module.css";
export function SpatialHUD({
  mode,
  fps,
  p95,
  settled,
  tracking,
  gesture,
  confidence,
  latency,
  logs,
}: {
  mode: string;
  fps: number | null;
  p95: number | null;
  settled: boolean;
  tracking: string;
  gesture: string;
  confidence: number;
  latency: number;
  logs: string[];
}) {
  const [date, setDate] = useState<Date | null>(null);
  useEffect(() => {
    setDate(new Date());
    const timer = setInterval(() => setDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className={styles.hud}>
      <div className={styles.hudLeft}>
        <span>
          <i /> SYSTEM ONLINE
        </span>
        <small>
          {mode} ·{" "}
          {fps === null ? "FPS awaiting motion" : `${fps} FPS / ${p95} ms p95`}
        </small>
        <small>
          {settled ? "SETTLED · render loop asleep" : "FOCUS SEQUENCE ACTIVE"}
        </small>
        <small>
          Tracking: {tracking}
          {latency ? ` · ${latency} ms` : ""}
        </small>
      </div>
      <div className={styles.hudRight}>
        <time>
          {date?.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }) ?? "—:—"}
        </time>
        <small>
          {date?.toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          }) ?? ""}
        </small>
      </div>
      <div className={styles.hudLog} aria-label="Spatial navigation log">
        {logs.slice(-3).map((log, i) => (
          <small key={`${log}:${i}`}>{log}</small>
        ))}
      </div>
      <div className={styles.hudGesture}>
        <small>{gesture.replaceAll("_", " ").toUpperCase()}</small>
        <small>
          {Math.round(confidence * 100)}% heuristic confidence · navigation only
        </small>
      </div>
    </div>
  );
}
