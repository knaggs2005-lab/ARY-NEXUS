/** Real provider comparison; synthetic audio only, no Brain or database writes. */
import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { VoiceService } from "../src/services/voice-service";
import { transcriptionResponse } from "../src/server/voice-stream";
import { readTranscript } from "../src/components/voice/transcript-stream";
import {
  OpenAISpeechToText,
  OpenAITextToSpeech,
} from "../src/infrastructure/providers/openai-voice";
loadEnvConfig(process.cwd());
async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Configured key required");
  const stt = new OpenAISpeechToText();
  const tts = new OpenAITextToSpeech();
  if (process.argv.includes("--pipeline-only")) {
    const directory = await mkdtemp(join(tmpdir(), "ary-stt-pipeline-"));
    try {
      const repo = new LocalRepository(
        randomUUID(),
        join(directory, "data.json"),
      );
      const actions = new ActionService(repo);
      const voice = new VoiceService(stt, tts, async (metric) => {
        await repo.insert("model_calls", { ...metric, action_id: null });
      });
      const audio = await tts.synthesize(
        "Please remind me to review the project tomorrow morning at nine.",
      );
      const started = performance.now();
      let first: number | null = null;
      const signal = new AbortController().signal;
      const response = await transcriptionResponse(
        actions,
        voice,
        audio,
        signal,
      );
      const result = await readTranscript(
        response,
        () => {
          first ??= Math.round(performance.now() - started);
        },
        signal,
      );
      assert.match(result.text, /nine|9/i);
      assert.equal((await repo.list("actions"))[0].status, "succeeded");
      assert.equal((await repo.list("outcomes"))[0].status, "success");
      assert.equal((await repo.list("model_calls"))[0].status, "succeeded");
      assert.equal((await repo.list("messages")).length, 0);
      assert.equal((await repo.list("memories")).length, 0);
      console.log(
        JSON.stringify({
          pipeline:
            "real provider → streamed transport → client parser, isolated local permission/audit store",
          first_text_ms: first,
          total_ms: Math.round(performance.now() - started),
          audit: "passed",
          extracted_memories: 0,
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return;
  }
  const samples: Array<Record<string, unknown>> = [];
  const fixtures = [
    "Please remind me to review the project tomorrow morning at nine.",
    "I would like to review the project tomorrow morning at nine. First, check the list of unfinished tasks and identify anything that is blocked. Then read the project notes and prepare a short summary of the outstanding questions. Please keep this as a draft until I have reviewed the details. Do not send a message or change a task automatically.",
  ];
  for (let fixture = 0; fixture < fixtures.length; fixture++) {
    const audio = await tts.synthesize(fixtures[fixture]);
    for (const streaming of [false, true, true, false]) {
      const start = performance.now();
      let first: number | null = null,
        deltas = 0;
      const result = await stt.transcribe(
        audio,
        undefined,
        streaming
          ? () => {
              first ??= Math.round(performance.now() - start);
              deltas++;
            }
          : undefined,
      );
      const total = Math.round(performance.now() - start);
      const sample = {
        fixture,
        mode: streaming ? "stream" : "buffered",
        bytes: audio.size,
        first_text_ms: first ?? total,
        total_ms: total,
        deltas,
        recall: /nine|9/i.test(result.text) && /project/i.test(result.text),
      };
      samples.push(sample);
      console.log(JSON.stringify(sample));
      if (!sample.recall)
        throw new Error("Transcription accuracy check failed");
    }
  }
  const report = {
    date: new Date().toISOString(),
    model: stt.model,
    scope:
      "Provider-only synthetic audio, no upload/authentication/audit/browser latency included",
    samples,
  };
  await mkdir(".data", { recursive: true });
  await writeFile(
    ".data/transcription-latency.json",
    JSON.stringify(report, null, 2),
  );
}
main().catch(() => {
  console.error(
    "Transcription latency evaluation failed; inspect safe provider telemetry. No credentials printed.",
  );
  process.exitCode = 1;
});
