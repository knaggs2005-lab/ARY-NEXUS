const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  systemPreferences,
  powerMonitor,
} = require("electron");
const path = require("node:path");
const { createServerManager } = require("./server-manager.cjs");
const {
  ORIGIN,
  isAryUrl,
  isExternalWebUrl,
  allowPermission,
  requestMediaAccess,
  desktopSessionHeaders,
} = require("./security.cjs");

function start({ projectRoot, nodeExecutable }) {
  app.setName("Ary Nexus");
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  let window,
    server,
    quitting = false,
    loading = false;
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  async function connect() {
    if (loading) return;
    loading = true;
    try {
      await window.loadFile(path.join(__dirname, "loading.html"));
      const result = await server.ensure();
      if (!window.isDestroyed()) await window.loadURL(result.origin);
    } catch (error) {
      if (!quitting) {
        const { response } = await dialog.showMessageBox(window, {
          type: "error",
          title: "Ary needs a moment",
          message: "Could not open Ary Nexus",
          detail: String(error.message),
          buttons: ["Retry", "Open project folder", "Quit"],
          defaultId: 0,
          cancelId: 2,
        });
        loading = false;
        if (response === 0) {
          await server.stop();
          server = makeServer();
          return connect();
        }
        if (response === 1) {
          await shell.openPath(projectRoot);
          return;
        }
        app.quit();
      }
    } finally {
      loading = false;
    }
  }
  const makeServer = () =>
    createServerManager({
      projectRoot,
      nodeExecutable,
      logPath: path.join(app.getPath("userData"), "logs", "server.log"),
    });
  app
    .whenReady()
    .then(async () => {
      server = makeServer();
      window = new BrowserWindow({
        width: 1320,
        height: 900,
        minWidth: 800,
        minHeight: 620,
        title: "Ary Nexus — Live",
        backgroundColor: "#0b100f",
        show: false,
        webPreferences: {
          backgroundThrottling: false, // Explicit voice sessions must receive AudioWorklet frames while hidden.
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          partition: "persist:ary-nexus",
        },
      });
      window.once("ready-to-show", () => window.show());
      window.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        window.setTitle(
          title === "Ary Nexus — Microphone active"
            ? title
            : "Ary Nexus — Live",
        );
      });
      const openWeb = (url) => {
        if (isExternalWebUrl(url)) void shell.openExternal(url);
      };
      window.webContents.setWindowOpenHandler(({ url }) => {
        openWeb(url);
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        if (!isAryUrl(url)) {
          event.preventDefault();
          openWeb(url);
        }
      });
      window.webContents.on("will-redirect", (event, url) => {
        if (!isAryUrl(url)) event.preventDefault();
      });
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      const session = window.webContents.session;
      session.webRequest.onBeforeSendHeaders((details, callback) => {
        callback({
          requestHeaders: desktopSessionHeaders(
            details,
            window.webContents.id,
            server?.bridgeSession?.(),
          ),
        });
      });
      // Always let macOS present its source picker. No automatic/default screen fallback.
      session.setDisplayMediaRequestHandler(
        (_request, callback) => callback({}),
        { useSystemPicker: true },
      );
      session.setPermissionCheckHandler(
        (contents, permission, origin, details) =>
          contents === window.webContents &&
          isAryUrl(contents.getURL()) &&
          allowPermission(permission, origin, details),
      );
      session.setPermissionRequestHandler(
        (contents, permission, callback, details) => {
          const allowed =
            contents === window.webContents &&
            isAryUrl(contents.getURL()) &&
            allowPermission(permission, details.requestingUrl, details);
          if (!allowed) {
            callback(false);
            return;
          }
          if (permission === "display-capture") {
            callback(true);
            return;
          }
          if (process.platform === "darwin")
            void requestMediaAccess(details, (type) =>
              systemPreferences.askForMediaAccess(type),
            )
              .then(callback)
              .catch(() => callback(false));
          else callback(true);
        },
      );
      const suspendVoice = () => {
        if (!window.isDestroyed() && isAryUrl(window.webContents.getURL()))
          void window.webContents
            .executeJavaScript(
              'window.dispatchEvent(new Event("ary:voice-suspend"))',
            )
            .catch(() => {});
      };
      powerMonitor.on("lock-screen", suspendVoice);
      powerMonitor.on("suspend", suspendVoice);
      window.on("closed", () => {
        powerMonitor.removeListener("lock-screen", suspendVoice);
        powerMonitor.removeListener("suspend", suspendVoice);
      });
      window.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          window.hide();
        }
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Ary Nexus",
            submenu: [
              { role: "about" },
              { label: "Live updates from this Mac", enabled: false },
              { label: "Stop voice session", click: suspendVoice },
              { type: "separator" },
              {
                label: "Restart Ary Nexus",
                click: () => {
                  app.relaunch();
                  app.quit();
                },
              },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          {
            label: "View",
            submenu: [
              { role: "reload" },
              { role: "forceReload" },
              { type: "separator" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
            ],
          },
          { role: "windowMenu" },
          {
            label: "Help",
            submenu: [
              { label: "Retry connection", click: () => void connect() },
              { label: "Open in browser", click: () => openWeb(ORIGIN) },
              {
                label: "Show project folder",
                click: () => void shell.openPath(projectRoot),
              },
              {
                label: "Show local server log",
                click: () =>
                  shell.showItemInFolder(
                    path.join(app.getPath("userData"), "logs", "server.log"),
                  ),
              },
              {
                label: "Developer tools",
                click: () => window.webContents.toggleDevTools(),
              },
            ],
          },
        ]),
      );
      await connect();
    })
    .catch((error) => {
      dialog.showErrorBox("Ary Nexus could not start", String(error.message));
      app.quit();
    });
  app.on("activate", () => {
    if (window) {
      window.show();
      window.focus();
    }
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    Promise.resolve(server?.stop()).finally(() => app.quit());
  });
}
module.exports = { start };
