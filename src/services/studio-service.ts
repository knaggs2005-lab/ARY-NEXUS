import { DeviceRegistry, isFresh } from "./device-registry";
import { HomeAssistantAdapter } from "../infrastructure/studio/home-assistant";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  studioConfig,
  defaultStudioConfig,
  StudioNotSent,
  type StudioAdapter,
  type StudioConfig,
  type StudioPlan,
  type StudioReport,
  type Observation,
  type StudioStep,
} from "../domain/studio";
import { AppError } from "../domain/validation";
import { digest } from "./permission-service";
import {
  EncryptedCalendarVault,
  type CalendarVault,
} from "../infrastructure/calendar/vault";
import { AmaranAdapter } from "../infrastructure/studio/amaran";
const stamp = () => new Date().toISOString();
const normalized = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
export class StudioService {
  constructor(
    readonly userId: string,
    private authorized: () => boolean = () => false,
    private configSource: () => Promise<StudioConfig> = async () => {
      const path = process.env.ARY_STUDIO_CONFIG_PATH;
      if (!path) return defaultStudioConfig;
      const text = await readFile(resolve(path), "utf8");
      if (text.length > 32768) throw new AppError("Studio config is too large");
      return studioConfig.parse(JSON.parse(text));
    },
    private adapters: Record<string, StudioAdapter> = {
      amaran: new AmaranAdapter(),
      home_assistant: new HomeAssistantAdapter(),
    },
    private vault: CalendarVault = new EncryptedCalendarVault(
      resolve(".data/studio-vault"),
    ),
    private gate?: () => void,
  ) {}
  private assertLive() {
    if (this.gate) {
      this.gate();
      return;
    }
    if (process.env.ARY_STUDIO_ENABLED !== "true")
      throw new AppError(
        "Studio control is disabled. Configure devices and explicitly enable ARY_STUDIO_ENABLED.",
        403,
      );
    if (
      process.platform !== "darwin" ||
      process.env.ARY_STORAGE !== "supabase" ||
      process.env.ARY_STUDIO_USER_ID !== this.userId ||
      !this.authorized()
    )
      throw new AppError(
        "Studio requires its configured owner and the installed Mac app's local session",
        403,
      );
  }
  private enabled() {
    try {
      this.assertLive();
      return true;
    } catch {
      return false;
    }
  }
  private async config() {
    return studioConfig.parse(await this.configSource());
  }
  private async observe(c: StudioConfig): Promise<Observation[]> {
    return new DeviceRegistry(c, this.adapters).observe(this.enabled());
  }

  async inspect(scene?: string) {
    const c = await this.config();
    const active = this.enabled()
      ? await this.vault.read<{ plan_id: string; action_id: string }>(
          `${this.userId}:studio:active`,
        )
      : null;
    const recovery = active
      ? {
          ...active,
          progress: await this.vault.read(
            `${this.userId}:studio:${active.plan_id}:progress`,
          ),
        }
      : null;
    const registry = new DeviceRegistry(c, this.adapters);
    const observations = await this.observe(c);
    if (scene && !c.scenes.some((s) => s.id === scene))
      throw new AppError("Unknown configured scene");
    return {
      locations: registry.locations,
      ...(scene ? { readiness: registry.readiness(scene, observations) } : {}),
      enabled: this.enabled(),
      recovery,
      devices: c.devices,
      scenes: c.scenes.map(({ id, name, aliases }) => ({ id, name, aliases })),
      observations,
      last_execution: this.enabled()
        ? await this.vault.read<StudioReport>(`${this.userId}:last`)
        : null,
    };
  }
  private blocked(step: StudioStep, observations: Observation[]) {
    const o = observations.find((o) => o.device_id === step.device_id);
    if (!o || o.status !== "available" || !isFresh(o))
      return "Device unavailable or observation stale";
    if (!o.capabilities.includes(step.command.verb))
      return "Unsupported device capability";
    if (
      step.command.verb === "cct" &&
      (typeof o.state.cct_min !== "number" ||
        typeof o.state.cct_max !== "number" ||
        step.command.value < o.state.cct_min ||
        step.command.value > o.state.cct_max)
    )
      return "Color temperature is outside this device's supported range";
    return null;
  }
  async plan(query: string): Promise<StudioPlan> {
    const c = await this.config(),
      q = normalized(query);
    const exact = c.scenes.filter(
      (s) => normalized(s.id) === q || normalized(s.name) === q,
    );
    const matches = exact.length
      ? exact
      : c.scenes.filter((s) => s.aliases.some((a) => normalized(a) === q));
    if (matches.length !== 1)
      throw new AppError(
        matches.length
          ? "Scene name is ambiguous; choose a scene ID"
          : "Unknown studio scene; choose a configured scene",
      );
    const scene = matches[0],
      observations = await this.observe(c);
    const steps = scene.steps.map((s) => ({
      ...s,
      device_name: c.devices.find((d) => d.id === s.device_id)!.name,
      blocked_reason: this.blocked(s, observations),
    }));
    for (const step of steps) {
      if (
        !step.blocked_reason &&
        step.depends_on.some(
          (id) => steps.find((s) => s.id === id)?.blocked_reason,
        )
      )
        step.blocked_reason = "Dependency is unavailable";
    }
    return {
      version: 1,
      id: randomUUID(),
      scene_id: scene.id,
      scene_name: scene.name,
      config_revision: digest(c),
      created_at: stamp(),
      observations,
      steps,
      executable:
        this.enabled() &&
        steps.some((s) => !s.blocked_reason) &&
        !steps.some((s) => s.required && s.blocked_reason),
    };
  }
  async execute(
    plan: StudioPlan,
    actionId: string,
    checkPermission: () => Promise<void>,
  ): Promise<StudioReport> {
    this.assertLive();
    const root = `${this.userId}:studio`;
    return this.vault.lock(root, async () => {
      await checkPermission();
      const receiptKey = `${root}:${plan.id}`,
        previous = await this.vault.read<{
          fingerprint: string;
          report: StudioReport | null;
        }>(receiptKey);
      if (previous) {
        if (previous.fingerprint !== digest(plan))
          throw new AppError(
            "Studio operation does not match its receipt",
            409,
          );
        if (previous.report) return previous.report;
        throw new AppError(
          "Previous studio delivery is uncertain; inspect history and devices. No automatic replay.",
          409,
        );
      }
      if (await this.vault.read(`${root}:active`))
        throw new AppError(
          "An earlier studio operation needs reconciliation before more device changes",
          409,
        );
      const c = await this.config();
      if (
        plan.version !== 1 ||
        plan.config_revision !== digest(c) ||
        !plan.executable ||
        Date.now() - Date.parse(plan.created_at) > 600000 ||
        Date.parse(plan.created_at) > Date.now() + 1000
      )
        throw new AppError(
          "Studio plan is stale or blocked; prepare a new plan",
          409,
        );
      const scene = c.scenes.find((s) => s.id === plan.scene_id);
      if (
        !scene ||
        digest(scene.steps) !==
          digest(
            plan.steps.map(({ device_name: _, blocked_reason: __, ...s }) => s),
          )
      )
        throw new AppError("Studio steps changed", 409);
      const live = await this.observe(c);
      const signature = (o: Observation | undefined) =>
        o ? digest([o.status, o.state, o.capabilities]) : "missing";
      for (const d of new Set(plan.steps.map((s) => s.device_id)))
        if (
          signature(live.find((o) => o.device_id === d)) !==
          signature(plan.observations.find((o) => o.device_id === d))
        )
          throw new AppError(
            "Studio state changed since planning; review a new plan",
            409,
          );
      const report: StudioReport = {
        plan_id: plan.id,
        scene_id: plan.scene_id,
        action_id: actionId,
        status: "failure",
        started_at: stamp(),
        finished_at: "",
        steps: [],
      };
      await this.vault.write(receiptKey, {
        fingerprint: digest(plan),
        report: null,
      });
      await this.vault.write(`${root}:active`, {
        plan_id: plan.id,
        action_id: actionId,
      });
      // Write-ahead receipt remains locked/uncertain if either device or database completion is unknown.
      for (const step of plan.steps) {
        const item: StudioReport["steps"][number] = {
          id: step.id,
          device_id: step.device_id,
          status: "skipped",
          detail: "",
          confirmation: null,
          timestamp: stamp(),
        };
        const blocked = this.blocked(step, live);
        if (report.steps.some((s) => s.status === "uncertain"))
          item.detail = "Stopped after uncertain delivery";
        else if (
          step.depends_on.some(
            (id) =>
              !report.steps.some(
                (s) => s.id === id && s.status === "succeeded",
              ),
          )
        )
          item.detail = "Dependency did not succeed";
        else if (blocked) item.detail = blocked;
        else {
          let dispatched = false;
          try {
            await checkPermission();
            const d = c.devices.find((d) => d.id === step.device_id)!;
            // Recheck capability and the target device immediately before dispatch. No implicit retry.
            const adapter = this.adapters[d.adapter];
            if (!adapter) throw new StudioNotSent("Device adapter unavailable");
            const observed = await adapter.inspect(d).catch(() => {
              throw new StudioNotSent("Device unavailable before dispatch");
            });
            if (this.blocked(step, [observed]))
              throw new StudioNotSent("Device capability changed");
            await this.vault.write(`${receiptKey}:progress`, {
              action_id: actionId,
              steps: report.steps,
              dispatching: step.id,
            });
            dispatched = true;
            const result = await adapter.execute(d, step.command);
            item.status = "succeeded";
            item.detail = result.detail;
            item.confirmation = result.confirmation;
          } catch (e) {
            item.status =
              e instanceof StudioNotSent ||
              (!dispatched && e instanceof AppError)
                ? "failed"
                : "uncertain";
            item.detail =
              e instanceof StudioNotSent || e instanceof AppError
                ? e.message
                : "Delivery may have occurred; verify this device before further changes";
          }
        }
        item.timestamp = stamp();
        report.steps.push(item);
        await this.vault.write(`${receiptKey}:progress`, {
          action_id: actionId,
          steps: report.steps,
          dispatching: null,
        });
      }
      report.status = report.steps.some((s) => s.status === "uncertain")
        ? "uncertain"
        : report.steps.every((s) => s.status === "succeeded")
          ? "success"
          : report.steps.some((s) => s.status === "succeeded")
            ? "partial"
            : "failure";
      // Verification is read-only. Never replay a physical write to repair uncertain delivery.
      let finalObservations: Observation[] = [];
      try {
        await checkPermission();
        finalObservations = await this.observe(c);
      } catch {
        /* Revoked permission stops further device reads. */
      }
      report.readiness = new DeviceRegistry(c, this.adapters).readiness(
        plan.scene_id,
        finalObservations,
      );
      if (report.status === "uncertain") report.readiness.status = "unverified";
      report.finished_at = stamp();
      await this.vault.write(receiptKey, { fingerprint: digest(plan), report });
      await this.vault.write(`${this.userId}:last`, report);
      if (report.status !== "uncertain")
        await this.vault.remove(`${root}:active`);
      return report;
    });
  }
}
