import { AppError } from "../../domain/validation";
import { assertDesktopAccess, DESKTOP_ORIGIN } from "../desktop/security";
export function assertControlAccess(owner: string, authorized: boolean) {
  assertDesktopAccess(owner, authorized);
  if (process.env.ARY_DIGITAL_CONTROL_ENABLED !== "true")
    throw new AppError(
      "Digital control is disabled; explicitly enable ARY_DIGITAL_CONTROL_ENABLED on this Mac",
      403,
    );
}
export function controlOrigins(
  raw = process.env.ARY_BROWSER_ALLOWED_ORIGINS ?? "",
) {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => {
      const u = new URL(v);
      if (
        !["http:", "https:"].includes(u.protocol) ||
        u.origin !== v ||
        u.username ||
        u.password ||
        u.origin === DESKTOP_ORIGIN ||
        (u.port === "3000" && ["localhost", "[::1]"].includes(u.hostname))
      )
        throw new AppError("Invalid browser origin configuration", 503);
      return u.origin;
    });
}
export function assertControlUrl(value: string, origins: readonly string[]) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("Invalid website URL", 400);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !origins.includes(url.origin) ||
    url.origin === DESKTOP_ORIGIN
  )
    throw new AppError(
      "Website origin is outside the configured control scope",
      403,
    );
  return url.toString();
}
export function assertControlApp(id: string, allowed: readonly string[]) {
  if (
    !allowed.includes(id) ||
    /safari|chrome|chromium|firefox|edge|terminal|iterm|code|scripteditor|systempreferences|systemsettings|keychain|password|ary.*nexus|com\.clevaryn\.ary/i.test(
      id,
    )
  )
    throw new AppError("Application is outside the allowed control scope", 403);
}

/** Do not forward model/API credentials into browser or native helper processes. */
export function controlProcessEnv(): NodeJS.ProcessEnv &
  Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    LANG: "en_US.UTF-8",
  };
}
