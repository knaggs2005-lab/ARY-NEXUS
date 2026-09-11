/** Isolated real decoder acceptance. --live adds one synthetic cloud STT call, never user media. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import {
  encodeWav,
  PremiereMediaAnalysis,
} from "../src/infrastructure/premiere/media-analysis";
import type { PremiereAdapter } from "../src/domain/premiere";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { ActionService } from "../src/services/action-service";
import { ActionRequestService } from "../src/services/action-request-service";
import { ToolRegistry } from "../src/domain/tool-registry";
import { registerPremiereTools } from "../src/infrastructure/tools/premiere-tools";
async function main() {
  const live = process.argv.includes("--live");
  if (live) loadEnvConfig(process.cwd());
  const dir = await mkdtemp(join(tmpdir(), "ary-premiere-real-media-")),
    run = promisify(execFile);
  try {
    const ffmpeg =
      process.env.ARY_PREMIERE_FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";
    const source = join(dir, "source.wav"),
      video = join(dir, "interview $(touch NEVER_EXECUTED).mp4");
    const samples = new Float32Array(16000 * 4);
    for (let i = 16000; i < 48000; i++)
      samples[i] = Math.sin((i * 440 * Math.PI * 2) / 16000) * 0.3;
    await writeFile(source, encodeWav(samples, 16000));
    if (live)
      await run(
        "/usr/bin/say",
        [
          "-o",
          join(dir, "speech.aiff"),
          "The surprising mistake changed our entire editing process. We learned to review the source before making a decision.",
        ],
        { timeout: 30000 },
      );
    await run(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        live ? join(dir, "speech.aiff") : source,
        "-c:a",
        "aac",
        video,
      ],
      { timeout: 30000 },
    );
    process.env.ARY_PREMIERE_ALLOWED_ROOTS = JSON.stringify([dir]);
    process.env.ARY_PREMIERE_FFMPEG_PATH = ffmpeg;
    const adapter: PremiereAdapter = {
      assertAvailable() {},
      inspect: async () => ({
        revision: "fixture",
        project_id: "project",
        project_name: "Disposable media",
        project_path: join(dir, "fixture.prproj"),
        sequence_id: null,
        sequences: [],
        items: [
          {
            id: "media",
            name: "Synthetic interview",
            parent_id: null,
            kind: "media",
            media_path: video,
            offline: false,
          },
        ],
        clips: [],
        complete: true,
      }),
      execute: async () => {
        throw Error("No native edits in decoder test");
      },
    };
    const service = new PremiereMediaAnalysis(adapter),
      repo = new LocalRepository(randomUUID(), join(dir, "repo.json")),
      actions = new ActionService(repo),
      requests = new ActionRequestService(
        repo,
        actions,
        registerPremiereTools(new ToolRegistry(), adapter, actions, service),
      );
    const prepared = await service.prepare({
      media_id: "media",
      expected_revision: "fixture",
      start_seconds: 0,
      duration_seconds: live ? 30 : 4,
      transcribe: live,
    });
    const req = {
      ...prepared.request,
      request_key: randomUUID(),
      reason: "Isolated synthetic media acceptance; no user recordings",
    };
    await assert.rejects(() => requests.request(req), /Approval required/);
    await actions.permissions.review(
      (await repo.list("actions")).at(-1)!.id,
      "approved",
      "Approve only this generated synthetic fixture",
    );
    const result = await requests.request(req);
    await requests.request(req);
    const receipt = result.result as Record<string, any>;
    assert.equal(receipt.decoder, "ffmpeg");
    assert.equal(receipt.audio_retained, false);
    assert.match(receipt.source.excerpt_sha256, /^[a-f0-9]{64}$/);
    if (live) {
      assert.match(receipt.transcript, /surprising|mistake|editing/i);
      assert.ok(
        receipt.plan.recommendations.some((r: any) => r.kind === "hook"),
      );
    } else
      assert.ok(
        receipt.plan.recommendations.some((r: any) => r.kind === "silence"),
      );
    assert.ok(
      (await repo.list("outcomes")).some(
        (o) => o.action_id === result.action_id,
      ),
    );
    await assert.rejects(() => stat(join(dir, "NEVER_EXECUTED")));
    console.log(
      JSON.stringify({
        success: true,
        decoder: receipt.decoder,
        transcription: live ? receipt.transcription : null,
        latency_ms: receipt.latency_ms,
        estimated_cost_usd: receipt.estimated_cost_usd,
        checks: [
          "compressed media decoding",
          "approval before analysis",
          "bounded source evidence",
          "outcome linkage",
          "idempotent replay",
          "command-looking filename remains inert",
        ],
        native_premiere: "not involved; dedicated acceptance remains pending",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    console.log("Synthetic files, audio and isolated repository removed.");
  }
}
main().catch(() => {
  console.error(
    "Synthetic media verification failed; no production records or native project were changed.",
  );
  process.exitCode = 1;
});
