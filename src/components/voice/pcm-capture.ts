/** AudioWorklet runs independently of animation frames; required for background listening. */
export async function capturePCM(
  stream: MediaStream,
  signal: AbortSignal,
  receive: (samples: Float32Array, rate: number) => void,
  options: {
    readonly sampleRate?: number;
    readonly channelCount?: number;
  } = {},
) {
  let context: AudioContext | undefined;
  let stopped = false;
  let source: MediaStreamAudioSourceNode | undefined,
    node: AudioWorkletNode | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (node) node.port.onmessage = null;
    source?.disconnect();
    node?.disconnect();
    void context?.close().catch(() => {});
    stream.getTracks().forEach((track) => track.stop());
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    context = new AudioContext(
      options.sampleRate ? { sampleRate: options.sampleRate } : undefined,
    );
    await context.audioWorklet.addModule("/audio/ary-capture.js");
    signal.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    node = new AudioWorkletNode(context, "ary-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: options.channelCount ?? 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!signal.aborted) receive(event.data, context!.sampleRate);
    };
    source.connect(node);
    node.connect(context.destination); // Processor writes silence only.
    await context.resume();
    signal.throwIfAborted();
    if (context.state !== "running")
      throw new Error("Audio is suspended. Start the conversation again.");
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
