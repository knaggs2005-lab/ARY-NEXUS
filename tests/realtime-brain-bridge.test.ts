import { it, expect, vi } from "vitest";
import { RealtimeBrainBridge } from "../src/services/realtime-brain-bridge";
import { OpenAIRealtimeSessionProvider } from "../src/infrastructure/providers/openai-realtime";
function fixture(respond: any, conversationId = "canonical") {
  const handlers = new Set<(e: any) => void>();
  const session: any = {
    id: "s",
    nexus_conversation_id: "canonical",
    state: "IDLE",
    speakText: vi.fn(),
    sendAudio: vi.fn(),
    interrupt: vi.fn(),
    close: vi.fn(),
    onEvent: (h: any) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
  const events: any[] = [];
  const brain = { respond: vi.fn(respond) };
  const bridge = new RealtimeBrainBridge(session, brain, conversationId, (e) =>
    events.push(e),
  );
  return {
    session,
    brain,
    bridge,
    events,
    emit: (e: any) => handlers.forEach((h) => h(e)),
  };
}
const final = (
  id = "u1",
  text = "Remember my preferred project is Ary Nexus",
) => ({ type: "transcript_final", turn_id: id, text });
it("final transcript invokes existing Brain once, with voice modality and canonical response only", async () => {
  const order: string[] = [];
  const f = fixture(async function* () {
    order.push("delta");
    yield { type: "delta", text: "outdated partial" };
    order.push("response");
    yield { type: "response", message: { content: "Canonical approved text" } };
    order.push("complete");
    yield {
      type: "complete",
      saved_memory_ids: ["existing-extraction"],
      warnings: [],
    };
  });
  f.emit({ type: "transcript_delta", turn_id: "u1", text: "partial" });
  expect(f.brain.respond).not.toHaveBeenCalled();
  f.emit(final());
  f.emit(final());
  await f.bridge.idle();
  expect(f.brain.respond).toHaveBeenCalledOnce();
  expect(f.brain.respond.mock.calls[0][0]).toEqual({
    input: final().text,
    conversation_id: "canonical",
    modality: "voice",
  });
  expect(order).toEqual(["delta", "response", "complete"]);
  expect(f.session.speakText).toHaveBeenCalledExactlyOnceWith(
    "Canonical approved text",
  );
  f.bridge.close();
});
it("approval remains Brain-owned and is spoken without approving anything", async () => {
  const f = fixture(async function* () {
    yield {
      type: "response",
      message: { content: "I need your approval for that." },
    };
    yield { type: "complete" };
  });
  f.emit(final());
  await f.bridge.idle();
  expect(f.session.speakText).toHaveBeenCalledWith(
    "I need your approval for that.",
  );
  expect(f.session.sendAudio).not.toHaveBeenCalled();
  f.bridge.close();
});
it("Brain failure never substitutes independent realtime reasoning", async () => {
  const f = fixture(async function* () {
    yield { type: "error", error: "private error" };
  });
  f.emit(final());
  await f.bridge.idle();
  expect(f.session.speakText).not.toHaveBeenCalled();
  expect(f.events.at(-1).failure.code).toBe("BRAIN_VOICE_FAILED");
  expect(JSON.stringify(f.events)).not.toContain("private error");
});
it("barge-in aborts reasoning, preserves external effects, and does not speak stale results", async () => {
  let signal: AbortSignal | undefined, release!: () => void;
  const waiting = new Promise<void>((r) => (release = r));
  const f = fixture(async function* (_input: any, options: any) {
    signal = options.signal;
    await waiting;
    yield { type: "response", message: { content: "Stale" } };
  });
  f.emit(final());
  await Promise.resolve();
  f.emit({
    type: "interruption",
    interruption: { kind: "BOTH", cancel_external_effect: false },
  });
  expect(signal?.aborted).toBe(true);
  release();
  await f.bridge.idle();
  expect(f.session.speakText).not.toHaveBeenCalled();
  f.bridge.close();
});
it("current transcript protocol and controlled response never exposes tools/history", async () => {
  let emit: (e: any) => void = () => {};
  const sent: any[] = [];
  const session = await new OpenAIRealtimeSessionProvider(() => ({
    connect: async (cb) => {
      emit = cb;
      cb({ type: "session.updated" });
    },
    send: (c) => sent.push(c),
    close: async () => {},
  })).createSession({
    user_id: "owner",
    conversation_id: "canonical",
    classic_fallback_available: true,
  });
  const events: any[] = [];
  session.onEvent((e) => events.push(e));
  emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "u1",
    transcript: "Hello",
  });
  expect(events[0]).toMatchObject({
    type: "transcript_final",
    turn_id: "u1",
    text: "Hello",
  });
  session.speakText!("Approved words only.");
  expect(sent[0]).toMatchObject({
    type: "response.create",
    response: { conversation: "none", input: [], output_modalities: ["audio"] },
  });
  expect(() => session.speakText!("duplicate")).toThrow();
  session.interrupt("BOTH");
  emit({ type: "response.created", response: { id: "late" } });
  expect(sent.filter((e) => e.type === "response.cancel")).toEqual([
    { type: "response.cancel", response_id: "late" },
  ]);
  await session.close();
});

it("real canonical Brain persists one voice turn and extracts memory through existing storage", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    { join } = await import("node:path");
  const { LocalRepository } =
    await import("../src/infrastructure/repositories/local");
  const { AryBrainService } = await import("../src/services/ary-brain-service");
  const { MemoryService } = await import("../src/services/memory-service");
  const { EntityService } = await import("../src/services/entity-service");
  const { ActionService } = await import("../src/services/action-service");
  const { LocalEmbeddingProvider, MockLanguageModel } =
    await import("../src/infrastructure/providers/local");
  const directory = await mkdtemp(join(tmpdir(), "ary-realtime-brain-"));
  try {
    const repo = new LocalRepository(
        crypto.randomUUID(),
        join(directory, "fixture.json"),
      ),
      memory = new MemoryService(repo, new LocalEmbeddingProvider()),
      brain = new AryBrainService(
        repo,
        memory,
        new EntityService(repo),
        new MockLanguageModel(),
        new ActionService(repo),
      );
    const conversation = await repo.insert("conversations", {
      title: "isolated voice",
      metadata: {},
    });
    const f = fixture(brain.respond.bind(brain), conversation.id);
    f.emit(final("final-turn", "Remember: I prefer quiet morning walks."));
    f.emit(final("final-turn", "Remember: I prefer quiet morning walks."));
    await f.bridge.idle();
    const messages = await repo.list("messages");
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(messages[0].conversation_id).toBe(conversation.id);
    expect((await repo.list("memories"))[0].content).toContain(
      "quiet morning walks",
    );
    expect(f.session.speakText).toHaveBeenCalledOnce();
    f.bridge.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
