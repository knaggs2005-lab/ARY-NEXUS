import type { Repository } from "../domain/repository";
import type { Json, Message } from "../domain/models";
import type { ExecutionPlan } from "../domain/orchestration";
import { AppError } from "../domain/validation";
import type { OrchestratorService } from "./orchestrator-service";

/** Text and transcribed voice share this narrow intent adapter and the existing action pipeline. */
export class OrchestrationConversationService {
  constructor(
    private repo: Repository,
    private coordinator: OrchestratorService,
  ) {}
  async handle(
    text: string,
    source: Message,
  ): Promise<{ content: string; metadata: Json } | null> {
    const normalized = text
      .trim()
      .replace(/^ary[,\s]+/i, "")
      .replace(/[.!?]+$/, "");
    const skill =
      /^(?:please\s+)?(?:make|turn)\s+(.+?)\s+into\s+(?:a\s+)?reusable skill$/i.exec(
        normalized,
      );
    const mission =
      /^(?:please\s+)?create\s+(?:a\s+)?mission\s+(?:to\s+)?(.{3,})$/i.exec(
        normalized,
      );
    const start = /^(?:plan|coordinate|orchestrate)\s+(.{3,})$/i.exec(
      normalized,
    );
    const domains = [
      /studio|podcast/i,
      /premiere|interview|selects/i,
      /task/i,
      /calendar|schedule|time block/i,
    ].filter((r) => r.test(normalized)).length;
    const multi =
      domains >= 2 &&
      /\b(and|then)\b/i.test(normalized) &&
      /^(get|put|prepare|open|create|schedule|set up)\b/i.test(normalized);
    const command =
      /^(pause(?: that| the plan)?|resume(?: that| the plan)?|cancel (?:everything|that|the plan)|what are you waiting on|(?:show|inspect) (?:the |my )?plan|skip .+|approve .+ step)$/i.test(
        normalized,
      );
    if (!skill && !mission && !start && !multi && !command) return null;
    const reply = (content: string, id?: string, action?: string) => ({
      content,
      metadata: {
        orchestration_context: true,
        ...(id ? { orchestration_plan_id: id } : {}),
        ...(action ? { orchestration_action_id: action } : {}),
      },
    });
    const request = (tool: string, input: Json) =>
      this.coordinator.requests.request({
        tool,
        input,
        request_key: `conversation-plan:${source.id}:${tool}`,
        reason: text,
        conversation_id: source.conversation_id,
        source_message_id: source.id,
      });
    try {
      if (skill) {
        const history = (
          await this.repo.list("messages", {
            conversation_id: source.conversation_id,
          })
        )
          .filter((m) => m.id !== source.id)
          .slice(-6);
        const goal =
          skill[1].toLowerCase() === "this"
            ? history
                .map((m) => m.content)
                .join("\n")
                .slice(-1800)
            : skill[1];
        if (goal.trim().length < 3)
          return reply(
            "Describe the workflow to make reusable, or discuss it in this conversation first.",
          );
        const result = await request("skill.propose", { goal });
        const saved = (
          result.result as {
            skill: {
              id: string;
              versions: { definition: { title: string } }[];
            };
          }
        ).skill;
        return {
          content: `I proposed “${saved.versions.at(-1)!.definition.title}” as a draft Skill. Open Skills to inspect the workflow, edit it, and review its exact version. No permissions were granted and no workflow actions ran.`,
          metadata: { skill_id: saved.id, skill_action_id: result.action_id },
        };
      }
      if (mission) {
        const result = await request("mission.create", { goal: mission[1] });
        const plan = result.result as unknown as ExecutionPlan;
        return {
          content: `I created the draft mission “${plan.spec.title}”. Mission ID: ${plan.id}. Open Missions → Execution Plans to review and plan it. No tool execution has started.`,
          metadata: {
            mission_id: plan.id,
            mission_action_id: result.action_id,
          },
        };
      }
      if (start || multi) {
        const result = await request("orchestrator.plan", {
          goal: start?.[1] ?? normalized,
        });
        const plan = result.result as unknown as ExecutionPlan;
        return reply(
          `I prepared “${plan.spec.title}” with ${plan.spec.steps.length} steps. ${plan.spec.steps.map((s) => s.title).join(" → ")}. ${plan.spec.questions.length ? `I need: ${plan.spec.questions.join("; ")}` : "Review Execution Plans, then say resume the plan."} No tool effects have run.`,
          plan.id,
          result.action_id,
        );
      }
      const messages = await this.repo.list("messages", {
        conversation_id: source.conversation_id,
      });
      const context = messages
        .filter(
          (m) =>
            m.role === "assistant" &&
            typeof m.metadata.orchestration_plan_id === "string",
        )
        .at(-1);
      if (!context)
        return reply(
          "Which execution plan do you mean? Start or inspect it in this conversation first. I have not changed any plan.",
        );
      const plans = await this.coordinator.history();
      const plan = plans.find(
        (p) => p.id === context.metadata.orchestration_plan_id,
      );
      if (!plan)
        return reply(
          "That execution plan is unavailable. Open Execution Plans to select the current plan.",
        );
      if (/^(what|show|inspect)/i.test(normalized))
        return reply(
          `${plan.summary}\n${plan.spec.steps.map((s) => `${s.title}: ${plan.step_details?.[s.id]?.execution_status ?? plan.states[s.id].status}${plan.states[s.id].error ? ` — ${plan.states[s.id].error}` : ""}`).join("\n")}`,
          plan.id,
        );
      let verb = /^pause/i.test(normalized)
        ? "pause"
        : /^resume/i.test(normalized)
          ? "resume"
          : /^cancel/i.test(normalized)
            ? "cancel"
            : "skip";
      let stepId: string | undefined;
      if (/^(skip|approve)/i.test(normalized)) {
        const name = normalized
          .replace(/^(skip|approve)\s+(?:the\s+)?/i, "")
          .replace(/\s+step$/i, "")
          .toLowerCase();
        const exact = plan.spec.steps.filter(
          (s) => s.id.toLowerCase() === name || s.title.toLowerCase() === name,
        );
        const candidates = exact.length
          ? exact
          : plan.spec.steps.filter((s) => s.tool.split(".")[0] === name);
        if (candidates.length !== 1)
          return reply(
            `Name one exact step: ${plan.spec.steps.map((s) => s.id).join(", ")}. I won't guess which action you mean.`,
            plan.id,
          );
        stepId = candidates[0].id;
        if (/^approve/i.test(normalized)) {
          const item = plan.pending_approvals?.find(
            (i) => i.step_id === stepId,
          );
          if (!item)
            return reply(
              "That step has no pending exact approval. Inspect Execution Plans first.",
              plan.id,
            );
          // Require the exact inputs to have been shown in this conversation before a spoken/text grant.
          const snapshot = JSON.stringify(item);
          const shown = messages.some(
            (m) =>
              m.role === "assistant" &&
              m.metadata.orchestration_approval_snapshot === snapshot,
          );
          if (!shown)
            return {
              content: `Please review ${candidates[0].title}: ${JSON.stringify(item.input)}. Say “approve ${stepId} step” to approve exactly these inputs.`,
              metadata: {
                orchestration_context: true,
                orchestration_plan_id: plan.id,
                orchestration_approval_snapshot: snapshot,
              },
            };
          const result = await request("orchestrator.review_steps", {
            plan_id: plan.id,
            revision: plan.revision,
            items: [item],
            decision: "approved",
            reason: text,
          });
          return reply(
            "That exact step is approved. Say resume the plan to continue through the permission checks.",
            plan.id,
            result.action_id,
          );
        }
        verb = "skip";
      }
      const result = await request("orchestrator.advance", {
        plan_id: plan.id,
        revision: plan.revision,
        command: verb,
        ...(stepId ? { step_id: stepId } : {}),
      });
      const updated = result.result as unknown as ExecutionPlan;
      return reply(
        `${updated.summary}${verb === "resume" && updated.status === "active" ? " Say resume the plan for the next verified stage, or run it in Execution Plans." : ""}`,
        plan.id,
        result.action_id,
      );
    } catch (e) {
      if (e instanceof AppError)
        return reply(`I couldn't change the execution plan: ${e.message}`);
      throw e;
    }
  }
}
