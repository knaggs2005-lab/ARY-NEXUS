import { AsyncLocalStorage } from "node:async_hooks";
import type { PresenceEvent } from "../domain/presence";
/** Request-scoped only; no shared-user bus and no retained input/content. */
export const presenceTelemetry = new AsyncLocalStorage<
  (event: PresenceEvent) => void
>();
export function reportPresence(event: PresenceEvent) {
  try {
    presenceTelemetry.getStore()?.(event);
  } catch {
    /* Visual transport cannot affect an action. */
  }
}
