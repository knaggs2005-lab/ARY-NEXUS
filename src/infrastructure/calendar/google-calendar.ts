import { OAuth2Client } from "google-auth-library";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CalendarEvent,
  CalendarProvider,
  CalendarWrite,
  CalendarUpdate,
} from "../../domain/calendar";
import { AppError } from "../../domain/validation";
import { EncryptedCalendarVault, type CalendarVault } from "./vault";
const READ = "https://www.googleapis.com/auth/calendar.events.readonly",
  WRITE = "https://www.googleapis.com/auth/calendar.events";
interface Connection {
  id: string;
  account: string;
  refresh_token: string;
  writable: boolean;
}
// Keep the original default connection shape so existing single-account callers remain valid.
interface StoredConnection extends Connection {
  additional?: Connection[];
}
function connections(stored: StoredConnection | null): Connection[] {
  if (!stored) return [];
  const { additional, ...primary } = stored;
  return [primary, ...(additional || [])];
}
function storedConnections(items: Connection[]): StoredConnection {
  return { ...items[0], additional: items.slice(1) };
}
interface Pending {
  userId: string;
  write: boolean;
  expires: number;
  verifier: string;
  state: string;
  browser?: string;
}
interface GoogleEvent {
  id: string;
  etag: string;
  summary?: string;
  description?: string;
  status?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  transparency?: string;
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    responseStatus?: string;
  }[];
  recurringEventId?: string;
  recurrence?: string[];
  eventType?: string;
  organizer?: { self?: boolean };
  htmlLink?: string;
  extendedProperties?: { private?: Record<string, string> };
}
export function googleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REDIRECT_URI &&
    /^[a-f0-9]{64}$/i.test(process.env.ARY_INTEGRATION_ENCRYPTION_KEY || ""),
  );
}
export function calendarRedirect() {
  const raw = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (!raw) throw new AppError("Google Calendar OAuth is not configured", 503);
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/calendar/oauth/callback" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new AppError("Invalid Calendar redirect URI configuration", 503);
  return url;
}
function client() {
  return new OAuth2Client({
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: calendarRedirect().href,
    transporterOptions: { timeout: 15000, retry: false },
  });
}
export class GoogleCalendarOAuth {
  constructor(
    private vault: CalendarVault = new EncryptedCalendarVault(),
    private config: {
      configured: () => boolean;
      redirect: () => URL;
      client: () => OAuth2Client;
      clientId: () => string | undefined;
      prefix: string;
      path: string;
      label: string;
      scopes: (write: boolean) => string[];
    } = {
      configured: googleCalendarConfigured,
      redirect: calendarRedirect,
      client,
      clientId: () => process.env.GOOGLE_CALENDAR_CLIENT_ID,
      prefix: "",
      path: "calendar",
      label: "Google Calendar",
      scopes: (write) => [write ? WRITE : READ],
    },
  ) {}
  async begin(userId: string, write: boolean) {
    if (!this.config.configured())
      throw new AppError(
        `Set ${this.config.label} OAuth client, redirect URI, and encryption key before connecting`,
        503,
      );
    const state = randomBytes(32).toString("hex"),
      ticket = randomBytes(32).toString("hex"),
      verifier = randomBytes(48).toString("base64url");
    await this.vault.write(this.config.prefix + "launch:" + ticket, {
      userId,
      write,
      expires: Date.now() + 600000,
      verifier,
      state,
    } satisfies Pending);
    return {
      launch_url: new URL(
        `/api/${this.config.path}/oauth/launch?ticket=` + ticket,
        this.config.redirect(),
      ).href,
    };
  }
  async launch(ticket: string) {
    if (!/^[a-f0-9]{64}$/.test(ticket))
      throw new AppError("Invalid connection link", 400);
    const pending = await this.vault.take<Pending>(
      this.config.prefix + "launch:" + ticket,
    );
    if (!pending || pending.expires < Date.now())
      throw new AppError("Connection link expired. Start again in Ary.", 400);
    const browser = randomBytes(32).toString("hex");
    await this.vault.write(this.config.prefix + "state:" + pending.state, {
      ...pending,
      browser,
    });
    const url = this.config.client().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["openid", "email", ...this.config.scopes(pending.write)],
      state: pending.state,
      code_challenge: createHash("sha256")
        .update(pending.verifier)
        .digest("base64url"),
      code_challenge_method:
        "S256" as import("google-auth-library").CodeChallengeMethod,
    });
    return { url, browser };
  }
  async finish(state: string, browser: string, code: string) {
    if (!/^[a-f0-9]{64}$/.test(state))
      throw new AppError("Invalid OAuth state", 400);
    const candidate = await this.vault.read<Pending>(
      this.config.prefix + "state:" + state,
    );
    if (
      !candidate ||
      candidate.expires < Date.now() ||
      candidate.browser !== browser
    )
      throw new AppError(
        `${this.config.label} connection session expired or browser did not match`,
        400,
      );
    const pending = await this.vault.take<Pending>(
      this.config.prefix + "state:" + state,
    );
    if (!pending) throw new AppError("Connection already completed", 409);
    const oauth = this.config.client();
    try {
      const { tokens } = await oauth.getToken({
        code,
        codeVerifier: pending.verifier,
      });
      if (
        !tokens.refresh_token ||
        !tokens.id_token ||
        !this.config
          .scopes(pending.write)
          .every((scope) => tokens.scope?.split(" ").includes(scope))
      )
        throw new Error("Missing consent");
      const verified = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.clientId(),
      });
      const account = verified.getPayload();
      if (!account?.email || !account.email_verified)
        throw new Error("Unverified account");
      // One atomic, encrypted record; never replace another Calendar account.
      // Gmail retains its existing single-account behavior and isolated key prefix.
      const key = this.config.prefix + "connection:" + pending.userId;
      await this.vault.lock(key, async () => {
        const next: Connection = {
          id: randomUUID(),
          account: account.email!,
          refresh_token: tokens.refresh_token!,
          writable: pending.write,
        };
        if (this.config.path !== "calendar") return this.vault.write(key, next);
        const all = connections(await this.vault.read<StoredConnection>(key));
        const index = all.findIndex(
          (c) => c.account.toLowerCase() === next.account.toLowerCase(),
        );
        if (index >= 0)
          all[index] = next; // Reconsent invalidates only this account's approvals.
        else {
          if (all.length >= 8)
            throw new Error("Calendar account limit reached");
          all.push(next);
        }
        await this.vault.write(key, storedConnections(all));
      });
    } catch {
      throw new AppError(
        `${this.config.label} authorization failed. Start again and grant the requested scope.`,
        502,
      );
    }
  }
  async disconnect(userId: string, connectionId?: string) {
    return this.vault.lock(
      this.config.prefix + "connection:" + userId,
      async () => {
        const key = this.config.prefix + "connection:" + userId;
        const all = connections(await this.vault.read<StoredConnection>(key));
        const current = connectionId
          ? all.find((c) => c.id === connectionId)
          : all[0];
        if (connectionId && !current)
          throw new AppError(
            "Google account connection changed. Refresh connections.",
            409,
          );
        if (current) {
          const remaining = all.filter((c) => c.id !== current.id);
          // Preserve other accounts even when Google revocation fails.
          if (remaining.length)
            await this.vault.write(key, storedConnections(remaining));
          else await this.vault.remove(key);
          try {
            await this.config.client().revokeToken(current.refresh_token);
            return { disconnected: true, revoked: true };
          } catch {
            return { disconnected: true, revoked: false };
          }
        }
        return { disconnected: true, revoked: true };
      },
    );
  }
}
// Google all-day boundaries use the calendar's IANA zone, not the server's local zone.
export function midnightInZone(date: string, zone: string) {
  const target = Date.parse(date + "T00:00:00Z");
  let time = target;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
      format.formatToParts(new Date(time)).map((x) => [x.type, x.value]),
    );
    const represented = Date.parse(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    );
    time += target - represented;
  }
  return new Date(time).toISOString();
}
export function normalizeGoogleEvent(
  e: GoogleEvent,
  zone = "UTC",
): CalendarEvent {
  const privateData = e.extendedProperties?.private || {};
  return {
    id: e.id,
    etag: e.etag,
    summary: e.summary || "Untitled event",
    description: e.description || "",
    start: e.start.dateTime || midnightInZone(e.start.date!, zone),
    end: e.end.dateTime || midnightInZone(e.end.date!, zone),
    all_day: !!e.start.date,
    time_zone: e.start.timeZone || zone,
    busy:
      e.status !== "cancelled" &&
      e.transparency !== "transparent" &&
      !e.attendees?.some((a) => a.self && a.responseStatus === "declined"),
    editable:
      !e.start.date &&
      !e.recurringEventId &&
      !e.recurrence?.length &&
      !e.attendees?.length &&
      e.organizer?.self === true &&
      (!e.eventType || e.eventType === "default"),
    html_url: e.htmlLink?.startsWith("https://www.google.com/calendar/")
      ? e.htmlLink
      : null,
    people: (e.attendees || [])
      .map((a) => a.displayName || a.email || "")
      .filter(Boolean),
    entity_ids: (privateData.ary_entity_ids || "").split(",").filter(Boolean),
    operation_id: privateData.ary_operation,
    operation_digest: privateData.ary_digest,
  };
}
export class GoogleCalendarProvider implements CalendarProvider {
  constructor(
    private userId: string,
    private vault: CalendarVault = new EncryptedCalendarVault(),
    private fetcher: typeof fetch = fetch,
    private accessToken?: () => Promise<string>,
  ) {}
  async status() {
    const configured = googleCalendarConfigured();
    const c = configured
      ? await this.vault.read<StoredConnection>("connection:" + this.userId)
      : null;
    return {
      configured,
      connected: !!c,
      writable: c?.writable || false,
      connection_id: c?.id || null,
      account: c?.account || null,
      accounts: connections(c).map(({ id, account, writable }) => ({
        connection_id: id,
        account,
        writable,
      })),
    };
  }
  private async connected<T>(
    write: boolean,
    id: string | undefined,
    work: (
      request: (path: string, init?: RequestInit) => Promise<Response>,
      c: Connection,
    ) => Promise<T>,
  ) {
    return this.vault.lock("connection:" + this.userId, async () => {
      const all = connections(
        await this.vault.read<StoredConnection>("connection:" + this.userId),
      );
      if (!all.length) throw new AppError("Connect Google Calendar first", 409);
      const c = id ? all.find((item) => item.id === id) : all[0];
      if (!c)
        throw new AppError(
          "Google account connection changed. Prepare a new request for approval.",
          409,
        );
      if (write && !c.writable)
        throw new AppError(
          "Reconnect with event editing consent before proposing a write",
          403,
        );
      let token: string;
      try {
        if (this.accessToken) token = await this.accessToken();
        else {
          const oauth = client();
          oauth.setCredentials({ refresh_token: c.refresh_token });
          token = (await oauth.getAccessToken()).token!;
          if (!token) throw new Error();
        }
      } catch {
        throw new AppError(
          "Google authorization expired or failed. Reconnect Calendar.",
          401,
        );
      }
      const request = (path: string, init: RequestInit = {}) =>
        this.fetcher(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
            path,
          {
            ...init,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              ...init.headers,
            },
            signal: AbortSignal.timeout(15000),
            cache: "no-store",
            redirect: "error",
          },
        );
      try {
        return await work(request, c);
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          "Google Calendar request failed or timed out. Inspect Action history before retrying; the external result may be uncertain.",
          502,
        );
      }
    });
  }
  async list(window: { start: string; end: string; connection_id?: string }) {
    return this.connected(false, window.connection_id, async (request, c) => {
      let next: string | undefined,
        zone = "UTC";
      const events: CalendarEvent[] = [];
      for (let page = 0; page < 4; page++) {
        const query = new URLSearchParams({
          timeMin: window.start,
          timeMax: window.end,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
          showDeleted: "false",
          ...(next ? { pageToken: next } : {}),
        });
        const response = await request("?" + query);
        if (!response.ok)
          throw new AppError(
            "Google Calendar read failed (" + response.status + ")",
            502,
          );
        const data = (await response.json()) as {
          items?: GoogleEvent[];
          timeZone?: string;
          nextPageToken?: string;
        };
        zone = data.timeZone || zone;
        events.push(
          ...(data.items || [])
            .filter((e) => e.status !== "cancelled")
            .map((e) => normalizeGoogleEvent(e, zone)),
        );
        next = data.nextPageToken;
        if (!next) break;
      }
      return {
        events,
        complete: !next,
        time_zone: zone,
        connection_id: c.id,
        account: c.account,
      };
    });
  }
  private async write(
    input: CalendarWrite | CalendarUpdate,
    entityIds: string[],
  ) {
    return this.connected(true, input.connection_id, async (request) => {
      const update = "event_id" in input;
      const hash = createHash("sha256")
        .update(JSON.stringify([input.event, [...entityIds].sort()]))
        .digest("hex");
      const id = update
        ? input.event_id
        : createHash("sha256")
            .update(
              [this.userId, input.connection_id, input.operation_id].join(":"),
            )
            .digest("hex");
      const privateData = {
        ary_operation: input.operation_id,
        ary_digest: hash,
        ary_entity_ids: [...entityIds].sort().join(","),
      };
      const before = await request("/" + encodeURIComponent(id));
      let current: GoogleEvent | undefined;
      if (before.ok) current = (await before.json()) as GoogleEvent;
      else if (before.status !== 404)
        throw new AppError(
          "Could not verify Google event before writing (" +
            before.status +
            ")",
          502,
        );
      if (
        current?.extendedProperties?.private?.ary_operation ===
        input.operation_id
      ) {
        if (current.extendedProperties.private.ary_digest !== hash)
          throw new AppError(
            "Operation ID was already used for different event details",
            409,
          );
        return {
          event: normalizeGoogleEvent(current, input.event.time_zone),
          recovered: true,
        };
      }
      if (!update && current)
        throw new AppError(
          "Event ID already exists; no event was overwritten",
          409,
        );
      if (update) {
        if (!current || current.etag !== input.etag)
          throw new AppError(
            "Event changed since review. Refresh and approve the new version.",
            409,
          );
        const normalized = normalizeGoogleEvent(current, input.event.time_zone);
        if (normalized.entity_ids.some((id) => !entityIds.includes(id)))
          throw new AppError(
            "Include the event's existing Nexus links in the reviewed request so their permission policies are checked",
            409,
          );
        if (!normalized.editable)
          throw new AppError(
            "V1 edits only personal, timed, non-recurring events without attendees",
            403,
          );
        for (const field of [
          "summary",
          "description",
          "start",
          "end",
        ] as const) {
          const same =
            field === "start" || field === "end"
              ? Date.parse(normalized[field]) ===
                Date.parse(input.before[field])
              : normalized[field] === input.before[field];
          if (!same)
            throw new AppError(
              "Reviewed event details do not match Google; refresh before approval",
              409,
            );
        }
      }
      const body = {
        summary: input.event.summary,
        description: input.event.description,
        start: { dateTime: input.event.start, timeZone: input.event.time_zone },
        end: { dateTime: input.event.end, timeZone: input.event.time_zone },
        extendedProperties: {
          private: { ...current?.extendedProperties?.private, ...privateData },
        },
        ...(!update ? { id } : {}),
      };
      const response = await request(
        (update ? "/" + encodeURIComponent(id) : "") + "?sendUpdates=none",
        {
          method: update ? "PATCH" : "POST",
          headers: update ? { "If-Match": input.etag } : {},
          body: JSON.stringify(body),
        },
      );
      if (response.status === 412)
        throw new AppError(
          "Google event changed during execution. Refresh and request approval again.",
          409,
        );
      if (!response.ok)
        throw new AppError(
          "Google Calendar write failed (" +
            response.status +
            "). Inspect this operation before retrying.",
          502,
        );
      return {
        event: normalizeGoogleEvent(
          (await response.json()) as GoogleEvent,
          input.event.time_zone,
        ),
        recovered: false,
      };
    });
  }
  create(input: CalendarWrite, entityIds: string[]) {
    return this.write(input, entityIds);
  }
  update(input: CalendarUpdate, entityIds: string[]) {
    return this.write(input, entityIds);
  }
}
