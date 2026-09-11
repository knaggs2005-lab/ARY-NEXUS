import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LocalRepository } from "../../src/infrastructure/repositories/local";
import { MemoryService } from "../../src/services/memory-service";
import { LocalEmbeddingProvider } from "../../src/infrastructure/providers/local";
export async function intelligenceBrowserCheck({
  run,
  evaluate,
  wait,
  click,
  dir,
}: {
  run: (...args: string[]) => string;
  evaluate: (s: string) => any;
  wait: (s: string) => any;
  click: (s: string) => void;
  dir: string;
}) {
  const file = join(dir, ".data/demo.json"),
    state = JSON.parse(await readFile(file, "utf8"));
  const repo = new LocalRepository(state.entities[0].user_id, file),
    memories = new MemoryService(repo, new LocalEmbeddingProvider());
  const nodes = [];
  for (const [name, type] of [
    ["Austin acceptance", "person"],
    ["Clevaryn acceptance", "company"],
    ["Client acceptance", "company"],
    ["Film acceptance", "project"],
  ] as const)
    nodes.push(
      await repo.insert("entities", {
        entity_type: type,
        name,
        description: "Isolated acceptance fixture",
        metadata: {},
      }),
    );
  for (let i = 1; i < nodes.length; i++)
    await repo.insert("relationships", {
      source_entity_id: nodes[i - 1].id,
      target_entity_id: nodes[i].id,
      relationship_type: ["works_at", "serves", "commissioned"][i - 1],
      strength: 0.85,
      metadata: {},
      valid_from: null,
      valid_to: null,
      memory_id: null,
    });
  const episode = await memories.createMemory({
    memory_type: "episodic",
    content: "The last interview finished with a missing pickup",
    summary: "Interview session acceptance",
    confidence_score: 0.65,
  });
  await memories.linkMemoryToEntity(episode.id, nodes[3].id);
  const old = await memories.createMemory({
    content: "The delivery deadline was Friday",
    summary: "Original deadline acceptance",
  });
  await memories.linkMemoryToEntity(old.id, nodes[3].id);
  await repo.update("memories", old.id, {
    status: "superseded",
    valid_to: new Date().toISOString(),
  });
  const current = await memories.createMemory({
    content: "The delivery deadline is Monday",
    summary: "Current deadline acceptance",
  });
  await repo.update("memories", current.id, { supersedes_id: old.id });
  await memories.linkMemoryToEntity(current.id, nodes[3].id);
  const c = await repo.insert("conversations", {
      title: "Acceptance mission",
      metadata: {},
    }),
    m = await repo.insert("messages", {
      conversation_id: c.id,
      role: "system",
      content: "Fixture",
      metadata: {},
    });
  const a = await repo.insert("actions", {
    conversation_id: c.id,
    tool_name: "create_task",
    action_type: "write",
    permission_level: 5,
    status: "succeeded",
    input: {},
    output: {},
    error: null,
    metadata: {},
    product_entity_ids: [nodes[3].id],
  });
  const o = await repo.insert("outcomes", {
    action_id: a.id,
    goal_id: null,
    status: "success",
    summary: "Accepted edit outcome",
    metrics: {},
    metadata: {},
  });
  await repo.update("messages", m.id, {
    metadata: {
      plan: {
        version: "orchestrator-v1",
        id: m.id,
        goal: "Deliver acceptance edit",
        summary: "Isolated saved mission",
        status: "complete",
        revision: 1,
        entity_ids: [nodes[3].id],
        memory_ids: [],
        states: { task: { action_id: a.id } },
      },
    },
  });
  run("press", "Meta+k");
  run("find", "label", "Search Ary commands", "fill", "WORLD");
  run("press", "Enter");
  wait(`document.querySelector('[aria-label="Search Nexus map"]')`);
  run("find", "label", "Search Nexus map", "fill", nodes[0].name);
  wait(`document.querySelector('[aria-label="Focus ${nodes[0].name}"]')`);
  evaluate(
    `document.querySelector('[aria-label="Focus ${nodes[0].name}"]').click();true`,
  );
  const follow = (label: string) => {
    wait(
      `Array.from(document.querySelectorAll('[aria-label="Nexus map context"] .${""}relationship button, [aria-label="Nexus map context"] button')).some(b=>b.textContent.trim()===${JSON.stringify(label)})`,
    );
    evaluate(
      `Array.from(document.querySelectorAll('[aria-label="Nexus map context"] button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click();true`,
    );
    wait(
      `document.querySelector('[aria-label="Nexus map context"] h2')?.textContent===${JSON.stringify(label)} && document.querySelector('[aria-label="Connected intelligence"]')`,
    );
  };
  for (const n of nodes.slice(1)) follow(n.name);
  wait(`document.body.innerText.includes('Current deadline acceptance')`);
  assert.ok(
    !evaluate(
      `document.querySelector('[aria-label="Connected intelligence"]').innerText.includes('Original deadline acceptance')`,
    ),
  );
  click("What happened last time?");
  wait(`document.body.innerText.includes('Interview session acceptance')`);
  click("What changed?");
  wait(`document.body.innerText.includes('Replaces an earlier recorded fact')`);
  run("select", '[aria-label="Memory and relationship time scope"]', "all");
  wait(
    `document.body.innerText.includes('supersedes') || document.body.innerText.includes('Replaces an earlier recorded fact')`,
  );
  click("What does ARY know about this?");
  wait(`document.body.innerText.includes('Original deadline acceptance')`);
  evaluate(
    `Array.from(document.querySelectorAll('summary')).find(b=>b.textContent==='Confidence & provenance').click();true`,
  );
  assert.ok(
    evaluate(
      `document.body.innerText.includes('Authenticated manual memory submission')`,
    ),
  );
  run(
    "screenshot",
    process.env.ARY_PRESENCE_REDUCED
      ? "/tmp/ary-world-reduced.png"
      : "/tmp/ary-world.png",
  );
  follow("Deliver acceptance edit");
  follow("Accepted edit outcome");
  assert.ok(
    evaluate(
      `document.querySelector('[aria-label="Nexus map context"]').textContent.includes(${JSON.stringify(o.id)})`,
    ),
  );
  // Semantic retrieval runs through the real local HTTP/MemoryService path in this credential-free fixture.
  run(
    "find",
    "label",
    "Semantic memory search",
    "fill",
    "delivery deadline Monday",
  );
  click("Search meaning");
  wait(
    `document.querySelector('[aria-label="Connected intelligence"]')?.textContent.includes('Why retrieved')`,
  );
  assert.ok(
    evaluate(`document.body.innerText.includes('Current deadline acceptance')`),
  );
  run("set", "viewport", "900", "900");
  run("screenshot", "/tmp/ary-world-compact.png");
  assert.ok(evaluate(`document.documentElement.scrollWidth <= innerWidth+1`));
  // Both primary destinations mount the same renderer; old library remains reachable.
  run("press", "Meta+k");
  run("find", "label", "Search Ary commands", "fill", "MEMORY");
  run("press", "Enter");
  wait(
    `document.querySelector('[aria-label="Central Nexus intelligence map"]')`,
  );
  assert.equal(
    evaluate(`!!document.querySelector('[data-nextjs-dialog]')`),
    false,
  );
  console.log(
    "World/Memory browser acceptance: source chain, episode, supersession, provenance, mission outcome, semantic retrieval, responsive map passed.",
  );
}
