"use client";
import { HeyAryTest } from "./hey-ary-test";
import { OwnerVoiceEnrollment } from "./owner-voice-enrollment";
import { useState } from "react";
import { loadWakeAssets } from "../../infrastructure/wake/local-wake-word";
export function LocalVoiceSetup({ wakeEnabled }: { wakeEnabled: boolean }) {
  const [status, setStatus] = useState("WAKE_MODEL_OWNER_SETUP_REQUIRED");
  return (
    <section style={{ marginTop: 32 }} aria-label="Local voice setup">
      <h2>Local Hey Ary setup</h2>
      <p>
        Wake enabled: {String(wakeEnabled)}. No microphone starts on this page.
        Sleeping audio must stay on this device.
      </p>
      <p>
        Selected engine: openWakeWord ONNX. A licensed custom Hey Ary model and
        packaged inference adapter are required. No production recognition is
        claimed.
      </p>
      <p>
        Fixed local model location: public/models/ary-wake/manifest.json with
        melspectrogram.onnx, embedding_model.onnx and hey_ary.onnx plus SHA-256
        hashes.
      </p>
      <button
        onClick={() =>
          void loadWakeAssets()
            .then(() =>
              setStatus("MODEL_ASSETS_VALID — ENGINE_PACKAGING_REQUIRED"),
            )
            .catch(() => setStatus("WAKE_MODEL_OWNER_SETUP_REQUIRED"))
        }
      >
        Check local wake assets — no microphone
      </button>
      <p role="status">{status}</p>
      <button disabled>
        Start local wake test — model/runtime setup required
      </button>
      <OwnerVoiceEnrollment />
      <HeyAryTest />
    </section>
  );
}
