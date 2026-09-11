import { z } from "zod";
import {
  StudioNotSent,
  studioCommand,
  type StudioAdapter,
  type StudioDevice,
  type StudioCommand,
} from "../../domain/studio";

/** Owner-configured origin only. No caller URLs, generic services, scripts, automations or power relays. */
export class HomeAssistantAdapter implements StudioAdapter {
  constructor(private transport: typeof fetch = fetch) {}
  private binding(device: StudioDevice) {
    if (
      device.kind !== "light" ||
      !/^light\.[a-z0-9_]{1,100}$/.test(device.ha_entity_id ?? "")
    )
      throw new StudioNotSent(
        "Configure an individual Home Assistant light entity",
      );
    return device.ha_entity_id!;
  }
  private async request(path: string, body?: Record<string, unknown>) {
    let origin: URL;
    try {
      origin = new URL(process.env.ARY_HOME_ASSISTANT_URL ?? "");
    } catch {
      throw new StudioNotSent("Configure the Home Assistant origin");
    }
    const token = process.env.ARY_HOME_ASSISTANT_TOKEN;
    if (
      !token ||
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    )
      throw new StudioNotSent(
        "Configure a Home Assistant origin and environment token",
      );
    try {
      const response = await this.transport(new URL(path, origin), {
        method: body ? "POST" : "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw Error("Provider failed");
      // Consume within the fetch timeout, with an explicit response-size cap.
      const reader = response.body?.getReader();
      if (!reader) throw Error("Missing response");
      let text = "",
        size = 0;
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) throw Error("Oversized response");
          text += decoder.decode(value, { stream: true });
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(text + decoder.decode());
    } catch {
      if (!body)
        throw new StudioNotSent(
          "Home Assistant unavailable; check origin, token and entity access",
        );
      throw Error(
        "Home Assistant delivery uncertain; inspect before further changes",
      );
    }
  }
  async inspect(device: StudioDevice) {
    const id = this.binding(device);
    const data = z
      .object({
        entity_id: z.literal(id),
        state: z.string(),
        attributes: z.object({
          brightness: z.number().min(0).max(255).nullish(),
          supported_color_modes: z.array(z.string().max(40)).max(12).optional(),
        }),
      })
      .parse(await this.request(`/api/states/${id}`));
    const available = ["on", "off"].includes(data.state);
    const state: Record<string, string | boolean | number> = {};
    if (available) {
      state.sleep = data.state === "off";
      if (data.state === "off") state.intensity = 0;
      else if (typeof data.attributes.brightness === "number")
        state.intensity = Math.round((data.attributes.brightness / 255) * 1000);
    }
    return {
      device_id: device.id,
      observed_at: new Date().toISOString(),
      status: available ? ("available" as const) : ("unavailable" as const),
      state,
      capabilities: available
        ? [
            "sleep",
            ...((
              data.attributes.supported_color_modes
                ? data.attributes.supported_color_modes.some((mode) =>
                    [
                      "brightness",
                      "color_temp",
                      "hs",
                      "rgb",
                      "rgbw",
                      "rgbww",
                      "white",
                      "xy",
                    ].includes(mode),
                  )
                : typeof data.attributes.brightness === "number"
            )
              ? ["intensity"]
              : []),
          ]
        : [],
      detail:
        "Home Assistant-reported state; not independent physical verification",
    };
  }
  async execute(device: StudioDevice, command: StudioCommand) {
    const parsed = studioCommand.safeParse(command);
    if (!parsed.success)
      throw new StudioNotSent("Invalid Home Assistant light command");
    command = parsed.data;
    const entity_id = this.binding(device);
    if (!["sleep", "intensity"].includes(command.verb))
      throw new StudioNotSent("Unsupported Home Assistant light command");
    const off = command.verb === "sleep" ? command.value : command.value === 0;
    await this.request(`/api/services/light/${off ? "turn_off" : "turn_on"}`, {
      entity_id,
      ...(command.verb === "intensity" && !off
        ? {
            brightness: Math.max(
              1,
              Math.round((Number(command.value) / 1000) * 255),
            ),
          }
        : {}),
    });
    return {
      confirmation: "provider_acknowledged" as const,
      detail: "Home Assistant accepted the light setting; read-back pending",
    };
  }
}
