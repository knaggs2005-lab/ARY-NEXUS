import {
  studioConfig,
  defaultLocations,
  type StudioConfig,
  type StudioAdapter,
  type Observation,
  type SceneReadiness,
} from "../domain/studio";

/** Projection over the existing owner-configured studio inventory, not a second device store. */
export class DeviceRegistry {
  readonly config: StudioConfig;
  constructor(
    config: StudioConfig,
    readonly adapters: Record<string, StudioAdapter>,
  ) {
    this.config = studioConfig.parse(config);
  }
  get locations() {
    return this.config.locations ?? defaultLocations;
  }
  get devices() {
    return this.config.devices;
  }
  async observe(enabled: boolean): Promise<Observation[]> {
    // Small bounded inventory; four concurrent inspections rather than an unbounded network burst.
    const result: Observation[] = [];
    for (let i = 0; i < this.devices.length; i += 4) {
      result.push(
        ...(await Promise.all(
          this.devices.slice(i, i + 4).map(async (d) => {
            const adapter = this.adapters[d.adapter];
            if (enabled && adapter) {
              for (let attempt = 0; attempt < 2; attempt++) {
                try {
                  const o = await adapter.inspect(d);
                  if (o.device_id !== d.id || !isFresh(o))
                    throw Error("Invalid observation");
                  if (o.status === "unavailable" && attempt === 0) continue;
                  return {
                    ...o,
                    ...(attempt
                      ? { recovery: "inspection_retried" as const }
                      : {}),
                  };
                } catch {
                  /* Retry reads once; never replay a write or leak provider payloads. */
                }
              }
            }
            return {
              device_id: d.id,
              observed_at: new Date().toISOString(),
              status: "unavailable" as const,
              state: {},
              capabilities: [],
              detail: !enabled
                ? "Studio disabled or this session is unauthorized"
                : !adapter
                  ? "Device adapter is not configured"
                  : "Inspection failed after one safe read retry; check connection and permissions",
              ...(enabled && adapter
                ? { recovery: "inspection_retried" as const }
                : {}),
            };
          }),
        )),
      );
    }
    return result;
  }
  readiness(sceneId: string, observations: Observation[]): SceneReadiness {
    const scene = this.config.scenes.find((s) => s.id === sceneId);
    if (!scene) throw Error("Unknown configured scene");
    const checks: SceneReadiness["checks"] = scene.steps.map((step) => {
      const o =
        observations.find((o) => o.device_id === step.device_id) ?? null;
      const expected =
        step.verify ??
        (step.command.verb === "preset"
          ? null
          : { [step.command.verb]: step.command.value });
      const status =
        !o || o.status !== "available" || !isFresh(o)
          ? "unavailable"
          : !expected ||
              Object.keys(expected).some((k) => !Object.hasOwn(o.state, k))
            ? "unverified"
            : Object.entries(expected).every(
                  ([k, v]) =>
                    o.state[k] === v ||
                    (!step.verify &&
                      k === "intensity" &&
                      this.devices.find((d) => d.id === step.device_id)
                        ?.adapter === "home_assistant" &&
                      typeof o.state[k] === "number" &&
                      typeof v === "number" &&
                      o.state[k] ===
                        (v === 0
                          ? 0
                          : Math.round(
                              (Math.max(1, Math.round((v / 1000) * 255)) /
                                255) *
                                1000,
                            ))),
                )
              ? "matched"
              : "mismatch";
      return {
        step_id: step.id,
        device_id: step.device_id,
        required: step.required,
        status,
        reason:
          status === "matched"
            ? "Fresh provider read-back matches the configured target"
            : status === "mismatch"
              ? "Observed state differs from the requested target"
              : status === "unavailable"
                ? "No fresh available observation"
                : "No readable verification target; acknowledgement is insufficient",
        observation: o,
      };
    });
    const required = checks.filter((c) => c.required);
    return {
      scene_id: sceneId,
      checked_at: new Date().toISOString(),
      status: !required.length
        ? "unverified"
        : required.some(
              (c) => c.status === "unavailable" || c.status === "mismatch",
            )
          ? "not_ready"
          : required.some((c) => c.status === "unverified")
            ? "unverified"
            : "ready",
      checks,
    };
  }
}
export function isFresh(o: Observation, now = Date.now()) {
  const age = now - Date.parse(o.observed_at);
  return Number.isFinite(age) && age >= -1000 && age <= 30000;
}
