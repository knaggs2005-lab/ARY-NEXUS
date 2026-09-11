import type { Repository } from "../domain/repository";
import { eventQuery } from "../domain/nexus-events";
import { PermissionService } from "../services/permission-service";
import { AppError } from "../domain/validation";
const connections = new Map<string, number>();
/** A subscription is a read projection, never an action executor. Reuse the existing read policy. */
export async function authorizeEventRead(repo: Repository) {
  const decision = await new PermissionService(repo).resolve("activity.read", {
    workspace: "ary-nexus",
    productIds: [],
  });
  if (!decision.allowed)
    throw new AppError(
      "Activity access is disabled by the existing permission policy",
      403,
    );
}
export function waitForEvents(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
/** Authenticated database-backed SSE; no per-process in-memory event history. Pull honors backpressure. */
export async function nexusEventStream(
  repo: Repository,
  request: Request,
  options = { pollMs: 1000, lifetimeMs: 45000 },
) {
  const url = new URL(request.url),
    origin = request.headers.get("origin");
  const expected = new URL(request.url);
  expected.host = request.headers.get("host") ?? url.host;
  if (origin && origin !== expected.origin)
    throw new AppError("Event stream origin mismatch", 403);
  const q = eventQuery.parse({
    after:
      url.searchParams.get("after") ??
      request.headers.get("last-event-id") ??
      undefined,
    limit: 100,
  });
  await authorizeEventRead(repo);
  const initial = await repo.readEvents(q);
  let cursor = q.after ?? initial.cursor;
  if ((connections.get(repo.userId) ?? 0) >= 8)
    throw new AppError("Too many event streams", 429);
  connections.set(repo.userId, (connections.get(repo.userId) ?? 0) + 1);
  const abort = new AbortController();
  const deadline = Date.now() + options.lifetimeMs;
  let closed = false,
    heartbeat = Date.now();
  let closeStream = () => {};
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(lifetime);
    abort.abort();
    request.signal.removeEventListener("abort", close);
    const count = (connections.get(repo.userId) ?? 1) - 1;
    if (count) connections.set(repo.userId, count);
    else connections.delete(repo.userId);
    closeStream();
  };
  const encode = (event: string, data: unknown, id?: string) =>
    new TextEncoder().encode(
      `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  lifetime = setTimeout(close, options.lifetimeMs);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      closeStream = () => {
        try {
          controller.close();
        } catch {
          /* already cancelled */
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }
      controller.enqueue(encode("ready", { cursor }));
    },
    async pull(controller) {
      while (!closed) {
        if (Date.now() >= deadline) {
          close();
          return;
        }
        try {
          const page = await repo.readEvents({ after: cursor, limit: 100 });
          if (closed) return;
          if (page.events.length) {
            cursor = page.cursor;
            controller.enqueue(encode("events", page, cursor));
            return;
          }
        } catch {
          if (!closed)
            controller.enqueue(
              encode("unavailable", {
                message:
                  "Event storage unavailable. Activity is not being inferred.",
              }),
            );
          close();
          return;
        }
        if (Date.now() - heartbeat >= 10000) {
          heartbeat = Date.now();
          controller.enqueue(new TextEncoder().encode(": keepalive\n\n"));
          return;
        }
        await waitForEvents(options.pollMs, abort.signal);
      }
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
