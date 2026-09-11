import { createHash } from "node:crypto";
import type { Repository } from "../domain/repository";
import type { EmbeddingProvider } from "../domain/providers";
import type { ToolRegistry } from "../domain/tool-registry";
import type { McpAdapter } from "../infrastructure/mcp/adapter";
import { ActionRequestService } from "./action-request-service";
import { ActionService } from "./action-service";
import { discoveryInput } from "../domain/tool-capabilities";
import { lexicalTokens } from "../infrastructure/providers/local";
import { AppError } from "../domain/validation";
const vectors = new Map<string, { at: number; vector: Promise<number[]> }>();
export class ToolDiscoveryService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private registry: ToolRegistry,
    private embeddings: EmbeddingProvider,
    private mcp?: McpAdapter,
    private connectionStatus?: (
      origin: string,
      name: string,
    ) => Promise<{ configured: boolean; connected: boolean } | null>,
  ) {}
  async catalog() {
    return this.actions.run("tools.read", null, async () => {
      const base = await new ActionRequestService(
        this.repo,
        this.actions,
        this.registry,
      ).catalog();
      const mcpBase = base.find((t) => t.name === "mcp.invoke");
      const list = [
        ...base.map((t) => ({
          ...t,
          id: t.name,
          request_defaults: {} as Record<string, unknown>,
        })),
        ...(mcpBase
          ? (this.mcp?.descriptors() ?? []).map((d) => ({ ...mcpBase, ...d }))
          : []),
      ];
      let logs: Awaited<ReturnType<Repository["list"]>> = [];
      const canRead = (
        await this.actions.permissions.resolve("activity.read", {
          workspace: "ary-nexus",
          productIds: [],
        })
      ).allowed;
      if (canRead) logs = await this.repo.list("actions");
      const statuses = new Map<
        string,
        Promise<{ configured: boolean; connected: boolean } | null>
      >();
      return Promise.all(
        list.map(async (t) => {
          const used = canRead
            ? (logs as import("../domain/models").Action[])
                .filter(
                  (a) =>
                    a.tool_name === t.name &&
                    (!t.id.startsWith("mcp:") ||
                      (a.input.server === t.request_defaults.server &&
                        a.input.tool === t.request_defaults.tool)),
                )
                .toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0]
            : undefined;
          const fresh =
            used && Date.now() - Date.parse(used.updated_at) < 300000;
          const availability = { ...t.availability };
          let authentication = { ...t.authentication };
          if (this.connectionStatus && t.permission.level > 0) {
            const family = t.name.split(".")[0];
            if (!statuses.has(family))
              statuses.set(
                family,
                this.connectionStatus(t.origin, t.name).catch(() => null),
              );
            const status = await statuses.get(family);
            if (status) {
              authentication.configured = status.configured;
              availability.state = status.connected
                ? "connected"
                : status.configured
                  ? "available"
                  : "unconfigured";
              availability.reason = status.connected
                ? "Existing owner connection is present; endpoint health is reported separately"
                : status.configured
                  ? "Configuration present; connection may still need consent or a live check"
                  : "Adapter configuration is missing or disabled";
              availability.evidence = "configuration";
            }
          }
          if (
            fresh &&
            t.origin !== "internal" &&
            availability.state !== "unconfigured" &&
            used.status === "succeeded"
          )
            Object.assign(availability, {
              state: "connected",
              reason:
                "Successful invocation observed within five minutes; not a continuous connection guarantee",
              checked_at: used.updated_at,
              evidence: "receipt",
            });
          if (
            fresh &&
            used.status === "failed" &&
            availability.state !== "unconfigured" &&
            /connection failed|timed out|network/i.test(used.error ?? "")
          )
            Object.assign(availability, {
              state: "offline",
              reason: "Last attempt reported a connection problem",
              checked_at: used.updated_at,
              evidence: "receipt",
            });
          return {
            ...t,
            authentication,
            availability,
            health: {
              status:
                fresh && used.status === "succeeded"
                  ? "healthy"
                  : fresh && used.status === "failed"
                    ? "degraded"
                    : "unknown",
              observed_at: used?.updated_at ?? null,
              reason: used
                ? "Based on last recorded attempt; validation/permission failure does not prove endpoint failure"
                : canRead
                  ? "No observed execution"
                  : "Activity access restricted",
            },
            recent_use: used
              ? {
                  action_id: used.id,
                  at: used.created_at,
                  status: used.status,
                  latency_ms: Math.max(
                    0,
                    Date.parse(used.updated_at) - Date.parse(used.created_at),
                  ),
                }
              : null,
          };
        }),
      );
    });
  }
  async search(raw: unknown) {
    const input = discoveryInput.parse(raw);
    return this.actions.run(
      "tools.discover",
      null,
      async () => {
        const catalog = (await this.catalog())
          .filter((t) => t.permission.level > 0 && !t.simulated)
          .slice(0, 180);
        const words = lexicalTokens(input.query),
          notes: string[] = [];
        let queryVector: number[] | null = null;
        try {
          queryVector = await this.embeddings.embed(input.query);
        } catch {
          notes.push("Semantic provider unavailable; lexical discovery only");
        }
        const cosine = (a: number[], b: number[]) => {
          if (
            !a.length ||
            a.length !== b.length ||
            [...a, ...b].some((v) => !Number.isFinite(v))
          )
            return 0;
          const norm = Math.sqrt(
            a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0),
          );
          return norm ? a.reduce((s, v, i) => s + v * b[i], 0) / norm : 0;
        };
        const candidates = [];
        // Bounded concurrency and keyed, ephemeral tool-descriptor cache; never a learned-memory record.
        for (let start = 0; start < catalog.length; start += 4)
          candidates.push(
            ...(await Promise.all(
              catalog.slice(start, start + 4).map(async (t) => {
                const text =
                  `${t.name}. ${t.description}. ${t.capabilities.join(". ")}`.slice(
                    0,
                    2500,
                  );
                const lexical =
                  words.filter((w) => lexicalTokens(text).includes(w)).length /
                  Math.max(1, words.length);
                let semantic: number | null = null;
                if (queryVector)
                  try {
                    const key = createHash("sha256")
                      .update(
                        JSON.stringify([
                          this.repo.userId,
                          this.embeddings.modelId,
                          this.embeddings.version,
                          this.embeddings.dimensions,
                          text,
                        ]),
                      )
                      .digest("hex");
                    let cached = vectors.get(key);
                    if (!cached || Date.now() - cached.at > 900000) {
                      if (vectors.size >= 512)
                        vectors.delete(vectors.keys().next().value!);
                      cached = {
                        at: Date.now(),
                        vector: this.embeddings.embed(text),
                      };
                      vectors.set(key, cached);
                      cached.vector.catch(() => vectors.delete(key));
                    }
                    semantic = cosine(queryVector, await cached.vector);
                  } catch {
                    notes.push("Some descriptor embeddings unavailable");
                  }
                return {
                  tool: t,
                  lexical,
                  semantic,
                  score: 0,
                  reasons: [] as string[],
                };
              }),
            )),
          );
        const semantic = candidates
            .filter((c) => c.semantic !== null && c.semantic >= 0.35)
            .toSorted((a, b) => b.semantic! - a.semantic!),
          lexical = candidates
            .filter((c) => c.lexical > 0)
            .toSorted((a, b) => b.lexical - a.lexical);
        for (const [name, pool] of [
          ["semantic", semantic],
          ["lexical", lexical],
        ] as const)
          pool.forEach((c, i) => {
            c.score += 1 / (60 + i + 1);
            c.reasons.push(`${name} rank ${i + 1}`);
          });
        return {
          query: input.query,
          model: queryVector ? this.embeddings.modelId : null,
          version: this.embeddings.version ?? null,
          ranking:
            "Equal-weight reciprocal rank fusion, k=60; semantic floor 0.35. Scores are not confidence.",
          warnings: [...new Set(notes)],
          matches: candidates
            .filter((c) => c.score > 0)
            .toSorted(
              (a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id),
            )
            .slice(0, input.limit),
        };
      },
      { query: input.query },
    );
  }
}
