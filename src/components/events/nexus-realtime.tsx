"use client";
import { useEffect } from "react";
import { api } from "../api";
import { nexusClientBus, parseEventBatch } from "./event-store";
import { SseDecoder } from "./sse";
import { presenceStore, setPresenceStreamConnected } from "../presence/store";
import { EventPresenceProjector } from "./presence-projector";
export function NexusRealtime() {
  useEffect(() => {
    const abort = new AbortController();
    const projector = new EventPresenceProjector(presenceStore);
    const leases = setInterval(() => projector.expire(), 5000);
    let connection: AbortController | undefined;
    const onVisibility = () => {
      if (document.hidden) {
        connection?.abort();
        setPresenceStreamConnected(false);
        projector.clear();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    let cursor: string | undefined,
      retry = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", done);
          resolve();
        };
        timer = setTimeout(done, ms);
        abort.signal.addEventListener("abort", done, { once: true });
      });
    const run = async () => {
      while (!abort.signal.aborted) {
        if (document.hidden) {
          nexusClientBus.status("paused");
          await pause(1000);
          continue;
        }
        connection = new AbortController();
        const signal = AbortSignal.any([abort.signal, connection.signal]);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let retryDelay = 0;
        try {
          if (cursor === undefined) {
            const page = parseEventBatch(
              await (await api("events?limit=100", { signal })).text(),
            );
            if (abort.signal.aborted) break;
            nexusClientBus.receive(page.events);
            cursor = page.cursor;
          }
          const response = await api(`events/stream?after=${cursor}`, {
            signal,
            headers: { Accept: "text/event-stream" },
          });
          reader = response.body?.getReader();
          if (!reader) throw Error("Event stream missing");
          const parser = new SseDecoder(),
            decoder = new TextDecoder();
          nexusClientBus.status("live");
          setPresenceStreamConnected(true);
          retry = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (abort.signal.aborted) break;
            for (const item of parser.push(
              decoder.decode(value, { stream: !done }),
            )) {
              if (item.event === "unavailable")
                throw Error(
                  "Event storage unavailable. No activity is inferred.",
                );
              if (item.event === "events") {
                const batch = parseEventBatch(item.data);
                nexusClientBus.receive(batch.events);
                projector.receive(batch.events);
                cursor = batch.cursor;
              }
            }
            if (done) break;
          }
        } catch (error) {
          if (abort.signal.aborted) break;
          setPresenceStreamConnected(false);
          projector.clear();
          if (document.hidden) {
            nexusClientBus.status("paused");
            continue;
          }
          nexusClientBus.status(
            "unavailable",
            error instanceof Error
              ? error.message
              : "Event connection unavailable",
          );
          retryDelay = Math.min(30000, 1000 * 2 ** Math.min(retry++, 5));
        } finally {
          connection.abort();
          await reader?.cancel().catch(() => {});
          reader?.releaseLock();
        }
        if (retryDelay && !abort.signal.aborted) await pause(retryDelay);
      }
    };
    void run();
    return () => {
      abort.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(leases);
      clearTimeout(timer);
      setPresenceStreamConnected(false);
      projector.clear();
      nexusClientBus.reset();
    };
  }, []);
  return null;
}
