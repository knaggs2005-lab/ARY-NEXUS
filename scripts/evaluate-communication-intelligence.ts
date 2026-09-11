/** One synthetic evidence-only model evaluation. No calls, mail, production fixtures or memory writes. */
import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { services } from "../src/server/context";
import { ActionRequestService } from "../src/services/action-request-service";
async function main() {
  if (!process.argv.includes("--live"))
    throw Error(
      "Use --live for one configured model call with synthetic communication evidence",
    );
  loadEnvConfig(resolve(process.env.ARY_TEST_ENV_DIR || process.cwd()));
  const dir = await mkdtemp(join(tmpdir(), "ary-communication-intelligence-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "repo.json"));
    const s = services(repo);
    const quote =
      "I will send the signed location release by September 15, 2026.";
    const source = await repo.insert("actions", {
      tool_name: "gmail.read",
      action_type: "fixture",
      conversation_id: null,
      status: "succeeded",
      permission_level: 1,
      input: {},
      error: null,
      metadata: { synthetic: true },
      output: {
        result: {
          id: "abcd",
          messages: [
            {
              id: "abc1",
              from: "Synthetic sender <sender@example.test>",
              to: "owner@example.test",
              date: "2026-09-10T12:00:00Z",
              body_available: true,
              truncated: false,
              text: quote,
            },
          ],
        },
      },
    });
    const request = {
      tool: "communications.debrief",
      request_key: randomUUID(),
      input: { source_action_id: source.id },
    };
    const pipeline = new ActionRequestService(repo, s.actions, s.actionTools);
    const start = performance.now();
    const result = await pipeline.request(request);
    const latency = Math.round(performance.now() - start);
    const candidates = result.result.candidates as {
      kind: string;
      quote: string;
    }[];
    assert.ok(
      candidates.some(
        (c) => c.kind === "commitment" && quote.includes(c.quote),
      ),
    );
    assert.equal(result.result.memory_written, false);
    assert.equal((await repo.list("memories")).length, 0);
    const metrics = await repo.list("model_calls");
    assert.ok(
      metrics.some(
        (m) => m.action_id === result.action_id && m.status === "succeeded",
      ),
    );
    assert.deepEqual(await pipeline.request(request), result);
    assert.equal((await repo.list("model_calls")).length, metrics.length);
    console.log(
      JSON.stringify(
        {
          passed: true,
          source: "synthetic captured email, no external delivery",
          latency_ms: latency,
          exact_commitment_extracted: true,
          memory_written: false,
          replay_model_calls: 0,
          model_calls: metrics.map((m) => ({
            model: m.model,
            latency_ms: m.latency_ms,
            input_tokens: m.input_tokens,
            output_tokens: m.output_tokens,
            estimated_cost_usd: m.estimated_cost_usd,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    console.log(
      "Temporary communication evidence/account ID and all fixtures removed.",
    );
  }
}
main().catch((e) => {
  console.error(
    e instanceof Error ? e.message : "Communication evaluation failed",
  );
  process.exitCode = 1;
});
