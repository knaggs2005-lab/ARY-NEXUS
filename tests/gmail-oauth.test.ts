import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import {
  gmailOAuth,
  gmailScopes,
  gmailRedirect,
} from "../src/infrastructure/gmail/google-auth";
const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  verify: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    generateAuthUrl(input: Record<string, unknown>) {
      return (
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams(
          Object.entries(input).map(([k, v]) => [k, String(v)]),
        )
      );
    }
    getToken = mocks.getToken;
    verifyIdToken = mocks.verify;
    revokeToken = mocks.revoke;
  },
}));
let dir: string, vault: EncryptedCalendarVault;
beforeEach(async () => {
  vi.resetAllMocks();
  dir = await mkdtemp(join(tmpdir(), "ary-gmail-oauth-"));
  vault = new EncryptedCalendarVault(dir, "a".repeat(64));
  vi.stubEnv("GOOGLE_GMAIL_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_GMAIL_CLIENT_SECRET", "test-secret");
  vi.stubEnv(
    "GOOGLE_GMAIL_REDIRECT_URI",
    "http://127.0.0.1:3000/api/gmail/oauth/callback",
  );
  vi.stubEnv("ARY_INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
  mocks.getToken.mockResolvedValue({
    tokens: {
      refresh_token: "test-refresh",
      id_token: "test-id",
      scope: gmailScopes.read,
    },
  });
  mocks.verify.mockResolvedValue({
    getPayload: () => ({ email: "owner@example.com", email_verified: true }),
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
async function launch(write = false) {
  const oauth = gmailOAuth(vault),
    user = randomUUID();
  const begin = await oauth.begin(user, write);
  const ticket = new URL(begin.launch_url).searchParams.get("ticket")!;
  const result = await oauth.launch(ticket);
  return {
    oauth,
    user,
    ticket,
    ...result,
    state: new URL(result.url).searchParams.get("state")!,
  };
}
it("Gmail OAuth uses separate browser state, read scope and encrypted credential namespace", async () => {
  const flow = await launch();
  expect(flow.url).toContain("gmail.readonly");
  expect(flow.url).not.toContain("gmail.send");
  await expect(
    flow.oauth.finish(flow.state, "other-browser", "code"),
  ).rejects.toThrow("browser");
  expect(mocks.getToken).not.toHaveBeenCalled();
  await flow.oauth.finish(flow.state, flow.browser, "code");
  expect(await vault.read("gmail:connection:" + flow.user)).toMatchObject({
    account: "owner@example.com",
    writable: false,
  });
  expect(await vault.read("connection:" + flow.user)).toBeNull();
  await expect(
    flow.oauth.finish(flow.state, flow.browser, "code"),
  ).rejects.toThrow();
});
it("send consent requires both selected read and send grants", async () => {
  const flow = await launch(true);
  expect(flow.url).toContain("gmail.send");
  expect(flow.url).toContain("gmail.readonly");
  await expect(
    flow.oauth.finish(flow.state, flow.browser, "code"),
  ).rejects.toThrow("authorization failed");
  expect(await vault.read("gmail:connection:" + flow.user)).toBeNull();
  const full = await launch(true);
  mocks.getToken.mockResolvedValue({
    tokens: {
      refresh_token: "test-refresh",
      id_token: "test-id",
      scope: gmailScopes.read + " " + gmailScopes.send,
    },
  });
  await full.oauth.finish(full.state, full.browser, "code");
  expect(await vault.read("gmail:connection:" + full.user)).toMatchObject({
    writable: true,
  });
});
it("Gmail disconnect preserves Calendar credentials", async () => {
  const flow = await launch();
  await vault.write("connection:" + flow.user, {
    account: "calendar@example.com",
  });
  await flow.oauth.finish(flow.state, flow.browser, "code");
  await flow.oauth.disconnect(flow.user);
  expect(await vault.read("gmail:connection:" + flow.user)).toBeNull();
  expect(await vault.read("connection:" + flow.user)).toMatchObject({
    account: "calendar@example.com",
  });
});
it("callback cannot be redirected to an unrelated route or insecure host", () => {
  vi.stubEnv(
    "GOOGLE_GMAIL_REDIRECT_URI",
    "http://example.com/api/gmail/oauth/callback",
  );
  expect(() => gmailRedirect()).toThrow();
  vi.stubEnv(
    "GOOGLE_GMAIL_REDIRECT_URI",
    "https://example.com/api/calendar/oauth/callback",
  );
  expect(() => gmailRedirect()).toThrow();
});
