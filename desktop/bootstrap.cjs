// The installed shell contains only this launcher and a local project location.
// Code updates are loaded from the project on the next app launch; no secrets are packaged.
const path = require("node:path");
const { app, dialog } = require("electron");
try {
  const config = require("./project.json");
  require(path.join(config.projectRoot, "desktop", "main.cjs")).start(config);
} catch {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      "Ary project folder unavailable",
      "Ary Nexus could not find its project folder. Restore the folder to its original location or rebuild the desktop launcher from the moved project.",
    );
    app.quit();
  });
}
