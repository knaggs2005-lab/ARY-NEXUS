import type { RealtimeVoiceActivator } from "../../services/voice-activation-service";
import type { AudioCaptureProvider } from "../../domain/audio-capture";
import type { WakeWordProvider } from "../../domain/wake-word";
import type { OwnerVoiceGate } from "../../services/owner-voice-gate";
import { WakeWordService } from "../../services/wake-word-service";
import { VoiceActivationService } from "../../services/voice-activation-service";
import {
  RealtimeMicRelayClient,
  type RelayRequest,
} from "./realtime-mic-relay-client";
import { RealtimePlayback } from "./realtime-playback";
import { RealtimeOutputClient } from "./realtime-output-client";
import { RelayVoiceActivator } from "./relay-voice-activator";
/** Composition only: one existing activation state machine, one relay/Brain, one mic lease. */
export function createHeyAryRuntime(options: {
  conversationId: string;
  activator?: RealtimeVoiceActivator & { snapshot(): unknown };
  enabled: boolean;
  capture: AudioCaptureProvider;
  wakeProvider: WakeWordProvider;
  request: RelayRequest;
  ownerGate?: Pick<OwnerVoiceGate, "verify">;
  createAudioContext?: () => AudioContext;
  changed?: (state: string) => void;
}) {
  const wake = new WakeWordService(options.wakeProvider);
  let status = "STOPPED",
    degraded = false,
    stopped = false;
  const change = (state: string) => {
    status = state;
    options.changed?.(state);
  };
  const playback = new RealtimePlayback(
    options.createAudioContext,
    (playing) => {
      wake.setPlaybackActive(playing);
      if (playing) change("SPEAKING");
      else if (status === "SPEAKING") change("LISTENING");
    },
  );
  const activator =
    options.activator ??
    new RelayVoiceActivator(() => {
      let client: RealtimeMicRelayClient;
      const output = new RealtimeOutputClient(
        options.request,
        playback,
        (code) => client.fail(code),
        (event) => {
          if (event.type === "closed")
            void client.remoteEnd(event.failure_code);
          if (event.type === "interrupted") change("INTERRUPTED");
          if (
            event.type === "state" &&
            !(event.state === "IDLE" && playback.snapshot().state === "PLAYING")
          )
            change(
              event.state === "PROCESSING"
                ? "THINKING"
                : event.state === "ASSISTANT_SPEAKING"
                  ? "SPEAKING"
                  : event.state,
            );
        },
        true,
      );
      // Keep unlocked dedicated output context across wake cycles; dispose only on runtime stop.
      client = new RealtimeMicRelayClient(
        options.capture,
        options.request,
        output,
      );
      return client;
    }, playback);
  const activation = new VoiceActivationService(
    wake,
    activator,
    options.conversationId,
    options.ownerGate
      ? async () =>
          (await options.ownerGate!.verify(wake.takeVerificationAudio()))
            .decision === "ALLOW"
      : undefined,
  );
  const off = activation.onEvent((event) => {
    if (event.type === "voice.activation.failed") degraded = true;
    change(
      event.state === "VERIFYING_OWNER"
        ? "VERIFYING"
        : event.state === "ACTIVE"
          ? "LISTENING"
          : event.state === "SLEEPING" && degraded
            ? "DEGRADED — WAKE LISTENING"
            : event.state,
    );
  });
  let started = false;
  let starting: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;
  return {
    start(): Promise<void> {
      if (started || stopped) return starting ?? Promise.resolve();
      started = true;
      return (starting = (async () => {
        if (!options.enabled) {
          change("WAKE_DISABLED");
          return;
        }
        try {
          // Must be called from an explicit owner gesture. Missing wake model never opens microphone/cloud.
          await playback.start();
          const health = await wake.start({
            enabled: true,
            phrases: ["HEY_ARY"],
            verificationAudio: !!options.ownerGate,
          });
          if (stopped) {
            await wake.stop();
            await playback.close();
            return;
          }
          change(
            health.state === "LISTENING"
              ? "SLEEPING — WAKE LISTENING"
              : (health.reason ?? "WAKE_FAILED"),
          );
          if (health.state !== "LISTENING") await playback.close();
        } catch {
          change("VOICE_RUNTIME_FAILED");
          await wake.stop();
          await playback.close();
        }
      })());
    },
    snapshot: () => ({
      state: status,
      activation: activation.state(),
      wake: wake.health(),
      capture: activator.snapshot(),
      playback: playback.snapshot(),
      degraded,
    }),
    stop(): Promise<void> {
      if (stopping) return stopping;
      stopped = true;
      off();
      return (stopping = (async () => {
        await activation.stop();
        await wake.stop();
        await starting;
        await playback.close();
        change("STOPPED");
      })());
    },
  };
}
