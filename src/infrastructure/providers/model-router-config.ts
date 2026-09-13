import { z } from "zod";
import {
  modelTarget,
  modelTasks,
  routePolicy,
  type ModelTarget,
  type RoutingTrace,
} from "../../domain/model-router";
import { ModelRouter, modelHealth } from "../../services/model-router";
import type {
  LanguageModelProvider,
  EmbeddingProvider,
} from "../../domain/providers";
import type { Telemetry } from "../../domain/telemetry";
import { AppError } from "../../domain/validation";
import { OpenAIResponsesProvider } from "./openai";
import { RoutedChatProvider } from "./routed-chat";
import { actionCancellation } from "../../services/action-cancellation";
export function localEndpoint(raw: string) {
  const u = new URL(raw);
  return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}
const targetConfig = modelTarget
  .extend({
    base_url: z.string().url().optional(),
    api_key_env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,100}$/)
      .optional(),
  })
  .strict();
const taskSettings = z.partialRecord(z.enum(modelTasks), routePolicy.partial());
export function routerPolicy() {
  return routePolicy.parse(
    JSON.parse(process.env.ARY_MODEL_ROUTER_POLICY || "{}"),
  );
}
export function createModelRouter(
  primary: LanguageModelProvider,
  mode: string,
  telemetry: Telemetry,
  onRoute: (r: RoutingTrace) => Promise<void>,
  signal?: AbortSignal,
  onlyPrimary = false,
) {
  const policy = routerPolicy();
  const base = mode === "compatible" ? process.env.LLM_BASE_URL : undefined;
  const primaryOverrides = JSON.parse(
    process.env.ARY_MODEL_ROUTER_PRIMARY || "{}",
  );
  const local =
    mode === "mock" ||
    (mode === "compatible" &&
      primaryOverrides.location === "local" &&
      !!base &&
      localEndpoint(base));
  if (base) {
    const u = new URL(base);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (!localEndpoint(base) && u.protocol !== "https:") ||
      !["https:", "http:"].includes(u.protocol)
    )
      throw new AppError("Invalid primary model endpoint", 503);
  }
  if (mode === "compatible")
    primary = new RoutedChatProvider(
      {
        baseUrl: base!,
        apiKey: process.env.LLM_API_KEY,
        model: primary.name,
        provider: "compatible",
        protocol: "chat",
        inputPrice: null,
        outputPrice: null,
      },
      telemetry,
    );
  const descriptor = modelTarget.parse({
    id: "configured",
    provider: mode === "mock" ? "development" : mode,
    model: primary.name,
    location: local ? "local" : "cloud",
    tasks: [
      "chat",
      "analysis",
      ...(primary.planWithUsage ? ["planning"] : []),
      "extraction",
    ],
    capabilities: [
      "reasoning",
      "structured",
      ...(["openai", "compatible"].includes(mode) ? ["streaming"] : []),
    ],
    context_tokens: 128000,
    ...primaryOverrides,
  });
  // Metadata cannot relabel a cloud deployment as local or replace its identity.
  if (
    descriptor.location !== (local ? "local" : "cloud") ||
    descriptor.model !== primary.name ||
    descriptor.id !== "configured" ||
    descriptor.provider !== (mode === "mock" ? "development" : mode)
  )
    throw new AppError(
      "Primary routing metadata cannot change provider identity or location",
      503,
    );
  const targets: ModelTarget[] = [
    {
      ...descriptor,
      adapter: primary,
      available: () =>
        mode !== "openai" || !!process.env.OPENAI_API_KEY?.trim(),
      healthKey: `${mode}:${base ?? ""}:${primary.name}`,
    },
  ];
  for (const cfg of onlyPrimary
    ? []
    : z
        .array(targetConfig)
        .max(8)
        .parse(JSON.parse(process.env.ARY_MODEL_ROUTER_TARGETS || "[]"))) {
    if (
      ["openai", "anthropic", "gemini"].includes(cfg.provider) &&
      cfg.location !== "cloud"
    )
      throw new AppError("Cloud provider cannot be labeled local", 503);
    if (cfg.provider === "development")
      throw new AppError(
        "Development stub must be selected explicitly, never as a production fallback",
        503,
      );
    let url =
      cfg.base_url ??
      (cfg.provider === "anthropic"
        ? "https://api.anthropic.com/v1"
        : cfg.provider === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai"
          : "");
    if (cfg.provider === "openai" && cfg.base_url)
      throw new AppError("OpenAI uses its existing Responses endpoint", 503);
    if (cfg.provider !== "openai") {
      const u = new URL(url);
      if (
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        (!localEndpoint(url) && u.protocol !== "https:") ||
        !["https:", "http:"].includes(u.protocol)
      )
        throw new AppError("Invalid model endpoint", 503);
      if (cfg.location === "local" && !localEndpoint(url))
        throw new AppError("Local models require a loopback endpoint", 503);
      if (
        ["llama.cpp", "mlx"].includes(cfg.provider) &&
        cfg.location !== "local"
      )
        throw new AppError("Local runtime must declare local location", 503);
    } else if (cfg.location !== "cloud")
      throw new AppError("OpenAI is a cloud provider", 503);
    const keyName =
      cfg.api_key_env ??
      (cfg.provider === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : cfg.provider === "gemini"
          ? "GEMINI_API_KEY"
          : cfg.provider === "openai"
            ? "OPENAI_API_KEY"
            : undefined);
    if (cfg.provider === "openai" && keyName !== "OPENAI_API_KEY")
      throw new AppError("Use the existing OpenAI environment key", 503);
    const { base_url: _, api_key_env: __, ...meta } = cfg;
    targets.push({
      ...meta,
      healthKey: `${cfg.provider}:${url}:${cfg.model}`,
      available: () => !keyName || !!process.env[keyName]?.trim(),
      adapter:
        cfg.provider === "openai"
          ? new OpenAIResponsesProvider(telemetry, cfg.model)
          : new RoutedChatProvider(
              {
                baseUrl: url,
                apiKey: keyName ? process.env[keyName] : undefined,
                model: cfg.model,
                provider: cfg.provider,
                protocol: cfg.provider === "anthropic" ? "anthropic" : "chat",
                inputPrice: cfg.input_usd_per_million,
                outputPrice: cfg.output_usd_per_million,
              },
              telemetry,
            ),
    });
  }
  return new ModelRouter(
    targets,
    policy,
    taskSettings.parse(JSON.parse(process.env.ARY_MODEL_ROUTER_TASKS || "{}")),
    onRoute,
    modelHealth,
    signal,
  );
}
/** Embedding identity never changes during failover. This guard returns no substitute vectors. */
export function guardedEmbeddings(
  provider: EmbeddingProvider,
  local: boolean,
  signal?: AbortSignal,
): EmbeddingProvider {
  const policy = routerPolicy();
  if (
    Object.values(
      taskSettings.parse(
        JSON.parse(process.env.ARY_MODEL_ROUTER_TASKS || "{}"),
      ),
    ).some((p) => p?.privacy === "local_only")
  )
    policy.privacy = "local_only";
  const key = `embedding:${provider.modelId}:${provider.version}`;
  async function guarded<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    if (policy.privacy === "local_only" && !local)
      throw new AppError("Cloud embeddings blocked by local-only policy", 503);
    if ((modelHealth.get(key)?.until ?? 0) > Date.now())
      throw new AppError("Embedding provider cooling down", 503);
    const signals = [
        signal,
        options?.signal,
        actionCancellation.getStore(),
        AbortSignal.timeout(Math.min(policy.timeout_ms, 8000)),
      ].filter((s): s is AbortSignal => !!s),
      combined = AbortSignal.any(signals);
    combined.throwIfAborted();
    let detach = () => {};
    try {
      return await Promise.race([
        operation(combined),
        new Promise<never>((_, reject) => {
          const abort = () => reject(combined.reason);
          combined.addEventListener("abort", abort, { once: true });
          detach = () => combined.removeEventListener("abort", abort);
        }),
      ]);
    } catch (error) {
      if (
        !signal?.aborted &&
        !options?.signal?.aborted &&
        !actionCancellation.getStore()?.aborted
      )
        modelHealth.set(key, {
          failures: 1,
          until: Date.now() + 15000,
          latency: null,
        });
      throw error;
    } finally {
      detach();
    }
  }
  return {
    modelId: provider.modelId,
    version: provider.version,
    dimensions: provider.dimensions,
    embed: (text, options) =>
      guarded((signal) => provider.embed(text, { signal }), options),
    ...(provider.embedMany
      ? {
          embedMany: (texts: string[], options?: { signal?: AbortSignal }) =>
            guarded(
              (signal) => provider.embedMany!(texts, { signal }),
              options,
            ),
        }
      : {}),
  };
}
