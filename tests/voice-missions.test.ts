import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { missionFixture } from "../scripts/lib/mission-fixture";
import { OrchestrationConversationService } from "../src/services/orchestration-conversation-service";
import type { Message } from "../src/domain/models";
let dir: string, f: ReturnType<typeof missionFixture>, source: Message;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ary-voice-mission-"));
  f = missionFixture(join(dir, "fixture.json"), randomUUID());
  const conversation = await f.repo.insert("conversations", {
    title: "Voice mission",
    metadata: {},
  });
  source = await f.repo.insert("messages", {
    role: "user",
    content: "Create a mission to validate the Wag Trails release",
    conversation_id: conversation.id,
    metadata: { modality: "voice" },
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("creates a durable draft through the existing action registry with voice provenance and no execution", async () => {
  const router = new OrchestrationConversationService(f.repo, f.coordinator);
  const reply = await router.handle(source.content, source);
  const id = reply!.metadata.mission_id as string;
  expect((await f.engine.inspect(id)).mission?.state).toBe("DRAFT");
  expect(await f.repo.list("tasks")).toHaveLength(0);
  const action = (await f.repo.list("actions")).find(
    (a) => a.tool_name === "mission.create" && a.status === "succeeded",
  )!;
  expect(action.metadata.source_message_id).toBe(source.id);
  expect(action.conversation_id).toBe(source.conversation_id);
  expect(
    (await f.repo.list("outcomes")).some((o) => o.action_id === action.id),
  ).toBe(true);
  const replay = await router.handle(source.content, source);
  expect(replay!.metadata.mission_id).toBe(id);
});
it("a denied mission policy blocks voice creation and records the attempt", async () => {
  await f.actions.permissions.savePolicy({
    tool: "mission.create",
    level: 0,
    reason: "isolated deny",
  });
  const reply = await new OrchestrationConversationService(
    f.repo,
    f.coordinator,
  ).handle(source.content, source);
  expect(reply!.metadata.mission_id).toBeUndefined();
  expect(await f.coordinator.history()).toHaveLength(0);
  expect(
    (await f.repo.list("actions")).some(
      (a) => a.tool_name === "mission.create" && a.status === "blocked",
    ),
  ).toBe(true);
});
it("ordinary conversation stays outside the deterministic mission adapter", async () => {
  expect(
    await new OrchestrationConversationService(f.repo, f.coordinator).handle(
      "What is a mission?",
      source,
    ),
  ).toBeNull();
  expect(await f.repo.list("actions")).toHaveLength(0);
});
