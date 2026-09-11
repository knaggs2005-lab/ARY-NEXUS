import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OpenAISpeechToText,
  OpenAITextToSpeech,
} from "../src/infrastructure/providers/openai-voice";
import {
  OpenAIResponsesProvider,
  OpenAIEmbeddingProvider,
} from "../src/infrastructure/providers/openai";
import { VoiceService } from "../src/services/voice-service";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { AryBrainService } from "../src/services/ary-brain-service";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { ActionService } from "../src/services/action-service";
import type { ModelMetric } from "../src/domain/telemetry";
loadEnvConfig(process.cwd());
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-voice-eval-"));
  const metrics: ModelMetric[] = [];
  const telemetry = async (m: ModelMetric) => {
    metrics.push(m);
  };
  const report: Record<string, unknown> = {
    date: new Date().toISOString(),
    fixture:
      "Synthetic speech; isolated temporary repository. No microphone or live memories used.",
  };
  try {
    const voice = new VoiceService(
      new OpenAISpeechToText(),
      new OpenAITextToSpeech(),
      telemetry,
    );
    report.providers = voice.describe();
    let transcript = {
      text: "Remember: My preferred meeting time is nine in the morning.",
    };
    if (!process.argv.includes("--text-only")) {
      const start = performance.now();
      const audio = await voice.synthesize(
        "Remember: My preferred meeting time is nine in the morning.",
      );
      report.tts = {
        success: audio.size > 0,
        bytes: audio.size,
        latency_ms: Math.round(performance.now() - start),
      };
      const stt = performance.now();
      transcript = await voice.transcribe(audio);
      report.stt = {
        success: /nine|9/i.test(transcript.text),
        latency_ms: Math.round(performance.now() - stt),
        text: transcript.text,
      };
    } else {
      report.audio =
        "Not run: awaiting project model permission. Brain uses a synthetic confirmed voice transcript.";
    }
    const repo = new LocalRepository(randomUUID(), join(dir, "fixture.json"));
    const memories = new MemoryService(
      repo,
      new OpenAIEmbeddingProvider(telemetry),
    );
    const brain = new AryBrainService(
      repo,
      memories,
      new EntityService(repo),
      new OpenAIResponsesProvider(
        telemetry,
        process.env.OPENAI_REASONING_MODEL || "gpt-5.6-sol",
      ),
      new ActionService(repo),
    );
    let conversationId: string | undefined;
    let deltas = 0;
    let firstDelta: number | null = null;
    let responseMs: number | null = null;
    let saved = 0;
    const began = performance.now();
    for await (const event of brain.respond(
      { input: transcript.text, modality: "voice" },
      {
        onDelta: () => {
          deltas++;
          firstDelta ??= Math.round(performance.now() - began);
        },
      },
    )) {
      if (event.type === "response") {
        conversationId = event.conversation_id;
        responseMs = Math.round(performance.now() - began);
      }
      if (event.type === "complete") {
        saved = event.saved_memory_ids.length;
        report.extraction_warnings = event.warnings;
      }
      if (event.type === "error") throw new Error(event.error);
    }
    report.reasoning = {
      success: Boolean(conversationId) && deltas > 0,
      deltas,
      first_delta_ms: firstDelta,
      response_ms: responseMs,
    };
    report.extraction = { success: saved > 0, count: saved };
    let recalled = false;
    let linked = false;
    for await (const event of brain.respond(
      {
        input: "At what hour should we schedule my meetings?",
        modality: "voice",
        conversation_id: conversationId,
      },
      { onDelta: () => {} },
    )) {
      if (event.type === "response") {
        recalled =
          /nine|9/i.test(event.message.content) &&
          event.retrieved_memories.length > 0;
        linked = event.conversation_id === conversationId;
        report.recall = {
          content: event.message.content,
          retrieved: event.retrieved_memories.length,
        };
      }
      if (event.type === "error") throw new Error(event.error);
    }
    report.continuity = { success: linked, paraphrased_recall: recalled };
    report.success =
      Boolean(
        (report.stt as { success: boolean } | undefined)?.success ??
        process.argv.includes("--text-only"),
      ) &&
      saved > 0 &&
      recalled &&
      deltas > 0;
  } catch (error) {
    report.success = false;
    report.error =
      error instanceof Error ? error.message : "Voice evaluation failed";
    process.exitCode = 1;
  } finally {
    report.metrics = metrics;
    await mkdir(".data", { recursive: true });
    await writeFile(
      ".data/voice-evaluation.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
    await rm(dir, { recursive: true, force: true });
  }
}
void main();
