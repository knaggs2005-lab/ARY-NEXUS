// Isolated Electron verification: synthetic camera, no user credentials or real recording.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  allowPermission,
  requestMediaAccess,
} = require("../desktop/security.cjs");
const dir = mkdtempSync(join(tmpdir(), "ary-desktop-tracking-"));
app.setPath("userData", dir);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
let window;
const requests = [],
  checks = [],
  osRequests = [];
const deadline = setTimeout(() => {
  console.error("Desktop tracking test timed out");
  app.exit(1);
}, 45000);
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const session = window.webContents.session;
    session.setPermissionCheckHandler(
      (contents, permission, origin, details) => {
        checks.push({ permission, origin, mediaType: details.mediaType });
        return (
          contents === window.webContents &&
          allowPermission(permission, origin, details)
        );
      },
    );
    session.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        requests.push({ permission, mediaTypes: details.mediaTypes });
        if (
          contents !== window.webContents ||
          !allowPermission(permission, details.requestingUrl, details)
        ) {
          callback(false);
          return;
        }
        requestMediaAccess(details, async (type) => {
          osRequests.push(type);
          return true;
        }).then(callback);
      },
    );
    await window.loadURL("http://127.0.0.1:3000/");
    const result = await window.webContents.executeJavaScript(`(async()=>{
 const wait=async(test)=>{const started=Date.now();while(!test()){if(Date.now()-started>25000)throw new Error('Tracking did not become ready: '+document.body.innerText.slice(-2000));await new Promise(r=>setTimeout(r,100));}};
 await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Enable hand tracking'));
 let delegate=null;let frames=0;const latencies=[];const tracks=[];let created=0,terminated=0;
 const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async opts=>{const stream=await media(opts);tracks.push(...stream.getTracks());return stream;};
 const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);created++;this.addEventListener('message',e=>{if(e.data.type==='result'){frames++;delegate=e.data.delegate;latencies.push(e.data.latency);}});}terminate(){terminated++;super.terminate();}};
 [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Enable hand tracking').click();
 await wait(()=>frames>=16);
 const status=document.querySelector('[aria-label="Hand tracking status"]').textContent;
 [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Disable hand tracking').click();
 await wait(()=>tracks.every(t=>t.readyState==='ended')&&created===terminated);
 return {frames,delegate,warmInferenceMs:Math.round(latencies.slice(-8).reduce((a,b)=>a+b,0)/8),meanInferenceMs:Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length),status,created,terminated,tracksEnded:tracks.every(t=>t.readyState==='ended')};
 })()`);
    if (
      !requests.some((r) => r.mediaTypes?.includes("video")) ||
      !osRequests.includes("camera")
    )
      throw new Error(
        "Camera request did not exercise the desktop permission handler",
      );
    console.log(
      JSON.stringify(
        {
          passed: true,
          syntheticCamera: true,
          realMacOSPromptTested: false,
          electron: process.versions.electron,
          result,
          requests,
          osRequests,
        },
        null,
        2,
      ),
    );
    clearTimeout(deadline);
    window.destroy();
    app.quit();
  } catch (error) {
    clearTimeout(deadline);
    console.error(String(error));
    window?.destroy();
    app.exit(1);
  }
});
app.on("will-quit", () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});
