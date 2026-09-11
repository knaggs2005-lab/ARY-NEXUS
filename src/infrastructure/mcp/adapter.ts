import { actionCancellation } from "../../services/action-cancellation";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Ajv from "ajv/dist/2020";
import { z } from "zod";
import type { Json } from "../../domain/models";
import type { ToolRegistry } from "../../domain/tool-registry";
import { AppError } from "../../domain/validation";
import { schemaHash, configurationHash, type McpServer } from "./config";
export interface McpConnection {
  list(): Promise<{ name: string; inputSchema: Json; outputSchema?: Json }[]>;
  call(
    name: string,
    input: Json,
  ): Promise<{
    isError?: boolean;
    content?: unknown[];
    structuredContent?: unknown;
  }>;
  close(): Promise<void>;
}
export type McpConnector = (
  server: McpServer,
  signal: AbortSignal,
) => Promise<McpConnection>;
/** Official protocol lifecycle/transports; no sampling, elicitation, roots or ambient credentials. */
export const connectMcp: McpConnector = async (server, signal) => {
  const client = new Client(
    { name: "ary-nexus", version: "1.0.0" },
    { capabilities: {} },
  );
  const token = server.token_env ? process.env[server.token_env] : undefined;
  if (server.token_env && !token)
    throw new AppError("MCP authentication is not configured", 503);
  const transport =
    server.transport === "stdio"
      ? new StdioClientTransport({
          command: server.command!,
          args: server.args,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            ...(server.token_env && token ? { [server.token_env]: token } : {}),
          },
          stderr: "ignore",
        })
      : new StreamableHTTPClientTransport(new URL(server.url!), {
          requestInit: {
            redirect: "error",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
          fetch: async (input, init) =>
            fetch(input, {
              ...init,
              redirect: "error",
              signal: AbortSignal.any([
                signal,
                ...(init?.signal ? [init.signal] : []),
              ]),
            }),
        });
  try {
    await client.connect(transport, { signal });
  } catch {
    await client.close().catch(() => {});
    throw new AppError(
      "MCP connection failed; verify configuration and server health",
      502,
    );
  }
  return {
    list: async () => {
      const result = await client.listTools({}, { signal, timeout: 10000 });
      if (result.tools.length > 128)
        throw new AppError("MCP catalog exceeds the supported window", 502);
      return result.tools;
    },
    call: (name, input) =>
      client.callTool({ name, arguments: input }, { signal, timeout: 20000 }),
    close: () => client.close(),
  };
};
const invokeSchema = z
  .object({
    server: z.string().min(1).max(80),
    tool: z.string().min(1).max(80),
    configuration_hash: z.string().regex(/^[a-f0-9]{64}$/),
    schema_hash: z.string().regex(/^[a-f0-9]{64}$/),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();
export class McpAdapter {
  constructor(
    readonly servers: McpServer[],
    private userId: string,
    private localAuthorized = false,
    private connector: McpConnector = connectMcp,
    readonly configurationError = false,
  ) {}
  private server(id: string) {
    const s = this.servers.find(
      (s) => s.id === id && s.owner_user_id === this.userId,
    );
    if (!s)
      throw new AppError(
        "MCP server is disabled, unavailable or outside this user scope",
        403,
      );
    if (
      s.transport === "stdio" ||
      (s.url &&
        ["127.0.0.1", "[::1]", "localhost"].includes(new URL(s.url).hostname))
    ) {
      if (!this.localAuthorized)
        throw new AppError(
          "Local MCP needs the existing authorized desktop session",
          403,
        );
    }
    return s;
  }
  private tool(input: z.infer<typeof invokeSchema>) {
    const server = this.server(input.server),
      tool = server.tools.find((t) => t.name === input.tool);
    if (input.configuration_hash !== configurationHash(server))
      throw new AppError(
        "MCP target configuration changed; review a new request",
        409,
      );
    if (!tool) throw new AppError("MCP capability is not allowlisted", 403);
    if (
      input.schema_hash !==
      schemaHash({
        input: tool.input_schema,
        output: tool.output_schema ?? null,
      })
    )
      throw new AppError("MCP schema changed; review a new request", 409);
    if (Buffer.byteLength(JSON.stringify(input.arguments)) > 32768)
      throw new AppError("MCP input exceeds 32 KB", 400);
    try {
      if (
        !new Ajv({
          strict: false,
          allErrors: false,
          validateFormats: false,
        }).validate(tool.input_schema, input.arguments)
      )
        throw Error("Invalid");
    } catch {
      throw new AppError(
        "Input does not match the pinned MCP JSON Schema",
        400,
      );
    }
    return { server, tool };
  }
  private async session<T>(
    server: McpServer,
    fn: (c: McpConnection) => Promise<T>,
  ): Promise<T> {
    const cancel = new AbortController(),
      timer = setTimeout(() => cancel.abort(), 30000);
    let connection: McpConnection | undefined;
    try {
      const ownerSignal = actionCancellation.getStore();
      connection = await this.connector(
        server,
        ownerSignal
          ? AbortSignal.any([cancel.signal, ownerSignal])
          : cancel.signal,
      );
      return await fn(connection);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "MCP failed or timed out; an external effect may be uncertain. Inspect its receipt before retrying.",
        502,
      );
    } finally {
      clearTimeout(timer);
      await connection?.close().catch(() => {});
    }
  }
  register(registry: ToolRegistry) {
    const capability = {
      origin: "mcp" as const,
      capabilities: [
        "connect protocol tools",
        "invoke approved external capabilities",
      ],
      authentication: {
        method: "environment" as const,
        configured: !!this.servers.length,
        note: "Owner-scoped server configuration; named environment secrets only",
      },
      execution_location: "server" as const,
      availability: {
        state: this.servers.length
          ? ("unknown" as const)
          : ("unconfigured" as const),
        reason: this.configurationError
          ? "MCP configuration is invalid or unavailable"
          : this.servers.length
            ? "Configured targets; inspect after approval to observe health"
            : "MCP is disabled or has no configured targets",
        checked_at: null,
        evidence: "configuration" as const,
      },
    };
    registry.register("mcp.inspect", {
      capability,
      inputSchema: z
        .object({
          server: z.string().min(1).max(80),
          configuration_hash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      validateInput: (i) => {
        if (configurationHash(this.server(i.server)) !== i.configuration_hash)
          throw new AppError(
            "MCP target configuration changed; review a new request",
            409,
          );
      },
      execute: async (i) =>
        this.session(this.server(i.server), async (c) => {
          const live = await c.list();
          return {
            server: i.server,
            observed_at: new Date().toISOString(),
            tools: this.server(i.server).tools.map((t) => ({
              name: t.name,
              matched: live.some(
                (l) =>
                  l.name === t.name &&
                  schemaHash({
                    input: l.inputSchema,
                    output: l.outputSchema ?? null,
                  }) ===
                    schemaHash({
                      input: t.input_schema,
                      output: t.output_schema ?? null,
                    }),
              ),
            })),
          };
        }),
    });
    registry.register("mcp.invoke", {
      capability,
      inputSchema: invokeSchema,
      validateInput: (i) => {
        this.tool(i);
      },
      execute: async (i) => {
        const { server, tool } = this.tool(i);
        return this.session(server, async (c) => {
          const live = (await c.list()).find((t) => t.name === tool.name);
          if (
            !live ||
            schemaHash({
              input: live.inputSchema,
              output: live.outputSchema ?? null,
            }) !== i.schema_hash
          )
            throw new AppError(
              "Remote MCP schema changed; no call was sent. Review the configuration and request again.",
              409,
            );
          const result = await c.call(tool.name, i.arguments);
          if (result.isError)
            throw new AppError(
              "MCP tool reported failure; inspect the external state before retrying",
              502,
            );
          if (Buffer.byteLength(JSON.stringify(result)) > 65536)
            throw new AppError(
              "MCP result exceeds 64 KB; external effect may have completed",
              502,
            );
          if (
            tool.output_schema &&
            !new Ajv({ strict: false, validateFormats: false }).validate(
              tool.output_schema,
              result.structuredContent,
            )
          )
            throw new AppError(
              "MCP output failed schema validation; external effect may have completed",
              502,
            );
          return {
            server: server.id,
            capability: tool.name,
            schema_hash: i.schema_hash,
            observed_at: new Date().toISOString(),
            content: result.content ?? [],
            structured_content: result.structuredContent ?? null,
          };
        });
      },
    });
  }
  descriptors() {
    return this.servers
      .filter((s) => s.owner_user_id === this.userId)
      .flatMap((s) =>
        s.tools.map((t) => ({
          id: `mcp:${s.id}:${t.name}`,
          name: "mcp.invoke",
          description: t.description,
          capabilities: t.capabilities,
          origin: s.origin,
          authentication: {
            method: s.token_env ? ("environment" as const) : ("none" as const),
            configured: !s.token_env || !!process.env[s.token_env],
            note: "Server-owned credential reference; remote OAuth enrollment is not automatic",
          },
          execution_location:
            s.transport === "stdio"
              ? ("local_mac" as const)
              : ("remote" as const),
          availability: {
            state: "unknown" as const,
            reason: "Configured capability, not a live health assertion",
            checked_at: null,
            evidence: "configuration" as const,
          },
          input_schema: {
            type: "object",
            properties: {
              configuration_hash: { const: configurationHash(s) },
              server: { const: s.id },
              tool: { const: t.name },
              schema_hash: {
                const: schemaHash({
                  input: t.input_schema,
                  output: t.output_schema ?? null,
                }),
              },
              arguments: t.input_schema,
            },
            required: [
              "server",
              "tool",
              "configuration_hash",
              "schema_hash",
              "arguments",
            ],
            additionalProperties: false,
          },
          output_schema: t.output_schema ?? null,
          request_defaults: {
            configuration_hash: configurationHash(s),
            server: s.id,
            tool: t.name,
            schema_hash: schemaHash({
              input: t.input_schema,
              output: t.output_schema ?? null,
            }),
          },
        })),
      );
  }
}
