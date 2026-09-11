import { readFileSync } from "node:fs";
import { z } from "zod";
import { createHash } from "node:crypto";
const id = z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/);
const schema = z.record(z.string(), z.unknown());
export const mcpServerSchema = z
  .object({
    id,
    owner_user_id: z.uuid(),
    transport: z.enum(["stdio", "http"]),
    url: z.url().optional(),
    command: z.string().startsWith("/").max(500).optional(),
    args: z.array(z.string().max(500)).max(20).default([]),
    token_env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/)
      .optional(),
    origin: z.enum(["mcp", "home_assistant", "plugin"]).default("mcp"),
    tools: z
      .array(
        z
          .object({
            name: id,
            description: z.string().min(1).max(2000),
            capabilities: z.array(z.string().max(200)).max(10).default([]),
            input_schema: schema,
            output_schema: schema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.transport === "stdio" && !v.command)
      c.addIssue({
        code: "custom",
        message: "stdio requires an absolute command",
      });
    if (v.transport === "http") {
      if (!v.url) c.addIssue({ code: "custom", message: "HTTP requires URL" });
      else {
        const u = new URL(v.url);
        if (
          u.username ||
          u.password ||
          u.hash ||
          (u.protocol !== "https:" &&
            !(
              u.protocol === "http:" &&
              ["127.0.0.1", "[::1]"].includes(u.hostname)
            ))
        )
          c.addIssue({
            code: "custom",
            message: "Use HTTPS or explicit loopback, without URL credentials",
          });
      }
    }
    if (new Set(v.tools.map((t) => t.name)).size !== v.tools.length)
      c.addIssue({ code: "custom", message: "Duplicate tool names" });
  });
export type McpServer = z.infer<typeof mcpServerSchema>;
function ordered(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, ordered(x)]),
        )
      : v;
}
export const schemaHash = (s: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(ordered(s)))
    .digest("hex");
export function mcpConfiguration(userId: string): {
  servers: McpServer[];
  error: boolean;
} {
  if (process.env.ARY_MCP_ENABLED !== "true")
    return { servers: [], error: false };
  try {
    const path = process.env.ARY_MCP_CONFIG_PATH;
    if (!path) return { servers: [], error: true };
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw) > 262144) throw Error("Oversize");
    const all = z.array(mcpServerSchema).max(12).parse(JSON.parse(raw));
    if (new Set(all.map((s) => s.id)).size !== all.length)
      throw Error("Duplicate servers");
    return {
      servers: all.filter((s) => s.owner_user_id === userId),
      error: false,
    };
  } catch {
    return { servers: [], error: true };
  }
}

/** Bind approvals to destination and executable configuration, without serializing secret values. */
export const configurationHash = (server: McpServer) =>
  schemaHash({
    owner: server.owner_user_id,
    id: server.id,
    transport: server.transport,
    url: server.url ?? null,
    command: server.command ?? null,
    args: server.args,
    token_env: server.token_env ?? null,
  });
