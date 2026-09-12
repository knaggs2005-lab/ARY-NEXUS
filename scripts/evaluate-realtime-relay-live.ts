import { loadEnvConfig } from "@next/env";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { services } from "../src/server/context";
import { LocalRepository } from "../src/infrastructure/repositories/local";
import { RealtimeVoiceRelayService } from "../src/services/realtime-voice-relay-service";

async function main() {
  loadEnvConfig(process.cwd());
  const directory = await mkdtemp(join(tmpdir(), "ary-relay-live-"));
  const user = crypto.randomUUID();
  const repository = new LocalRepository(user, join(directory, "fixture.json"));
  let relay: RealtimeVoiceRelayService | undefined;
  let id: string | undefined;
  let providerError: string | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    const conversation = await repository.insert("conversations", {
      title: "Synthetic relay acceptance",
      metadata: {},
    });
    const provider = services(repository).realtimeVoice;
    const create = provider.createSession.bind(provider);
    provider.createSession = async (config) => {
      const session = await create(config);
      unsubscribe = session.onEvent((event) => {
        if (event.type === "failure") providerError = event.failure.message;
      });
      return session;
    };
    relay = new RealtimeVoiceRelayService(provider);
    const started = await relay.start(user, conversation.id);
    id = started.relay_id;
    await relay.append(user, id, new Uint8Array(14400));
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const status = relay.status(user, id);
    if (providerError || !status || status.frames_forwarded !== 15)
      throw new Error(
        providerError ?? "Relay closed or frame counters invalid",
      );
    await relay.stop(user, id);
    console.log(
      "REAL_RELAY: PASS (15 synthetic silence frames, 14400 bytes, closed)",
    );
  } catch (error) {
    const key = process.env.OPENAI_API_KEY ?? "unused-key";
    const message = String(
      error instanceof Error ? error.message : "Provider failure",
    )
      .split(key)
      .join("[redacted]")
      .replace(/Bearer\s+\S+|sk-\S+/gi, "[redacted]")
      .slice(0, 240);
    console.log(`REAL_RELAY: FAIL ${message}`);
    process.exitCode = 1;
  } finally {
    unsubscribe?.();
    if (relay && id) await relay.stop(user, id);
    await rm(directory, { recursive: true, force: true });
  }
}
void main();
