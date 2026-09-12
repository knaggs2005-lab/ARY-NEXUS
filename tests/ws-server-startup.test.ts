import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
describe("Node server startup disables optional ws bufferutil before evaluation", () => {
  it.each(["dev", "start", "build"])(
    "npm run %s applies the flag before the server entry loads ws",
    (command) => {
      const directory = mkdtempSync(join(tmpdir(), "ary-ws-startup-"));
      try {
        const bin = join(directory, "node_modules", ".bin");
        mkdirSync(bin, { recursive: true });
        writeFileSync(
          join(directory, "package.json"),
          JSON.stringify({ scripts: { [command]: manifest.scripts[command] } }),
        );
        // Execute the real npm command against an instrumented Next entrypoint.
        // Poison the optional addon: any evaluation before the flag will fail masking.
        writeFileSync(
          join(bin, "next"),
          `#!/usr/bin/env node
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;
let addonLoads = 0;
Module._load = function(name, ...args) {
  if (name === 'bufferutil') { addonLoads++; return {}; }
  return original.call(this, name, ...args);
};
assert.equal(process.env.WS_NO_BUFFER_UTIL, '1');
const util = require(${JSON.stringify(join(dirname(require.resolve("ws")), "lib/buffer-util.js"))});
const output = Buffer.alloc(960);
util.mask(Buffer.alloc(960, 7), Buffer.from([1,2,3,4]), output, 0, 960);
assert.equal(output[0], 6);
assert.equal(addonLoads, 0);
console.log('WS_FLAG_BEFORE_IMPORT: PASS');
`,
          { mode: 0o755 },
        );
        const result = execFileSync("npm", ["run", command, "--silent"], {
          cwd: directory,
          encoding: "utf8",
          timeout: 10000,
          env: { ...process.env, WS_NO_BUFFER_UTIL: "", NODE_OPTIONS: "" },
        });
        expect(result.trim()).toBe("WS_FLAG_BEFORE_IMPORT: PASS");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
