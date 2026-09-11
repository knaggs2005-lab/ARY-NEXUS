/** Isolated UI smoke test with synthetic camera. No credentials or business writes. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const cli = resolve("node_modules/.bin/agent-browser");
const session = `ary-spatial-${process.pid}`;
const run = (...args) =>
  execFileSync(cli, ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 40000,
  });
const evaluate = (code) => {
  const raw = run("eval", code).trim();
  return JSON.parse(raw);
};
const results = [];
const assert = (name, value) => {
  if (!value) throw new Error(name);
  results.push({ name, passed: true });
};
const button = (name) =>
  `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(name)})`;
const waitFor = (expression) =>
  evaluate(
    `new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${expression})resolve(true);else if(Date.now()-start>25000)reject(new Error('Timed out'));else setTimeout(tick,100)};tick()})`,
  );
try {
  run(
    "--args",
    "--use-fake-device-for-media-stream,--use-fake-ui-for-media-stream",
    "open",
    process.env.SPATIAL_TEST_URL || "http://127.0.0.1:3000/",
  );
  run("set", "viewport", "1440", "1000");
  waitFor(`document.querySelector('[data-nexus-shell]')`);
  run("find", "role", "button", "click", "--name", "System", "--exact");
  run(
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Open spatial navigation",
    "--exact",
  );
  waitFor(`document.querySelector('button[data-module="home"]')`);
  assert(
    "tracking off by default",
    evaluate(`document.body.innerText.includes('Tracking: off')`),
  );
  evaluate(`document.querySelector('summary').click(); true`);
  // Observe actual resource lifetimes without replacing inference or media behavior.
  evaluate(`window.__spatial={tracks:[],workers:0,terminated:0,frames:0,latencies:[]};
    const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await media(...args);window.__spatial.tracks.push(...stream.getTracks());return stream};
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {constructor(...args){super(...args);window.__spatial.workers++;this.addEventListener('message',e=>{if(e.data.type==='result'){window.__spatial.frames++;window.__spatial.latencies.push(e.data.latency)}})}terminate(){window.__spatial.terminated++;super.terminate()}}; true`);
  run("find", "role", "button", "click", "--name", "Enable hand tracking");
  waitFor(`window.__spatial.frames>=5`);
  const tracking = evaluate(
    `({frames:window.__spatial.frames,meanInferenceMs:Math.round(window.__spatial.latencies.reduce((a,b)=>a+b,0)/window.__spatial.latencies.length),workers:window.__spatial.workers})`,
  );
  assert(
    "real local model processes synthetic-camera frames",
    tracking.frames >= 5,
  );
  run("find", "role", "button", "click", "--name", "Disable hand tracking");
  assert(
    "camera and worker released",
    evaluate(
      `window.__spatial.tracks.every(t=>t.readyState==='ended')&&window.__spatial.workers===window.__spatial.terminated`,
    ),
  );
  evaluate(`document.querySelector('summary').click(); true`);
  run("find", "role", "button", "click", "--name", "Rotate modules right");
  waitFor(`document.body.innerText.includes('SETTLED · render loop asleep')`);
  assert(
    "mouse rotates to Brain",
    evaluate(
      `document.querySelector('button[data-module="brain"]').getAttribute('aria-pressed')==='true'`,
    ),
  );
  const performance = evaluate(
    `Array.from(document.querySelectorAll('output')).find(o=>o.getAttribute('aria-label')==='Rendering diagnostics').textContent`,
  );
  assert(
    "idle transforms settle",
    evaluate(
      `new Promise(resolve=>{const before=Array.from(document.querySelectorAll('button[data-module]')).map(b=>b.style.transform).join();setTimeout(()=>resolve(before===Array.from(document.querySelectorAll('button[data-module]')).map(b=>b.style.transform).join()),400)})`,
    ),
  );
  // Start alignment and expansion, then interrupt on the next frame.
  evaluate(
    `document.querySelector('button[data-module="projects"]').click();setTimeout(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Open Projects')).click();requestAnimationFrame(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))},30);true`,
  );
  waitFor(
    `document.querySelector('button[data-module="projects"]')?.getAttribute('aria-pressed')==='true'&&document.body.innerText.includes('SETTLED · render loop asleep')`,
  );
  assert(
    "focus interruption leaves workspace closed",
    evaluate(
      `document.querySelector('[aria-label="Existing Ary workspace"]').hidden`,
    ),
  );
  run("set", "media", "reduced-motion");
  waitFor(`document.querySelector('[data-reduced="true"]')`);
  assert("OS reduced-motion preference respected", true);
  evaluate(`document.querySelector('summary').click(); true`);
  run("find", "role", "button", "click", "--name", "2D mode");
  waitFor(`document.querySelector('[data-flat="true"]')`);
  assert(
    "2D exposes every module without transforms",
    evaluate(
      `Array.from(document.querySelectorAll('button[data-module]')).every(b=>!b.inert&&getComputedStyle(b).transform==='none')`,
    ),
  );
  run("find", "role", "button", "click", "--name", "Classic workspace");
  assert(
    "classic workspace available",
    evaluate(
      `!document.querySelector('[aria-label="Existing Ary workspace"]').hidden&&!!document.querySelector('[data-nexus-shell]')`,
    ),
  );
  console.log(
    JSON.stringify(
      { results, performance, tracking, errors: run("errors").trim() },
      null,
      2,
    ),
  );
} finally {
  run("close");
}
