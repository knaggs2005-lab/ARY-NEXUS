import { execFile } from "node:child_process";
import { AppError } from "../../domain/validation";
export type MacRunner = (
  file: string,
  args: string[],
  stdin?: string,
) => Promise<string>;
export const runMacFile: MacRunner = (file, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        shell: false,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: process.env.HOME,
          LANG: "en_US.UTF-8",
        },
      },
      (error, stdout, stderr) => {
        if (error) reject(macPrivacyError(String(stderr), error));
        else resolve(stdout.trimEnd());
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(stdin);
  });
export function macPrivacyError(stderr: string, error?: unknown) {
  if (
    /-1743|not authorized to send Apple events|not permitted|assistive access|1002|10004|access.*denied/i.test(
      stderr,
    )
  )
    return new AppError(
      "macOS denied access. Open System Settings → Privacy & Security → Automation and allow the requesting Ary/Node host to control the named app. Hide/lock also require Accessibility. Reminders may require Reminders access. Retry only after reviewing the failed action; an uncertain operation is not automatically repeated.",
      403,
    );
  if (/cancel|128\)/i.test(stderr))
    return new AppError(
      "macOS operation was cancelled; inspect the app before making another request",
      409,
    );
  return new AppError(
    (error as { killed?: boolean })?.killed
      ? "Mac operation timed out; its result is uncertain. Inspect the app before retrying."
      : "Mac operation failed. Check that the app is installed, running if required, and its macOS privacy access is allowed. No automatic repeat was attempted.",
    502,
  );
}
