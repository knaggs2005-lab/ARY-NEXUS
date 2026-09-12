import { z } from "zod";
import type {
  AudioCaptureProvider,
  AudioCaptureSession,
} from "../../domain/audio-capture";
import { resampleMono, float32ToPcm16 } from "../../domain/audio-capture";
import type {
  WakeWordProvider,
  WakeWordConfig,
  WakeWordSession,
  WakeWordEvent,
  WakeWordState,
} from "../../domain/wake-word";
const asset = z
  .object({
    file: z.enum([
      "melspectrogram.onnx",
      "embedding_model.onnx",
      "hey_ary.onnx",
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const wakeManifest = z
  .object({
    version: z.literal(1),
    engine: z.literal("openwakeword-onnx"),
    phrase: z.literal("HEY_ARY"),
    model_version: z.string().min(1).max(80),
    license: z.string().min(1).max(200),
    assets: z.array(asset).length(3),
  })
  .strict();
export type WakeAssets = {
  manifest: z.infer<typeof wakeManifest>;
  models: Map<string, Uint8Array>;
};
/** Exact same-origin model path; never accepts remote URLs or runtime code from a manifest. */
export async function loadWakeAssets(
  fetcher: typeof fetch = fetch,
): Promise<WakeAssets> {
  const response = await fetcher("/models/ary-wake/manifest.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("WAKE_MODEL_OWNER_SETUP_REQUIRED");
  const text = await response.text();
  if (text.length > 4096) throw new Error("INVALID_WAKE_MANIFEST");
  const manifest = wakeManifest.parse(JSON.parse(text));
  if (new Set(manifest.assets.map((a) => a.file)).size !== 3)
    throw new Error("INVALID_WAKE_MANIFEST");
  const models = new Map<string, Uint8Array>();
  for (const asset of manifest.assets) {
    const r = await fetcher(`/models/ary-wake/${asset.file}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok || !r.body) throw new Error("WAKE_MODEL_OWNER_SETUP_REQUIRED");
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 32 * 1024 * 1024) throw new Error("WAKE_MODEL_TOO_LARGE");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (digest !== asset.sha256) throw new Error("WAKE_MODEL_HASH_MISMATCH");
    models.set(asset.file, data);
  }
  return { manifest, models };
}
/** A real engine must implement all three official feature/classifier stages. No energy/STT substitute. */
export interface LocalAcousticWakeEngine {
  process(samples: Int16Array): Promise<number>;
  reset(): void;
  close(): Promise<void>;
}
export type WakeEngineFactory = (
  assets: WakeAssets,
) => Promise<LocalAcousticWakeEngine>;
export class LocalWakeWordProvider implements WakeWordProvider {
  readonly id = "openwakeword-local";
  readonly localOnly = true as const;
  constructor(
    private capture: AudioCaptureProvider,
    private assets = loadWakeAssets,
    private engineFactory?: WakeEngineFactory,
    private now = Date.now,
  ) {}
  async start(config: WakeWordConfig): Promise<WakeWordSession> {
    if (config.enabled !== true) throw new Error("WAKE_DISABLED");
    if (config.phrases.length !== 1 || config.phrases[0] !== "HEY_ARY")
      throw new Error("UNSUPPORTED_WAKE_PHRASE");
    if (!this.engineFactory) throw new Error("WAKE_MODEL_OWNER_SETUP_REQUIRED");
    const engine = await this.engineFactory(await this.assets());
    const listeners = new Set<(event: WakeWordEvent) => void>();
    let state: WakeWordState = "PAUSED",
      session: AudioCaptureSession | undefined,
      epoch = 0,
      pending = new Int16Array(0),
      busy = false,
      started = 0,
      last = -Infinity;
    let serial = Promise.resolve();
    let inference: Promise<void> | undefined;
    const ring = new Float32Array(config.verificationAudio ? 48000 : 0);
    let ringAt = 0,
      ringCount = 0;
    const clearRing = () => {
      ring.fill(0);
      ringAt = 0;
      ringCount = 0;
    };
    const id = crypto.randomUUID();
    const release = async () => {
      epoch++;
      pending.fill(0);
      pending = new Int16Array(0);
      const s = session;
      session = undefined;
      await s?.stop();
      await inference; // bounded inference finishes before reset/close of the same engine
    };
    const fail = () => {
      if (state === "STOPPED" || state === "FAILED") return;
      clearRing();
      state = "FAILED";
      void release();
      listeners.forEach((h) =>
        h({ type: "wake.failed", code: "LOCAL_WAKE_ENGINE_FAILED" }),
      );
    };
    const acquire = async () => {
      if (
        (state as WakeWordState) === "STOPPED" ||
        (state as WakeWordState) === "FAILED" ||
        session
      )
        return;
      const generation = ++epoch;
      started = this.now();
      clearRing();
      engine.reset();
      try {
        const s = await this.capture.start(
          { targetSampleRateHz: 24000, frameDurationMs: 20 },
          (frame) => {
            if (generation !== epoch || state !== "LISTENING") return;
            const bytes =
              frame.data instanceof Uint8Array
                ? frame.data
                : new Uint8Array(frame.data);
            if (
              frame.sample_rate_hz !== 24000 ||
              frame.channels !== 1 ||
              bytes.length !== 960
            ) {
              fail();
              return;
            }
            const view = new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength,
              ),
              floats = new Float32Array(480);
            for (let i = 0; i < 480; i++)
              floats[i] = view.getInt16(i * 2, true) / 32768;
            const local = resampleMono(floats, 24000, 16000);
            if (ring.length)
              for (const value of local) {
                ring[ringAt] = value;
                ringAt = (ringAt + 1) % ring.length;
                ringCount = Math.min(ringCount + 1, ring.length);
              }
            const pcm = float32ToPcm16(local);
            floats.fill(0);
            local.fill(0);
            const joined = new Int16Array(pending.length + pcm.length);
            joined.set(pending);
            joined.set(pcm, pending.length);
            pending = joined;
            if (pending.length < 1280) return;
            if (busy) {
              fail();
              return;
            }
            const block = pending;
            pending = new Int16Array(0);
            busy = true;
            let deadline: ReturnType<typeof setTimeout>;
            inference = Promise.race([
              engine.process(block),
              new Promise<number>((_, reject) => {
                deadline = setTimeout(
                  () => reject(new Error("LOCAL_WAKE_TIMEOUT")),
                  1000,
                );
              }),
            ])
              .then((score) => {
                if (generation !== epoch || state !== "LISTENING") return;
                if (!Number.isFinite(score) || score < 0 || score > 1) {
                  fail();
                  return;
                }
                if (
                  this.now() - started < 1500 ||
                  this.now() - last < (config.cooldownMs ?? 2000) ||
                  score < 0.8
                )
                  return;
                last = this.now();
                listeners.forEach((h) =>
                  h({
                    type: "wake.detected",
                    detection: {
                      wakePhrase: "HEY_ARY",
                      timestamp: new Date(last).toISOString(),
                      confidence: score,
                      providerId: this.id,
                      sessionId: id,
                    },
                  }),
                );
              })
              .catch(() => {
                if (generation === epoch && state === "LISTENING") fail();
              })
              .finally(() => {
                clearTimeout(deadline!);
                busy = false;
                block.fill(0);
              });
          },
          fail,
        );
        if (
          generation !== epoch ||
          (state as WakeWordState) === "STOPPED" ||
          (state as WakeWordState) === "FAILED"
        ) {
          await s.stop();
          return;
        }
        session = s;
        state = "LISTENING";
      } catch {
        fail();
        throw new Error("LOCAL_WAKE_CAPTURE_FAILED");
      }
    };
    try {
      await acquire();
      if ((state as WakeWordState) !== "LISTENING")
        throw new Error("LOCAL_WAKE_CAPTURE_FAILED");
    } catch (error) {
      await release();
      await engine.close();
      throw error;
    }
    let stopped: Promise<void> | undefined;
    return {
      id,
      get state() {
        return state;
      },
      takeVerificationAudio: () => {
        const sample = new Float32Array(ringCount);
        const from = (ringAt - ringCount + ring.length) % ring.length;
        for (let i = 0; i < ringCount; i++)
          sample[i] = ring[(from + i) % ring.length];
        clearRing();
        return sample;
      },
      pause: () => {
        if (state === "STOPPED" || state === "FAILED") return Promise.resolve();
        state = "PAUSED";
        return (serial = serial.then(release));
      },
      resume: () => (serial = serial.then(acquire)),
      stop: () => {
        if (stopped) return stopped;
        state = "STOPPED";
        clearRing();
        return (stopped = serial =
          serial.then(async () => {
            await release();
            await engine.close();
            listeners.clear();
          }));
      },
      onEvent: (h) => {
        listeners.add(h);
        return () => listeners.delete(h);
      },
    };
  }
}
