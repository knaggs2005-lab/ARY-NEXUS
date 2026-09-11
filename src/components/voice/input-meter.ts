/** Local-only RMS sampling. Audio is never routed to speakers or stored by the meter. */
export function audioLevel(samples: Float32Array) {
  if (!samples.length) return 0;
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.min(1, Math.sqrt(sum / samples.length) * 5);
}
export function observeMicrophone(
  stream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  if (typeof AudioContext === "undefined") return () => {};
  let context: AudioContext | null = null,
    frame = 0,
    stopped = false;
  try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream),
      analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let previous = 0,
      smoothed = 0;
    function tick(time: number) {
      if (stopped) return;
      if (time - previous >= 50 && !document.hidden) {
        analyser.getFloatTimeDomainData(samples);
        smoothed = smoothed * 0.45 + audioLevel(samples) * 0.55;
        onLevel(smoothed);
        previous = time;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    void context.resume().catch(() => {});
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context?.close().catch(() => {});
      onLevel(0);
    };
  } catch {
    stopped = true;
    cancelAnimationFrame(frame);
    void context?.close().catch(() => {});
    return () => {};
  }
}
