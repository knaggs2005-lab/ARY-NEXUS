import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  OpenAIEmbeddingProvider,
  OpenAIResponsesProvider,
  OpenAIProviderError,
} from "../src/infrastructure/providers/openai";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { MemoryService } from "../src/services/memory-service";
import { EntityService } from "../src/services/entity-service";
import { MemoryReconciliationService } from "../src/services/memory-reconciliation-service";
import { AryBrainService } from "../src/services/ary-brain-service";
import { ActionService } from "../src/services/action-service";
import type { ModelMetric } from "../src/domain/telemetry";

loadEnvConfig(process.cwd());
const average = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ary-openai-eval-"));
  const metrics: ModelMetric[] = [];
  const results: { name: string; passed: boolean; detail: string }[] = [];
  const repo = new LocalRepository(randomUUID(), join(dir, "fixture.json"));
  const llm = new OpenAIResponsesProvider(async (metric) => {
    metrics.push(metric);
  }, process.env.OPENAI_REASONING_MODEL || "gpt-5.6-sol");
  const embedding = new OpenAIEmbeddingProvider(async (metric) => {
    metrics.push(metric);
  });
  const memories = new MemoryService(repo, embedding);
  const entities = new EntityService(repo);
  const reconciliation = new MemoryReconciliationService(
    repo,
    memories,
    entities,
    llm,
  );
  const responseLatencies: number[] = [];
  const check = (name: string, passed: boolean, detail: string) => {
    results.push({ name, passed, detail });
    console.log(JSON.stringify({ name, passed, detail }));
  };
  async function extract(content: string) {
    const conversation = await repo.insert("conversations", {
      title: "Synthetic evaluation",
      metadata: {},
    });
    const source = await repo.insert("messages", {
      role: "user",
      conversation_id: conversation.id,
      content,
      metadata: {},
    });
    const job = await repo.insert("extraction_jobs", {
      source_message_id: source.id,
      status: "pending",
      attempts: 0,
      lease_until: null,
      error: null,
      saved_memory_ids: [],
    });
    return reconciliation.runJob(job.id);
  }
  try {
    const wag = await entities.createEntity({
      entity_type: "project",
      name: "Wag Trails",
    });
    await entities.addAlias(wag.id, "Trailbook");
    const ary = await entities.createEntity({
      entity_type: "project",
      name: "Ary Nexus",
    });
    const route = await memories.createMemory({
      content:
        "Wag Trails saves your favorite hiking routes so you can return to those walks later.",
    });
    await memories.linkMemoryToEntity(route.id, wag.id);
    const billing = await memories.createMemory({
      content:
        "Clevaryn sends customer invoices on the first business day of each month.",
    });
    const deadline = await memories.createMemory({
      content: "Ary Nexus is scheduled to launch on October 1, 2026.",
    });
    await memories.linkMemoryToEntity(deadline.id, ary.id);
    const contact = await memories.createMemory({
      content: "Wag Trails primary contact is Sam.",
    });
    await memories.linkMemoryToEntity(contact.id, wag.id);
    const semantic = await memories.searchMemories(
      "Which project lets me revisit hikes I enjoyed?",
    );
    check(
      "semantic recall",
      semantic[0]?.id === route.id,
      `top similarity=${semantic[0]?.similarity.toFixed(3) ?? "none"}`,
    );
    const paraphrase = await memories.searchMemories(
      "When does Clevaryn bill its clients?",
    );
    check(
      "paraphrased recall",
      paraphrase[0]?.id === billing.id,
      `top similarity=${paraphrase[0]?.similarity.toFixed(3) ?? "none"}`,
    );
    const resolved = await entities.resolveEntities("Tell me about Trailbook");
    const graph = await memories.getRelevantMemories(
      "Tell me about Trailbook",
      8,
      resolved.map((e) => e.id),
    );
    check(
      "entity-linked recall",
      graph.some(
        (m) => m.id === route.id && m.graph_path?.includes("Wag Trails"),
      ),
      "Alias resolved to the canonical project and linked memories",
    );
    const none = await memories.searchMemories(
      "What is the orbital period of Kepler-1625b?",
    );
    const noAnswer = await llm.reason({
      input: "What is my private access code for the observatory?",
      intent: "recall",
      entities: [],
      memories: [],
      history: [],
    });
    check(
      "no relevant memory",
      none.length === 0 &&
        /don.t|do not|not have|haven.t|no .*stored|no .*information/i.test(
          noAnswer,
        ),
      `retrieved=${none.length}; abstention=${noAnswer.slice(0, 220)}`,
    );
    await extract(
      "Correction: Ary Nexus launches on November 20, 2026, replacing the previous October 1, 2026 launch date.",
    );
    const correction = (await repo.list("memory_conflicts")).find(
      (c) => c.existing_memory_id === deadline.id && c.status === "pending",
    );
    if (correction)
      await reconciliation.resolveConflict(correction.id, "replaced");
    const oldRecord = await repo.get("memories", deadline.id);
    const historicalVersions = await repo.list("memory_versions", {
      record_id: deadline.id,
    });
    const recalled = await memories.searchMemories(
      "When does Ary Nexus launch?",
    );
    const answer = await llm.reason({
      input: "When does Ary Nexus launch?",
      intent: "recall",
      entities: [ary],
      memories: recalled.slice(0, 8),
      history: [],
    });
    check(
      "corrections / supersession",
      Boolean(correction) &&
        oldRecord?.status === "superseded" &&
        historicalVersions.some(
          (v) => v.snapshot.content === deadline.content,
        ) &&
        !recalled.some((m) => m.id === deadline.id) &&
        /November 20|2026-11-20/i.test(answer),
      `reviewed=${Boolean(correction)}; old fact excluded; answer=${answer.slice(0, 220)}`,
    );
    const brain = new AryBrainService(
      repo,
      memories,
      entities,
      llm,
      new ActionService(repo),
    );
    const conversationInput =
      "Remember: I prefer short bullet summaries for Ary Nexus status updates.";
    let savedIds: string[] = [];
    for await (const event of brain.respond({ input: conversationInput })) {
      if (event.type === "response")
        responseLatencies.push(
          Number(event.message.metadata.response_latency_ms),
        );
      if (event.type === "complete") savedIds = event.saved_memory_ids;
    }
    const savedFacts = await Promise.all(
      savedIds.map((id) => repo.get("memories", id)),
    );
    const evidence = await repo.list("memory_evidence");
    check(
      "conversation extraction",
      savedFacts.some(
        (m) => m?.status === "active" && /bullet/i.test(m.content),
      ) &&
        evidence.some(
          (e) =>
            savedIds.includes(e.memory_id) &&
            conversationInput.includes(e.quote),
        ),
      "Full brain conversation produced an active preference with an exact source quote",
    );
    await extract("Wag Trails primary contact is Jordan.");
    const conflict = (await repo.list("memory_conflicts")).find(
      (c) => c.existing_memory_id === contact.id && c.status === "pending",
    );
    check(
      "conflicting memories",
      Boolean(conflict) &&
        (await repo.get("memories", contact.id))?.status === "active",
      "Unreviewed contradiction retained without silently replacing the existing fact",
    );
  } catch (error) {
    check(
      "live provider execution",
      false,
      error instanceof OpenAIProviderError
        ? error.code
        : "Evaluation failed; inspect implementation",
    );
  } finally {
    const report = {
      executed_at: new Date().toISOString(),
      reasoning_model: llm.name,
      embedding_model: embedding.modelId,
      embedding_version: embedding.version,
      dimensions: embedding.dimensions,
      results,
      metrics,
      average_reasoning_latency_ms: average(
        metrics
          .filter((m) => m.operation === "reason" && m.status === "succeeded")
          .map((m) => m.latency_ms),
      ),
      average_response_latency_ms: average(responseLatencies),
      successful_reasoning_calls: metrics.filter(
        (m) => m.operation === "reason" && m.status === "succeeded",
      ).length,
      successful_embedding_calls: metrics.filter(
        (m) => m.operation === "embed" && m.status === "succeeded",
      ).length,
      estimated_cost_usd: metrics.reduce(
        (sum, m) => sum + (m.estimated_cost_usd ?? 0),
        0,
      ),
    };
    await mkdir(".data", { recursive: true });
    await writeFile(
      ".data/openai-evaluation.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        passed: results.filter((r) => r.passed).length,
        total: results.length,
        estimated_cost_usd: report.estimated_cost_usd,
        report: ".data/openai-evaluation.json",
      }),
    );
    await rm(dir, { recursive: true, force: true });
    if (results.length < 7 || results.some((r) => !r.passed))
      process.exitCode = 1;
  }
}
main().catch(() => {
  console.error("Could not run the live OpenAI evaluation");
  process.exitCode = 1;
});
