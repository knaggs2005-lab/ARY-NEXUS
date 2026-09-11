import { timingSafeEqual } from "node:crypto";
import { AppError } from "../../domain/validation";
export const DESKTOP_ORIGIN = "http://127.0.0.1:3000";
/** Token originates in Electron main, is passed only to its owned loopback child,
 * and injected outside the renderer. No Origin/forwarded-host shortcuts. */
export function desktopRequestAuthorized(request: Request): boolean {
  const secret = process.env.ARY_DESKTOP_SESSION_TOKEN || "";
  const actual = request.headers.get("x-ary-desktop-session") || "";
  return (
    /^[a-f0-9]{64}$/.test(secret) &&
    /^[a-f0-9]{64}$/.test(actual) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(secret)) &&
    request.method === "POST" &&
    request.headers.get("origin") === DESKTOP_ORIGIN &&
    request.headers.get("host") === "127.0.0.1:3000" &&
    ["http://127.0.0.1:3000", "http://localhost:3000"].includes(
      new URL(request.url).origin,
    ) &&
    !request.headers.has("forwarded") &&
    (!request.headers.has("x-forwarded-for") ||
      ["127.0.0.1", "::1"].includes(request.headers.get("x-forwarded-for")!))
  );
}
export function assertDesktopAccess(userId: string, authorized: boolean) {
  if (process.platform !== "darwin")
    throw new AppError("Desktop Bridge requires macOS", 503);
  if (process.env.ARY_DESKTOP_BRIDGE_ENABLED !== "true")
    throw new AppError(
      "Desktop Bridge is disabled; enable ARY_DESKTOP_BRIDGE_ENABLED explicitly on this Mac",
      403,
    );
  if (
    process.env.ARY_STORAGE !== "supabase" ||
    !process.env.ARY_DESKTOP_USER_ID ||
    userId !== process.env.ARY_DESKTOP_USER_ID
  )
    throw new AppError(
      "Desktop Bridge is restricted to its configured authenticated owner",
      403,
    );
  if (!authorized)
    throw new AppError(
      "Open Ary in its installed Mac app with an owned local server; Desktop Bridge requires its same-origin launcher session",
      403,
    );
}
