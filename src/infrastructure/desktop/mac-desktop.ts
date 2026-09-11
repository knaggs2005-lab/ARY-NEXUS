import { resolve } from "node:path";
import type {
  DesktopProvider,
  DesktopVerb,
  InstalledApp,
} from "../../domain/desktop";
import { desktopSchemas } from "../../domain/desktop";
import type { Json } from "../../domain/models";
import { AppError } from "../../domain/validation";
import { digest } from "../../services/permission-service";
import { EncryptedCalendarVault, type CalendarVault } from "../calendar/vault";
import { runMacFile, type MacRunner } from "./process";
import { resolveInstalledApp, scanInstalledApps } from "./apps";
import { macScripts } from "./scripts";
interface Receipt {
  fingerprint: string;
  state: "pending" | "complete";
  result?: Json;
}
export class MacDesktopProvider implements DesktopProvider {
  constructor(
    private userId: string,
    private guard: () => void,
    private run: MacRunner = runMacFile,
    private scan: () => Promise<InstalledApp[]> = () => scanInstalledApps(run),
    private vault: CalendarVault = new EncryptedCalendarVault(
      resolve(".data/desktop-vault"),
    ),
  ) {}
  assertAvailable() {
    this.guard();
  }
  async execute(
    verb: DesktopVerb,
    raw: Record<string, unknown>,
  ): Promise<Json> {
    this.assertAvailable();
    if (!Object.hasOwn(desktopSchemas, verb))
      throw new AppError("Invalid desktop action name", 400);
    const parsed = desktopSchemas[verb].safeParse(raw);
    if (!parsed.success)
      throw new AppError("Invalid desktop action input", 400);
    const input = parsed.data as Record<string, unknown>;
    if (verb === "list_apps") return { apps: await this.scan() };
    if (verb === "clipboard_read") {
      const text = await this.script("clipboard_read", []);
      if (text.length > 16000)
        throw new AppError(
          "Clipboard text exceeds the 16,000 character limit",
          413,
        );
      return {
        text,
        format: "text/plain",
        captured_at: new Date().toISOString(),
      };
    }
    const key = `desktop:${this.userId}:${input.operation_id}`;
    const fingerprint = digest([verb, input]);
    return this.vault.lock(key, async () => {
      const previous = await this.vault.read<Receipt>(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new AppError(
            "Desktop operation ID belongs to different inputs",
            409,
          );
        if (previous.state === "complete") return previous.result!;
        throw new AppError(
          "Desktop operation outcome is uncertain. Inspect the Mac and Action History; this operation will not execute again. A new operation requires fresh review.",
          409,
        );
      }
      // Resolve before claiming execution, and always from a fresh scan.
      let app: InstalledApp | undefined;
      if (typeof input.app_id === "string")
        app = resolveInstalledApp(await this.scan(), input.app_id);
      if (verb === "media")
        app = resolveInstalledApp(
          await this.scan(),
          input.player === "music" ? "com.apple.Music" : "com.spotify.client",
        );
      if (
        verb === "quit_app" &&
        app &&
        /^(com\.apple\.(finder|systemevents|loginwindow|SystemUIServer|dock)|.*ary.*nexus.*)$/i.test(
          app.id,
        )
      )
        throw new AppError(
          "Quitting this system or Ary host app is not an allowed bridge action",
          403,
        );
      if (verb === "do_not_disturb") {
        const name = input.enabled ? "Ary Focus On" : "Ary Focus Off";
        const names = (await this.run("/usr/bin/shortcuts", ["list"])).split(
          "\n",
        );
        if (!names.includes(name))
          throw new AppError(
            `Create the '${name}' shortcut in Shortcuts with only Set Focus → Do Not Disturb ${input.enabled ? "On until turned off" : "Off"}. Ary cannot configure it automatically.`,
            503,
          );
      }
      this.assertAvailable();
      await this.vault.write(key, {
        fingerprint,
        state: "pending",
      } satisfies Receipt);
      // Failures/timeouts keep pending: OS side effects cannot share the database transaction.
      try {
        let output: string;
        switch (verb) {
          case "launch_app":
            output = await this.run("/usr/bin/open", [app!.path]);
            break;
          case "open_website":
            output = await this.run("/usr/bin/open", [String(input.url)]);
            break;
          case "media":
            output = await this.script("media", [
              app!.path,
              String(input.command),
            ]);
            break;
          case "volume":
            output = await this.script("volume", [String(input.level)]);
            break;
          case "clipboard_write":
            output = await this.script("clipboard_write", [String(input.text)]);
            break;
          case "hide_others":
            output = await this.script("hide_others", [app!.path, app!.id]);
            break;
          case "quit_app":
            output = await this.script("quit_app", [app!.path]);
            break;
          case "lock_screen":
            output = await this.script("lock_screen", []);
            break;
          case "sleep_display":
            output = await this.run("/usr/bin/pmset", ["displaysleepnow"]);
            break;
          case "do_not_disturb":
            output = await this.run("/usr/bin/shortcuts", [
              "run",
              input.enabled ? "Ary Focus On" : "Ary Focus Off",
            ]);
            break;
          case "create_note":
            output = await this.script("create_note", [
              String(input.title),
              String(input.body),
            ]);
            break;
          case "create_reminder":
            output = await this.script("create_reminder", [
              String(input.title),
              String(input.notes),
              String(input.due_at || ""),
            ]);
            break;
          default:
            throw new AppError("Invalid desktop action name", 400);
        }
        const result: Json = {
          operation_id: input.operation_id,
          verb,
          dispatched: true,
          detail: output.slice(0, 16000),
          app: app ?? null,
          completed_at: new Date().toISOString(),
          verification: ["create_note", "create_reminder"].includes(verb)
            ? "native_record_id"
            : "command_returned; inspect Mac for visible state",
        };
        if (["create_note", "create_reminder"].includes(verb)) {
          if (!output)
            throw new AppError(
              "Native record ID missing; inspect the app before retrying",
              502,
            );
          result.record_id = output;
        }
        await this.vault.write(key, {
          fingerprint,
          state: "complete",
          result,
        } satisfies Receipt);
        return result;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "Desktop operation outcome is uncertain because its result could not be saved. Inspect the Mac and Action History before another request; this operation will not execute again.",
          502,
        );
      }
    });
  }
  private script(name: keyof typeof macScripts, args: string[]) {
    return this.run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-", ...args],
      macScripts[name],
    );
  }
}
