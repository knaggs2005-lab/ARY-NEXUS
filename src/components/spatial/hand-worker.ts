import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
let detector: HandLandmarker | null = null;
let files: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
let origin = "";
let delegate: "GPU" | "CPU" = "CPU";
async function createDetector(mode: "GPU" | "CPU") {
  const next = await HandLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: `${origin}/spatial/hand_landmarker.task`,
      delegate: mode,
    },
    ...(mode === "GPU" ? { canvas: new OffscreenCanvas(640, 480) } : {}),
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  detector = next;
  delegate = mode;
}
self.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  if (data.type === "init") {
    try {
      origin = data.origin;
      files = await FilesetResolver.forVisionTasks(`${origin}/spatial/wasm`);
      if (data.forceCPU) await createDetector("CPU");
      else
        try {
          await createDetector("GPU");
        } catch {
          await createDetector("CPU");
        }
      self.postMessage({ type: "ready", delegate });
    } catch {
      self.postMessage({
        type: "error",
        message:
          "Hand tracking could not load. Mouse and keyboard remain available.",
      });
    }
  } else if (data.type === "frame") {
    try {
      const start = performance.now();
      if (!detector) throw new Error("Detector is not initialized");
      let result;
      try {
        result = detector.detectForVideo(data.frame, data.time);
      } catch (error) {
        if (delegate !== "GPU") throw error;
        // Recover from a lost/unsupported GPU context without reopening the camera.
        try {
          detector.close();
        } catch {
          /* context already lost */
        }
        detector = null;
        await createDetector("CPU");
        result = detector!.detectForVideo(data.frame, data.time);
      }
      self.postMessage({
        type: "result",
        landmarks: result.landmarks[0] ?? [],
        latency: performance.now() - start,
        delegate,
      });
    } catch {
      self.postMessage({
        type: "error",
        message:
          "Tracking stopped after an inference error. Disable and re-enable tracking to retry.",
      });
    } finally {
      data.frame.close();
    }
  }
};
