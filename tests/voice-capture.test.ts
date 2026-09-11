import { afterEach, expect, it, vi } from "vitest";
// Focused hook lifecycle harness; browser rendering is verified separately.
const harness = vi.hoisted(() => ({
  cleanup: [] as Array<() => void>,
  auth: [] as Array<
    (event: string, session: { user: { id: string } } | null) => void
  >,
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: (effect: () => undefined | (() => void)) => {
    const cleanup = effect();
    if (cleanup) harness.cleanup.push(cleanup);
  },
}));
vi.mock("../src/components/api", () => ({
  authClient: {
    auth: {
      onAuthStateChange: (
        callback: (
          event: string,
          session: { user: { id: string } } | null,
        ) => void,
      ) => {
        harness.auth.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
  api: vi.fn(async () =>
    Response.json({ stt: { model: "stt" }, tts: { model: "tts" } }),
  ),
}));
vi.mock("../src/components/voice/input-meter", () => ({
  observeMicrophone: vi.fn(() => vi.fn()),
}));
import { useAryVoice } from "../src/components/voice/use-ary-voice";
import { api } from "../src/components/api";
class Recorder {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  onstop: (() => void) | null = null;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  } // Explicitly deliver delayed browser callbacks in each test.
}
function setup() {
  const streams: Array<{
    getTracks: () => Array<{ stop: ReturnType<typeof vi.fn> }>;
  }> = [];
  const getUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    streams.push(stream);
    return stream;
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("window", { MediaRecorder: Recorder });
  vi.stubGlobal("MediaRecorder", Recorder);
  return { streams, getUserMedia };
}
afterEach(() => {
  for (const cleanup of harness.cleanup.splice(0)) cleanup();
  harness.auth.length = 0;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("ignores late stop/data/error from an old recording without killing the new microphone", async () => {
  const { streams } = setup();
  const recordings: Recorder[] = [];
  class Observed extends Recorder {
    constructor() {
      super();
      recordings.push(this);
    }
  }
  vi.stubGlobal("MediaRecorder", Observed);
  vi.stubGlobal("window", { MediaRecorder: Observed });
  const transcript = vi.fn();
  const voice = useAryVoice(transcript, vi.fn());
  await voice.startListening();
  await voice.startListening();
  expect(streams[0].getTracks()[0].stop).toHaveBeenCalled();
  recordings[0].onstop?.();
  recordings[0].ondataavailable?.({ data: new Blob(["old"]) });
  recordings[0].onerror?.();
  expect(streams[1].getTracks()[0].stop).not.toHaveBeenCalled();
  expect(
    vi.mocked(api).mock.calls.filter(([path]) => path === "voice/transcribe"),
  ).toHaveLength(0);
  voice.interruptAll();
  expect(streams[1].getTracks()[0].stop).toHaveBeenCalled();
  expect(transcript).not.toHaveBeenCalled();
});
it("releases a late permission grant after cancellation and never starts recording", async () => {
  const { getUserMedia } = setup();
  let grant!: (stream: unknown) => void;
  getUserMedia.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve as (stream: unknown) => void;
      }),
  );
  const interrupt = vi.fn();
  const voice = useAryVoice(vi.fn(), interrupt);
  const starting = voice.startListening();
  voice.interruptAll();
  const stop = vi.fn();
  grant({ getTracks: () => [{ stop }] });
  await starting;
  expect(stop).toHaveBeenCalled();
  expect(interrupt).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "keeps streamed partials out of Chat and respects cancellation: %s",
  async (cancel) => {
    setup();
    let recording!: Recorder;
    class Observed extends Recorder {
      constructor() {
        super();
        recording = this;
      }
    }
    vi.stubGlobal("MediaRecorder", Observed);
    vi.stubGlobal("window", { MediaRecorder: Observed });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(api)
      .mockResolvedValueOnce(
        Response.json({ stt: { model: "stt" }, tts: { model: "tts" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(c) {
              stream = c;
            },
          }),
        ),
      );
    const transcript = vi.fn();
    const voice = useAryVoice(transcript, vi.fn());
    await voice.startListening();
    recording.ondataavailable?.({ data: new Blob(["audio"]) });
    voice.stopListening();
    recording.onstop?.();
    const emit = (event: unknown) =>
      stream.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
    emit({ type: "delta", text: "Create a task" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transcript).not.toHaveBeenCalled();
    if (cancel) voice.cancelCapture();
    else {
      emit({ type: "complete", text: "Create a task to review the project." });
      stream.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (cancel) expect(transcript).not.toHaveBeenCalled();
    else
      expect(transcript).toHaveBeenCalledExactlyOnceWith(
        "Create a task to review the project.",
      );
  },
);

it("releases capture when the signed-in owner changes or signs out", async () => {
  const { streams } = setup();
  const voice = useAryVoice(vi.fn(), vi.fn());
  harness.auth[0]("INITIAL_SESSION", { user: { id: "owner" } });
  await voice.startListening();
  harness.auth[0]("SIGNED_IN", { user: { id: "another-owner" } });
  expect(streams[0].getTracks()[0].stop).toHaveBeenCalled();
  await voice.startListening();
  harness.auth[0]("SIGNED_OUT", null);
  expect(streams[1].getTracks()[0].stop).toHaveBeenCalled();
});
