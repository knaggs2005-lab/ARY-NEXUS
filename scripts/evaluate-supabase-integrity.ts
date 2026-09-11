/** Live HTTP/RLS integration test. Requires an explicitly approved disposable
 * Supabase user. Never accepts the working user's session or service-role key.
 * Credentials stay in environment variables; output contains no tokens/keys.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { SupabaseRepository } from "../src/infrastructure/repositories/supabase";
import type { BrainEvent } from "../src/services/ary-brain-service";

loadEnvConfig(process.cwd());
async function main() {
  const email = process.env.ARY_INTEGRITY_EMAIL;
  const password = process.env.ARY_INTEGRITY_PASSWORD;
  const userId = process.env.ARY_INTEGRITY_USER_ID;
  assert.ok(
    email?.startsWith("recovery-") &&
      email.endsWith("@ary-nexus.invalid") &&
      password &&
      userId,
    "Explicit disposable test identity required",
  );
  const base = process.env.ARY_INTEGRITY_APP_URL ?? "http://127.0.0.1:3000";
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email: email!,
    password,
  });
  assert.ok(
    !error && data.session && data.user?.id === userId,
    "Disposable identity authentication failed",
  );
  const token = data.session.access_token;
  const repo = new SupabaseRepository(userId, client);
  const results: { name: string; passed: boolean }[] = [];
  const check = (name: string, value: unknown) => {
    results.push({ name, passed: Boolean(value) });
    console.log(JSON.stringify(results.at(-1)));
    assert.ok(value, name);
  };
  async function api(path: string, body?: unknown, allowedStatus = 200) {
    const res = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await res.json();
    assert.equal(
      res.status,
      allowedStatus,
      `${path}: ${JSON.stringify(value)}`,
    );
    return value;
  }
  const latencies: number[] = [];
  let conversationId: string | undefined;
  async function chat(input: string) {
    const start = performance.now();
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input, conversation_id: conversationId }),
    });
    assert.equal(response.status, 200);
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as BrainEvent);
    const answer = events.find((e) => e.type === "response");
    assert.ok(answer?.type === "response", "Real response event required");
    conversationId = answer.conversation_id;
    latencies.push(performance.now() - start);
    assert.ok(!events.some((e) => e.type === "error"));
    const jobId = answer.message.metadata.extraction_job_id;
    assert.equal(typeof jobId, "string");
    // after() may finish after the response closes. Wait for a bounded terminal state.
    const deadline = Date.now() + 120000;
    let job = await repo.get("extraction_jobs", jobId as string);
    while (
      job &&
      ["pending", "running"].includes(job.status) &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 500));
      job = await repo.get("extraction_jobs", jobId as string);
    }
    assert.equal(
      job?.status,
      "completed",
      job?.error ?? "Extraction did not finish",
    );
    return { answer, job: job! };
  }
  try {
    // Initialize public profile through the same authenticated application API.
    const initial = await api("dashboard");
    assert.equal(initial.mode, "supabase");
    assert.equal(
      initial.memoryRecords.length,
      0,
      "Refusing to run in a populated workspace",
    );
    const ary = await api(
      "entities",
      {
        name: "Ary Nexus",
        entity_type: "project",
        metadata: { integrity_fixture: true },
      },
      201,
    );
    const first = await chat(
      "Ary Nexus launch priority is voice verification.",
    );
    const beforeCorrection = new Date().toISOString();
    const facts = await repo.list("memories");
    const old = facts.find((m) => /voice verification/i.test(m.content));
    check("real conversation extraction", old && old.status === "active");
    check(
      "provider/model metadata",
      first.answer.message.metadata.provider_id === "openai" &&
        typeof first.answer.message.metadata.provider === "string",
    );
    check(
      "original source and evidence",
      (await repo.list("memory_sources", { memory_id: old!.id })).some(
        (s) => s.source_message_id === first.job.source_message_id,
      ) &&
        (await repo.list("memory_evidence", { memory_id: old!.id })).length > 0,
    );
    check(
      "entity link",
      (await repo.list("memory_entities", { memory_id: old!.id })).some(
        (l) => l.entity_id === ary.id,
      ),
    );
    const second = await chat(
      "Actually, Calendar connection is now the launch priority.",
    );
    const conflicts = await repo.list("memory_conflicts");
    const conflict = conflicts.find(
      (c) => c.existing_memory_id === old!.id && c.status === "pending",
    );
    check(
      "unresolved contradiction held for review",
      conflict &&
        (await repo.get("memories", conflict.candidate_memory_id))?.status ===
          "disputed" &&
        (await repo.get("memories", old!.id))?.status === "active",
    );
    // This acceptance of synthetic evidence is explicitly part of the controlled test.
    await api(`conflicts/${conflict!.id}`, { resolution: "replaced" });
    const current = await repo.get("memories", conflict!.candidate_memory_id);
    check(
      "reviewed supersession",
      current?.status === "active" &&
        current.supersedes_id === old!.id &&
        (await repo.get("memories", old!.id))?.status === "superseded",
    );
    const recall = await api(
      `memories?q=${encodeURIComponent("What should we connect first before shipping Ary Nexus?")}`,
    );
    check(
      "paraphrase retrieves current fact only",
      recall.some((m: { id: string }) => m.id === current!.id) &&
        !recall.some((m: { id: string }) => m.id === old!.id),
    );
    const history = await api(`memories/${old!.id}/history`);
    check(
      "source/version history retained",
      history.versions.length >= 2 && history.evidence.length > 0,
    );
    const past = await api(
      `memory-timeline?known_at=${encodeURIComponent(beforeCorrection)}`,
    );
    check(
      "historical knowledge retains original fact",
      past.some((m: { id: string }) => m.id === old!.id),
    );
    const third = await chat(current!.content);
    const afterDuplicate = await repo.list("memories");
    check(
      "duplicate adds evidence without another fact",
      afterDuplicate.length === 2 &&
        (await repo.list("memory_evidence", { memory_id: current!.id })).some(
          (e) => e.source_message_id === third.job.source_message_id,
        ),
    );
    const evidenceCount = (await repo.list("memory_evidence")).length;
    await api(`extraction-jobs/${third.job.id}/retry`, {});
    check(
      "completed job replay is idempotent",
      (await repo.list("memories")).length === 2 &&
        (await repo.list("memory_evidence")).length === evidenceCount &&
        (await repo.get("extraction_jobs", third.job.id))?.attempts ===
          third.job.attempts,
    );
    const answer = await chat(
      "What is Ary Nexus's current launch priority? Explain the previous priority using its source history if available.",
    );
    check(
      "grounded current-priority response",
      /calendar/i.test(answer.answer.message.content) &&
        answer.answer.retrieved_memories.some((m) => m.id === current!.id) &&
        !answer.answer.retrieved_memories.some((m) => m.id === old!.id),
    );
    const calls = await repo.list("model_calls");
    const reason = calls.find(
      (c) =>
        c.operation === "reason" && c.status === "succeeded" && c.action_id,
    );
    check(
      "persisted model tokens latency and estimated cost",
      reason &&
        reason.input_tokens! > 0 &&
        reason.output_tokens! > 0 &&
        reason.latency_ms > 0 &&
        reason.estimated_cost_usd! > 0 &&
        Number.isFinite(Date.parse(reason.created_at)),
    );
    check(
      "real embedding telemetry",
      calls.some(
        (c) => c.model === "text-embedding-3-large" && c.status === "succeeded",
      ),
    );
    check(
      "action/outcome linkage",
      reason &&
        (await repo.list("outcomes", { action_id: reason.action_id! })).length >
          0,
    );
    const cost = {
      action_id: reason!.action_id!,
      parent_id: null,
      estimated_compute_cost_usd: null,
      actual_model_cost_usd: null,
      additional_compute_cost_usd: 0.0123,
      tool_cost_usd: 0.0045,
      confidence: 0,
      attribution_notes:
        "Synthetic isolated cost-column fixture; not a claim of billed cost or financial impact.",
      evidence: "integrity-test fixture",
    };
    const entry = await api("roi/costs", cost, 201);
    check(
      "migration 011 columns write and read",
      entry.additional_compute_cost_usd === cost.additional_compute_cost_usd &&
        entry.tool_cost_usd === cost.tool_cost_usd,
    );
    await api("roi/costs", cost, 409);
    check(
      "duplicate cost root rejected without overcounting",
      (await repo.list("roi_cost_entries", { action_id: cost.action_id }))
        .length === 1,
    );
    const revision = await api(
      "roi/costs",
      {
        ...cost,
        parent_id: entry.id,
        additional_compute_cost_usd: null,
        tool_cost_usd: null,
      },
      201,
    );
    await api("roi/costs", { ...cost, parent_id: entry.id }, 409);
    check(
      "cost revision retry is unique",
      (await repo.list("roi_cost_entries", { action_id: cost.action_id }))
        .length === 2 && revision.parent_id === entry.id,
    );
    const other = calls.find(
      (c) => c.action_id && c.action_id !== reason!.action_id,
    )!;
    const optional = await api(
      "roi/costs",
      {
        action_id: other.action_id,
        parent_id: null,
        estimated_compute_cost_usd: null,
        actual_model_cost_usd: null,
        confidence: 0,
        attribution_notes: "No optional costs assessed in isolated fixture.",
        evidence: "",
      },
      201,
    );
    check(
      "missing optional costs stay unknown",
      optional.additional_compute_cost_usd === null &&
        optional.tool_cost_usd === null,
    );
    const report = await api("roi");
    check(
      "Economics reads current revision and retained history",
      report.costHistory.some((c: { id: string }) => c.id === entry.id) &&
        report.costHistory.some((c: { id: string }) => c.id === revision.id),
    );
    check(
      "no fabricated impact",
      (await repo.list("roi_outcome_entries")).length === 0,
    );
    check(
      "no extraction failures remain",
      !(await repo.list("extraction_jobs")).some(
        (j) => j.status !== "completed",
      ),
    );
    await writeFile(
      "/tmp/ary-supabase-integrity-results.json",
      JSON.stringify(
        {
          userId,
          results,
          averageConversationWallMs: Math.round(
            latencies.reduce((a, b) => a + b, 0) / latencies.length,
          ),
          modelCalls: calls.length,
          conversations: [
            first.answer.conversation_id,
            second.answer.conversation_id,
          ],
          fixtureCleanupRequired: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.auth.signOut();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Integrity evaluation failed",
  );
  process.exitCode = 1;
});
