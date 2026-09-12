import { afterEach, expect, it, vi } from "vitest";
import { diagnoseRealtimeHttp } from "../src/components/voice/realtime-http-diagnostic";

const id = "00000000-0000-4000-8000-000000000001";
const capability = "b".repeat(64);
afterEach(() => vi.useRealTimers());

function fixture(failAudio = false) {
  let frames = 0;
  const cancel = vi.fn();
  const request = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/start"))
      return Response.json({ relay_id: id, relay_capability: capability });
    expect(new Headers(options?.headers).get("X-Ary-Realtime-Relay")).toBe(
      capability,
    );
    if (path.endsWith("/output"))
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"type":"ready"}\n'));
          },
          cancel,
        }),
      );
    if (path.endsWith("/audio")) {
      if (failAudio)
        throw new Error("sensitive network data must not be returned");
      expect(options?.body).toEqual(new Uint8Array(14400));
      frames += 15;
      return Response.json({
        frames_forwarded: frames,
        bytes_forwarded: frames * 960,
      });
    }
    if (path.endsWith("/status"))
      return Response.json({ relay_state: "ACTIVE", failure_code: null });
    if (path.endsWith("/stop")) return Response.json({ stopped: true });
    throw new Error("Unexpected endpoint");
  });
  return { request, cancel };
}

it("bounds synthetic HTTP benchmark to one start, 30 batches, concurrent polling/output, and one stop", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const running = diagnoseRealtimeHttp(f.request, id);
  await vi.advanceTimersByTimeAsync(10000);
  const report = await running;
  expect(report).toMatchObject({
    result: "PASS",
    batches: 30,
    frames: 450,
    output_connected: true,
    cleanup_confirmed: true,
  });
  expect(report.status_polls).toBeGreaterThan(20);
  for (const path of ["start", "stop", "output"])
    expect(
      f.request.mock.calls.filter(([p]) => p.endsWith(`/${path}`)),
    ).toHaveLength(1);
  expect(JSON.parse(f.request.mock.calls[0][1]!.body as string)).toEqual({
    conversation_id: id,
  });
  expect(JSON.stringify(report)).not.toContain(capability);
  expect(JSON.stringify(report)).not.toContain(id);
  expect(f.cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("never retries an uncertain audio POST and cleans up without exposing error content", async () => {
  vi.useFakeTimers();
  const f = fixture(true);
  const running = diagnoseRealtimeHttp(f.request, id);
  await vi.advanceTimersByTimeAsync(100);
  expect(await running).toMatchObject({
    result: "FAIL",
    batches: 0,
    cleanup_confirmed: true,
    failure: "HTTP_DIAGNOSTIC_FAILED",
  });
  expect(
    f.request.mock.calls.filter(([p]) => p.endsWith("/audio")),
  ).toHaveLength(1);
  expect(f.cancel).toHaveBeenCalledOnce();
});
