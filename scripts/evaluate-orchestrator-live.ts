/** One paid planning call against synthetic local records. No external execution. */
import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { LocalEmbeddingProvider } from "../src/infrastructure/providers/local";
import { OpenAIResponsesProvider } from "../src/infrastructure/providers/openai";
import {
  ActionService,
  ApprovalRequiredError,
} from "../src/services/action-service";
import { createActionToolRegistry } from "../src/services/action-request-service";
import { OrchestratorService } from "../src/services/orchestrator-service";
import { registerOrchestratorTools } from "../src/infrastructure/tools/orchestrator-tools";
import { EntityService } from "../src/services/entity-service";
import { MemoryService } from "../src/services/memory-service";
import { actionTelemetryContext } from "../src/services/action-telemetry-context";
import type { ExecutionPlan } from "../src/domain/orchestration";
async function main() {
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  if (!process.env.OPENAI_API_KEY) throw Error("Configured key unavailable");
  const dir = await mkdtemp(join(tmpdir(), "ary-orchestrator-live-"));
  try {
    const repo = new LocalRepository(randomUUID(), join(dir, "repo.json")),
      actions = new ActionService(repo),
      entities = new EntityService(repo),
      memories = new MemoryService(repo, new LocalEmbeddingProvider());
    const project = await entities.createEntity({
      name: "Wag Trails",
      entity_type: "project",
      description: "Synthetic acceptance project",
    });
    const model = new OpenAIResponsesProvider(async (metric) => {
      await repo.insert("model_calls", {
        ...metric,
        action_id: actionTelemetryContext.getStore() ?? null,
      });
    });
    const registry = createActionToolRegistry(repo, undefined, actions),
      service = new OrchestratorService(
        repo,
        actions,
        registry,
        memories,
        entities,
        model,
      );
    registerOrchestratorTools(registry, service, repo, actions);
    const proposed = await service.requests.request({
      tool: "orchestrator.plan",
      request_key: randomUUID(),
      input: {
        goal: `Create a high priority task titled "Finish acceptance edit" under Wag Trails project ${project.id}, then inspect the resulting task and verify its title is exactly "Finish acceptance edit". No deadline, no email, no calendar, no desktop, no external tools. Use create_task followed by task.inspect verification. This is a disposable internal acceptance test.`,
      },
    });
    let plan = proposed.result as unknown as ExecutionPlan;
    console.log(
      JSON.stringify({
        proposed_steps: plan.spec.steps,
        questions: plan.spec.questions,
      }),
    );
    assert.equal((await repo.list("tasks")).length, 0);
    assert.equal(plan.spec.questions.length, 0);
    assert.ok(plan.spec.steps.some((s) => s.tool === "create_task"));
    assert.ok(
      plan.spec.steps.every((s) =>
        ["create_task", "task.inspect"].includes(s.tool),
      ),
    );
    assert.ok(plan.spec.steps.every((s) => s.missing.length === 0));
    for (let n = 0; n < 26; n++) {
      plan = await service.command(plan.id, "advance", plan.revision);
      const waiting = Object.values(plan.states).find(
        (s) => s.status === "waiting_approval",
      );
      if (waiting) {
        const a = (await repo.get("actions", waiting.approval_action_id!))!;
        assert.equal(a.tool_name, "create_task");
        await actions.permissions.review(
          a.id,
          "approved",
          "Isolated internal acceptance task only",
        );
        continue;
      }
      if (plan.status === "complete") break;
      assert.notEqual(plan.status, "paused", plan.summary);
    }
    assert.equal(plan.status, "complete", plan.summary);
    assert.equal((await repo.list("tasks")).length, 1);
    assert.ok(Object.values(plan.states).every((s) => s.status === "verified"));
    const metrics = await repo.list("model_calls");
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0].status, "succeeded");
    assert.ok(metrics[0].action_id);
    console.log(
      JSON.stringify({
        success: true,
        model: plan.model,
        steps: plan.spec.steps.map((s) => ({
          id: s.id,
          tool: s.tool,
          status: plan.states[s.id].status,
        })),
        latency_ms: metrics[0].latency_ms,
        input_tokens: metrics[0].input_tokens,
        output_tokens: metrics[0].output_tokens,
        estimated_cost_usd: metrics[0].estimated_cost_usd,
        task_count: 1,
        external_effects: 0,
        storage: "isolated LocalRepository",
        embeddings: "development local; no semantic claim",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    console.log(
      "Synthetic plans, tasks, metrics and account fixtures removed; no Supabase account created.",
    );
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Planning acceptance failed");
  process.exitCode = 1;
});
