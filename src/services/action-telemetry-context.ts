import { AsyncLocalStorage } from "node:async_hooks";
/** Concurrent requests and nested actions retain their own cost attribution. */
export const actionTelemetryContext = new AsyncLocalStorage<string>();
