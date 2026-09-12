"use client";
import { useEffect, useRef, useState } from "react";
import {
  BrowserAudioCaptureProvider,
  frameMetadata,
} from "../../infrastructure/audio/browser-audio-capture";
import type { AudioCaptureSession } from "../../domain/audio-capture";

export default function MicTestPage() {
  const session = useRef<AudioCaptureSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [health, setHealth] = useState({
    state: "STOPPED",
    microphone_active: false,
    sample_rate_hz: 24000,
    channels: 1,
    frame_count: 0,
    duration: 0,
    last_frame_bytes: 0,
    error: "",
  });
  const started = useRef(0);
  useEffect(
    () => () => {
      void session.current?.stop();
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const id = setInterval(() => {
      const h = session.current?.health;
      setHealth((v) => ({
        ...v,
        ...(h
          ? {
              state: h.state,
              microphone_active: h.microphone_active,
              sample_rate_hz: h.sample_rate_hz,
              channels: h.channels,
              frame_count: h.frame_count,
            }
          : {}),
        duration: started.current ? Date.now() - started.current : v.duration,
      }));
    }, 100);
    return () => clearInterval(id);
  }, []);
  async function start() {
    if (session.current) return;
    started.current = Date.now();
    controller.current = new AbortController();
    setHealth((v) => ({
      ...v,
      state: "STARTING",
      error: "",
      frame_count: 0,
      duration: 0,
    }));
    try {
      const provider = new BrowserAudioCaptureProvider();
      session.current = await provider.start(
        { signal: controller.current.signal },
        (frame) => {
          const meta = frameMetadata(frame);
          setHealth((v) => ({ ...v, last_frame_bytes: meta.byte_length }));
        },
        (failure) =>
          setHealth((v) => ({ ...v, state: "FAILED", error: failure.message })),
      );
    } catch (error) {
      setHealth((v) => ({
        ...v,
        state: "FAILED",
        error: error instanceof Error ? error.message : "Capture failed",
      }));
    }
  }
  async function stop() {
    controller.current?.abort();
    await session.current?.stop();
    session.current = null;
    controller.current = null;
    setHealth((v) => ({ ...v, state: "STOPPED", microphone_active: false }));
  }
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "4rem",
        background: "#080b14",
        color: "#eef2ff",
        fontFamily: "system-ui",
      }}
    >
      <div
        style={{
          maxWidth: 680,
          margin: "0 auto",
          padding: "2rem",
          border: "1px solid #27304a",
          borderRadius: 24,
          background: "rgba(19,24,40,.9)",
        }}
      >
        <p style={{ color: "#8f9bb8", letterSpacing: ".12em", fontSize: 12 }}>
          ARY NEXUS · DEVELOPMENT DIAGNOSTIC
        </p>
        <h1>Physical microphone test</h1>
        <p style={{ color: "#aeb8d0" }}>
          Audio stays in memory. Nothing is uploaded, saved, logged, or sent to
          OpenAI.
        </p>
        <div style={{ display: "flex", gap: 12, margin: "2rem 0" }}>
          <button
            onClick={() => void start()}
            disabled={!!session.current}
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              border: 0,
              background: "#b9a7ff",
            }}
          >
            START MIC TEST
          </button>
          <button
            onClick={() => void stop()}
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              border: "1px solid #59637e",
              color: "#eef2ff",
              background: "transparent",
            }}
          >
            STOP MIC TEST
          </button>
        </div>
        <dl
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          {[
            ["State", health.state],
            ["Microphone active", String(health.microphone_active)],
            ["Actual sample rate", `${health.sample_rate_hz} Hz`],
            ["Channels", health.channels],
            ["Complete frames", health.frame_count],
            ["Frame duration", "20 ms"],
            ["Last frame", `${health.last_frame_bytes} bytes`],
            ["Test duration", `${Math.round(health.duration / 1000)} s`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt style={{ color: "#8f9bb8", fontSize: 12 }}>{k}</dt>
              <dd style={{ margin: "4px 0", fontSize: 18 }}>{v}</dd>
            </div>
          ))}
        </dl>
        {health.error && (
          <p style={{ color: "#ff9f9f" }}>Error: {health.error}</p>
        )}
      </div>
    </main>
  );
}
