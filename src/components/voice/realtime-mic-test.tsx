"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { BrowserAudioCaptureProvider } from "../../infrastructure/audio/browser-audio-capture";
import {
  RealtimeMicRelayClient,
  type MicRelayHealth,
} from "./realtime-mic-relay-client";

export function RealtimeMicTest() {
  const client = useRef<RealtimeMicRelayClient | null>(null);
  const [health, setHealth] = useState<MicRelayHealth | null>(null);
  const [conversation, setConversation] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const refresh = setInterval(() => {
      if (client.current) setHealth(client.current.snapshot());
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
  async function start() {
    if (
      client.current &&
      ["STARTING", "CAPTURING", "STOPPING"].includes(
        client.current.snapshot().client_capture_state,
      )
    )
      return;
    const next = new RealtimeMicRelayClient(
      new BrowserAudioCaptureProvider(),
      api,
    );
    client.current = next;
    const starting = next.start(conversation);
    setHealth(next.snapshot());
    await starting;
    setHealth(next.snapshot());
  }
  const busy =
    health &&
    ["STARTING", "CAPTURING", "STOPPING"].includes(health.client_capture_state);
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
        Start, allow microphone access, and wait for CAPTURING / ACTIVE. Say
        “Hey Ary, can you hear me?”, then pause until both speech indicators are
        true and click Stop. No assistant audio will play.
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
          disabled={!busy}
          style={{ padding: 12 }}
        >
          STOP REALTIME MIC TEST
        </button>
      </div>
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
        Buffer limit: 15 frames / 300 ms including the request in flight. Slow
        delivery fails the test and stops capture. If offline or the page is
        terminated, remote closure may be unconfirmed; the server expires
        abandoned sessions after five minutes.
      </p>
    </section>
  );
}
