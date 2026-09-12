const http = require("node:http");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { loadEnvConfig } = require("@next/env");
const { ORIGIN } = require("./security.cjs");

function probe(origin = ORIGIN) {
  return new Promise((resolve) => {
    const request = http.get(
      `${origin}/api/desktop/health`,
      { timeout: 1500 },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 4096) {
            request.destroy();
            resolve("other");
          }
        });
        response.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve(
              response.statusCode === 200 &&
                data.application === "ary-nexus" &&
                data.protocol === 1
                ? data.liveUpdates
                  ? "ary"
                  : "production"
                : "other",
            );
          } catch {
            resolve("other");
          }
        });
        response.on("error", () => resolve("other"));
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolve("busy");
    });
    request.on("error", (error) =>
      resolve(error.code === "ECONNREFUSED" ? "absent" : "busy"),
    );
  });
}
function validateProject(projectRoot, nodeExecutable) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  if (manifest.name !== "ary-nexus")
    throw new Error("The configured folder is not Ary Nexus.");
  const next = path.join(projectRoot, "node_modules/next/dist/bin/next");
  fs.accessSync(next);
  fs.accessSync(nodeExecutable, fs.constants.X_OK);
  return next;
}
function loadProjectEnvironment(projectRoot) {
  // The packaged desktop launcher does not inherit the shell that normally
  // starts `next dev`. Load the project's server-only env files here so
  // integrations (Twilio, Supabase, etc.) behave identically in the app.
  // @next/env respects .env.local precedence and never exposes values to the
  // browser unless Next's public-variable rules explicitly allow it.
  // Force a fresh read because the desktop process may inherit stale feature
  // flags from the shell that launched it (for example ARY_CALLS_ENABLED).
  loadEnvConfig(projectRoot, true, { info() {}, error() {} }, true);
}
function createServerManager(
  { projectRoot, nodeExecutable, logPath },
  operations = {},
) {
  const check = operations.probe ?? probe;
  const launch = operations.spawn ?? spawn;
  const signal = operations.kill ?? process.kill;
  const wait = operations.wait ?? delay;
  const bridgeSession = randomBytes(32).toString("hex");
  let child = null,
    startup = null,
    closing = false,
    lastExit = null;
  let log;
  const append = (data) => {
    // Log file is private and bounded; .env files are never read by the launcher.
    try {
      if (!log) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024)
          fs.renameSync(logPath, `${logPath}.previous`);
        log = fs.openSync(logPath, "a", 0o600);
      }
      if (fs.fstatSync(log).size < 1024 * 1024) fs.writeSync(log, data);
    } catch {
      /* Logging must not prevent the app from opening. */
    }
  };
  async function ensure() {
    if (startup) return startup;
    startup = (async () => {
      let state = await check();
      // An existing dev server may be compiling its first request.
      for (let i = 0; state === "busy" && i < 15 && !closing; i++) {
        await wait(500);
        state = await check();
      }
      if (closing) throw new Error("Ary is closing.");
      if (state === "ary") return { origin: ORIGIN, owned: false };
      if (state === "production")
        throw new Error(
          "Ary is running in production mode on port 3000. Live updates need its development server. Close that server, then choose Retry.",
        );
      if (state !== "absent")
        throw new Error(
          "Port 3000 is busy with a different or unresponsive app. Ary has left it untouched. Close that app, then choose Retry.",
        );
      const next = validateProject(projectRoot, nodeExecutable);
      loadProjectEnvironment(projectRoot);
      lastExit = null;
      child = launch(
        nodeExecutable,
        [next, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3000"],
        {
          cwd: projectRoot,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: "development",
            // Set before Next/ws evaluation; avoid incompatible bundled native addon.
            WS_NO_BUFFER_UTIL: "1",
            NEXT_TELEMETRY_DISABLED: "1",
            ARY_DESKTOP_SESSION_TOKEN: bridgeSession,
          },
        },
      );
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error) => {
        lastExit = error.message;
      });
      child.on("exit", (code) => {
        lastExit = `Local server exited (${code ?? "signal"}).`;
      });
      for (let i = 0; i < 90 && !closing; i++) {
        if (lastExit)
          throw new Error(
            `${lastExit} See the local server log from the Help menu.`,
          );
        if ((await check()) === "ary") return { origin: ORIGIN, owned: true };
        await wait(500);
      }
      throw new Error(
        "Ary did not become ready. Check the local server log, then Retry.",
      );
    })();
    try {
      return await startup;
    } finally {
      startup = null;
    }
  }
  async function stop() {
    closing = true;
    if (child?.pid && child.exitCode === null && !lastExit) {
      const owned = child;
      const exited = new Promise((resolve) => owned.once("exit", resolve));
      try {
        signal(-owned.pid, "SIGTERM");
      } catch {
        /* Already stopped. */
      }
      await Promise.race([exited, wait(3000)]);
      if (owned.exitCode === null && owned.signalCode === null) {
        try {
          signal(-owned.pid, "SIGKILL");
        } catch {
          /* Already stopped. */
        }
      }
    }
    child = null;
    if (log) {
      try {
        fs.closeSync(log);
      } catch {}
      log = null;
    }
  }
  return {
    ensure,
    stop,
    bridgeSession: () =>
      child && child.exitCode === null && !lastExit ? bridgeSession : null,
    ownsServer: () => !!child && child.exitCode === null && !lastExit,
  };
}
module.exports = { probe, validateProject, createServerManager };
