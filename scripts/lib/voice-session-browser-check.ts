import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
/** Controlled synthetic audio and speech-provider fixtures. Brain/action/storage HTTP are real. */
export async function voiceSessionBrowserCheck({
  run,
  evaluate,
  wait,
  click,
  dir,
}: {
  run: (...args: string[]) => string;
  evaluate: (code: string) => any;
  wait: (code: string) => any;
  click: (name: string) => void;
  dir: string;
}) {
  click("Ambient");
  wait(`document.querySelector('[aria-label="Ambient conversation"]')`);
  assert.ok(
    evaluate(
      `!document.body.innerText.includes('Microphone active · Ary conversation')`,
    ),
  );
  evaluate(`(() => {
    const context = new AudioContext(); const destination = context.createMediaStreamDestination();
    const oscillator = context.createOscillator(); const gain = context.createGain();
    gain.gain.value = 0; oscillator.frequency.value = 220; oscillator.connect(gain); gain.connect(destination); oscillator.start();
    window.__voiceFixture = {context,gain,destination,requests:[],queue:[],tracks:[],started:0};
    navigator.mediaDevices.getUserMedia = async () => { await context.resume(); const stream=destination.stream.clone(); window.__voiceFixture.tracks.push(...stream.getTracks()); return stream; };
    const original = window.fetch.bind(window);
    window.fetch = async (resource, options={}) => {
      const path=String(resource); const f=window.__voiceFixture;
      if(path.endsWith('/voice/transcribe')) {
        const text=f.queue.shift() || ''; f.requests.push({kind:'stt',size:options.body.size,at:performance.now()});
        return new Response(JSON.stringify({type:'delta',text:text.slice(0,10)})+'\\n'+JSON.stringify({type:'complete',text})+'\\n',{headers:{'Content-Type':'application/x-ndjson'}});
      }
      if(path.endsWith('/voice/speak')) {
        f.requests.push({kind:'tts',at:performance.now()});
        const bytes=new ArrayBuffer(44+16000*12),v=new DataView(bytes);
        const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
        str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,bytes.byteLength-44,true);
        return new Response(bytes,{headers:{'Content-Type':'audio/wav'}});
      }
      return original(resource,options);
    }; return true;
  })()`);
  click("Start conversation");
  wait(`document.body.innerText.includes('Your microphone is active')`);
  const say = (text: string) =>
    evaluate(
      `new Promise(resolve=>{const f=window.__voiceFixture;f.queue.push(${JSON.stringify(text)});f.started=performance.now();f.gain.gain.value=.18;setTimeout(()=>{f.gain.gain.value=0;resolve(true)},650)})`,
    );
  say("Remember: The acceptance project's launch color is amber.");
  wait(
    `document.querySelector('[aria-label="Latest voice conversation"]').textContent.includes('launch color')`,
  );
  wait(
    `document.body.innerText.includes('Conversation saved') || document.body.innerText.includes('new memory saved')`,
  );
  const read = async () =>
    JSON.parse(await readFile(join(dir, ".data/demo.json"), "utf8"));
  let saved = await read();
  assert.ok(
    saved.messages.some(
      (m: any) =>
        m.metadata.modality === "voice" && m.content.includes("launch color"),
    ),
  );
  assert.ok(
    saved.memories.some((m: any) => m.content.includes("launch color")),
  );
  const conversationId = saved.messages.find(
    (m: any) => m.metadata.modality === "voice",
  ).conversation_id;
  wait(
    `Array.from(document.querySelectorAll('[data-ary-presence]')).some(e=>e.dataset.aryPresence==='speaking')`,
  );
  evaluate(
    `window.__voiceFixture.beforeBarge=performance.now();window.__voiceFixture.barged=null;window.__voiceFixture.observer=new MutationObserver(()=>{if(Array.from(document.querySelectorAll('[data-ary-presence]')).some(e=>e.dataset.aryPresence==='listening'))window.__voiceFixture.barged??=performance.now()});window.__voiceFixture.observer.observe(document.body,{attributes:true,subtree:true,attributeFilter:['data-ary-presence']});true`,
  );
  say(
    "Create a high priority task to verify continuous voice for Wag Trails tomorrow.",
  );
  wait(
    `document.querySelector('[aria-label="Latest voice conversation"]').textContent.includes('No task has been created')`,
  );
  assert.ok(evaluate(`window.__voiceFixture.barged!==null`));
  console.log(
    "Synthetic interruption onset ms:",
    evaluate(
      `Math.round(window.__voiceFixture.barged-window.__voiceFixture.started)`,
    ),
  );
  saved = await read();
  const proposed = saved.actions.find(
    (a: any) =>
      a.tool_name === "create_task" && a.status === "approval_required",
  );
  assert.ok(proposed);
  assert.ok(
    !saved.tasks.some((t: any) => t.title.includes("verify continuous voice")),
  );
  wait(`document.body.innerText.includes("Conversation saved")`);
  click("Conversation & evidence");
  wait(
    `document.querySelector('[data-nexus-shell]').dataset.mode === 'systems'`,
  );
  // Existing TaskProposal reviews the exact action then submits its original execution key.
  evaluate(
    `Array.from(document.querySelectorAll('[aria-label="Real task approval"] button')).find(b=>b.textContent==='Approve and create task').click();true`,
  );
  wait(`document.body.innerText.includes('Task saved')`);
  saved = await read();
  const task = saved.tasks.find((t: any) =>
    t.title.includes("verify continuous voice"),
  );
  assert.ok(task);
  assert.ok(
    saved.actions.some(
      (a: any) => a.id === task.metadata.action_id && a.status === "succeeded",
    ),
  );
  assert.ok(
    saved.outcomes.some((o: any) => o.action_id === task.metadata.action_id),
  );
  click("Ambient");
  say("What task did you just create?");
  wait(
    `document.querySelector('[aria-label="Latest voice conversation"]').textContent.includes(${JSON.stringify(task.id)})`,
  );
  saved = await read();
  assert.ok(
    saved.messages
      .filter((m: any) => m.metadata.modality === "voice")
      .every((m: any) => m.conversation_id === conversationId),
  );
  say("Create a mission to validate the Wag Trails release.");
  wait(
    `document.querySelector('[aria-label="Latest voice conversation"]').textContent.includes('draft mission')`,
  );
  wait(`document.body.innerText.includes('Conversation saved')`);
  saved = await read();
  const mission = saved.messages.find(
    (m: any) => typeof m.metadata.mission_id === "string",
  );
  assert.ok(mission);
  assert.ok(
    saved.actions.some(
      (a: any) =>
        a.tool_name === "mission.create" &&
        a.status === "succeeded" &&
        a.metadata.source_message_id,
    ),
  );
  // Session stays available across navigation; no second mic or conversation.
  click("Systems");
  click("TOOLS");
  assert.ok(evaluate(`document.body.innerText.includes('Microphone active')`));
  click("Ambient");
  run(
    "screenshot",
    process.env.ARY_PRESENCE_REDUCED
      ? "/tmp/ary-voice-ambient-reduced.png"
      : "/tmp/ary-voice-ambient.png",
  );
  click("End conversation");
  wait(
    `!document.body.innerText.includes('Microphone active · Ary conversation')`,
  );
  assert.ok(
    evaluate(`window.__voiceFixture.tracks.every(t=>t.readyState==='ended')`),
  );
  assert.ok(evaluate(`window.__voiceFixture.requests.some(r=>r.kind==='tts')`));
  click("Start conversation");
  wait(`document.body.innerText.includes('Your microphone is active')`);
  // Exercise browser lifecycle events with opt-in off, then on. No physical lock is simulated as verified.
  evaluate(
    `Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));true`,
  );
  wait(
    `!document.body.innerText.includes('Microphone active · Ary conversation')`,
  );
  assert.ok(
    evaluate(`window.__voiceFixture.tracks.every(t=>t.readyState==='ended')`),
  );
  evaluate(
    `delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));document.querySelector('[aria-label="Ambient conversation"] input[type="checkbox"]').click();true`,
  );
  click("Start conversation");
  wait(`document.body.innerText.includes('Your microphone is active')`);
  evaluate(
    `Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));true`,
  );
  assert.ok(
    evaluate(`window.__voiceFixture.tracks.some(t=>t.readyState==='live')`),
  );
  evaluate(
    `delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));true`,
  );
  evaluate(`window.dispatchEvent(new Event('ary:voice-suspend'));true`);
  wait(
    `!document.body.innerText.includes('Microphone active · Ary conversation')`,
  );
  assert.ok(
    evaluate(`window.__voiceFixture.tracks.every(t=>t.readyState==='ended')`),
  );
  run("set", "viewport", "900", "1000");
  assert.ok(evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));
  evaluate(
    `window.__voiceFixture.destination.stream.getTracks().forEach(t=>t.stop());window.__voiceFixture.context.close();true`,
  );
  console.log(
    "Voice session acceptance: real AudioWorklet/VAD, fixture STT/TTS, real Brain memory, approved task/outcome, task recall, same conversation, navigation, microphone teardown and suspend.",
  );
}
