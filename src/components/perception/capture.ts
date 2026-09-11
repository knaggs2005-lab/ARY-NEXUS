import type { PerceptionSource } from "../../domain/perception";
export interface CaptureProvider {
  capture(
    source: PerceptionSource,
    deviceId: string,
    signal: AbortSignal,
  ): Promise<Blob>;
  stop(): void;
}
export class BrowserFrameCapture implements CaptureProvider {
  private stream: MediaStream | null = null;
  private epoch = 0;
  stop() {
    this.epoch++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
  async capture(
    source: PerceptionSource,
    deviceId: string,
    signal: AbortSignal,
  ) {
    if (!["screen", "window", "webcam", "studio_camera"].includes(source))
      throw Error("This source does not permit live capture");
    this.stop();
    const epoch = this.epoch;
    const stop = () => this.stop();
    signal.addEventListener("abort", stop, { once: true });
    let video: HTMLVideoElement | undefined;
    const timeout = setTimeout(stop, 30000);
    try {
      signal.throwIfAborted();
      const display = source === "screen" || source === "window";
      const media = display
        ? navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: source === "screen" ? "monitor" : "window",
            },
            audio: false,
          })
        : navigator.mediaDevices.getUserMedia({
            video:
              deviceId === "default" ? true : { deviceId: { exact: deviceId } },
            audio: false,
          });
      const stream = await media;
      if (epoch !== this.epoch || signal.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error("Capture cancelled");
      }
      this.stream = stream;
      if (display) {
        const surface = stream
          .getVideoTracks()[0]
          ?.getSettings().displaySurface;
        if (surface !== (source === "screen" ? "monitor" : "window"))
          throw Error(
            "Choose the approved source type; the selected stream was stopped",
          );
      }
      video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("No video frame available")),
          4000,
        );
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        if (typeof video!.requestVideoFrameCallback === "function")
          video!.requestVideoFrameCallback(done);
        else if (video!.readyState >= 2) done();
        else video!.onloadeddata = done;
      });
      if (epoch !== this.epoch || signal.aborted)
        throw Error("Capture cancelled");
      return await normalizeFrame(video, video.videoWidth, video.videoHeight);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError")
        throw Error(
          "Capture was declined or blocked. Check macOS Privacy & Security → Camera or Screen Recording, then explicitly try again.",
        );
      throw e;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
      this.stop();
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    }
  }
}
export async function normalizeFrame(
  image: CanvasImageSource,
  width: number,
  height: number,
) {
  if (!width || !height || width * height > 40000000)
    throw Error("Image dimensions are unsupported");
  const scale = Math.min(1, 2048 / Math.max(width, height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Canvas is unavailable");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error("Could not prepare image"))),
      "image/jpeg",
      0.9,
    ),
  );
  canvas.width = canvas.height = 0;
  if (blob.size > 3 * 1024 * 1024)
    throw Error("Image is too large; crop it before adding it");
  return blob;
}
export async function prepareUpload(file: File) {
  if (
    file.size > 10 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  )
    throw Error("Choose a PNG, JPEG or WebP image up to 10 MB");
  const bitmap = await createImageBitmap(file);
  try {
    return await normalizeFrame(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
