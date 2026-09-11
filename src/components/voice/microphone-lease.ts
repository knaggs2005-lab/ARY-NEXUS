/** One continuous microphone owner per origin across windows; never wait and start later. */
export async function microphoneLease(
  signal: AbortSignal,
): Promise<() => void> {
  signal.throwIfAborted();
  if (!navigator.locks)
    throw new Error(
      "Continuous voice requires a browser with microphone session locking. Use the single-message microphone instead.",
    );
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(
        "ary-continuous-microphone",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            reject(
              new Error(
                "Another Ary window is already listening. End that session first.",
              ),
            );
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("Stopped", "AbortError"));
            return;
          }
          await new Promise<void>((release) => {
            const done = () => {
              signal.removeEventListener("abort", done);
              release();
            };
            signal.addEventListener("abort", done, { once: true });
            resolve(done);
          });
        },
      )
      .catch(reject);
  });
}
