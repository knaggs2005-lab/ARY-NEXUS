import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(require("electron"), [resolve(root, "desktop/dev.cjs")], {
  stdio: "inherit",
  env: { ...process.env, ARY_DESKTOP_NODE: process.execPath },
});
child.on("exit", (code) => process.exit(code ?? 0));
