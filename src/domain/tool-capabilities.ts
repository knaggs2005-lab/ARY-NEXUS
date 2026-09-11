import { z } from "zod";
export const capabilityOrigins = [
  "mcp",
  "api",
  "oauth",
  "local_program",
  "macos",
  "browser",
  "computer",
  "internal",
  "device",
  "home_assistant",
  "plugin",
] as const;
export type CapabilityOrigin = (typeof capabilityOrigins)[number];
export type Availability = {
  state: "connected" | "available" | "offline" | "unconfigured" | "unknown";
  reason: string;
  checked_at: string | null;
  evidence: "declaration" | "configuration" | "receipt";
};
export interface CapabilityMetadata {
  origin: CapabilityOrigin;
  capabilities: string[];
  authentication: {
    method: "none" | "session" | "oauth2" | "environment" | "local_consent";
    configured: boolean | null;
    note: string;
  };
  execution_location: "server" | "local_mac" | "browser" | "remote" | "device";
  availability: Availability;
}
/** Compatibility descriptors for existing adapters; registration never implies external connectivity. */
export function capabilityMetadata(name: string): CapabilityMetadata {
  const prefix = name.split(".")[0];
  const origin: CapabilityOrigin =
    prefix === "browser"
      ? "browser"
      : ["computer", "control"].includes(prefix)
        ? "computer"
        : prefix === "desktop"
          ? name === "desktop.open_website"
            ? "browser"
            : [
                  "desktop.launch_app",
                  "desktop.list_apps",
                  "desktop.quit_app",
                ].includes(name)
              ? "local_program"
              : "macos"
          : prefix === "google_calendar" || prefix === "gmail"
            ? "oauth"
            : prefix === "studio"
              ? "device"
              : prefix === "premiere" || prefix === "design"
                ? "plugin"
                : prefix === "phone" || prefix === "worker"
                  ? "api"
                  : prefix === "perception"
                    ? "computer"
                    : prefix === "mcp"
                      ? "mcp"
                      : "internal";
  const internal = origin === "internal";
  return {
    origin,
    capabilities: [name.replace(/[._]/g, " ")],
    authentication: {
      method: internal
        ? "session"
        : origin === "oauth"
          ? "oauth2"
          : [
                "macos",
                "plugin",
                "computer",
                "device",
                "local_program",
                "browser",
              ].includes(origin)
            ? "local_consent"
            : "environment",
      configured: internal ? true : null,
      note: internal
        ? "Authenticated Ary workspace"
        : "Adapter-owned credentials and consent; secrets never enter the catalog",
    },
    execution_location: internal
      ? "server"
      : ["macos", "plugin", "computer", "local_program", "browser"].includes(
            origin,
          )
        ? "local_mac"
        : origin === "device"
          ? "device"
          : "remote",
    availability: {
      state: internal ? "available" : "unknown",
      reason: internal
        ? "Registered internal service; execution remains permission-gated"
        : "Registered adapter; no live health check implied",
      checked_at: null,
      evidence: "declaration",
    },
  };
}
export const discoveryInput = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(12).default(6),
  })
  .strict();
