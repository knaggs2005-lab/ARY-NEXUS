import { describe, expect, it } from "vitest";
import {
  capabilityAccess,
  connectionDestinations,
  normalizeConnectionStatus,
} from "../src/components/connections-view";
const t = (overrides: any = {}) => ({
  name: "x.read",
  description: "",
  origin: "oauth",
  availability: {
    state: "unknown",
    reason: "",
    evidence: "declaration",
    checked_at: null,
  },
  authentication: { configured: null },
  health: { status: "unknown", observed_at: null, reason: "" },
  permission: { level: 1, mode: "observe" },
  ...overrides,
});
describe("Connections Control Center normalization", () => {
  it("does not infer writable from permission", () =>
    expect(
      capabilityAccess([t({ permission: { level: 5, mode: "observe" } })])
        .write,
    ).toBe(null));
  it("labels actual mutation read/write", () =>
    expect(
      capabilityAccess([
        t({ name: "x.create", permission: { level: 1, mode: "execute" } }),
      ]).write,
    ).toBe(true));
  it("hard blocker outranks degraded", () =>
    expect(
      normalizeConnectionStatus([
        t({
          availability: {
            state: "offline",
            reason: "KYC compliance blocker",
            evidence: "receipt",
            checked_at: null,
          },
          health: { status: "degraded" },
        }),
      ])[0],
    ).toBe("BLOCKED"));
  it("distinguishes auth and not live", () => {
    expect(
      normalizeConnectionStatus([
        t({ authentication: { configured: false } }),
      ])[0],
    ).toBe("NEEDS_AUTH");
    expect(
      normalizeConnectionStatus([
        t({ origin: "computer", execution_location: "local_mac" }),
      ])[0],
    ).toBe("NOT_LIVE");
  });
  it("configured without evidence is unknown", () =>
    expect(
      normalizeConnectionStatus([
        t({ authentication: { configured: true } }),
      ])[0],
    ).toBe("UNKNOWN"));
  it("has valid existing destinations", () =>
    Object.values(connectionDestinations).forEach((v) =>
      expect([
        "Settings",
        "Chat",
        "Tools",
        "Calendar",
        "Communications",
        "Calls",
        "Computer & Browser",
        "Creative",
        "Perception",
        "Studio",
        "Finance",
      ]).toContain(v),
    ));
  it("never includes secrets", () =>
    expect(JSON.stringify(connectionDestinations)).not.toMatch(
      /key|secret|token/i,
    ));
});
