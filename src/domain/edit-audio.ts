/** PCM measurements only. No speech inference and no network access. */
export function measureEditAudio(
  channels: readonly Float32Array[],
  sampleRate: number,
) {
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    !channels.length ||
    channels.length > 8 ||
    !channels[0].length ||
    channels.some((c) => c.length !== channels[0].length)
  )
    throw Error("Unsupported PCM audio");
  const duration = channels[0].length / sampleRate;
  if (duration > 250)
    throw Error("Use an audio excerpt of at most 250 seconds per source clip");
  const size = Math.floor(sampleRate / 2),
    windows = [];
  for (let start = 0; start < channels[0].length; start += size) {
    const end = Math.min(start + size, channels[0].length);
    let sum = 0;
    for (const channel of channels)
      for (let i = start; i < end; i++) {
        const value = channel[i];
        if (!Number.isFinite(value) || Math.abs(value) > 1)
          throw Error("Invalid PCM sample");
        sum += value * value;
      }
    windows.push({
      start: start / sampleRate,
      end: end / sampleRate,
      rms_dbfs: Math.max(
        -160,
        10 *
          Math.log10(Math.max(1e-16, sum / ((end - start) * channels.length))),
      ),
    });
  }
  return { duration, windows };
}
