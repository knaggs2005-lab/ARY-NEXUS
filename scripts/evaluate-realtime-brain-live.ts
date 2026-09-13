import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { services } from "../src/server/context";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { RealtimeBrainBridge } from "../src/services/realtime-brain-bridge";
import { RealtimeSpeechQueue } from "../src/services/realtime-speech-queue";
import { RealtimeOutputStream } from "../src/services/realtime-output-stream";
import { RealtimeOutputClient } from "../src/components/voice/realtime-output-client";
import { RealtimePlayback } from "../src/components/voice/realtime-playback";
import { silentTimingContext } from "./profile-realtime-voice";
import type {
  RealtimeVoiceEvent,
  RealtimeVoiceSession,
} from "../src/domain/realtime-voice";

/** Real configured Brain + Realtime output; synthetic transcript, isolated storage, no devices. */
async function main() {
  loadEnvConfig(process.cwd(), true);
  const includeDiscovery = process.argv.includes("--tool-discovery");
  const shortAnswer = process.argv.includes("--short-answer");
  const directory = await mkdtemp(join(tmpdir(), "ary-brain-speech-live-"));
  let session: RealtimeVoiceSession | undefined;
  let bridge: RealtimeBrainBridge | undefined;
  let output: RealtimeOutputStream | undefined;
  let client: RealtimeOutputClient | undefined;
  let off = () => {};
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const repo = new LocalRepository(
      crypto.randomUUID(),
      join(directory, "fixture.json"),
    );
    const conversation = await repo.insert("conversations", {
      title: "Synthetic voice sound check",
      metadata: {},
    });
    const { brain, realtimeVoice } = services(repo);
    const actual = (session = await realtimeVoice.createSession({
      user_id: repo.userId,
      conversation_id: conversation.id,
      classic_fallback_available: false,
    }));
    const handlers = new Set<(e: RealtimeVoiceEvent) => void>();
    const emit = (e: RealtimeVoiceEvent) => handlers.forEach((h) => h(e));
    const input: RealtimeVoiceSession = {
      id: actual.id,
      nexus_conversation_id: actual.nexus_conversation_id,
      provider_session_id: actual.provider_session_id,
      get state() {
        return actual.state;
      },
      sendAudio() {
        throw new Error("NO_MICROPHONE_AUDIO_PERMITTED");
      },
      speakText: (text) => actual.speakText!(text),
      interrupt: (kind) => actual.interrupt(kind),
      close: () => actual.close(),
      onEvent: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
    let failed = false,
      responseMs = 0,
      audioMs = 0;
    const started = performance.now();
    output = new RealtimeOutputStream(() => {
      failed = true;
      console.log("DIAGNOSTIC_FAILURE: OUTPUT_BACKPRESSURE");
    });
    const stream = output;
    const playback = new RealtimePlayback(silentTimingContext);
    await playback.start();
    client = new RealtimeOutputClient(
      async () => stream.open(new AbortController().signal),
      playback,
      (code) => {
        failed = true;
        console.log(
          `DIAGNOSTIC_FAILURE: ${code.replace(/[^A-Z_]/g, "").slice(0, 64)}`,
        );
      },
    );
    await client.open("synthetic-live-brain");
    off = actual.onEvent((event) => {
      if (event.type === "assistant_audio_delta")
        audioMs ||= performance.now() - started;
      if (event.type === "failure") {
        failed = true;
        console.log(
          `DIAGNOSTIC_FAILURE: ${event.failure.code.replace(/[^A-Z_]/g, "").slice(0, 64)}`,
        );
      }
      stream.publish(event);
      emit(event);
    });
    const speech = new RealtimeSpeechQueue(input, () => stream.drained());
    bridge = new RealtimeBrainBridge(
      input,
      {
        async *respond(...args) {
          for await (const event of brain.respond(...args)) {
            if (event.type === "response")
              responseMs = performance.now() - started;
            yield event;
          }
        },
      },
      conversation.id,
      (event) => {
        if (event.type === "failure") {
          failed = true;
          console.log(
            `DIAGNOSTIC_FAILURE: ${event.failure.code.replace(/[^A-Z_]/g, "").slice(0, 64)}`,
          );
        }
        stream.publish(event);
      },
      undefined,
      (text, signal) => speech.speak(text, signal),
    );
    emit({
      type: "transcript_final",
      turn_id: "synthetic-final",
      text: includeDiscovery
        ? shortAnswer
          ? "Which tools can you use? Reply in at most five words."
          : "Which tools can you use? Answer briefly."
        : "Ary, can you hear me? Answer briefly.",
    });
    await Promise.race([
      bridge.idle(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("DIAGNOSTIC_TIMEOUT")),
          60000,
        );
      }),
    ]);
    await stream.drained();
    const health = playback.snapshot();
    const messages = await repo.list("messages");
    const toolDiscovery = (await repo.list("actions")).filter(
      (a) => a.tool_name === "tools.discover",
    ).length;
    console.log(
      JSON.stringify({
        diagnostic_stage: "audio_complete",
        failed,
        canonical_response_ms: Math.round(responseMs),
        first_audio_received_ms: Math.round(audioMs),
        audio_bytes: health.audio_bytes_received,
      }),
    );
    if (
      failed ||
      !responseMs ||
      !audioMs ||
      !health.audio_bytes_received ||
      toolDiscovery !== (includeDiscovery ? 1 : 0)
    )
      throw new Error("BRAIN_AUDIO_NOT_ACCEPTED");
    console.log(
      JSON.stringify({
        BRAIN_REALTIME_SPEECH: "PASS",
        input: "SYNTHETIC_TRANSCRIPT",
        physical_microphone: "NOT_RUN",
        physical_playback: "NOT_RUN",
        canonical_response_ms: Math.round(responseMs),
        first_audio_received_ms: Math.round(audioMs),
        audio_chunks: health.audio_chunks_received,
        audio_bytes: health.audio_bytes_received,
        tool_catalog_discoveries: toolDiscovery,
        assistant_messages: messages.filter((m) => m.role === "assistant")
          .length,
        extraction_completed: messages.some(
          (m) =>
            m.role === "assistant" &&
            m.metadata.extraction_status === "completed",
        ),
      }),
    );
  } finally {
    clearTimeout(deadline);
    bridge?.close();
    off();
    output?.close();
    try {
      await client?.close();
    } finally {
      try {
        await session?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
main().catch(() => {
  console.error(
    "BRAIN_REALTIME_SPEECH: FAIL (sanitized; no prompts, audio, or secrets logged)",
  );
  process.exitCode = 1;
});
