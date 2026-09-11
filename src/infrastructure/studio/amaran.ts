import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  StudioNotSent,
  type StudioAdapter,
  type StudioDevice,
  type StudioCommand,
} from "../../domain/studio";
const verbs = [
  "get_fixture_list",
  "get_intensity",
  "get_sleep",
  "get_cct",
  "get_node_config",
  "set_intensity",
  "set_sleep",
  "set_cct",
] as const;
type Verb = (typeof verbs)[number];
export function amaranToken(secret: string) {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32)
    throw new StudioNotSent("Configure a valid Amaran OpenAPI key");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(String(Math.floor(Date.now() / 1000))),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
/** Official OpenAPI v2; fixed loopback endpoint, no caller URLs or arbitrary API verbs. */
export async function amaranRequest(
  action: Verb,
  node_id?: string,
  args?: Record<string, number | boolean>,
): Promise<unknown> {
  if (!verbs.includes(action)) throw new StudioNotSent("Invalid Amaran action");
  const token = amaranToken(process.env.ARY_AMARAN_API_KEY || "");
  return new Promise((resolve, reject) => {
    const request_id = randomUUID(),
      ws = new WebSocket("ws://127.0.0.1:12345");
    let sent = false,
      done = false;
    const finish = (error?: Error, data?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      error ? reject(error) : resolve(data);
    };
    const timer = setTimeout(
      () =>
        finish(
          sent
            ? Error("Amaran response timed out; delivery uncertain")
            : new StudioNotSent("Amaran Desktop is unavailable"),
        ),
      4000,
    );
    ws.addEventListener("open", () => {
      try {
        sent = true;
        ws.send(
          JSON.stringify({
            version: 2,
            type: "request",
            client_id: "ary-nexus",
            request_id,
            action,
            node_id,
            args,
            token,
          }),
        );
      } catch {
        finish(Error("Amaran dispatch could not be confirmed"));
      }
    });
    ws.addEventListener("error", () =>
      finish(
        sent
          ? Error("Amaran connection lost after dispatch")
          : new StudioNotSent("Open Amaran Desktop and enable its OpenAPI"),
      ),
    );
    ws.addEventListener("close", () => {
      if (!done)
        finish(
          sent
            ? Error("Amaran closed after dispatch")
            : new StudioNotSent("Amaran connection closed"),
        );
    });
    ws.addEventListener("message", (e) => {
      try {
        if (typeof e.data !== "string" || e.data.length > 262144)
          throw Error("Invalid Amaran response");
        const r = JSON.parse(e.data);
        if (r.type !== "response" || r.request_id !== request_id) return;
        if (
          r.version !== 2 ||
          r.action !== action ||
          r.client_id !== "ary-nexus" ||
          (node_id && r.node_id !== node_id)
        )
          throw Error("Amaran response mismatch");
        // A provider error after dispatch is conservatively uncertain; never echo its raw payload.
        if (r.code !== 0)
          throw Error(
            "Amaran rejected the request; inspect device before retrying",
          );
        finish(undefined, r.data);
      } catch {
        finish(Error("Amaran response could not confirm the operation"));
      }
    });
  });
}
export class AmaranAdapter implements StudioAdapter {
  constructor(private rpc: typeof amaranRequest = amaranRequest) {}
  async inspect(device: StudioDevice) {
    const fixtures = z
      .array(z.object({ node_id: z.string() }))
      .max(200)
      .parse(await this.rpc("get_fixture_list"));
    if (
      device.kind !== "light" ||
      !device.node_id ||
      !fixtures.some((f) => f.node_id === device.node_id)
    )
      throw new StudioNotSent("Configured individual light was not found");
    const config = z
      .object({
        cct_support: z.boolean(),
        cct_min: z.number(),
        cct_max: z.number(),
      })
      .parse(await this.rpc("get_node_config", device.node_id));
    const state: Record<string, number | boolean> = {
      intensity: z
        .number()
        .int()
        .min(0)
        .max(1000)
        .parse(await this.rpc("get_intensity", device.node_id)),
      sleep: z.boolean().parse(await this.rpc("get_sleep", device.node_id)),
      cct_min: config.cct_min,
      cct_max: config.cct_max,
    };
    if (config.cct_support)
      state.cct = z
        .object({ cct: z.number() })
        .parse(await this.rpc("get_cct", device.node_id)).cct;
    return {
      device_id: device.id,
      observed_at: new Date().toISOString(),
      status: "available" as const,
      state,
      capabilities: [
        "intensity",
        "sleep",
        ...(config.cct_support ? ["cct"] : []),
      ],
      detail:
        "Amaran Desktop-reported state; not independent physical verification",
    };
  }
  async execute(device: StudioDevice, command: StudioCommand) {
    if (!device.node_id || device.kind !== "light" || command.verb === "preset")
      throw new StudioNotSent("Unsupported Amaran operation");
    await this.rpc(`set_${command.verb}`, device.node_id, {
      [command.verb]: command.value,
    });
    // Official guide specifies >=200ms between device writes.
    await new Promise((r) => setTimeout(r, 250));
    return {
      confirmation: "provider_acknowledged" as const,
      detail:
        "Amaran Desktop acknowledged the setting; physical light confirmation is pending",
    };
  }
}
