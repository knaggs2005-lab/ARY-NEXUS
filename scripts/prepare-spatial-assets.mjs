// Install-time assets only. Runtime inference and all camera frames stay local.
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const destination = new URL("public/spatial/", root);
await mkdir(destination, { recursive: true });
await cp(
  new URL("node_modules/@mediapipe/tasks-vision/wasm/", root),
  new URL("wasm/", destination),
  { recursive: true },
);
const model = new URL("hand_landmarker.task", destination);
const source =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
try {
  await stat(model);
} catch {
  const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000000) throw new Error("Incomplete hand model");
  await writeFile(model, bytes);
}
const packageInfo = JSON.parse(
  await readFile(
    new URL("node_modules/@mediapipe/tasks-vision/package.json", root),
    "utf8",
  ),
);
const hash = createHash("sha256")
  .update(await readFile(model))
  .digest("hex");
if (hash !== "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1")
  throw new Error("Hand model checksum mismatch");
await writeFile(
  new URL("manifest.json", destination),
  JSON.stringify(
    {
      package: "@mediapipe/tasks-vision",
      version: packageInfo.version,
      model: source,
      sha256: hash,
      processing: "on-device only",
    },
    null,
    2,
  ),
);
console.log(
  `Local MediaPipe ${packageInfo.version} assets ready; model SHA-256 ${hash}`,
);
