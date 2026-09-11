import { packager } from "@electron/packager";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const stage = join(root, ".desktop-build", "launcher");
const iconset = join(root, ".desktop-build", "Ary.iconset");
const icon = join(root, ".desktop-build", "Ary.icns");
await mkdir(stage, { recursive: true });
await cp(join(root, "desktop/bootstrap.cjs"), join(stage, "bootstrap.cjs"));
const version = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
).version;
await writeFile(
  join(stage, "package.json"),
  JSON.stringify({
    name: "ary-nexus-desktop",
    productName: "Ary Nexus",
    version,
    main: "bootstrap.cjs",
  }),
);
await writeFile(
  join(stage, "project.json"),
  JSON.stringify({ projectRoot: root, nodeExecutable: process.execPath }),
);
execFileSync(
  "swift",
  [
    "-module-cache-path",
    join(root, ".desktop-build/swift-cache"),
    join(root, "desktop/icon.swift"),
    iconset,
  ],
  { stdio: "inherit" },
);
execFileSync("iconutil", ["-c", "icns", iconset, "-o", icon], {
  stdio: "inherit",
});
const results = await packager({
  dir: stage,
  out: join(root, "dist-desktop"),
  name: "Ary Nexus",
  platform: "darwin",
  arch: process.arch,
  electronVersion: require("electron/package.json").version,
  electronDist: join(root, "node_modules/electron/dist"),
  appBundleId: "com.clevaryn.ary-nexus",
  appCategoryType: "public.app-category.productivity",
  appVersion: version,
  buildVersion: version,
  icon,
  asar: true,
  overwrite: true,
  prune: false,
  darwinDarkModeSupport: true,
  extendInfo: {
    NSAppleEventsUsageDescription:
      "Ary controls selected Mac apps only through explicitly enabled, permission-checked and approved Desktop Bridge actions.",
    NSRemindersFullAccessUsageDescription:
      "Ary creates a reminder only after you approve its exact content.",
    NSCameraUsageDescription:
      "Ary uses your camera only when you enable on-device hand tracking. Frames are not uploaded.",
    NSMicrophoneUsageDescription:
      "Ary uses your microphone only when you choose to speak in Chat.",
  },
});
for (const directory of results) {
  const appPath = join(directory, "Ary Nexus.app");
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" },
  );
  console.log(appPath);
}
