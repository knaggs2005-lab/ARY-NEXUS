import {
  coarseLocation,
  type MobileLocationProvider,
} from "../../domain/mobile";
/** Explicit one-shot capture. No watcher, tracking, storage or automatic server transmission. */
export class BrowserLocationInput implements MobileLocationProvider {
  async locate(signal: AbortSignal) {
    if (!window.isSecureContext || !navigator.geolocation)
      throw Error("Location needs HTTPS and browser location support.");
    signal.throwIfAborted();
    return new Promise<ReturnType<typeof coarseLocation>>((resolve, reject) => {
      const cancel = () =>
        reject(new DOMException("Location capture cancelled", "AbortError"));
      signal.addEventListener("abort", cancel, { once: true });
      navigator.geolocation.getCurrentPosition(
        (position) => {
          signal.removeEventListener("abort", cancel);
          if (signal.aborted) return;
          try {
            resolve(
              coarseLocation({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy_m: position.coords.accuracy,
                observed_at: new Date(position.timestamp).toISOString(),
              }),
            );
          } catch (e) {
            reject(e);
          }
        },
        (error) => {
          signal.removeEventListener("abort", cancel);
          reject(
            Error(
              error.code === 1
                ? "Location permission was declined. Nothing was captured."
                : "Location is unavailable. Try again when ready.",
            ),
          );
        },
        { enableHighAccuracy: false, maximumAge: 0, timeout: 10000 },
      );
    });
  }
}
