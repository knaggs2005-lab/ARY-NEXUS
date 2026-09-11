const ppro = require("premierepro"),
  uxp = require("uxp");
const { createEngine } = require("./engine.js");
const fs = uxp.storage.localFileSystem;
const entry = (path) => fs.getEntryWithUrl("file:" + path);
const engine = createEngine(ppro, {
  async existing(path, suffix) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      /[\x00-\x1f]/.test(path) ||
      (suffix && !path.toLowerCase().endsWith(suffix))
    )
      throw Error("Invalid file path.");
    const file = await entry(path);
    if (!file.isFile) throw Error("Expected an existing file.");
  },
  async newOutput(path) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      /[\x00-\x1f]/.test(path)
    )
      throw Error("Invalid output path.");
    const split = path.lastIndexOf("/");
    const parent = await entry(path.slice(0, split) || "/");
    if (!parent.isFolder) throw Error("Export parent is not a folder.");
    const entries = await parent.getEntries();
    if (entries.some((file) => file.name === path.slice(split + 1)))
      throw Error("Output exists; overwriting is not supported.");
  },
});
let enabled = false,
  token = "",
  timer = null,
  pendingReceipt = null;
const status = (message) => {
  document.getElementById("status").textContent = message;
};
async function request(path, input) {
  const r = await fetch("http://127.0.0.1:3000/api/premiere/bridge/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw Error("Ary bridge HTTP " + r.status);
  return r.json();
}
async function tick() {
  if (!enabled) return;
  try {
    if (pendingReceipt) {
      await request("result", pendingReceipt);
      pendingReceipt = null;
    }
    const state = await engine.scan();
    const job = await request("poll", { state });
    status(
      "Connected · " +
        (state.project_name || "No active project") +
        "\nRevision " +
        state.revision,
    );
    if (job) {
      status(
        "Approved action: " + job.verb + "\n" + JSON.stringify(job.input.args),
      );
      // The server claims once before delivery. A plugin crash can never redeliver an edit.
      pendingReceipt = {
        operation_id: job.operation_id,
        receipt: await engine.execute(job),
      };
      await request("result", pendingReceipt);
      status(
        pendingReceipt.receipt.ok
          ? "Action recorded. Review exact result in Ary."
          : pendingReceipt.receipt.error,
      );
      pendingReceipt = null;
    }
  } catch (e) {
    status(
      String(e.message || e) +
        "\nNo automatic editing retry. Receipt delivery will retry while connected.",
    );
  }
  if (enabled) timer = setTimeout(tick, 2000);
}
document.getElementById("connect").addEventListener("click", () => {
  if (enabled) return;
  token = document.getElementById("token").value.trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    status("Enter the locally configured 64-character bridge token.");
    return;
  }
  document.getElementById("token").value = "";
  enabled = true;
  tick();
});
document.getElementById("disconnect").addEventListener("click", () => {
  enabled = false;
  clearTimeout(timer);
  status(
    "Disconnected. An already executing operation may finish; inspect its receipt before retrying.",
  );
});
