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
it("a newer turn fences an older final transcript still waiting to enter Brain", async () => {
  const f = fixture(async function* () {
    yield { type: "response", message: { content: "latest" } };
  });
  f.emit(final("old", "old"));
  f.emit({ type: "speech_start", turn_id: "new" });
  f.emit(final("new", "new"));
  await f.bridge.idle();
  expect(f.brain.respond).toHaveBeenCalledOnce();
  expect(f.brain.respond.mock.calls[0][0]).toMatchObject({ input: "new" });
  f.bridge.close();
});

it("speaks the committed response before slow extraction completes while still draining Brain", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  let extractionStarted = false,
    extractionFinished = false;
  const f = fixture(async function* () {
    yield { type: "response", message: { content: "Committed answer" } };
    extractionStarted = true;
    await wait;
    extractionFinished = true;
    yield { type: "complete", saved_memory_ids: ["preserved"], warnings: [] };
  });
  f.emit(final());
  await vi.waitFor(() => expect(extractionStarted).toBe(true));
  expect(f.session.speakText).toHaveBeenCalledExactlyOnceWith(
    "Committed answer",
  );
  expect(extractionFinished).toBe(false);
  release();
  await f.bridge.idle();
  expect(extractionFinished).toBe(true);
  f.bridge.close();
});

it("uses the same interrupt signal for speech started while extraction is pending", async () => {
  let release!: () => void, speechSignal: AbortSignal | undefined;
  const wait = new Promise<void>((r) => (release = r));
  const f = fixture(async function* () {
    yield { type: "response", message: { content: "Answer" } };
    await wait;
    yield { type: "complete" };
  });
  f.bridge.close();
  const bridge = new RealtimeBrainBridge(
    f.session,
    f.brain,
    "canonical",
    () => {},
    undefined,
    async (_text, signal) => {
      speechSignal = signal;
    },
  );
  f.emit(final());
  await vi.waitFor(() => expect(speechSignal).toBeDefined());
  f.emit({ type: "speech_start", turn_id: "new" });
  expect(speechSignal?.aborted).toBe(true);
  release();
  await bridge.idle();
  bridge.close();
});
it("speaks a completed Brain sentence before the final response without replay", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let extraction = false;
  const f = fixture(async function* (_input: unknown, options: any) {
    options.onDelta("First answer. ");
    await gate;
    options.onDelta("More detail");
    yield {
      type: "response",
      message: { content: "First answer. More detail" },
    };
    extraction = true;
    yield { type: "complete" };
  });
  f.emit(final());
  try {
    await vi.waitFor(() =>
      expect(f.session.speakText).toHaveBeenCalledExactlyOnceWith(
        "First answer.",
      ),
    );
  } finally {
    release();
  }
  await f.bridge.idle();
  expect(f.session.speakText.mock.calls.map((a: any[]) => a[0])).toEqual([
    "First answer.",
    "More detail",
  ]);
  expect(extraction).toBe(true);
  f.bridge.close();
});
it("does not speak unfinished streamed words until final response", async () => {
  const f = fixture(async function* (_input: unknown, options: any) {
    options.onDelta("An unfinished");
    await Promise.resolve();
    expect(f.session.speakText).not.toHaveBeenCalled();
    yield { type: "response", message: { content: "An unfinished" } };
  });
  f.emit(final());
  await f.bridge.idle();
  expect(f.session.speakText).toHaveBeenCalledExactlyOnceWith("An unfinished");
  f.bridge.close();
});
it("rejects a final stream mismatch without replaying a different answer", async () => {
  const f = fixture(async function* (_input: unknown, options: any) {
    options.onDelta("Partial");
    yield { type: "response", message: { content: "Different answer" } };
  });
  f.emit(final());
  await f.bridge.idle();
  expect(f.session.speakText).not.toHaveBeenCalled();
  expect(f.events).toContainEqual(
    expect.objectContaining({
      type: "failure",
      failure: expect.objectContaining({ code: "BRAIN_STREAM_MISMATCH" }),
    }),
  );
});
it("interruption fences late streamed sentences", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const f = fixture(async function* (_input: unknown, options: any) {
    options.onDelta("First. ");
    await gate;
    options.onDelta("Late. ");
    yield { type: "response", message: { content: "First. Late." } };
  });
  f.emit(final());
  await vi.waitFor(() => expect(f.session.speakText).toHaveBeenCalledOnce());
  f.emit({ type: "speech_start", turn_id: "next" });
  release();
  await f.bridge.idle();
  expect(f.session.speakText).toHaveBeenCalledExactlyOnceWith("First.");
  f.bridge.close();
});
it("failure stops queued speech before extraction completes", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const f = fixture(async function* (_input: unknown, options: any) {
    options.onDelta("Unfinished");
    yield { type: "error", error: "provider failed" };
    await gate;
    yield { type: "complete" };
  });
  f.emit(final());
  try {
    await vi.waitFor(() =>
      expect(f.events).toContainEqual(
        expect.objectContaining({ type: "failure" }),
      ),
    );
  } finally {
    release();
  }
  await f.bridge.idle();
  expect(f.session.speakText).not.toHaveBeenCalled();
});
