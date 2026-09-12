import { it, expect, vi } from "vitest";
import { OwnerVoiceGate } from "../src/services/owner-voice-gate";
import {
  EncryptedSpeakerTemplateStore,
  type EncryptedSpeakerRecord,
} from "../src/infrastructure/speaker/local-template-store";
function setup() {
  const records = new Map<string, EncryptedSpeakerRecord>(),
    kv = {
      get: async (k: string) => records.get(k),
      put: async (k: string, v: EncryptedSpeakerRecord) => {
        records.set(k, v);
      },
      delete: async (k: string) => {
        records.delete(k);
      },
    },
    owner = crypto.randomUUID();
  const store = new EncryptedSpeakerTemplateStore(owner, kv);
  const provider = {
    id: "fixture",
    version: "1",
    modelHash: "a".repeat(64),
    localOnly: true as const,
    available: () => true,
    embed: vi.fn(async () => new Float32Array(16).fill(1)),
  };
  const gate = new OwnerVoiceGate(true, provider, store);
  return { records, store, provider, gate, owner, kv };
}
const sample = () => new Float32Array(48000).fill(0.1);
it("requires explicit owner-present enrollment and persists only encrypted derived template", async () => {
  const f = setup();
  await expect(
    f.gate.enroll(sample(), { explicit: false, owner_present: false }),
  ).rejects.toThrow();
  const audio = sample();
  await f.gate.enroll(audio, { explicit: true, owner_present: true });
  expect(audio.every((n) => n === 0)).toBe(true);
  const record = f.records.get(f.owner)!;
  expect(record.key.extractable).toBe(false);
  expect(new TextDecoder().decode(record.ciphertext)).not.toContain("vector");
  expect(await f.store.read()).toMatchObject({
    model_id: "fixture",
    version: 1,
  });
});
it("owner match is not action authority or replay resistance", async () => {
  const f = setup();
  await f.gate.enroll(sample(), { explicit: true, owner_present: true });
  expect(await f.gate.verify(sample())).toMatchObject({
    decision: "ALLOW",
    reason: "OWNER_MATCH",
    authorizes_actions: false,
    replay_resistant: false,
  });
});
it("non-owner, low confidence, missing/corrupt enrollment fail closed", async () => {
  const f = setup();
  expect((await f.gate.verify(sample())).reason).toBe(
    "OWNER_VOICE_ENROLLMENT_REQUIRED",
  );
  await f.gate.enroll(sample(), { explicit: true, owner_present: true });
  f.provider.embed.mockResolvedValueOnce(new Float32Array(16).fill(-1));
  expect((await f.gate.verify(sample())).decision).toBe("REJECT");
  const r = f.records.get(f.owner)!;
  new Uint8Array(r.ciphertext)[0] ^= 255;
  expect((await f.gate.verify(sample())).decision).toBe("REJECT");
});
it("delete/re-enroll rotates key, isolates owners, and version drift rejects", async () => {
  const f = setup();
  await f.gate.enroll(sample(), { explicit: true, owner_present: true });
  const key = f.records.get(f.owner)!.key;
  expect(
    await new EncryptedSpeakerTemplateStore(crypto.randomUUID(), f.kv).read(),
  ).toBeNull();
  await f.gate.deleteEnrollment();
  expect(await f.store.read()).toBeNull();
  await f.gate.enroll(sample(), { explicit: true, owner_present: true });
  expect(f.records.get(f.owner)!.key).not.toBe(key);
  f.provider.version = "2";
  expect((await f.gate.verify(sample())).reason).toBe("SPEAKER_MODEL_MISMATCH");
});
it("disabled gate performs no biometric inference", async () => {
  const f = setup();
  const disabled = new OwnerVoiceGate(false, f.provider, f.store);
  expect((await disabled.verify(sample())).reason).toBe("DISABLED");
  expect(f.provider.embed).not.toHaveBeenCalled();
});
