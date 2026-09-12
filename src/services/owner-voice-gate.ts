import {
  speakerTemplate,
  type SpeakerVerificationProvider,
  type SpeakerTemplateStore,
  type OwnerVoiceDecision,
} from "../domain/owner-voice";
/** Convenience gate only. Never returns a Nexus permission or approval. */
export class OwnerVoiceGate {
  constructor(
    private readonly enabled: boolean,
    private readonly provider: SpeakerVerificationProvider,
    private readonly store: SpeakerTemplateStore,
    private readonly threshold = 0.85,
  ) {
    if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1)
      throw new Error("INVALID_SPEAKER_THRESHOLD");
  }
  private decision(
    allow: boolean,
    reason: string,
    confidence: number | null = null,
  ): OwnerVoiceDecision {
    return {
      decision: allow ? "ALLOW" : "REJECT",
      reason,
      confidence,
      authorizes_actions: false,
      replay_resistant: false,
    };
  }
  private async embed(samples: Float32Array) {
    if (!this.provider.localOnly || !this.provider.available())
      throw new Error("SPEAKER_MODEL_SETUP_REQUIRED");
    if (
      samples.length < 16000 ||
      samples.length > 160000 ||
      !samples.every(Number.isFinite)
    )
      throw new Error("INVALID_ENROLLMENT_SAMPLE");
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        this.provider.embed(samples, 16000),
        new Promise<Float32Array>((_, reject) => {
          timer = setTimeout(() => reject(new Error("SPEAKER_TIMEOUT")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
      samples.fill(0);
    }
  }
  async enroll(
    samples: Float32Array,
    consent: { explicit: boolean; owner_present: boolean },
  ) {
    if (!consent.explicit || !consent.owner_present)
      throw new Error("OWNER_PRESENCE_AND_CONSENT_REQUIRED");
    const vector = await this.embed(samples);
    try {
      const template = speakerTemplate.parse({
        version: 1,
        model_id: this.provider.id,
        model_version: this.provider.version,
        model_hash: this.provider.modelHash,
        created_at: new Date().toISOString(),
        vector: Array.from(vector),
      });
      if (!template.vector.some((v) => v !== 0))
        throw new Error("INVALID_SPEAKER_TEMPLATE");
      await this.store.write(template);
    } finally {
      vector.fill(0);
    }
  }
  async verify(samples: Float32Array): Promise<OwnerVoiceDecision> {
    if (!this.enabled) {
      samples.fill(0);
      return this.decision(true, "DISABLED");
    }
    let vector: Float32Array | undefined;
    try {
      const saved = await this.store.read();
      if (!saved)
        return this.decision(false, "OWNER_VOICE_ENROLLMENT_REQUIRED");
      const t = speakerTemplate.parse(saved);
      if (
        t.model_id !== this.provider.id ||
        t.model_version !== this.provider.version ||
        t.model_hash !== this.provider.modelHash
      )
        return this.decision(false, "SPEAKER_MODEL_MISMATCH");
      vector = await this.embed(samples);
      if (vector.length !== t.vector.length || !vector.every(Number.isFinite))
        return this.decision(false, "INVALID_SPEAKER_VECTOR");
      let dot = 0,
        a = 0,
        b = 0;
      for (let i = 0; i < vector.length; i++) {
        dot += vector[i] * t.vector[i];
        a += vector[i] ** 2;
        b += t.vector[i] ** 2;
      }
      if (!a || !b) return this.decision(false, "INVALID_SPEAKER_VECTOR");
      const score = Math.max(-1, Math.min(1, dot / Math.sqrt(a * b)));
      return this.decision(
        score >= this.threshold,
        score >= this.threshold ? "OWNER_MATCH" : "LOW_CONFIDENCE",
        score,
      );
    } catch {
      return this.decision(false, "OWNER_VERIFICATION_UNAVAILABLE");
    } finally {
      samples.fill(0);
      vector?.fill(0);
    }
  }
  deleteEnrollment() {
    return this.store.delete();
  }
}
