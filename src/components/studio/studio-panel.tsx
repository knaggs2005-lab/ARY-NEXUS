"use client";
import { useRef, useState } from "react";
import { StudioSpace } from "./studio-space";
import type { PlanSpec } from "../../domain/orchestration";
import type {
  StudioPlan,
  StudioReport,
  StudioDevice,
  Observation,
  StudioLocation,
} from "../../domain/studio";
import type { Json } from "../../domain/models";
import { api } from "../api";
import styles from "../gmail/gmail.module.css";
import local from "./studio.module.css";
type Inventory = {
  locations?: StudioLocation[];
  enabled: boolean;
  recovery?: { plan_id: string; action_id: string } | null;
  devices: StudioDevice[];
  observations: Observation[];
  scenes: { id: string; name: string }[];
  last_execution: StudioReport | null;
};
type Prepared = { plan: StudioPlan; request: Json; mission_spec?: PlanSpec };
const displayValue = (name: string, value: string | number | boolean) =>
  name === "intensity" && typeof value === "number"
    ? `${value / 10}%`
    : name.startsWith("cct") && typeof value === "number"
      ? `${value} K`
      : String(value);
export function StudioPanel({
  onMission,
}: { onMission?: (id: string) => void } = {}) {
  const [inventory, setInventory] = useState<Inventory | null>(null),
    [prepared, setPrepared] = useState<Prepared | null>(null),
    [result, setResult] = useState<StudioReport | null>(null),
    [scene, setScene] = useState("podcast"),
    [mission, setMission] = useState<string | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const active = useRef(false),
    key = useRef(""),
    missionKey = useRef("");
  async function call(body: Json) {
    return (
      await (
        await api("actions/request", {
          method: "POST",
          body: JSON.stringify({
            request_key: crypto.randomUUID(),
            reason: "User requested a reviewed studio scene in Nexus",
            ...body,
          }),
        })
      ).json()
    ).result;
  }
  async function work(label: string, fn: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  return (
    <section
      className={`${styles.mail} ${local.studio}`}
      aria-label="Ary Studio"
    >
      <span className={styles.eyebrow}>ARY / PHYSICAL WORLD</span>
      <h2>The room, in concert.</h2>
      <p>
        Prepare the room with one reviewed scene. Recording setup does not start
        a recording. Unconfigured hardware stays visibly unavailable.
      </p>
      <div className={styles.toolbar}>
        <button
          disabled={!!busy}
          onClick={() =>
            void work("Reading device state", async () =>
              setInventory(await call({ tool: "studio.inspect", input: {} })),
            )
          }
        >
          Inspect studio
        </button>
        <label>
          Scene
          <select
            value={scene}
            disabled={!!busy}
            onChange={(e) => {
              setScene(e.target.value);
              setPrepared(null);
              setResult(null);
              setMission(null);
            }}
          >
            {(
              inventory?.scenes ?? [
                { id: "podcast", name: "Podcast mode" },
                { id: "recording", name: "Recording setup" },
              ]
            ).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!!busy}
          onClick={() =>
            void work("Preparing exact scene plan", async () => {
              setResult(null);
              setPrepared(
                await call({ tool: "studio.plan_scene", input: { scene } }),
              );
              key.current = crypto.randomUUID();
              missionKey.current = crypto.randomUUID();
              setMission(null);
            })
          }
        >
          Plan scene
        </button>
      </div>
      {busy && (
        <p role="status" className={styles.pulse}>
          {busy}…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {inventory?.recovery && (
        <p role="alert">
          Recovery required for action {inventory.recovery.action_id}. A device
          may have changed. Further execution is blocked; inspect the physical
          devices and preserved receipt before recovery. Nothing will be retried
          automatically.
        </p>
      )}
      {inventory && (
        <>
          <p>
            {inventory.enabled
              ? "Local control enabled for this session"
              : "Control disabled or session unauthorized"}{" "}
            · {inventory.devices.length} configured slots
          </p>
          <StudioSpace
            devices={inventory.devices}
            observations={inventory.observations}
            locations={inventory.locations}
          />
          <details>
            <summary>Device telemetry inventory</summary>
            <div className={local.devices}>
              {inventory.devices.map((d) => {
                const o = inventory.observations.find(
                  (o) => o.device_id === d.id,
                );
                return (
                  <article key={d.id}>
                    <small>
                      {d.kind} / {d.adapter}
                    </small>
                    <h3>{d.name}</h3>
                    <p>
                      {o?.status ?? "Unknown"} · {o?.detail}
                    </p>
                    {o?.status === "available" && (
                      <dl>
                        {Object.entries(o.state).map(([k, v]) => (
                          <div key={k}>
                            <dt>{k}</dt>
                            <dd>{displayValue(k, v)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <small>
                      Observed{" "}
                      {o
                        ? new Date(o.observed_at).toLocaleTimeString()
                        : "never"}
                    </small>
                  </article>
                );
              })}
            </div>
          </details>
        </>
      )}
      {prepared && (
        <article className={local.plan}>
          <span className={styles.eyebrow}>
            REVIEW / {prepared.plan.scene_name}
          </span>
          <ol>
            {prepared.plan.steps.map((s) => (
              <li key={s.id}>
                <strong>{s.device_name}</strong>
                <span>
                  {s.command.verb} →{" "}
                  {displayValue(s.command.verb, s.command.value)}
                </span>
                <small>
                  {s.blocked_reason ?? "Ready"}
                  {s.required ? " · required" : " · optional"}
                  {s.depends_on.length
                    ? ` · after ${s.depends_on.join(", ")}`
                    : ""}
                </small>
              </li>
            ))}
          </ol>
          <p>
            Approval covers these exact steps and observed state. A changed or
            expired plan requires review again.
          </p>
          <button
            disabled={!!busy || !prepared.plan.executable || !!result}
            onClick={() =>
              void work("Approval → execution → device report", async () => {
                setResult(
                  await call({ ...prepared.request, request_key: key.current }),
                );
                setInventory(await call({ tool: "studio.inspect", input: {} }));
              })
            }
          >
            Review and execute scene
          </button>
          {prepared.mission_spec && (
            <button
              disabled={!!busy || !!mission}
              onClick={() =>
                void work("Saving durable equipment mission", async () => {
                  const created = await call({
                    tool: "mission.create",
                    request_key: missionKey.current,
                    input: {
                      goal: `Prepare ${prepared.plan.scene_name} and verify equipment readiness`,
                      spec: prepared.mission_spec,
                    },
                  });
                  setMission(created.id);
                })
              }
            >
              Create preparation mission
            </button>
          )}
          {mission && (
            <p>
              Mission saved as a draft. Equipment approval is still required.{" "}
              <button
                onClick={() => onMission?.(mission)}
                disabled={!onMission}
              >
                Open preparation mission
              </button>
            </p>
          )}
          {!prepared.plan.executable && (
            <p>
              Scene blocked: configure or reconnect its required devices, then
              plan again.
            </p>
          )}
        </article>
      )}
      {(result ?? inventory?.last_execution) && (
        <StudioReportView report={(result ?? inventory?.last_execution)!} />
      )}
      <p className={local.foot}>
        Amaran Desktop and configured Home Assistant lights use the same
        reviewed scenes. Cameras, prompters, displays, LED walls and audio
        routes need a verified model-specific adapter. No recording, network
        scanning or hidden device commands.
      </p>
    </section>
  );
}
export function StudioReportView({ report }: { report: StudioReport }) {
  return (
    <article className={local.report} aria-label="Studio execution report">
      <h3>Scene result: {report.status}</h3>
      <p>
        Action {report.action_id} ·{" "}
        {new Date(report.finished_at).toLocaleString()}
      </p>
      {report.readiness && (
        <section
          className={local.readiness}
          aria-label="Equipment readiness"
          data-status={report.readiness.status}
        >
          <h4>Readiness: {report.readiness.status.replaceAll("_", " ")}</h4>
          <p>
            Checked {new Date(report.readiness.checked_at).toLocaleString()}.
            Provider read-back, not independent physical verification.
          </p>
          <ul>
            {report.readiness.checks.map((c) => (
              <li key={c.step_id}>
                {c.device_id} · {c.status} · {c.reason}
                {c.required ? " · required" : " · optional"}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ol>
        {report.steps.map((s) => (
          <li key={s.id} data-status={s.status}>
            <strong>
              {s.device_id}: {s.status}
            </strong>
            <p>{s.detail}</p>
            <small>{s.confirmation ?? "No confirmation"}</small>
          </li>
        ))}
      </ol>
      <p>
        Full approval, inputs and outcome are in Action history. A successful
        provider response is not independent physical verification.
      </p>
    </article>
  );
}
