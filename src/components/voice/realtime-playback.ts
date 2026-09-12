import type { RealtimeVoiceAudioFrame } from "../../domain/realtime-voice";
export type PlaybackState =
  "IDLE" | "BUFFERING" | "PLAYING" | "STOPPED" | "FAILED";
/** Dedicated hardware-rate output context; input PCM carries its own real sample rate. */
export class RealtimePlayback {
  private context?: AudioContext;
  private nodes = new Set<AudioBufferSourceNode>();
  private end = 0;
  private state: PlaybackState = "IDLE";
  private chunks = 0;
  private bytes = 0;
  private underruns = 0;
  private first: number | null = null;
  private started = 0;
  constructor(
    private readonly createContext = () => new AudioContext(),
    private readonly changed: (playing: boolean) => void = () => {},
  ) {}
  async start() {
    if (this.context) return;
    this.context = this.createContext(); // Never pass the microphone's 24000-Hz context.
    this.started = performance.now();
    try {
      await this.context.resume();
      this.state = "BUFFERING";
    } catch {
      await this.close();
      this.state = "FAILED";
      throw new Error("PLAYBACK_UNAVAILABLE");
    }
  }
  snapshot() {
    return {
      state: this.state,
      audio_chunks_received: this.chunks,
      audio_bytes_received: this.bytes,
      queued_audio_ms: Math.max(
        0,
        (this.end - (this.context?.currentTime ?? this.end)) * 1000,
      ),
      first_audio_latency_ms: this.first,
      underrun_count: this.underruns,
    };
  }
  accept(frame: RealtimeVoiceAudioFrame) {
    const context = this.context;
    const bytes =
      frame.data instanceof Uint8Array
        ? frame.data
        : new Uint8Array(frame.data);
    if (
      !context ||
      this.state === "FAILED" ||
      frame.encoding !== "pcm16" ||
      frame.channels !== 1 ||
      frame.sample_rate_hz !== 24000 ||
      !bytes.length ||
      bytes.length % 2
    )
      return this.failure("INVALID_PLAYBACK_FRAME");
    const duration = bytes.length / 2 / frame.sample_rate_hz;
    if (duration * 1000 + this.snapshot().queued_audio_ms > 1000)
      return this.failure("PLAYBACK_BACKPRESSURE");
    if (this.chunks && this.end < context.currentTime) this.underruns++;
    const buffer = context.createBuffer(
      1,
      bytes.length / 2,
      frame.sample_rate_hz,
    );
    const channel = buffer.getChannelData(0),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < channel.length; i++)
      channel[i] = view.getInt16(i * 2, true) / 32768;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    const when = Math.max(context.currentTime + 0.015, this.end);
    this.end = when + duration;
    this.nodes.add(node);
    node.onended = () => {
      node.disconnect();
      this.nodes.delete(node);
      if (!this.nodes.size && this.state === "PLAYING") {
        this.state = "IDLE";
        this.changed(false);
      }
    };
    node.start(when);
    this.chunks++;
    this.bytes += bytes.length;
    this.first ??=
      performance.now() - this.started + (when - context.currentTime) * 1000;
    this.state = "PLAYING";
    this.changed(true);
  }
  private failure(code: string): never {
    this.stop();
    this.state = "FAILED";
    throw new Error(code);
  }
  stop() {
    this.state = "STOPPED";
    for (const node of this.nodes) {
      node.onended = null;
      try {
        node.stop();
        node.disconnect();
      } catch {}
    }
    this.nodes.clear();
    this.end = this.context?.currentTime ?? 0;
    this.changed(false);
  }
  async close() {
    this.stop();
    const context = this.context;
    this.context = undefined;
    if (context) await context.close();
  }
}
