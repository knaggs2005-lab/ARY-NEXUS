import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
if (process.platform !== "darwin")
  throw Error("The AX control helper requires macOS");
mkdirSync(".native", { recursive: true });
execFileSync(
  "/usr/bin/xcrun",
  [
    "swiftc",
    "-parse-as-library",
    "-O",
    "native/ary-control.swift",
    "-o",
    ".native/ary-control",
    "-framework",
    "AppKit",
    "-framework",
    "ApplicationServices",
    "-framework",
    "ScreenCaptureKit",
  ],
  { stdio: "inherit" },
);
console.log(
  "Built .native/ary-control. Accessibility and Screen Recording remain explicit macOS permissions.",
);
