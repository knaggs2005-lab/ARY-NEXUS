/** Bounded transport probe only. No physical microphone or audible playback acceptance. */
import { loadEnvConfig } from "@next/env";
import { chromium } from "playwright";
import { OpenAILiveProvider } from "../src/infrastructure/providers/openai-live";
async function main() {
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let control: Awaited<ReturnType<OpenAILiveProvider["attach"]>> | undefined;
  try {
    const page = await browser.newPage();
    const sdp = await page.evaluate(async () => {
      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      const state = { peer, channel, events: [] as string[] };
      (window as any).liveProbe = state;
      peer.addTransceiver("audio", { direction: "sendrecv" });
      channel.onmessage = ({ data }) => {
        const event = JSON.parse(data);
        state.events.push(event.type);
        if (event.type === "session.started")
          channel.send(JSON.stringify({ type: "session.close" }));
      };
      await peer.setLocalDescription(await peer.createOffer());
      return peer.localDescription!.sdp;
    });
    const provider = new OpenAILiveProvider(process.env.OPENAI_API_KEY ?? "");
    const begin = performance.now();
    const result = await provider.create(sdp, AbortSignal.timeout(15000));
    console.log("LIVE_CREATE: PASS");
    control = await provider.attach(
      result.id,
      () => {},
      () => {},
    );
    console.log("SIDEBAND: OPEN");
    await page.evaluate(
      (s) =>
        (window as any).liveProbe.peer.setRemoteDescription({
          type: "answer",
          sdp: s,
        }),
      result.sdp,
    );
    await page.waitForFunction(
      () => (window as any).liveProbe.events.includes("session.closed"),
      null,
      { timeout: 15000 },
    );
    console.log(
      "LIFECYCLE",
      await page.evaluate(() => (window as any).liveProbe.events),
    );
    console.log(
      "HANDSHAKE_AND_CLOSE_MS",
      Math.round(performance.now() - begin),
    );
    console.log("PHYSICAL_MIC: NOT_RUN");
  } catch (error) {
    console.log(
      "LIVE_PROBE: FAIL",
      error instanceof Error && /^LIVE_[A-Z_0-9]+$/.test(error.message)
        ? error.message
        : "TRANSPORT_OR_BROWSER_FAILURE",
    );
    process.exitCode = 1;
  } finally {
    try {
      control?.send({ type: "session.close" });
    } catch {}
    control?.close();
    await browser.close();
  }
}
void main();
