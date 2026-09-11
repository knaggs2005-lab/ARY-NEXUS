import { readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { desktopAppId, type InstalledApp } from "../../domain/desktop";
import { runMacFile, type MacRunner } from "./process";
import { AppError } from "../../domain/validation";
/** Rescan at execution; no model-supplied path, fuzzy match, symlink traversal or cached identity. */
export async function scanInstalledApps(
  run: MacRunner = runMacFile,
  roots = [
    "/Applications",
    "/System/Applications",
    join(homedir(), "Applications"),
  ],
): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];
  async function visit(root: string, depth: number) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (e) {
      if (
        ["ENOENT", "EACCES"].includes((e as NodeJS.ErrnoException).code || "")
      )
        return;
      throw e;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(root, entry.name);
      if (entry.name.endsWith(".app")) {
        try {
          const plist = join(path, "Contents/Info.plist");
          if ((await realpath(plist)) !== plist) continue;
          const info = JSON.parse(
            await run("/usr/bin/plutil", [
              "-convert",
              "json",
              "-o",
              "-",
              plist,
            ]),
          );
          const id = desktopAppId.parse(info.CFBundleIdentifier);
          apps.push({
            id,
            name: String(
              info.CFBundleDisplayName ||
                info.CFBundleName ||
                entry.name.slice(0, -4),
            ).slice(0, 200),
            path,
          });
        } catch {
          /* Non-app or unreadable bundle; never infer an executable. */
        }
      } else if (depth < 3) await visit(path, depth + 1);
    }
  }
  for (const root of roots) {
    try {
      await visit(await realpath(root), 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return apps.sort((a, b) => a.name.localeCompare(b.name));
}
export function resolveInstalledApp(
  apps: InstalledApp[],
  raw: unknown,
): InstalledApp {
  const parsed = desktopAppId.safeParse(raw);
  if (!parsed.success)
    throw new AppError("Invalid application ID; select a scanned app", 400);
  const matches = apps.filter((app) => app.id === parsed.data);
  if (matches.length !== 1)
    throw new AppError(
      matches.length
        ? "Ambiguous installed application ID; resolve duplicate installations first"
        : "Invalid application name: this ID is not installed",
      400,
    );
  return matches[0];
}
