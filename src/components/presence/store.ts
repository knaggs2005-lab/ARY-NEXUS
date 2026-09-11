"use client";
import { useSyncExternalStore } from "react";
import {
  idlePresence,
  selectPresence,
  type PresenceEvent,
} from "../../domain/presence";
export class PresenceStore {
  private entries = new Map<string, PresenceEvent>();
  private listeners = new Set<() => void>();
  private snapshot = idlePresence;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  read = () => this.snapshot;
  set(key: string, event: PresenceEvent) {
    this.entries.set(key, event);
    this.publish();
  }
  clear(key: string) {
    this.entries.delete(key);
    this.publish();
  }
  clearScope(scope: string) {
    for (const key of this.entries.keys())
      if (key.startsWith(scope + ":")) this.entries.delete(key);
    this.publish();
  }
  private publish() {
    this.snapshot = selectPresence([...this.entries.values()]);
    this.listeners.forEach((fn) => fn());
  }
}
export const presenceStore = new PresenceStore();
export const usePresence = () =>
  useSyncExternalStore(
    presenceStore.subscribe,
    presenceStore.read,
    () => idlePresence,
  );
let sequence = 0;
let streamConnected = false;
export const setPresenceStreamConnected = (value: boolean) => {
  streamConnected = value;
};
/** Each transport owns only its own visual scope; late replies cannot overwrite a newer request. */
export function presenceOperation(label: string) {
  const scope = `presence-${++sequence}`;
  let closed = false;
  presenceStore.set(scope + ":request", {
    operation: scope,
    state: "waiting",
    label,
  });
  return {
    update(event: PresenceEvent) {
      if (closed) return;
      if (streamConnected) {
        presenceStore.clearScope(scope);
        return;
      }
      presenceStore.clear(scope + ":request");
      if (event.terminal) presenceStore.clear(scope + ":" + event.operation);
      else presenceStore.set(scope + ":" + event.operation, event);
    },
    finish(
      state: "complete" | "error" | "waiting" | "approval" = "complete",
      label = "Result received",
    ) {
      if (closed) return;
      closed = true;
      presenceStore.clearScope(scope);
      const key = scope + ":receipt";
      presenceStore.set(key, {
        operation: scope,
        state,
        label,
        terminal: true,
      });
      setTimeout(() => presenceStore.clear(key), 2400);
    },
  };
}
