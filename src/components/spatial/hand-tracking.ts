import type { Landmark } from "./gesture-engine";
export interface TrackingDependencies {
  media: () => Promise<MediaStream>;
  worker: () => Worker;
  video: () => HTMLVideoElement;
  bitmap: (video: HTMLVideoElement) => Promise<ImageBitmap>;
}
const defaults: TrackingDependencies = {
  media: () =>
    navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    }),
  worker: () =>
    new Worker(new URL("./hand-worker.ts", import.meta.url), {
      type: "module",
    }),
  video: () => document.createElement("video"),
  bitmap: (video) => createImageBitmap(video),
};
/** Owns all camera/worker resources. An epoch invalidates late grants and frames. */
export class HandTrackingSession {
  private epoch = 0;
  private fps = 20;
  setFps(fps: number) {
    this.fps = Math.max(5, Math.min(30, Number.isFinite(fps) ? fps : 20));
  }
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private state: (value: string) => void,
    private result: (points: Landmark[], latency: number) => void,
    private deps: TrackingDependencies = defaults,
  ) {}
  stop() {
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.worker?.terminate();
    this.worker = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.state("off");
    this.result([], 0);
  }
  async start(fps = 20) {
    this.setFps(fps);
    this.stop();
    const epoch = this.epoch;
    this.state("requesting camera");
    try {
      const stream = await this.deps.media();
      if (epoch !== this.epoch) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const video = this.deps.video();
      this.video = video;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (epoch !== this.epoch) return;
      let worker = this.deps.worker();
      let cpuFallback = false;
      let delegate: string | undefined;
      this.worker = worker;
      this.state("loading model");
      // Bounded startup wait releases camera if worker assets cannot initialize.
      this.timer = setTimeout(
        () => recover("Tracking startup timed out"),
        20000,
      );
      const fail = (message: string) => {
        if (epoch !== this.epoch) return;
        this.stop();
        this.state(message);
      };
      const recover = (message: string) => {
        if (epoch !== this.epoch) return;
        if (cpuFallback || delegate === "CPU") {
          fail(message);
          return;
        }
        cpuFallback = true;
        if (this.timer) clearTimeout(this.timer);
        worker.terminate();
        try {
          worker = this.deps.worker();
          this.worker = worker;
          attach(worker);
          this.state("GPU unavailable; loading CPU tracking");
          this.timer = setTimeout(
            () => fail("CPU tracking startup timed out"),
            20000,
          );
          worker.postMessage({
            type: "init",
            origin: location.origin,
            forceCPU: true,
          });
        } catch {
          fail("Tracking worker unavailable");
        }
      };
      let lastFrameAt = 0;
      let lastVideoTime = -1;
      let lastVideoProgress = performance.now();
      const next = () => {
        if (epoch !== this.epoch) return;
        this.timer = setTimeout(
          async () => {
            try {
              if (
                video.readyState < 2 ||
                (Number.isFinite(video.currentTime) &&
                  video.currentTime === lastVideoTime)
              ) {
                if (performance.now() - lastVideoProgress > 5000) {
                  fail(
                    "Camera stopped delivering frames. Disable and re-enable tracking to retry.",
                  );
                  return;
                }
                lastFrameAt = performance.now();
                next();
                return;
              }
              lastVideoProgress = performance.now();
              this.timer = setTimeout(
                () => fail("Camera frame capture timed out"),
                5000,
              );
              const frame = await this.deps.bitmap(video);
              if (epoch !== this.epoch) {
                frame.close();
                return;
              }
              if (this.timer) clearTimeout(this.timer);
              lastVideoTime = video.currentTime;
              lastFrameAt = performance.now();
              worker.postMessage({ type: "frame", frame, time: lastFrameAt }, [
                frame,
              ]);
              this.timer = setTimeout(
                () => recover("Tracking frame timed out"),
                5000,
              );
            } catch {
              fail("Camera frames unavailable");
            }
          },
          Math.max(0, 1000 / this.fps - (performance.now() - lastFrameAt)),
        );
      };
      const attach = (instance: Worker) => {
        instance.onerror = () => {
          if (instance === worker) recover("Tracking worker unavailable");
        };
        instance.onmessage = (event) => {
          if (epoch !== this.epoch || instance !== worker) return;
          if (this.timer) clearTimeout(this.timer);
          if (event.data.type === "ready") {
            delegate = event.data.delegate;
            this.state(
              `tracking locally${event.data.delegate ? ` · ${event.data.delegate}` : ""}`,
            );
            next();
          } else if (event.data.type === "result") {
            this.state(
              event.data.landmarks?.length === 21
                ? `hand detected${event.data.delegate ? ` · ${event.data.delegate}` : ""}`
                : "Show one hand to the camera",
            );
            this.result(event.data.landmarks, event.data.latency);
            next();
          } else recover(event.data.message ?? "Tracking unavailable");
        };
      };
      attach(worker);
      worker.postMessage({ type: "init", origin: location.origin });
    } catch (e) {
      if (epoch === this.epoch) {
        this.stop();
        this.state(
          (e as Error).name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access for this app or browser. On macOS, check System Settings → Privacy & Security → Camera."
            : (e as Error).name === "NotFoundError"
              ? "No camera found"
              : (e as Error).name === "NotReadableError"
                ? "Camera is busy or unavailable. Close other camera apps and retry."
                : "Camera unavailable",
        );
      }
    }
  }
}
