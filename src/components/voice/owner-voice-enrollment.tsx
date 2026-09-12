"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { OwnerVoiceGate } from "../../services/owner-voice-gate";
import { LocalSpeakerVerificationProvider } from "../../infrastructure/speaker/local-speaker-provider";
import {
  EncryptedSpeakerTemplateStore,
  IndexedDbSpeakerRecords,
} from "../../infrastructure/speaker/local-template-store";
import type { SpeakerVerificationProvider } from "../../domain/owner-voice";
import { BrowserAudioCaptureProvider } from "../../infrastructure/audio/browser-audio-capture";
import { resampleMono } from "../../domain/audio-capture";
export function OwnerVoiceEnrollment({
  provider = new LocalSpeakerVerificationProvider(),
}: {
  provider?: SpeakerVerificationProvider;
}) {
  const [gate, setGate] = useState<OwnerVoiceGate>();
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("OWNER_VOICE_ENROLLMENT_REQUIRED");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load() {
    try {
      const config = await (await api("realtime/local-config")).json();
      setGate(
        new OwnerVoiceGate(
          true,
          provider,
          new EncryptedSpeakerTemplateStore(
            config.owner_id,
            new IndexedDbSpeakerRecords(),
          ),
        ),
      );
      setStatus(
        provider.available()
          ? "READY_FOR_EXPLICIT_ENROLLMENT"
          : "SPEAKER_MODEL_SETUP_REQUIRED",
      );
    } catch {
      setStatus("SIGN_IN_REQUIRED");
    }
  }
  async function sample() {
    const abort = new AbortController();
    active.current = abort;
    const data = new Float32Array(48000);
    let at = 0,
      session:
        Awaited<ReturnType<BrowserAudioCaptureProvider["start"]>> | undefined;
    let resolve!: () => void, reject!: (error: Error) => void;
    const finished = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const timer = setTimeout(() => {
      abort.abort();
      reject(new Error("LOCAL_SAMPLE_TIMEOUT"));
    }, 8000);
    abort.signal.addEventListener(
      "abort",
      () => reject(new Error("LOCAL_SAMPLE_CANCELLED")),
      { once: true },
    );
    try {
      session = await new BrowserAudioCaptureProvider().start(
        { signal: abort.signal },
        (frame) => {
          const bytes =
              frame.data instanceof Uint8Array
                ? frame.data
                : new Uint8Array(frame.data),
            view = new DataView(
              bytes.buffer,
              bytes.byteOffset,
              bytes.byteLength,
            ),
            pcm = new Float32Array(bytes.length / 2);
          for (let i = 0; i < pcm.length; i++)
            pcm[i] = view.getInt16(i * 2, true) / 32768;
          const samples = resampleMono(pcm, 24000, 16000);
          data.set(
            samples.subarray(0, Math.min(samples.length, data.length - at)),
            at,
          );
          at = Math.min(data.length, at + samples.length);
          if (at === data.length) resolve();
        },
        () => reject(new Error("LOCAL_SAMPLE_FAILED")),
      );
      await finished;
      return data;
    } catch (error) {
      data.fill(0);
      throw error;
    } finally {
      clearTimeout(timer);
      abort.abort();
      await session?.stop();
      active.current = null;
    }
  }
  async function run(enroll: boolean) {
    if (!gate || !consent || !provider.available()) return;
    setBusy(true);
    setStatus("CAPTURING_LOCAL_ONLY — speak for three seconds");
    try {
      const samples = await sample();
      if (enroll) {
        await gate.enroll(samples, { explicit: consent, owner_present: true });
        setStatus("ENROLLED_LOCAL_ENCRYPTED_TEMPLATE");
      } else {
        const decision = await gate.verify(samples);
        setStatus(
          `${decision.decision}: ${decision.reason}; does not authorize actions`,
        );
      }
    } catch {
      setStatus("OWNER_VOICE_TEST_FAILED");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Owner voice enrollment" style={{ marginTop: 32 }}>
      <h2>Owner Voice Gate</h2>
      <p>
        Optional convenience verification. It never approves actions. Enrollment
        creates a local encrypted biometric template, separate from Ary memory.
        No voice or template is uploaded. A licensed, calibrated local model
        must be installed first.
      </p>
      <button disabled={busy} onClick={() => void load()}>
        Load local owner voice controls
      </button>
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        I am present and consent to local voice-template
        enrollment/verification.
      </label>
      <button
        disabled={busy || !gate || !consent || !provider.available()}
        onClick={() => void run(true)}
      >
        Enroll / re-enroll owner voice
      </button>
      <button
        disabled={busy || !gate || !consent || !provider.available()}
        onClick={() => void run(false)}
      >
        Verify owner voice locally
      </button>
      <button disabled={!busy} onClick={() => active.current?.abort()}>
        Stop local sample
      </button>
      <button
        disabled={busy || !gate}
        onClick={() =>
          void gate
            ?.deleteEnrollment()
            .then(() => setStatus("LOCAL_TEMPLATE_DELETED"))
            .catch(() => setStatus("LOCAL_DELETE_FAILED"))
        }
      >
        Delete local voice template
      </button>
      <p role="status">{status}</p>
    </section>
  );
}
