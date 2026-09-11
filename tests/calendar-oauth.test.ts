import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EncryptedCalendarVault } from "../src/infrastructure/calendar/vault";
import {
  GoogleCalendarOAuth,
  GoogleCalendarProvider,
} from "../src/infrastructure/calendar/google-calendar";
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
    credentials: { refresh_token?: string } = {};
    setCredentials(value: { refresh_token?: string }) {
      this.credentials = value;
    }
    async getAccessToken() {
      return { token: "access:" + this.credentials.refresh_token };
    }
    getToken = mocks.getToken;
    verifyIdToken = mocks.verify;
    revokeToken = mocks.revoke;
  },
}));
let dir: string, vault: EncryptedCalendarVault, oauth: GoogleCalendarOAuth;
beforeEach(async () => {
  vi.resetAllMocks();
  dir = await mkdtemp(join(tmpdir(), "ary-oauth-"));
  vault = new EncryptedCalendarVault(dir, "f".repeat(64));
  oauth = new GoogleCalendarOAuth(vault);
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "test-secret");
  vi.stubEnv(
    "GOOGLE_CALENDAR_REDIRECT_URI",
    "http://127.0.0.1:3000/api/calendar/oauth/callback",
  );
  vi.stubEnv("ARY_INTEGRATION_ENCRYPTION_KEY", "f".repeat(64));
  mocks.getToken.mockResolvedValue({
    tokens: {
      refresh_token: "test-refresh",
      id_token: "test-id",
      scope: "https://www.googleapis.com/auth/calendar.events.readonly",
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
async function launch(user: string = randomUUID(), write = false) {
  const begin = await oauth.begin(user, write),
    ticket = new URL(begin.launch_url).searchParams.get("ticket")!;
  const result = await oauth.launch(ticket);
  return {
    ...result,
    user,
    ticket,
    state: new URL(result.url).searchParams.get("state")!,
  };
}
it("launch handoff is single-use and requests only chosen Calendar scope", async () => {
  const flow = await launch();
  expect(flow.url).toContain("calendar.events.readonly");
  expect(flow.url).toContain("code_challenge");
  await expect(oauth.launch(flow.ticket)).rejects.toThrow("expired");
});
it("requires the initiating system-browser cookie before exchanging tokens", async () => {
  const flow = await launch();
  await expect(
    oauth.finish(flow.state, "wrong-browser", "code"),
  ).rejects.toThrow("browser");
  expect(mocks.getToken).not.toHaveBeenCalled();
  await oauth.finish(flow.state, flow.browser, "code");
  expect(await vault.read("connection:" + flow.user)).toMatchObject({
    account: "owner@example.com",
    writable: false,
  });
  await expect(
    oauth.finish(flow.state, flow.browser, "code"),
  ).rejects.toThrow();
  expect(mocks.getToken).toHaveBeenCalledTimes(1);
});
it("partial Google consent never creates an editing connection", async () => {
  const flow = await launch(randomUUID(), true);
  await expect(oauth.finish(flow.state, flow.browser, "code")).rejects.toThrow(
    "authorization failed",
  );
  expect(await vault.read("connection:" + flow.user)).toBeNull();
});
it("disconnect removes local credentials even if revocation fails", async () => {
  const flow = await launch();
  await oauth.finish(flow.state, flow.browser, "code");
  mocks.revoke.mockRejectedValue(new Error("offline"));
  expect(await oauth.disconnect(flow.user)).toEqual({
    disconnected: true,
    revoked: false,
  });
  expect(await vault.read("connection:" + flow.user)).toBeNull();
});
it("expired launch links fail closed", async () => {
  const begin = await oauth.begin(randomUUID(), false),
    ticket = new URL(begin.launch_url).searchParams.get("ticket")!;
  const pending = await vault.read<Record<string, unknown>>("launch:" + ticket);
  await vault.write("launch:" + ticket, { ...pending, expires: 0 });
  await expect(oauth.launch(ticket)).rejects.toThrow("expired");
});

async function connectAccount(user: string, email: string) {
  mocks.verify.mockResolvedValue({
    getPayload: () => ({ email, email_verified: true }),
  });
  mocks.getToken.mockResolvedValue({
    tokens: {
      refresh_token: "refresh:" + email,
      id_token: "test-id",
      scope: "https://www.googleapis.com/auth/calendar.events.readonly",
    },
  });
  const flow = await launch(user);
  await oauth.finish(flow.state, flow.browser, "code");
  return new GoogleCalendarProvider(user, vault).status();
}
it("keeps personal and work Calendar accounts in one encrypted record without leaking credentials", async () => {
  const user = randomUUID();
  const first = await connectAccount(user, "personal@example.com");
  const both = await connectAccount(user, "work@example.com");
  expect(both.connection_id).toBe(first.connection_id);
  expect(both.accounts).toHaveLength(2);
  expect(both.accounts.map((c) => c.account)).toEqual([
    "personal@example.com",
    "work@example.com",
  ]);
  expect(JSON.stringify(both)).not.toMatch(/refresh_token|refresh:|test-id/);
  expect(
    (await new GoogleCalendarProvider(randomUUID(), vault).status()).accounts,
  ).toEqual([]);
});
it("reconsent rotates only the matching account and invalidates its old connection ID", async () => {
  const user = randomUUID();
  await connectAccount(user, "personal@example.com");
  const before = await connectAccount(user, "work@example.com");
  const after = await connectAccount(user, "WORK@example.com");
  expect(after.accounts).toHaveLength(2);
  expect(after.connection_id).toBe(before.connection_id);
  expect(after.accounts[1].connection_id).not.toBe(
    before.accounts[1].connection_id,
  );
  const fetcher = vi.fn();
  await expect(
    new GoogleCalendarProvider(user, vault, fetcher).list({
      start: "2030-01-01T00:00:00Z",
      end: "2030-01-02T00:00:00Z",
      connection_id: before.accounts[1].connection_id,
    }),
  ).rejects.toThrow("connection changed");
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses each selected account's token and fails closed for a foreign account ID", async () => {
  const user = randomUUID();
  await connectAccount(user, "personal@example.com");
  const status = await connectAccount(user, "work@example.com");
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ items: [], timeZone: "UTC" })),
    );
  const provider = new GoogleCalendarProvider(user, vault, fetcher);
  const window = { start: "2030-01-01T00:00:00Z", end: "2030-01-02T00:00:00Z" };
  const personal = await provider.list(window);
  const work = await provider.list({
    ...window,
    connection_id: status.accounts[1].connection_id,
  });
  expect(personal.account).toBe("personal@example.com");
  expect(work.account).toBe("work@example.com");
  expect(
    new Headers(fetcher.mock.calls[0][1].headers).get("Authorization"),
  ).toBe("Bearer access:refresh:personal@example.com");
  expect(
    new Headers(fetcher.mock.calls[1][1].headers).get("Authorization"),
  ).toBe("Bearer access:refresh:work@example.com");
  await expect(
    provider.list({ ...window, connection_id: randomUUID() }),
  ).rejects.toThrow("connection changed");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("disconnects only the selected account even if remote revocation fails", async () => {
  const user = randomUUID();
  const personal = await connectAccount(user, "personal@example.com");
  const both = await connectAccount(user, "work@example.com");
  mocks.revoke.mockRejectedValue(new Error("offline"));
  expect(await oauth.disconnect(user, both.accounts[1].connection_id)).toEqual({
    disconnected: true,
    revoked: false,
  });
  const remaining = await new GoogleCalendarProvider(user, vault).status();
  expect(remaining.accounts).toEqual(personal.accounts);
  expect(mocks.revoke).toHaveBeenCalledWith("refresh:work@example.com");
  await expect(oauth.disconnect(user, randomUUID())).rejects.toThrow(
    "connection changed",
  );
});
it("disconnecting the default promotes the remaining account without changing its ID", async () => {
  const user = randomUUID();
  await connectAccount(user, "personal@example.com");
  const both = await connectAccount(user, "work@example.com");
  await oauth.disconnect(user, both.connection_id!);
  const remaining = await new GoogleCalendarProvider(user, vault).status();
  expect(remaining.connection_id).toBe(both.accounts[1].connection_id);
  expect(remaining.account).toBe("work@example.com");
  expect(remaining.accounts).toHaveLength(1);
});
it("failed consent and failed atomic storage leave both existing connections intact", async () => {
  const user = randomUUID();
  await connectAccount(user, "personal@example.com");
  const before = await connectAccount(user, "work@example.com");
  const flow = await launch(user, true);
  await expect(oauth.finish(flow.state, flow.browser, "code")).rejects.toThrow(
    "authorization failed",
  );
  expect(await new GoogleCalendarProvider(user, vault).status()).toEqual(
    before,
  );
  const retry = await launch(user);
  const original = vault.write.bind(vault);
  vi.spyOn(vault, "write").mockImplementation(async (key, value) => {
    if (key === "connection:" + user) throw new Error("disk unavailable");
    return original(key, value);
  });
  await expect(
    oauth.finish(retry.state, retry.browser, "code"),
  ).rejects.toThrow("authorization failed");
  expect(await new GoogleCalendarProvider(user, vault).status()).toEqual(
    before,
  );
});
it("a writable default account cannot authorize writes to a selected read-only account", async () => {
  const user = randomUUID();
  await connectAccount(user, "personal@example.com");
  const both = await connectAccount(user, "work@example.com");
  const key = "connection:" + user;
  const stored = await vault.read<Record<string, unknown>>(key);
  await vault.write(key, { ...stored, writable: true });
  const fetcher = vi.fn();
  await expect(
    new GoogleCalendarProvider(user, vault, fetcher).create(
      {
        connection_id: both.accounts[1].connection_id,
        operation_id: randomUUID(),
        event: {
          summary: "Never sent",
          description: "",
          start: "2030-01-01T00:00:00Z",
          end: "2030-01-01T01:00:00Z",
          time_zone: "UTC",
        },
      },
      [],
    ),
  ).rejects.toThrow("editing consent");
  expect(fetcher).not.toHaveBeenCalled();
});
