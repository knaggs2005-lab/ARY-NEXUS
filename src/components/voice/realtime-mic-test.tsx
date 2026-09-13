"use client";
import { useEffect, useRef, useState } from "react";
import type {
  AudioCaptureFrame,
  AudioCaptureProvider,
} from "../../domain/audio-capture";
import {
  diagnoseRealtimeHttp,
  type RealtimeHttpDiagnostic,
} from "./realtime-http-diagnostic";
import { RealtimePlayback } from "./realtime-playback";
import { RealtimeOutputClient } from "./realtime-output-client";
import { api } from "../api";
import { BrowserAudioCaptureProvider } from "../../infrastructure/audio/browser-audio-capture";
import {
  RealtimeMicRelayClient,
  type MicRelayHealth,
} from "./realtime-mic-relay-client";

export function RealtimeMicTest() {
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmark, setBenchmark] = useState<RealtimeHttpDiagnostic>();
  const client = useRef<RealtimeMicRelayClient | null>(null);
  const playbackRef = useRef<RealtimePlayback | null>(null);
  const [playbackHealth, setPlaybackHealth] =
    useState<ReturnType<RealtimePlayback["snapshot"]>>();
  const [health, setHealth] = useState<MicRelayHealth | null>(null);
  const [conversation, setConversation] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("Not started");
  useEffect(() => {
    const refresh = setInterval(() => {
      if (client.current) setHealth(client.current.snapshot());
      if (playbackRef.current)
        setPlaybackHealth(playbackRef.current.snapshot());
    }, 100);
    const unload = () => client.current?.unload();
    const offline = () => client.current?.offline();
    window.addEventListener("pagehide", unload);
    window.addEventListener("offline", offline);
    return () => {
      clearInterval(refresh);
      window.removeEventListener("pagehide", unload);
      window.removeEventListener("offline", offline);
      client.current?.unload();
    };
  }, []);
  async function loadConversations() {
    try {
      const result = await (await api("conversations")).json();
      const values = (result as { id: string }[]).map((item) => item.id);
      setIds(values);
      setNotice(
        values.length
          ? "Choose an existing conversation. No conversation will be created."
          : "No conversations available. Return to Nexus to create one first.",
      );
    } catch {
      setNotice(
        "Sign in on the Nexus home page, then load existing conversations again.",
      );
    }
  }
  async function start(synthetic = false, withPlayback = false) {
    if (
      client.current &&
      ["STARTING", "CAPTURING", "STOPPING"].includes(
        client.current.snapshot().client_capture_state,
      )
    )
      return;
    let emit: ((frame: AudioCaptureFrame) => void) | undefined;
    const syntheticProvider: AudioCaptureProvider = {
      start: async (_config, onFrame) => {
        emit = onFrame;
        return {
          health: {
            state: "CAPTURING",
            microphone_active: false,
            sample_rate_hz: 24000,
            channels: 1,
            frame_count: 0,
          },
          pause() {},
          resume() {},
          async stop() {},
        };
      },
    };
    setSource(
      synthetic
        ? "SYNTHETIC SILENCE — microphone not opened"
        : "OWNER MICROPHONE",
    );
    const playback = withPlayback ? new RealtimePlayback() : undefined;
    if (playback) {
      try {
        await playback.start();
      } catch {
        setNotice("Playback unavailable. Check audio permission.");
        return;
      }
    }
    playbackRef.current = playback ?? null;
    const output = playback
      ? new RealtimeOutputClient(
          api,
          playback,
          (code) => client.current?.fail(code),
          (event) => {
            if (event.type === "closed")
              void client.current?.remoteEnd(event.failure_code);
          },
        )
      : undefined;
    const next = new RealtimeMicRelayClient(
      synthetic ? syntheticProvider : new BrowserAudioCaptureProvider(),
      api,
      output,
    );
    client.current = next;
    const starting = next.start(conversation, withPlayback);
    setHealth(next.snapshot());
    await starting;
    if (synthetic && emit) {
      for (let i = 0; i < 15; i++)
        emit({
          encoding: "pcm16",
          sample_rate_hz: 24000,
          channels: 1,
          frame_index: i,
          data: new Uint8Array(960),
        });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await next.stop();
    }
    setHealth(next.snapshot());
  }
  const busy =
    benchmarking ||
    (health &&
      ["STARTING", "CAPTURING", "STOPPING"].includes(
        health.client_capture_state,
      ));
  return (
    <section
      style={{ borderTop: "1px solid #27304a", marginTop: 32, paddingTop: 24 }}
    >
      <h2>Realtime microphone acceptance</h2>
      <p>
        During this test, microphone audio is sent to OpenAI Realtime through
        the authenticated local Nexus server relay. Audio is not stored by
        Nexus.
      </p>
      <p>
        For a spoken answer, use START ARY BRAIN VOICE + PLAYBACK. Say “Ary, can
        you hear me? Answer briefly.” and wait for her response before stopping.
        START REALTIME MIC TEST checks input only and plays no answer.
      </p>
      <button onClick={() => void loadConversations()} disabled={!!busy}>
        Load existing conversations
      </button>
      {notice && <p role="status">{notice}</p>}
      <label style={{ display: "block", marginTop: 16 }}>
        Existing Nexus conversation ID
        <input
          aria-label="Existing Nexus conversation ID"
          list="realtime-conversations"
          value={conversation}
          onChange={(e) => setConversation(e.target.value)}
          disabled={!!busy}
          style={{
            display: "block",
            width: "100%",
            padding: 10,
            marginTop: 8,
            color: "#eef2ff",
            background: "#080b14",
            border: "1px solid #59637e",
          }}
        />
      </label>
      <datalist id="realtime-conversations">
        {ids.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      <div
        style={{ display: "flex", gap: 12, margin: "20px 0", flexWrap: "wrap" }}
      >
        <button
          onClick={() => void start()}
          disabled={!!busy || !conversation}
          style={{ padding: 12 }}
        >
          START REALTIME MIC TEST
        </button>
        <button
          onClick={() => void client.current?.stop()}
          disabled={!busy || benchmarking}
          style={{ padding: 12 }}
        >
          STOP REALTIME MIC TEST
        </button>
      </div>
      <button
        onClick={() => void start(true)}
        disabled={!!busy || !conversation}
      >
        CHECK RELAY — SYNTHETIC ONLY
      </button>
      <button
        onClick={() => void start(false, true)}
        disabled={!!busy || !conversation}
      >
        START ARY BRAIN VOICE + PLAYBACK
      </button>
      <p>
        Playback test uses your speakers and sends microphone audio to OpenAI.
        Start only when present. Stop ends both paths.
      </p>
      <button
        disabled={!!busy || !conversation}
        onClick={async () => {
          setBenchmarking(true);
          try {
            setBenchmark(await diagnoseRealtimeHttp(api, conversation));
          } finally {
            setBenchmarking(false);
          }
        }}
      >
        BENCHMARK HTTP — SYNTHETIC ONLY
      </button>
      <p>
        HTTP benchmark: 30 silence batches with concurrent status polling and
        output streaming. No microphone, Brain, STT, or TTS calls.
      </p>
      {benchmarking && (
        <p role="status">Measuring actual HTTP batch latency…</p>
      )}
      {benchmark && (
        <pre aria-label="HTTP relay benchmark">
          {JSON.stringify(benchmark, null, 2)}
        </pre>
      )}
      <p role="status">Test source: {source}</p>
      {playbackHealth && (
        <pre aria-label="Bounded playback metrics">
          {JSON.stringify(playbackHealth, null, 2)}
        </pre>
      )}
      {health && (
        <dl
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
        >
          {Object.entries(health).map(([key, value]) => (
            <div key={key}>
              <dt style={{ color: "#aeb8d0", fontSize: 12 }}>{key}</dt>
              <dd style={{ margin: "4px 0" }}>{String(value ?? "none")}</dd>
            </div>
          ))}
        </dl>
      )}
      <p style={{ fontSize: 12, color: "#aeb8d0" }}>
        Batches: 15 frames / 300 ms. Buffer limit: 30 frames / 600 ms including
        the request in flight. Slow delivery fails the test and stops capture.
        If offline or the page is terminated, remote closure may be unconfirmed;
        the server expires abandoned sessions after five minutes.
      </p>
    </section>
  );
}
