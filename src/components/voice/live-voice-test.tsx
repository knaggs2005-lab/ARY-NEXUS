"use client";
import { useEffect, useRef, useState } from "react";
import { liveTiming } from "./live-timing";
import { api } from "../api";
import { LiveVoiceClient, type LiveMetric } from "./live-voice-client";
export function LiveVoiceTest() {
  const [server, setServer] = useState<unknown>(null);
  const client = useRef<LiveVoiceClient | null>(null);
  const [mode, setMode] = useState("legacy"),
    [ids, setIds] = useState<string[]>([]),
    [conversation, setConversation] = useState("");
  const [state, setState] = useState("Not started"),
    [metrics, setMetrics] = useState<LiveMetric[]>([]),
    [text, setText] = useState("");
  useEffect(() => () => client.current?.dispose(), []);
  async function load() {
    try {
      const config = await (await api("live/config")).json();
      setMode(config.mode);
      const values = await (await api("conversations")).json();
      setIds(values.map((v: { id: string }) => v.id));
    } catch {
      setState("Sign in to Nexus first");
    }
  }
  function start() {
    client.current?.dispose();
    setText("");
    client.current = new LiveVoiceClient(
      (s, m) => {
        setState(s);
        setMetrics(m);
      },
      (role, t) => setText((old) => (old + `\n${role}: ${t}`).slice(-12000)),
      setServer,
    );
    void client.current.start(conversation);
  }
  return (
    <section className="panel" style={{ margin: 24, padding: 24 }}>
      <h2>GPT-Live · experimental A/B</h2>
      <p>
        Direct WebRTC conversation with Nexus delegation. Start sends microphone
        audio to OpenAI. Legacy remains available below. Timing is
        browser-observed, not physical-speaker acceptance.
      </p>
      <button onClick={() => void load()}>
        Load existing conversations / mode
      </button>
      <p>Configured mode: {mode}</p>
      <select
        aria-label="Live conversation"
        value={conversation}
        onChange={(e) => setConversation(e.target.value)}
      >
        <option value="">Choose conversation</option>
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <button
        disabled={
          mode !== "live" ||
          !conversation ||
          state === "Connected" ||
          state === "Connecting"
        }
        onClick={start}
      >
        Start GPT-Live microphone
      </button>
      <button onClick={() => client.current?.interrupt()}>Interrupt</button>
      <button onClick={() => client.current?.stop()}>Stop Live</button>
      <p role="status">{state}</p>
      <pre style={{ whiteSpace: "pre-wrap" }}>{text}</pre>
      <pre>{JSON.stringify(liveTiming(metrics), null, 2)}</pre>
      <details>
        <summary>Server delegation and tool timing</summary>
        <pre>{JSON.stringify(server, null, 2)}</pre>
      </details>
      <details>
        <summary>Bounded timing events ({metrics.length})</summary>
        <pre>{JSON.stringify(metrics, null, 2)}</pre>
      </details>
    </section>
  );
}
