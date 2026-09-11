/** Real vision call, synthetic images and disposable local records only. */
import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { perceptionFixture } from "./perception-fixtures";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import {
  ActionRequestService,
  createActionToolRegistry,
} from "../src/services/action-request-service";
import { PerceptionService } from "../src/services/perception-service";
import { FrameStore } from "../src/infrastructure/perception/frame-store";
import { OpenAIVisionProvider } from "../src/infrastructure/providers/openai-vision";
import { actionTelemetryContext } from "../src/services/action-telemetry-context";
import type { VisionFinding } from "../src/domain/perception";
async function main() {
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  if (!process.env.OPENAI_API_KEY)
    throw Error("Existing OpenAI key is not configured");
  const dir = await mkdtemp(join(tmpdir(), "ary-perception-live-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "repo.json")),
      actions = new ActionService(repo),
      store = new FrameStore();
    const provider = new OpenAIVisionProvider(async (metric) => {
      await repo.insert("model_calls", {
        ...metric,
        action_id: actionTelemetryContext.getStore() ?? null,
      });
    });
    const service = new PerceptionService(repo, actions, provider, store);
    const requests = new ActionRequestService(
      repo,
      actions,
      createActionToolRegistry(
        repo,
        undefined,
        actions,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        service,
      ),
    );
    async function approved(r: Record<string, unknown>) {
      try {
        await requests.request(r);
        throw Error("Expected explicit approval");
      } catch (e) {
        assert.ok(e instanceof ApprovalRequiredError);
        await actions.permissions.review(
          e.actionId,
          "approved",
          "Isolated synthetic image acceptance only",
        );
      }
      return requests.request(r);
    }
    const frames = [];
    for (const after of [false, true]) {
      const g = await approved({
        tool: "perception.capture_upload",
        input: { source_id: after ? "synthetic after" : "synthetic before" },
        request_key: randomUUID(),
      });
      frames.push(
        await service.stage(
          String(g.result.grant_id),
          await perceptionFixture(after),
        ),
      );
    }
    const input = {
      mode: "compare",
      question:
        "Is an Export Media dialog visible in Frame 2 compared with Frame 1? Verify dialog appearance, and distinguish that from a completed export.",
      frames,
    };
    const r = { tool: "perception.analyze", input, request_key: randomUUID() };
    const result = await approved(r),
      finding = result.result.finding as VisionFinding;
    assert.equal(finding.verification.verdict, "supported");
    assert.ok(finding.observations.some((o) => o.frame === 2));
    assert.match(JSON.stringify(finding), /export/i);
    assert.ok(finding.differences.length);
    for (const f of frames) assert.throws(() => store.get(repo.userId, f));
    await requests.request(r);
    const metrics = await repo.list("model_calls");
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].status, "succeeded");
    assert.equal(metrics[0].action_id, result.action_id);
    const serialized = JSON.stringify(await repo.list("actions"));
    assert.ok(!serialized.includes("data:image"));
    assert.equal((await repo.list("memories")).length, 0);
    console.log(
      JSON.stringify({
        success: true,
        provider: result.result.provider,
        model: result.result.model,
        finding,
        latency_ms: result.result.latency_ms,
        input_tokens: metrics[0].input_tokens,
        output_tokens: metrics[0].output_tokens,
        estimated_cost_usd: metrics[0].estimated_cost_usd,
        replay_model_calls: metrics.length,
        images_removed: true,
        storage: "isolated LocalRepository; no real user records",
        input: "synthetic before/after only",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    console.log(
      "Temporary local account records and synthetic buffers cleaned up; no Supabase account created.",
    );
  }
}
main().catch((e) => {
  console.error(
    e instanceof Error ? e.message : "Perception acceptance failed",
  );
  process.exitCode = 1;
});
