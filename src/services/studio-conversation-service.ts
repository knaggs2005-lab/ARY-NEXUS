import type { Repository } from "../domain/repository";
import type { ToolRegistry } from "../domain/tool-registry";
import type { Message, Json } from "../domain/models";
import type { StudioPlan } from "../domain/studio";
import { ActionRequestService } from "./action-request-service";
import { ActionService, ApprovalRequiredError } from "./action-service";
import { AppError } from "../domain/validation";
/** Explicit scene commands only. This is a domain adapter for the existing brain, not another assistant. */
export class StudioConversationService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
    private registry: ToolRegistry,
  ) {}
  async handle(
    text: string,
    source: Message,
  ): Promise<{ content: string; metadata: Json } | null> {
    const match = text
      .trim()
      .match(
        /^(?:ary[,\s]+)?(?:(?:prepare|activate|set up|switch to)\s+)?(podcast(?: mode)?|recording (?:mode|setup))[.!]?$/i,
      );
    if (!match) return null;
    const requests = new ActionRequestService(
      this.repo,
      this.actions,
      this.registry,
    );
    try {
      const planned = await requests.request({
        tool: "studio.plan_scene",
        input: { scene: match[1] },
        conversation_id: source.conversation_id,
        source_message_id: source.id,
        reason: text,
        request_key: `studio-plan:${source.id}`,
      });
      const plan = planned.result.plan as StudioPlan;
      const details = plan.steps
        .map(
          (s) =>
            `• ${s.device_name}: ${s.command.verb} → ${String(s.command.value)}${s.blocked_reason ? ` (${s.blocked_reason})` : ""}`,
        )
        .join("\n");
      if (!plan.executable)
        return {
          content: `${plan.scene_name} is not ready to run:\n${details}\nOpen Studio to configure or reconnect required devices. Nothing was changed.`,
          metadata: {
            studio_context: true,
            studio_plan_action_id: planned.action_id,
          },
        };
      const request = {
        ...(planned.result.request as Json),
        source_message_id: source.id,
        reason: text,
        request_key: `studio-scene:${source.id}`,
      };
      try {
        await requests.request(request);
        return {
          content:
            "The studio execution report is available in Studio and Action history.",
          metadata: { studio_context: true },
        };
      } catch (e) {
        if (e instanceof ApprovalRequiredError)
          return {
            content: `Proposed ${plan.scene_name}:\n${details}\nReview this exact scene in Approvals before I change any devices. Recording setup does not start recording.`,
            metadata: {
              studio_context: true,
              studio_approval_action_id: e.actionId,
              studio_plan_action_id: planned.action_id,
            },
          };
        throw e;
      }
    } catch (e) {
      if (e instanceof AppError)
        return {
          content: `I couldn't prepare the studio scene: ${e.message}`,
          metadata: { studio_context: true, studio_error: true },
        };
      throw e;
    }
  }
}
