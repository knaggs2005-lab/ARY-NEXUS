import { registerControlStop } from "../../services/action-cancellation";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type ElementHandle,
} from "playwright";
import { randomUUID } from "node:crypto";
import type {
  BrowserControlProvider,
  ControlAction,
  ControlSnapshot,
} from "../../domain/digital-control";
import { AppError } from "../../domain/validation";
import { digest } from "../../services/permission-service";
import { assertControlUrl, controlProcessEnv } from "./security";
import { ControlFiles } from "./files";
type Item = {
  handle: ElementHandle;
  signature: string;
  protected: boolean;
  actions: string[];
};
type Snapshot = {
  value: ControlSnapshot;
  items: Map<string, Item>;
  url: string;
  used: boolean;
};
type Session = {
  owner: string;
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  snapshots: Map<string, Snapshot>;
  permit: boolean;
  download: boolean;
  touched: number;
  busy: boolean;
  config: string;
};
const state = globalThis as typeof globalThis & {
  aryControlledBrowsers?: Map<string, Session>;
  aryControlOpenings?: Map<string, number>;
};
const sessions = (state.aryControlledBrowsers ??= new Map<string, Session>());
const openings = (state.aryControlOpenings ??= new Map<string, number>());
/** Fixed DOM inspection code. No request-supplied selectors or JavaScript. */
function describe(element: Element) {
  const e = element as HTMLInputElement;
  const protectedField =
    e.type === "password" ||
    /password|credit.?card|card.?number|cvv|security.?code|one.?time|otp|secret|token/i.test(
      [
        e.name,
        e.id,
        e.getAttribute("autocomplete"),
        e.getAttribute("aria-label"),
      ].join(" "),
    );
  const labelNode = e.labels?.[0]?.cloneNode(true) as Element | undefined;
  labelNode
    ?.querySelectorAll("input,select,textarea")
    .forEach((control) => control.remove());
  const label =
    e.getAttribute("aria-label") ||
    labelNode?.textContent ||
    e.getAttribute("placeholder") ||
    e.textContent ||
    e.id;
  const actions =
    e.disabled || protectedField
      ? []
      : e.tagName === "SELECT"
        ? ["select"]
        : e.type === "file"
          ? ["upload"]
          : ["button", "submit", "reset"].includes(e.type)
            ? ["click", "key"]
            : ["checkbox", "radio"].includes(e.type)
              ? ["check"]
              : ["INPUT", "TEXTAREA"].includes(e.tagName)
                ? ["fill", "key"]
                : ["click", "key", ...(e.tagName === "A" ? ["download"] : [])];
  return {
    role: e.getAttribute("role") || e.tagName.toLowerCase(),
    label: (label ?? "").trim().slice(0, 180),
    value: protectedField ? "[protected]" : (e.value ?? "").slice(0, 500),
    protected: protectedField,
    actions,
    href: e.getAttribute("href"),
    form: e.form?.action,
    method: e.form?.method,
    type: e.type,
    checked: e.checked,
    disabled: e.disabled,
  };
}
export class PlaywrightBrowser implements BrowserControlProvider {
  constructor(
    private owner: string,
    private guard: () => void,
    private origins: string[],
    private files: ControlFiles,
    private launch: () => Promise<Browser> = () =>
      chromium.launch({
        headless: false,
        channel: "chrome",
        env: controlProcessEnv(),
      }),
  ) {}
  assertAvailable() {
    this.guard();
    if (!this.origins.length)
      throw new AppError(
        "Configure ARY_BROWSER_ALLOWED_ORIGINS before opening a controlled browser",
        503,
      );
  }
  private session(id: string, closing = false) {
    const s = sessions.get(id);
    if (
      !s ||
      s.owner !== this.owner ||
      (!closing &&
        (s.page.isClosed() || s.config !== JSON.stringify(this.origins)))
    )
      throw new AppError(
        "Browser session unavailable; inspect or open a new session",
        410,
      );
    return s;
  }
  private async exclusive<T>(
    s: Session,
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ) {
    if (s.busy)
      throw new AppError("This browser is already handling an action", 409);
    s.busy = true;
    s.touched = Date.now();
    const abort = () => {
      void s.browser
        .close()
        .then(() => sessions.delete(s.id))
        .catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      return await work();
    } finally {
      s.busy = false;
      s.permit = false;
      s.download = false;
      signal?.removeEventListener("abort", abort);
    }
  }
  async open(value: string, signal?: AbortSignal) {
    this.assertAvailable();
    const url = assertControlUrl(value, this.origins);
    for (const s of sessions.values())
      if (s.owner === this.owner && Date.now() - s.touched > 15 * 60_000)
        await this.close(s.id);
    if (
      [...sessions.values()].filter((s) => s.owner === this.owner).length +
        (openings.get(this.owner) ?? 0) >=
      3
    )
      throw new AppError(
        "Close an existing controlled browser first (maximum three)",
        429,
      );
    openings.set(this.owner, (openings.get(this.owner) ?? 0) + 1);
    let launched: Browser | undefined;
    try {
      const browser = (launched = await this.launch());
      const context = await browser.newContext({
        acceptDownloads: true,
        serviceWorkers: "block",
        permissions: [],
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      const s: Session = {
        owner: this.owner,
        id: randomUUID(),
        browser,
        context,
        page,
        snapshots: new Map(),
        permit: false,
        download: false,
        touched: Date.now(),
        busy: false,
        config: JSON.stringify(this.origins),
      };
      sessions.set(s.id, s);
      browser.on("disconnected", () => sessions.delete(s.id));
      page.setDefaultTimeout(8000);
      await context.route("**/*", async (route) => {
        try {
          assertControlUrl(route.request().url(), this.origins);
          if (
            !["GET", "HEAD", "OPTIONS"].includes(route.request().method()) &&
            !s.permit
          )
            throw Error("Write outside approved action");
          await route.continue();
        } catch {
          await route.abort().catch(() => {});
        }
      });
      await context.routeWebSocket("**/*", (ws) => ws.close());
      context.on("page", (p) => {
        if (p !== page) void p.close().catch(() => {});
      });
      page.on("dialog", (dialog) => {
        void dialog.dismiss();
      });
      page.on("download", (download) => {
        if (!s.download) void download.cancel();
      });
      return await this.exclusive(s, signal, async () => {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        return this.snapshot(s);
      });
    } catch (error) {
      await launched?.close().catch(() => {});
      throw error;
    } finally {
      const remaining = (openings.get(this.owner) ?? 1) - 1;
      if (remaining) openings.set(this.owner, remaining);
      else openings.delete(this.owner);
    }
  }
  private async snapshot(s: Session): Promise<ControlSnapshot> {
    assertControlUrl(s.page.url(), this.origins);
    for (const snap of s.snapshots.values())
      for (const item of snap.items.values())
        await item.handle.dispose().catch(() => {});
    s.snapshots.clear();
    const all = await s.page.$$(
      "button,a,input,textarea,select,[role=button],[role=menuitem],[role=checkbox],[role=tab]",
    );
    const items = new Map<string, Item>(),
      elements: ControlSnapshot["elements"] = [];
    for (const handle of all.slice(0, 200)) {
      if (!(await handle.isVisible())) {
        await handle.dispose();
        continue;
      }
      const info = await handle.evaluate(describe),
        id = `e${elements.length + 1}`;
      items.set(id, {
        handle,
        signature: digest(info),
        protected: info.protected,
        actions: info.actions,
      });
      elements.push({
        id,
        role: info.role,
        label: info.label,
        value: info.value,
        protected: info.protected,
        actions: info.actions,
      });
    }
    for (const handle of all.slice(200)) await handle.dispose();
    const value: ControlSnapshot = {
      id: randomUUID(),
      surface: "browser",
      target_id: s.id,
      title: `${await s.page.title()} · ${s.page.url()}`,
      text_preview: (await s.page.locator("body").innerText()).slice(0, 6000),
      observed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 120000).toISOString(),
      elements,
      truncated: all.length > 200,
    };
    s.snapshots.set(value.id, { value, items, url: s.page.url(), used: false });
    return value;
  }
  async inspect(id: string, signal?: AbortSignal) {
    this.assertAvailable();
    const s = this.session(id);
    return this.exclusive(s, signal, () => this.snapshot(s));
  }
  async act(input: ControlAction, signal?: AbortSignal) {
    this.assertAvailable();
    const s = [...sessions.values()].find(
      (s) => s.owner === this.owner && s.snapshots.has(input.snapshot_id),
    );
    if (!s || s.config !== JSON.stringify(this.origins))
      throw new AppError("Snapshot expired or belongs to another owner", 410);
    return this.exclusive(s, signal, async () => {
      const snap = s.snapshots.get(input.snapshot_id)!,
        item = snap.items.get(input.element_id);
      if (
        snap.used ||
        Date.parse(snap.value.expires_at) <= Date.now() ||
        s.page.url() !== snap.url ||
        !item
      )
        throw new AppError(
          "Stale or invalid browser target; inspect again",
          409,
        );
      if (item.protected || !item.actions.includes(input.verb))
        throw new AppError(
          "Action is not supported for this inspected target",
          403,
        );
      if (digest(await item.handle.evaluate(describe)) !== item.signature)
        throw new AppError("Browser target changed since inspection", 409);
      signal?.throwIfAborted();
      snap.used = true;
      s.permit = true;
      let receipt: Record<string, unknown> = {};
      switch (input.verb) {
        case "click":
          await item.handle.click();
          break;
        case "fill":
          await item.handle.fill(input.value!);
          break;
        case "select":
          await item.handle.selectOption(input.value!);
          break;
        case "check":
          await item.handle.setChecked(input.checked!);
          break;
        case "key":
          await item.handle.press(input.key!);
          break;
        case "upload": {
          const file = await this.files.read(input.file_id!);
          try {
            await item.handle.setInputFiles(file);
            receipt = { file_id: file.name, bytes: file.buffer.length };
          } finally {
            file.buffer.fill(0);
          }
          break;
        }
        case "download": {
          s.download = true;
          const pending = s.page.waitForEvent("download", { timeout: 10000 });
          const [download] = await Promise.all([pending, item.handle.click()]);
          assertControlUrl(download.url(), this.origins);
          const stream = await download.createReadStream();
          const chunks: Buffer[] = [];
          let bytes = 0;
          try {
            for await (const chunk of stream) {
              signal?.throwIfAborted();
              bytes += chunk.length;
              if (bytes > 10 * 1024 * 1024)
                throw new AppError("Download exceeds 10 MB", 413);
              chunks.push(Buffer.from(chunk));
            }
            receipt = await this.files.write(
              `${randomUUID()}-${download.suggestedFilename()}`,
              Buffer.concat(chunks),
            );
          } finally {
            await download.delete();
          }
          break;
        }
        default:
          throw new AppError("Unsupported browser action", 400);
      }
      s.permit = false;
      return {
        dispatched: true,
        verb: input.verb,
        receipt,
        verification:
          "Interaction returned; inspect the resulting state before claiming business success",
        snapshot: await this.snapshot(s),
      };
    });
  }
  async close(id: string) {
    this.guard();
    const s = this.session(id, true);
    await s.browser.close();
    sessions.delete(id);
    return { closed: true, session_id: id };
  }
}
export async function stopControlledBrowsers(owner: string) {
  for (const s of sessions.values())
    if (s.owner === owner) {
      await s.browser.close();
      sessions.delete(s.id);
    }
}

registerControlStop("browser", stopControlledBrowsers);

// Bound unattended sessions even if the client disappears. No additional capture occurs.
const timers = globalThis as typeof globalThis & {
  aryControlReaper?: ReturnType<typeof setInterval>;
};
timers.aryControlReaper ??= setInterval(() => {
  for (const s of sessions.values())
    if (Date.now() - s.touched > 15 * 60_000) {
      void s.browser
        .close()
        .then(() => sessions.delete(s.id))
        .catch(() => {});
    }
}, 30_000);
timers.aryControlReaper.unref();
