import type { GmailProvider, MailIntelligence } from "../domain/gmail";
import { gmailAnalysis, gmailEvidenceInput } from "../domain/gmail";
import type { Repository } from "../domain/repository";
import type { MemoryService } from "./memory-service";
import { ActionService } from "./action-service";
import { EntityService } from "./entity-service";
import { AppError, required } from "../domain/validation";
import { createHash } from "node:crypto";
import {
  EncryptedCalendarVault,
  type CalendarVault,
} from "../infrastructure/calendar/vault";
import type { z } from "zod";
export class GmailService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private provider: GmailProvider,
    private intelligence?: MailIntelligence,
    private memories?: Pick<
      MemoryService,
      "createMemory" | "linkMemoryToEntity"
    >,
    private vault: CalendarVault = new EncryptedCalendarVault(),
  ) {}
  search(input: { query: string; page?: string }) {
    return this.provider.search(input);
  }
  async read(input: { connection_id: string; thread_id: string }) {
    const thread = await this.provider.thread(input);
    return this.actions.run("entity.read", null, async () => {
      const resolved = await new EntityService(this.repo).resolveMentions(
        thread.messages
          .map((m) => [m.from, m.to, m.subject, m.text].join("\n"))
          .join("\n")
          .slice(0, 50000),
      );
      return {
        ...thread,
        entities: resolved.entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.entity_type,
        })),
        resolution: resolved.resolutions,
      };
    });
  }
  private readAllowed(input: { connection_id: string; thread_id: string }) {
    return this.actions.run("gmail.read", null, () => this.read(input), input);
  }
  async summarize(input: { connection_id: string; thread_id: string }) {
    const thread = await this.readAllowed(input);
    if (!this.intelligence)
      throw new AppError("Mail intelligence is not configured", 503);
    const result = gmailAnalysis.parse(
      await this.intelligence.summarize(thread),
    );
    const candidates = result.candidates.filter(
      (c) =>
        c.importance >= 0.7 &&
        c.confidence >= 0.65 &&
        thread.messages.some(
          (m) =>
            m.id === c.message_id &&
            m.body_available &&
            !m.truncated &&
            m.text.includes(c.quote),
        ),
    );
    return {
      summary: result.summary,
      candidates,
      thread,
      discarded_candidates: result.candidates.length - candidates.length,
      memory_written: false,
    };
  }
  async draft(input: {
    connection_id: string;
    thread_id: string;
    instruction: string;
  }) {
    const thread = await this.readAllowed(input);
    if (!this.intelligence)
      throw new AppError("Mail intelligence is not configured", 503);
    return {
      ...(await this.intelligence.draft(thread, input.instruction)),
      source_thread_id: thread.id,
      connection_id: thread.connection_id,
      from_account: thread.account,
      related_entity_ids: thread.entities.map((e) => e.id),
      state: "draft",
      sent: false,
    };
  }
  send(input: Parameters<GmailProvider["send"]>[0]) {
    return this.provider.send(input);
  }
  async evidence(raw: z.infer<typeof gmailEvidenceInput>) {
    const input = gmailEvidenceInput.parse(raw);
    const action = required(
      await this.repo.get("actions", input.analysis_action_id),
      "Email analysis",
    );
    if (action.status !== "succeeded" || action.tool_name !== "gmail.summarize")
      throw new AppError("Use a completed Gmail summary as evidence");
    // Recheck access even when the source is a previously captured action receipt.
    await this.actions.run(
      "gmail.read",
      null,
      async () => ({
        analysis_action_id: action.id,
        source: "captured_email_evidence",
      }),
      { analysis_action_id: action.id },
    );
    const result = action.output.result as Awaited<
      ReturnType<GmailService["summarize"]>
    >;
    const candidate = result?.candidates?.[input.candidate_index];
    const source = result?.thread?.messages?.find(
      (m) => m.id === candidate?.message_id,
    );
    if (
      !candidate ||
      !source ||
      candidate.quote !== input.quote ||
      !source.text.includes(candidate.quote)
    )
      throw new AppError(
        "The selected evidence does not match the captured email",
        409,
      );
    if (!this.memories)
      throw new AppError("Memory service is unavailable", 503);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([result.thread.account, source.id, candidate.quote]),
      )
      .digest("hex");
    return this.actions.run(
      "memory.create",
      null,
      () =>
        this.vault.lock(
          `gmail:evidence:${this.repo.userId}:${fingerprint}`,
          async () => {
            const previous = (await this.repo.list("memories")).find(
              (m) => m.metadata.gmail_evidence_hash === fingerprint,
            );
            const reference = `gmail://${encodeURIComponent(result.thread.account)}/messages/${source.id}`;
            const memory =
              previous ||
              (await this.memories!.createMemory({
                memory_type: "episodic",
                content: `Reviewed email ${candidate.kind} reported by ${source.from.slice(0, 500)} on ${source.date}. Source: ${reference}\nExact source quote: ${candidate.quote}`,
                summary: `Email evidence: ${source.subject.slice(0, 200)}`,
                importance_score: candidate.importance,
                confidence_score: candidate.confidence,
                metadata: {
                  origin: "manual",
                  gmail_evidence_hash: fingerprint,
                  gmail_source: {
                    reference,
                    account: result.thread.account,
                    message_id: source.id,
                    thread_id: source.thread_id,
                    from: source.from,
                    date: source.date,
                    quote: candidate.quote,
                    kind: candidate.kind,
                    analysis_action_id: action.id,
                  },
                  reviewed_by: this.repo.userId,
                  attribution: "Email statement; not independently verified",
                },
              }));
            // Use existing link permission and service; retry can repair a failed link without duplicating memory.
            for (const entity of result.thread.entities)
              await this.actions.run(
                "memory.link",
                null,
                () => this.memories!.linkMemoryToEntity(memory.id, entity.id),
                { memory_id: memory.id, entity_id: entity.id },
                { productIds: [entity.id] },
              );
            return { memory_id: memory.id, reference, recovered: !!previous };
          },
        ),
      { analysis_action_id: action.id, quote: candidate.quote },
    );
  }
}
