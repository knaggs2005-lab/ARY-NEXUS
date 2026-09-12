import type { RelayRequest } from "./realtime-mic-relay-client";
import type { RealtimeRelayStart } from "../../services/realtime-voice-relay-service";

export type RealtimeHttpDiagnostic = {
  result: "PASS" | "FAIL";
  source: "SYNTHETIC_SILENCE_HTTP";
  session_start_ms: number;
  batches: number;
  frames: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  status_polls: number;
  output_connected: boolean;
  cleanup_confirmed: boolean;
  failure: string | null;
};

/** Dev harness only. Uses the real authenticated same-origin api(), never a mic. */
export async function diagnoseRealtimeHttp(
  request: RelayRequest,
  conversationId: string,
): Promise<RealtimeHttpDiagnostic> {
  const times: number[] = [];
  let relayId = "",
    capability = "";
  let outputReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let outputTask: Promise<void> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> | undefined;
  let ended = false;
  const outputAbort = new AbortController();
  const result: RealtimeHttpDiagnostic = {
    result: "FAIL",
    source: "SYNTHETIC_SILENCE_HTTP",
    session_start_ms: 0,
    batches: 0,
    frames: 0,
    mean_ms: 0,
    p50_ms: 0,
    p95_ms: 0,
    max_ms: 0,
    status_polls: 0,
    output_connected: false,
    cleanup_confirmed: false,
    failure: null,
  };
  const call = async (operation: string, options: RequestInit = {}) => {
    const response = await request(`realtime/session/${relayId}/${operation}`, {
      ...options,
      headers: { ...options.headers, "X-Ary-Realtime-Relay": capability },
      signal:
        operation === "output" ? outputAbort.signal : AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("HTTP_REQUEST_FAILED");
    return response;
  };
  const poll = async () => {
    try {
      const status = await (await call("status")).json();
      if (status.relay_state !== "ACTIVE" || status.failure_code)
        throw new Error("RELAY_ENDED");
      result.status_polls++;
    } catch {
      result.failure = "STATUS_FAILED";
    }
    if (!ended)
      pollTimer = setTimeout(() => {
        polling = poll();
      }, 400);
  };
  try {
    const startTime = performance.now();
    const response = await request("realtime/session/start", {
      method: "POST",
      body: JSON.stringify({ conversation_id: conversationId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("START_FAILED");
    const start: RealtimeRelayStart = await response.json();
    result.session_start_ms = performance.now() - startTime;
    relayId = start.relay_id;
    capability = start.relay_capability;
    if (!/^[a-f0-9]{64}$/.test(capability ?? ""))
      throw new Error("CAPABILITY_MISSING");
    const outputTimeout = setTimeout(() => outputAbort.abort(), 5000);
    let output: Response;
    try {
      output = await call("output", { method: "POST" });
    } finally {
      clearTimeout(outputTimeout);
    }
    outputReader = output.body!.getReader();
    outputTask = (async () => {
      // Consume transient bounded events; no persistence or logging of content.
      while (!(await outputReader!.read()).done) result.output_connected = true;
    })().catch(() => {
      if (!ended) result.failure = "OUTPUT_FAILED";
    });
    polling = poll();
    for (let i = 0; i < 30; i++) {
      if (result.failure) throw new Error(result.failure);
      const begin = performance.now();
      const forwarded = await (
        await call("audio", {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(14400),
        })
      ).json();
      times.push(performance.now() - begin);
      result.batches++;
      result.frames = forwarded.frames_forwarded;
      if (
        result.frames !== result.batches * 15 ||
        forwarded.bytes_forwarded !== result.frames * 960
      )
        throw new Error("COUNTER_MISMATCH");
      // Retain real 300ms production cadence. No retries, bigger batches, or buffer.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 300 - (performance.now() - begin))),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    result.failure ??= /^[A-Z_]{1,60}$/.test(message)
      ? message
      : "HTTP_DIAGNOSTIC_FAILED";
  } finally {
    ended = true;
    clearTimeout(pollTimer);
    await polling;
    if (relayId && capability) {
      try {
        const stop = await (
          await call("stop", { method: "POST", keepalive: true })
        ).json();
        result.cleanup_confirmed = stop.stopped === true;
      } catch {
        result.failure ??= "STOP_UNCONFIRMED";
      }
    }
    capability = "";
    outputAbort.abort();
    await outputReader?.cancel().catch(() => {});
    await outputTask;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const rounded = (n: number) => Math.round(n * 10) / 10;
  result.session_start_ms = rounded(result.session_start_ms);
  if (sorted.length) {
    result.mean_ms = rounded(times.reduce((a, b) => a + b, 0) / times.length);
    result.p50_ms = rounded(sorted[Math.ceil(sorted.length * 0.5) - 1]);
    result.p95_ms = rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]);
    result.max_ms = rounded(sorted.at(-1)!);
  }
  if (
    !result.failure &&
    result.batches === 30 &&
    result.output_connected &&
    result.cleanup_confirmed &&
    result.p95_ms < 150 &&
    result.max_ms < 300
  )
    result.result = "PASS";
  else result.failure ??= "THROUGHPUT_TARGET_NOT_MET";
  return result;
}
