"use client";
import { useEffect, useRef, useState } from "react";
import {
  perceptionSources,
  type PerceptionSource,
  type FrameReference,
  type VisionFinding,
} from "../../domain/perception";
import { api } from "../api";
import { BrowserFrameCapture, prepareUpload } from "./capture";
import type { Json } from "../../domain/models";
import styles from "../gmail/gmail.module.css";
import local from "./perception.module.css";
type Preview = { ref: FrameReference; url: string };
type Grant = {
  grant_id: string;
  source: PerceptionSource;
  source_id: string;
  expires_at: string;
};
type Report = {
  finding: VisionFinding;
  provider: string;
  model: string;
  latency_ms: number;
};
export function PerceptionPanel({ mobile = false }: { mobile?: boolean } = {}) {
  const [source, setSource] = useState<PerceptionSource>("upload"),
    [device, setDevice] = useState("default"),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [grant, setGrant] = useState<Grant | null>(null),
    [frames, setFrames] = useState<Preview[]>([]),
    [mode, setMode] = useState("inspect"),
    [question, setQuestion] = useState(
      "Describe the visible state and any readable errors.",
    ),
    [actionId, setActionId] = useState(""),
    [report, setReport] = useState<Report | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const capture = useRef<BrowserFrameCapture | null>(null),
    abort = useRef<AbortController | null>(null),
    held = useRef<Preview[]>([]),
    pendingGrant = useRef<Grant | null>(null),
    mounted = useRef(true),
    active = useRef(false);
  async function request(body: Json, signal?: AbortSignal) {
    return (
      await (
        await api("actions/request", {
          method: "POST",
          signal,
          body: JSON.stringify({
            request_key: crypto.randomUUID(),
            reason:
              "Owner explicitly selected Perception source/images and question",
            ...body,
          }),
        })
      ).json()
    ).result;
  }
  function stop() {
    capture.current?.stop();
    abort.current?.abort();
  }
  async function discard(cancel = true) {
    if (cancel) stop();
    const ids = [
      ...held.current.map((f) => f.ref.id),
      ...(pendingGrant.current ? [pendingGrant.current.grant_id] : []),
    ];
    held.current.forEach((f) => URL.revokeObjectURL(f.url));
    held.current = [];
    pendingGrant.current = null;
    if (mounted.current) {
      setFrames([]);
      setGrant(null);
    }
    if (ids.length)
      try {
        await request({ tool: "perception.clear", input: { ids } });
      } catch {
        if (mounted.current)
          setError(
            "Local previews cleared. Server images expire automatically within five minutes.",
          );
      }
  }
  useEffect(() => {
    mounted.current = true;
    capture.current = new BrowserFrameCapture();
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    const timer = setInterval(() => {
      if (held.current.some((f) => Date.parse(f.ref.expires_at) <= Date.now()))
        void discard();
    }, 1000);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", hidden);
      clearInterval(timer);
      void discard();
    };
  }, []);
  async function work(
    label: string,
    fn: (signal: AbortSignal) => Promise<void>,
  ) {
    if (active.current) return;
    active.current = true;
    abort.current = new AbortController();
    setBusy(label);
    setError("");
    try {
      await fn(abort.current.signal);
    } catch (e) {
      if (mounted.current)
        setError(
          abort.current.signal.aborted
            ? "Stopped. No further capture will occur."
            : (e as Error).message,
        );
    } finally {
      active.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function stage(blob: Blob, signal: AbortSignal) {
    const g = pendingGrant.current;
    if (!g || Date.parse(g.expires_at) <= Date.now())
      throw Error("Authorize this source again");
    const response = await api("perception/frames", {
      method: "POST",
      signal,
      headers: { "Content-Type": blob.type, "X-Ary-Capture-Grant": g.grant_id },
      body: blob,
    });
    const ref = (await response.json()) as FrameReference;
    if (signal.aborted || !mounted.current) {
      await request({ tool: "perception.clear", input: { ids: [ref.id] } });
      return;
    }
    const preview = { ref, url: URL.createObjectURL(blob) };
    held.current = [...held.current, preview];
    pendingGrant.current = null;
    setFrames(held.current);
    setGrant(null);
    setReport(null);
  }
  const camera = source === "webcam" || source === "studio_camera",
    file = source === "upload" || source === "screenshot";
  return (
    <section className={styles.mail} aria-label="Ary Perception">
      <span className={styles.eyebrow}>ARY / PERCEPTION / ON DEMAND</span>
      <h2>See only what you choose.</h2>
      <p>
        No background capture. One frame per source approval. Preview first;
        analysis requires separate approval to send the selected images to the
        configured vision model.
      </p>
      <p>
        Images stay in temporary memory for up to five minutes and are removed
        after analysis. Findings, your question and image hashes remain in
        Action history; images are not added to permanent memory. Provider
        retention rules also apply.
      </p>
      <div className={styles.toolbar}>
        <label>
          Visual source
          <select
            value={source}
            disabled={!!busy || !!grant}
            onChange={(e) => setSource(e.target.value as PerceptionSource)}
          >
            {(mobile ? (["upload", "webcam"] as const) : perceptionSources).map(
              (s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ),
            )}
          </select>
        </label>
        {camera && (
          <>
            <button
              disabled={!!busy || !!grant}
              onClick={() =>
                void work("Listing camera choices", async () =>
                  setDevices(
                    (await navigator.mediaDevices.enumerateDevices()).filter(
                      (d) => d.kind === "videoinput",
                    ),
                  ),
                )
              }
            >
              List cameras
            </button>
            <label>
              Camera
              <select
                value={device}
                disabled={!!busy || !!grant}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="default">Browser default camera</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button
          disabled={!!busy || !!grant || frames.length >= 2}
          onClick={() =>
            void work("Awaiting source approval", async (signal) => {
              const g = (await request(
                {
                  tool: `perception.capture_${source}`,
                  input: {
                    source_id: camera
                      ? device
                      : file
                        ? "user-selected image"
                        : `OS-selected ${source}`,
                  },
                },
                signal,
              )) as Grant;
              if (!mounted.current || signal.aborted) {
                await request({
                  tool: "perception.clear",
                  input: { ids: [g.grant_id] },
                });
                return;
              }
              pendingGrant.current = g;
              setGrant(g);
            })
          }
        >
          Authorize one image
        </button>
      </div>
      {grant && (
        <div className={local.capture}>
          <p>
            Approved source: {grant.source.replaceAll("_", " ")} · one image
            only
          </p>
          {file ? (
            <label>
              Choose image
              <input
                type="file"
                capture={mobile ? "environment" : undefined}
                accept="image/png,image/jpeg,image/webp"
                disabled={!!busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f)
                    void work("Preparing selected image", async (signal) => {
                      await stage(await prepareUpload(f), signal);
                    });
                }}
              />
            </label>
          ) : (
            <button
              disabled={!!busy}
              onClick={() =>
                void work(
                  camera
                    ? "Camera active — capturing one frame"
                    : "Screen selection active — capturing one frame",
                  async (signal) =>
                    stage(
                      await capture.current!.capture(source, device, signal),
                      signal,
                    ),
                )
              }
            >
              Capture selected source
            </button>
          )}
        </div>
      )}
      {busy && (
        <div role="status" className={`${styles.pulse} ${local.indicator}`}>
          {busy}… <button onClick={stop}>Stop</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={local.frames}>
        {frames.map((f, i) => (
          <figure key={f.ref.id}>
            <img
              src={f.url}
              alt={`Selected ${i === 0 ? "before / single" : "after"} image preview`}
            />
            <figcaption>
              Frame {i + 1} · {i === 0 ? "before / single" : "after"} ·{" "}
              {f.ref.source}
              <br />
              Expires {new Date(f.ref.expires_at).toLocaleTimeString()}
            </figcaption>
          </figure>
        ))}
      </div>
      <label>
        Analysis mode
        <select
          disabled={!!busy}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="inspect">Inspect visible state</option>
          <option value="verify">Verify a visible criterion</option>
          <option value="compare">Compare before → after</option>
        </select>
      </label>
      <label>
        Question or visible success criterion
        <textarea
          disabled={!!busy}
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <label>
        Related action ID (optional)
        <input
          value={actionId}
          disabled={!!busy}
          onChange={(e) => setActionId(e.target.value)}
          placeholder="Link evidence without changing action status"
        />
      </label>
      <div className={styles.toolbar}>
        <button
          disabled={
            !!busy ||
            !frames.length ||
            (mode === "compare" && frames.length !== 2) ||
            question.trim().length < 3
          }
          onClick={() =>
            void work(
              "Awaiting analysis approval / vision active",
              async (signal) => {
                try {
                  const result = await request(
                    {
                      tool: "perception.analyze",
                      input: {
                        mode,
                        question,
                        frames: frames.map((f) => f.ref),
                        ...(actionId ? { related_action_id: actionId } : {}),
                      },
                    },
                    signal,
                  );
                  if (mounted.current) setReport(result as Report);
                } finally {
                  await discard(false);
                }
              },
            )
          }
        >
          Review and analyze images
        </button>
        <button
          disabled={!frames.length && !grant}
          onClick={() => void discard()}
        >
          Clear images
        </button>
      </div>
      {report && <PerceptionReport report={report} />}
      <p>
        Studio cameras must appear as an explicitly selected OS camera or
        provide an image you upload. No RTSP polling, face recognition,
        automatic camera activation or always-on screen reading.
      </p>
    </section>
  );
}
export function PerceptionReport({ report }: { report: Report }) {
  return (
    <article className={local.report} aria-label="Visual evidence report">
      <h3>{report.finding.summary}</h3>
      <p>
        {report.provider} / {report.model} · {report.latency_ms} ms
      </p>
      <strong>
        Visual criterion:{" "}
        {report.finding.verification.verdict.replaceAll("_", " ")}
      </strong>
      <p>{report.finding.verification.reason}</p>
      <p>
        Model confidence:{" "}
        {Math.round(report.finding.verification.confidence * 100)}% (not
        calibrated)
      </p>
      <ul>
        {report.finding.observations.map((o, i) => (
          <li key={i}>
            Frame {o.frame}: {o.evidence}
          </li>
        ))}
      </ul>
      {!!report.finding.differences.length && (
        <>
          <h4>Before / after</h4>
          <ul>
            {report.finding.differences.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      )}
      <h4>Limits of this evidence</h4>
      <ul>
        {report.finding.limitations.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <p>
        Original action status is unchanged. A visible dialog or changed light
        does not prove the full operation succeeded.
      </p>
    </article>
  );
}
