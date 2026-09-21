import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CommandReceipt,
  CommandName,
} from "../../domain/self-development";
import { sourcePath } from "../../domain/self-development";
import { AppError } from "../../domain/validation";

/** Fixed host policy; callers cannot supply a timeout or broaden command authority. */
export const commandTimeoutMs: Record<CommandName, number> = {
  test: 300000,
  focused: 60000,
  typecheck: 120000,
  format: 60000,
  build: 300000,
};
/** OS-enforced deny-default boundary. No host home, credential environment, network or writable dependencies. */
export function sandboxProfile(
  scratch: string,
  dependencies: string,
  nodeRoot: string,
) {
  const q = (s: string) => JSON.stringify(s);
  const ancestors = new Set<string>();
  for (const location of [scratch, dependencies, nodeRoot]) {
    let parent = dirname(location);
    while (parent !== "/") {
      ancestors.add(parent);
      parent = dirname(parent);
    }
  }
  return `(version 1)(deny default)(allow process-exec)(allow process-fork)(allow signal (target self) (target children))(allow process-info* (target self))(allow sysctl-read)
    (allow file-read-metadata ${[...ancestors].map((p) => `(literal ${q(p)})`).join(" ")})
    (allow file-read* (literal "/") ${["/System/Library", "/System/Volumes/Preboot/Cryptexes/OS/System/Library", "/System/Volumes/Preboot/Cryptexes/OS/usr/lib", "/usr/lib", "/Library/Apple", "/dev/null", "/dev/urandom", "/dev/random", "/dev/zero", "/dev/fd", "/private/var/db/dyld", nodeRoot, ...(nodeRoot.startsWith("/opt/homebrew/Cellar/") ? ["/opt/homebrew/Cellar", "/opt/homebrew/opt"] : []), dependencies, scratch].map((p) => `(subpath ${q(p)})`).join(" ")})
    (allow file-write* (subpath ${q(scratch)}) (literal "/dev/null"))`;
}
export type SandboxedCommand = (
  command: CommandName,
  scratch: string,
  dependencies: string,
  focused: string[],
  signal?: AbortSignal,
) => Promise<CommandReceipt>;
export const runSandboxed: SandboxedCommand = async (
  command,
  scratch,
  dependencies,
  focused,
  signal,
) => {
  if (process.platform !== "darwin")
    throw new AppError(
      "Development runner requires the verified macOS sandbox; no host-execution fallback",
      503,
    );
  if (!["test", "focused", "typecheck", "format", "build"].includes(command))
    throw new AppError("Command not allowlisted", 403);
  for (const path of focused) {
    sourcePath.parse(path);
    if (!/^tests\/.*\.test\.tsx?$/.test(path))
      throw new AppError("Invalid focused test path", 403);
  }
  if (
    (await realpath(scratch)) !== scratch ||
    !/\/validation-(test|focused|typecheck|format|build)$/.test(scratch)
  )
    throw new AppError(
      "Command cwd must be an isolated validation snapshot",
      403,
    );
  dependencies = await realpath(dependencies);
  const node = await realpath(process.execPath);
  const nodeRoot = dirname(dirname(node));
  const commands: Record<CommandName, string[]> = {
    test: [
      join(dependencies, "vitest/vitest.mjs"),
      "run",
      "--api.host",
      "127.0.0.1",
      "--api.middlewareMode=true",
    ],
    focused: [
      join(dependencies, "vitest/vitest.mjs"),
      "run",
      "--api.host",
      "127.0.0.1",
      "--api.middlewareMode=true",
      ...focused,
    ],
    typecheck: [join(dependencies, "typescript/bin/tsc"), "--noEmit"],
    format: [
      join(dependencies, "prettier/bin/prettier.cjs"),
      "--check",
      "src",
      "scripts",
      "tests",
      "desktop",
      "*.json",
      "*.ts",
      "README.md",
    ],
    build: [join(dependencies, "next/dist/bin/next"), "build", "--webpack"],
  };
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let output = "",
      bytes = 0,
      truncated = false,
      settled = false;
    let termination: "exited" | "timeout" | "cancelled" | "output_limit" =
      "exited";
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        sandboxProfile(scratch, dependencies, nodeRoot),
        node,
        ...commands[command],
      ],
      {
        cwd: scratch,
        shell: false,
        detached: true,
        env: {
          OPENSSL_CONF: "/dev/null",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
          PATH: dirname(node),
          HOME: scratch,
          TMPDIR: scratch,
          NODE_ENV: command === "build" ? "production" : "test",
          NEXT_TELEMETRY_DISABLED: "1",
          WS_NO_BUFFER_UTIL: "1",
          CI: "1",
          NODE_OPTIONS: "--max-old-space-size=2048",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const kill = () => {
      if (child.pid && !settled)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already exited */
        }
    };
    const cancel = () => {
      termination = "cancelled";
      kill();
    };
    const timer = setTimeout(() => {
      termination = "timeout";
      kill();
    }, commandTimeoutMs[command]);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    function collect(chunk: Buffer) {
      bytes += chunk.length;
      if (output.length + chunk.toString("utf8").length > 524288)
        truncated = true;
      if (output.length < 524288)
        output += chunk.toString("utf8").slice(0, 524288 - output.length);
      else truncated = true;
      if (bytes > 2 * 1024 * 1024) {
        termination = "output_limit";
        kill();
      }
    }
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      settled = true;
      reject(new AppError(`Sandbox runner unavailable: ${e.name}`, 503));
    });
    child.once("close", (code, exitSignal) => {
      kill();
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve({
        command,
        exit_code: code,
        signal: exitSignal,
        duration_ms: Date.now() - started,
        termination,
        timeout_ms: commandTimeoutMs[command],
        output_bytes: bytes,
        output: output.replace(
          /(?:sk-[A-Za-z0-9_-]{10,}|Bearer\s+[^\s]+|(?:api[_-]?key|password|token|secret)\s*[:=]\s*[^\s]+|-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----)/gi,
          "[REDACTED]",
        ),
        truncated,
      });
    });
  });
};
