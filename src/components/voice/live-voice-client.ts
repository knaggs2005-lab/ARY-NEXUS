import { microphoneLease } from "./microphone-lease";
import { api } from "../api";
export type LiveMetric = {
  name: string;
  ms: number;
  basis: "browser-observed";
};
/** WebRTC media only: no recording, PCM upload, legacy STT or TTS. */
export class LiveVoiceClient {
  private releaseMic?: () => void;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private microphone?: MediaStream;
  private audio = new Audio();
  private context?: AudioContext;
  private heartbeat?: ReturnType<typeof setInterval>;
  private polling = false;
  private timer?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private id?: string;
  private abort = new AbortController();
  private closed = false;
  private running = false;
  private ready = false;
  private metrics: LiveMetric[] = [];
  private speech = false;
  private speaking = false;
  private mutedForInterrupt = false;
  private lastInput = 0;
  private lastOutput = 0;
  private started = performance.now();
  constructor(
    private notify: (state: string, metrics: LiveMetric[]) => void,
    private transcript: (role: string, text: string) => void,
    private serverTiming: (value: unknown) => void = () => {},
  ) {
    this.audio.autoplay = true;
  }
  private mark(name: string, at = performance.now()) {
    this.metrics.push({
      name,
      ms: Math.round(at - this.started),
      basis: "browser-observed",
    });
    if (this.metrics.length > 512) this.metrics.shift();
    this.notify(this.ready ? "Connected" : "Connecting", [...this.metrics]);
  }
  async start(conversationId: string) {
    if (this.running || this.closed) return;
    this.running = true;
    this.notify("Connecting", []);
    try {
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      this.timeout = setTimeout(
        () =>
          this.fail("Live startup timed out; legacy voice remains available"),
        25000,
      );
      this.releaseMic = await microphoneLease(this.abort.signal);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      if (this.closed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.microphone = stream;
      stream.getAudioTracks().forEach((t) => peer.addTrack(t, stream));
      const input = this.analyzer(stream);
      let output: AnalyserNode | undefined;
      peer.ontrack = (event) => {
        const remote = new MediaStream([event.track]);
        this.audio.srcObject = remote;
        output = this.analyzer(remote);
        void this.audio
          .play()
          .catch(() =>
            this.fail("Audio playback blocked; restart with an explicit click"),
          );
      };
      peer.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(peer.connectionState))
          this.fail("Live disconnected; use legacy voice");
      };
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onmessage = ({ data }) => {
        if (this.closed) return;
        let e;
        try {
          e = JSON.parse(data);
        } catch {
          return;
        }
        if (e.type === "session.started") {
          clearTimeout(this.timeout);
          this.ready = true;
          this.mark("live_session_ready");
        }
        if (e.type === "session.closed") {
          this.cleanup();
          this.notify("Stopped (provider finalized)", [...this.metrics]);
        }
        if (e.type === "error")
          this.fail("Live provider error; see server diagnostics");
        if (e.type === "session.delegation.created")
          this.mark("delegation_started");
        if (e.type === "session.commentary.appended")
          this.mark("delegation_context_accepted");
        if (
          e.type === "session.input_transcript.delta" ||
          e.type === "session.output_transcript.delta"
        ) {
          if (typeof e.delta === "string")
            this.transcript(e.type.includes("input") ? "You" : "Ary", e.delta);
        }
      };
      channel.onclose = () => {
        if (!this.closed)
          this.fail("Live closed without final usage confirmation");
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.gather(peer);
      if (this.closed) return;
      const response = await api("live/start", {
        method: "POST",
        signal: this.abort.signal,
        body: JSON.stringify({
          conversation_id: conversationId,
          sdp: peer.localDescription?.sdp,
        }),
      });
      if (!response.ok)
        throw new Error(
          `Live setup failed (${response.status}); legacy voice remains available`,
        );
      const result = await response.json();
      this.id = result.id;
      if (this.closed) {
        void api(`live/${this.id}/stop`, { method: "POST" });
        return;
      }
      this.heartbeat = setInterval(() => {
        if (this.closed || this.polling) return;
        this.polling = true;
        void api(`live/${this.id}/status`)
          .then(async (r) => {
            if (r.ok) this.serverTiming(await r.json());
            if (!r.ok) this.fail("Nexus control connection lost; Live stopped");
          })
          .catch(() => this.fail("Nexus control connection lost; Live stopped"))
          .finally(() => {
            this.polling = false;
          });
      }, 3000);
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
      this.timer = setInterval(() => {
        if (!this.ready || this.closed) return;
        const now = performance.now();
        const loud = this.energy(input) > 0.035;
        if (loud) {
          this.lastInput = now;
          if (!this.speech) {
            this.speech = true;
            this.mark("user_speech_started");
            if (this.speaking) this.interrupt();
          }
        } else if (this.speech && now - this.lastInput > 250) {
          this.speech = false;
          this.mark("user_speech_ended", this.lastInput);
        }
        const audible = !!output && this.energy(output) > 0.008;
        if (audible) {
          this.lastOutput = now;
          if (!this.speaking) {
            this.speaking = true;
            this.mark("first_audio_received");
            if (!this.audio.muted && !this.audio.paused)
              this.mark("first_audio_played_estimate");
          }
        } else if (this.speaking && now - this.lastOutput > 250) {
          this.speaking = false;
          if (this.mutedForInterrupt && !this.speech) {
            this.mutedForInterrupt = false;
            this.audio.muted = false;
          }
        }
      }, 25);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : "Live setup failed");
    }
  }
  private analyzer(stream: MediaStream) {
    const a = this.context!.createAnalyser();
    a.fftSize = 512;
    this.context!.createMediaStreamSource(stream).connect(a);
    return a;
  }
  private energy(a: AnalyserNode) {
    const values = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(values);
    return Math.sqrt(values.reduce((sum, n) => sum + n * n, 0) / values.length);
  }
  private gather(peer: RTCPeerConnection) {
    return new Promise<void>((resolve, reject) => {
      if (peer.iceGatheringState === "complete") return resolve();
      const done = () => {
        if (peer.iceGatheringState !== "complete") return;
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", done);
        resolve();
      };
      const timer = setTimeout(() => {
        peer.removeEventListener("icegatheringstatechange", done);
        reject(new Error("ICE gathering timed out"));
      }, 5000);
      peer.addEventListener("icegatheringstatechange", done);
    });
  }
  interrupt() {
    if (!this.ready || this.closed) return;
    this.mark("interruption_detected");
    this.audio.muted = true;
    this.mutedForInterrupt = true;
    this.mark("remote_audio_stopped_local_mute");
    if (this.id)
      void api(`live/${this.id}/interrupt`, { method: "POST" }).catch(() =>
        this.fail("Interruption delivery failed"),
      );
  }
  stop() {
    if (this.closed) return;
    if (!this.ready) {
      if (this.id)
        void api(`live/${this.id}/stop`, { method: "POST" }).catch(() => {});
      this.cleanup();
      this.notify("Stopped during startup", [...this.metrics]);
      return;
    }
    this.microphone?.getTracks().forEach((t) => t.stop());
    this.audio.muted = true;
    this.notify("Stopping", [...this.metrics]);
    if (this.channel?.readyState === "open")
      this.channel.send(JSON.stringify({ type: "session.close" }));
    if (this.id)
      void api(`live/${this.id}/stop`, { method: "POST" }).catch(() => {});
    this.timeout = setTimeout(() => {
      this.cleanup();
      this.notify("Stopped (final usage unconfirmed)", [...this.metrics]);
    }, 5500);
  }
  private fail(message: string) {
    if (this.closed) return;
    if (this.id)
      void api(`live/${this.id}/stop`, { method: "POST" }).catch(() => {});
    if (this.channel?.readyState === "open")
      this.channel.send(JSON.stringify({ type: "session.close" }));
    this.cleanup();
    this.notify(message, [...this.metrics]);
  }
  dispose() {
    this.stop();
    this.cleanup();
  }
  private cleanup() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.abort.abort();
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    clearTimeout(this.timeout);
    this.microphone?.getTracks().forEach((t) => t.stop());
    this.releaseMic?.();
    this.releaseMic = undefined;
    this.audio.pause();
    this.audio.srcObject = null;
    this.channel?.close();
    this.peer?.close();
    void this.context?.close();
  }
}
