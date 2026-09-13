"use client";
import { LiveVoiceActivator } from "./live-voice-activator";
import { useEffect, useRef, useState } from "react";
import { createHeyAryRuntime } from "./hey-ary-runtime";
import { api } from "../api";
import { BrowserAudioCaptureProvider } from "../../infrastructure/audio/browser-audio-capture";
import { LocalWakeWordProvider } from "../../infrastructure/wake/local-wake-word";
import { LocalSpeakerVerificationProvider } from "../../infrastructure/speaker/local-speaker-provider";
import { OwnerVoiceGate } from "../../services/owner-voice-gate";
import {
  EncryptedSpeakerTemplateStore,
  IndexedDbSpeakerRecords,
} from "../../infrastructure/speaker/local-template-store";
export function HeyAryTest() {
  const runtime = useRef<ReturnType<typeof createHeyAryRuntime> | undefined>(
    undefined,
  );
  const [state, setState] = useState("WAKE_MODEL_OWNER_SETUP_REQUIRED");
  const [conversation, setConversation] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const stop = () => {
      void runtime.current?.stop();
    };
    window.addEventListener("pagehide", stop);
    window.addEventListener("offline", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("offline", stop);
      stop();
    };
  }, []);
  async function start() {
    if (busy || !consent || !conversation.trim()) return;
    setBusy(true);
    try {
      await runtime.current?.stop();
      const response = await api("realtime/local-config");
      if (!response.ok) throw new Error("AUTH_REQUIRED");
      const config = await response.json();
      const capture = new BrowserAudioCaptureProvider();
      runtime.current = createHeyAryRuntime({
        enabled: config.wake_enabled === true,
        activator:
          config.voice_mode === "live"
            ? new LiveVoiceActivator(setState)
            : undefined,
        conversationId: conversation,
        capture,
        wakeProvider: new LocalWakeWordProvider(capture),
        request: api,
        changed: setState,
        ownerGate: config.owner_voice_enabled
          ? new OwnerVoiceGate(
              true,
              new LocalSpeakerVerificationProvider(),
              new EncryptedSpeakerTemplateStore(
                config.owner_id,
                new IndexedDbSpeakerRecords(),
              ),
            )
          : undefined,
      });
      await runtime.current.start();
    } catch {
      setState(
        "VOICE_SETUP_FAILED — explicit classic fallback is available in Chat",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Unified Hey Ary acceptance">
      <h2>Hey Ary session acceptance</h2>
      <p>
        Not ready: the licensed Hey Ary model and inference runtime are not
        installed. This gate stays closed. No microphone or cloud session starts
        without a working local wake provider and explicit Start.
      </p>
      <p>
        When configured: sleeping audio stays local; wake verification stays
        local; after an accepted wake, speech goes to OpenAI and final
        transcripts enter existing Ary memory. Voice never approves actions.
      </p>
      <label>
        Existing conversation ID{" "}
        <input
          value={conversation}
          onChange={(e) => setConversation(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I am present and authorize the wake/session test described above.
      </label>
      <button
        disabled={busy || !consent || !conversation.trim()}
        onClick={() => void start()}
      >
        Start Hey Ary — validate setup gates
      </button>
      <button onClick={() => void runtime.current?.stop()}>
        Stop all Hey Ary listening
      </button>
      <p role="status">{state}</p>
      <a href="/">Return to Nexus for explicit classic voice fallback</a>
    </section>
  );
}
