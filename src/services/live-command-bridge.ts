import { randomUUID } from "node:crypto";
import {
  buildCommands,
  exactVoiceDestination,
  rankCommands,
  indexCommands,
  voiceQuery,
  dispatchCommand,
} from "../components/commands/command-index";
import type { InstalledApp } from "../domain/desktop";
import type { Repository } from "../domain/repository";
import type { ActionRequestService } from "./action-request-service";
import { ApprovalRequiredError } from "./action-service";
/** Reuses the universal command dispatcher; it cannot call a desktop adapter directly. */
export function liveCommandBridge(
  repo: Repository,
  requests: Pick<ActionRequestService, "request">,
) {
  return async (
    text: string,
    key: string,
    conversationId: string,
    signal: AbortSignal,
    report?: (name: string) => void,
  ): Promise<string | null> => {
    if (
      !/^(?:ary[,\s]+)?(?:open|launch)\s+[^\n]{1,120}[.!?]?$/i.test(text.trim())
    )
      return null;
    const source = await repo.insert("messages", {
      conversation_id: conversationId,
      role: "user",
      content: text,
      metadata: {
        modality: "voice",
        live_delegation: key,
        transcript_request: true,
      },
    });
    const common = {
      conversation_id: conversationId,
      source_message_id: source.id,
      reason: text,
    };
    try {
      report?.("tool_dispatched:desktop.list_apps");
      const scan = await requests.request({
        ...common,
        tool: "desktop.list_apps",
        input: {},
        request_key: `${key}:scan`,
      });
      report?.("tool_completed:desktop.list_apps");
      if (signal.aborted) return "The request was interrupted before dispatch.";
      const commands = buildCommands(
        [],
        [],
        [],
        (scan.result.apps ?? []) as unknown as InstalledApp[],
        [],
      ).filter((c) => c.source === "app");
      const candidates = rankCommands(
        indexCommands(commands),
        voiceQuery(text),
        200,
      );
      const command =
        exactVoiceDestination(commands, text) ??
        (candidates.length === 1 ? candidates[0].command : null);
      // Reuse palette ranking only when exactly one installed app matches; ambiguity stays with the owner.
      if (!command)
        return "Please select the exact installed application in the command palette; no app was launched.";
      const result: any = await dispatchCommand(command, {
        navigate: () => {},
        uuid: randomUUID,
        executionKeys: {
          operationId: randomUUID(),
          requestKey: `${key}:launch`,
        },
        request: async (raw) => {
          report?.("tool_dispatched:desktop.launch_app");
          const result = await requests.request({
            ...(raw as object),
            ...common,
          });
          report?.("tool_completed:desktop.launch_app");
          return result;
        },
      });
      return `Nexus completed ${command.label}. Action ID: ${result.action_id}.`;
    } catch (error) {
      if (error instanceof ApprovalRequiredError)
        return `Approval is required to open the application. Review action ${error.actionId} in Nexus Approvals. Nothing is confirmed as launched.`;
      return "Nexus could not launch the application. Check Action History for the exact failure; no launch is confirmed.";
    }
  };
}
