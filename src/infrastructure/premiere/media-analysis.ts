import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PremiereAdapter } from "../../domain/premiere";
import type { SpeechToTextProvider } from "../../domain/voice";
import { OpenAISpeechToText } from "../providers/openai-voice";
import { validatePremiereFiles } from "./bridge";
import { measureEditAudio } from "../../domain/edit-audio";
import { EditIntelligenceService } from "../../services/edit-intelligence-service";
import { actionCancellation } from "../../services/action-cancellation";
const runFile = promisify(execFile);
const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export const analysisInput = z
  .object({
    media_id: z.string().min(1).max(200),
    expected_revision: z.string().min(1).max(200),
    start_seconds: z.number().min(0).max(86400).default(0),
    duration_seconds: z.number().min(1).max(60).default(30),
    transcribe: z.boolean().default(false),
    brief: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .default("Find clear interview hooks"),
    destination: z.string().trim().min(1).max(160).default("Reviewed selects"),
  })
  .strict();
export const executionAnalysisInput = analysisInput
  .extend({ source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type AnalysisInput = z.infer<typeof analysisInput>;
/** Local decoder boundary. Never receives caller-supplied commands or filter expressions. */
export interface MediaDecoder {
  decode(
    path: string,
    start: number,
    duration: number,
    signal?: AbortSignal,
  ): Promise<{ samples: Float32Array; sampleRate: number; decoder: string }>;
}
export function wavPcm(buffer: Buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw Error("Expected PCM WAV");
  let format = 0,
    channels = 0,
    rate = 0,
    bits = 0,
    pcm: Buffer | undefined;
  for (let pos = 12; pos + 8 <= buffer.length;) {
    const size = buffer.readUInt32LE(pos + 4),
      end = pos + 8 + size;
    if (end > buffer.length) throw Error("Truncated WAV");
    const tag = buffer.toString("ascii", pos, pos + 4);
    if (tag === "fmt " && size >= 16) {
      format = buffer.readUInt16LE(pos + 8);
      channels = buffer.readUInt16LE(pos + 10);
      rate = buffer.readUInt32LE(pos + 12);
      bits = buffer.readUInt16LE(pos + 22);
    }
    if (tag === "data") pcm = buffer.subarray(pos + 8, end);
    pos = end + (size % 2);
  }
  if (
    format !== 1 ||
    bits !== 16 ||
    channels < 1 ||
    channels > 8 ||
    rate < 8000 ||
    rate > 192000 ||
    !pcm ||
    !pcm.length ||
    pcm.length % (channels * 2)
  )
    throw Error("Use 16-bit PCM WAV or configure FFmpeg for this format");
  // Maximum magnitude avoids cancelling out-of-phase stereo when measuring silence.
  const samples = new Float32Array(pcm.length / (channels * 2));
  for (let i = 0; i < samples.length; i++)
    for (let c = 0; c < channels; c++) {
      const value = pcm.readInt16LE((i * channels + c) * 2) / 32768;
      if (Math.abs(value) > Math.abs(samples[i])) samples[i] = value;
    }
  return { samples, sampleRate: rate };
}
export function encodeWav(samples: Float32Array, rate: number) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) =>
    b.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(s * 32768))),
      44 + i * 2,
    ),
  );
  return b;
}
export class LocalMediaDecoder implements MediaDecoder {
  async decode(
    path: string,
    start: number,
    duration: number,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const executable = process.env.ARY_PREMIERE_FFMPEG_PATH;
    if (!executable) {
      if (!/\.wav$/i.test(path) || (await stat(path)).size > 64 * 1024 * 1024)
        throw Error(
          "Configure ARY_PREMIERE_FFMPEG_PATH for compressed/video or large media. Small 16-bit PCM WAV works locally without FFmpeg.",
        );
      const decoded = wavPcm(await readFile(path, { signal }));
      const samples = decoded.samples.slice(
        Math.floor(start * decoded.sampleRate),
        Math.floor((start + duration) * decoded.sampleRate),
      );
      if (!samples.length)
        throw Error("Requested range is beyond the source audio");
      return { ...decoded, samples, decoder: "pcm-wav" };
    }
    if (!executable.startsWith("/") || /[\x00-\x1f]/.test(executable))
      throw Error("Configure an absolute FFmpeg executable path");
    // Only local file protocol, fixed demuxers, no playlists, devices, network or caller filters.
    const { stdout } = await runFile(
      executable,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,mp3,wav,aiff,mxf",
        "-ss",
        String(start),
        "-i",
        path,
        "-t",
        String(duration),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-acodec",
        "pcm_s16le",
        "-f",
        "s16le",
        "pipe:1",
      ],
      {
        encoding: "buffer",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 45000,
        signal,
      },
    );
    if (!stdout.length || stdout.length % 2)
      throw Error("Decoder returned no valid audio");
    const samples = new Float32Array(stdout.length / 2);
    for (let i = 0; i < samples.length; i++)
      samples[i] = stdout.readInt16LE(i * 2) / 32768;
    return { samples, sampleRate: 16000, decoder: "ffmpeg" };
  }
}
export class PremiereMediaAnalysis {
  constructor(
    private premiere: PremiereAdapter,
    private decoder: MediaDecoder = new LocalMediaDecoder(),
    private speech: SpeechToTextProvider = new OpenAISpeechToText(),
  ) {}
  private async source(input: AnalysisInput) {
    this.premiere.assertAvailable();
    const state = await this.premiere.inspect();
    if (!state.complete || state.revision !== input.expected_revision)
      throw Error("Premiere source changed; inspect and prepare again");
    const item = state.items.find(
      (i) => i.id === input.media_id && i.kind === "media",
    );
    if (!item?.media_path || item.offline)
      throw Error("Choose online source media from the updated UXP inventory");
    await validatePremiereFiles("import_media", { paths: [item.media_path] });
    const path = await realpath(item.media_path),
      info = await stat(path);
    return {
      state,
      item,
      path,
      fingerprint: digest(
        JSON.stringify([
          path,
          info.dev,
          info.ino,
          info.size,
          info.mtimeMs,
          info.ctimeMs,
        ]),
      ),
    };
  }
  async prepare(raw: unknown) {
    const input = analysisInput.parse(raw),
      source = await this.source(input);
    return {
      plan: `Analyze ${source.item.name} source seconds ${input.start_seconds}–${input.start_seconds + input.duration_seconds}. ${input.transcribe ? `Send only the decoded excerpt to ${this.speech.id}/${this.speech.model} for transcription after approval.` : "Local acoustic measurements only; no audio sent to a model."} Recommendations only; no timeline modification.`,
      request: {
        tool: "premiere.analyze_media",
        input: { ...input, source_fingerprint: source.fingerprint },
      },
      source: {
        project_id: source.state.project_id,
        media_id: source.item.id,
        path: source.path,
        fingerprint: source.fingerprint,
      },
    };
  }
  async analyze(raw: unknown) {
    const input = executionAnalysisInput.parse(raw),
      source = await this.source(input);
    if (source.fingerprint !== input.source_fingerprint)
      throw Error("Source file changed after review; prepare again");
    if (
      input.transcribe &&
      this.speech.id === "openai" &&
      ((process.env.ARY_STT_PROVIDER ?? "openai") !== "openai" ||
        !process.env.OPENAI_API_KEY?.trim())
    )
      throw Error("Configured transcription provider is unavailable");
    const signal = actionCancellation.getStore(),
      started = performance.now();
    const decoded = await this.decoder.decode(
      source.path,
      input.start_seconds,
      input.duration_seconds,
      signal,
    );
    const measured = measureEditAudio([decoded.samples], decoded.sampleRate);
    if (measured.duration > input.duration_seconds + 0.001)
      throw Error("Decoder exceeded the approved source range");
    const audio = encodeWav(decoded.samples, decoded.sampleRate);
    if (audio.length > 5 * 1024 * 1024)
      throw Error(
        "Decoded excerpt exceeds the speech upload limit; shorten the range",
      );
    if ((await this.source(input)).fingerprint !== input.source_fingerprint)
      throw Error("Source changed while decoding; no transcription sent");
    signal?.throwIfAborted();
    const transcript = input.transcribe
      ? await this.speech.transcribe(
          new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
          signal,
        )
      : null;
    signal?.throwIfAborted();
    const end = input.start_seconds + measured.duration,
      hash = digest(audio),
      ref = `premiere:${source.state.project_id}:${source.item.id}:audio-sha256:${hash}`;
    const plan = new EditIntelligenceService().createPlan({
      brief: input.brief,
      destination: input.destination,
      clips: [
        {
          id: source.item.id,
          name: source.item.name,
          source_ref: ref,
          duration: end,
          fps: 30,
          segments: transcript?.text
            ? [
                {
                  id: "excerpt",
                  start: input.start_seconds,
                  end,
                  text: transcript.text,
                  confidence: 0.5,
                },
              ]
            : [],
          audio_source_ref: ref,
          audio_windows: measured.windows.map((w) => ({
            ...w,
            start: w.start + input.start_seconds,
            end: w.end + input.start_seconds,
          })),
        },
      ],
      target_seconds: input.duration_seconds,
    });
    // Do not infer gaps outside the approved excerpt. The planner's clip origin is otherwise zero.
    plan.recommendations = plan.recommendations.filter(
      (r) => r.start >= input.start_seconds && r.end <= end,
    );
    plan.warnings = [
      "Advisory analysis of a pinned Premiere source excerpt; no timeline changes.",
      "Source seconds are authoritative. Timecodes use an unverified 30fps display rate, not the clip's native frame rate.",
      "Transcript confidence is uncalibrated and timing is excerpt-level; no word alignment.",
    ];
    return {
      source: {
        project_id: source.state.project_id,
        media_id: source.item.id,
        path: source.path,
        revision: source.state.revision,
        fingerprint: source.fingerprint,
        excerpt_sha256: hash,
        start_seconds: input.start_seconds,
        end_seconds: end,
      },
      decoder: decoded.decoder,
      transcript: transcript?.text ?? null,
      transcription: input.transcribe
        ? {
            provider: this.speech.id,
            model: this.speech.model,
            timing: "excerpt range only; not word aligned",
            confidence: null,
          }
        : null,
      latency_ms: Math.round(performance.now() - started),
      estimated_cost_usd: null,
      audio_retained: false,
      plan,
      warnings: [
        "Acoustic silence uses measured half-second RMS windows at the edit planner threshold. Speech gaps are not proof of silence.",
        "Hooks are heuristic suggestions; excerpt-level transcription cannot justify precise word edits. Review source in Premiere.",
        "Source audio is ephemeral; transcript/evidence remains in the action receipt, not permanent memory.",
      ],
    };
  }
}
