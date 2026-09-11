import type { Entity, Json, Message } from "../domain/models";
import type { Repository } from "../domain/repository";
import { ActionRequestService } from "./action-request-service";
import { ActionService, ApprovalRequiredError } from "./action-service";
import { AppError } from "../domain/validation";

/** Narrow internal command adapter. Normal chat continues through the existing model and retrieval. */
export class TaskConversationService {
  constructor(
    private repo: Repository,
    private actions: ActionService,
  ) {}
  async handle(
    text: string,
    source: Message,
    entities: Entity[],
    ambiguous: boolean,
    timeZone = "UTC",
  ): Promise<{ content: string; metadata: Json } | null> {
    if (/^what task did you just create\??$/i.test(text.trim())) {
      const last = (
        await this.repo.list("actions", {
          conversation_id: source.conversation_id,
          tool_name: "create_task",
          status: "succeeded",
        })
      )
        .filter((action) => !action.metadata.replay_of)
        .at(-1);
      if (!last)
        return {
          content:
            "I have not created a task in this conversation yet. Pending proposals are not completed tasks.",
          metadata: { task_confirmation: null },
        };
      return this.actions.run(
        "activity.read",
        source.conversation_id,
        async () => {
          const result = last.output.result as Json;
          const task =
            typeof result?.task_id === "string"
              ? await this.repo.get("tasks", result.task_id)
              : null;
          if (!task || task.metadata.action_id !== last.id)
            return {
              content:
                "I found an action record, but its task is unavailable. I cannot confirm that task currently exists.",
              metadata: { task_confirmation: null },
            };
          const project = task.entity_id
            ? await this.repo.get("entities", task.entity_id)
            : null;
          return {
            content: `I created “${task.title}”${project ? ` for ${project.name}` : ""}. It is ${["low", "normal", "high", "urgent"][task.priority]} priority, ${task.status.replaceAll("_", " ")}${task.due_at ? `, due ${task.due_at.slice(0, 10)}` : ""}. Task ID: ${task.id}.`,
            metadata: {
              task_confirmation: {
                task_id: task.id,
                action_id: last.id,
                project_id: task.entity_id,
              },
            },
          };
        },
        { source_message_id: source.id },
        { productIds: last.product_entity_ids ?? [] },
      );
    }
    const command = text
      .trim()
      .match(
        /^(?:ary[,\s]+)?(?:please\s+)?(?:(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:create|add)\s+(?:a\s+)?(?:(low|normal|medium|high|urgent)\s+priority\s+)?task\s+(?:for\s+me\s+)?(?:to\s+)?(.+)$/i,
      );
    if (!command) {
      // A voice transcription can turn the address "Ary" into "I". Do not
      // interpret the resulting declarative sentence as execution authority.
      if (
        source.metadata.modality === "voice" &&
        /^i\s+(?:create|add)\s+(?:a\s+)?(?:(?:low|normal|medium|high|urgent)\s+priority\s+)?task\b/i.test(
          text.trim(),
        )
      )
        return {
          content:
            "I can help create tasks, but this transcript starts with “I create,” so I need to confirm your request. Please review the wording and exact project name, then send “Create a task to [what needs doing] for [project name] tomorrow.” No task has been created.",
          metadata: { task_clarification: "unclear_voice_request" },
        };
      return null;
    }
    const projects = entities.filter((entity) =>
      ["company", "project", "product"].includes(entity.entity_type),
    );
    if (ambiguous || projects.length !== 1)
      return {
        content:
          "I can help create this task. Which project should it belong to? Please repeat the task request with one exact project name, correcting the transcript if needed. No task has been created.",
        metadata: { task_clarification: "project_required" },
      };
    const project = projects[0];
    let title = command[2].replace(/[.!?]+$/, "").trim();
    const due = title.match(
      /\s+(?:by\s+|due\s+)?(tomorrow|today|\d{4}-\d{2}-\d{2})$/i,
    );
    let dueDate: string | null = null;
    if (due) {
      title = title.slice(0, due.index).trim();
      if (/^\d/.test(due[1])) dueDate = due[1];
      else {
        const parts = new Intl.DateTimeFormat("en", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date());
        const part = (type: string) =>
          parts.find((p) => p.type === type)!.value;
        const day = new Date(
          `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
        );
        if (due[1].toLowerCase() === "tomorrow")
          day.setUTCDate(day.getUTCDate() + 1);
        dueDate = day.toISOString().slice(0, 10);
      }
    } else if (
      /\b(next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight)\b/i.test(
        title,
      )
    ) {
      return {
        content:
          "Please give the due date as YYYY-MM-DD, today, or tomorrow so I can propose the task precisely.",
        metadata: {},
      };
    }
    const priority =
      { low: 0, normal: 1, medium: 1, high: 2, urgent: 3 }[
        command[1]?.toLowerCase() ?? "normal"
      ] ?? 1;
    const request = {
      tool: "create_task",
      input: {
        title,
        description: "",
        project_id: project.id,
        status: "pending",
        priority,
        due_date: dueDate,
      },
      reason: source.content.slice(0, 1000),
      conversation_id: source.conversation_id,
      source_message_id: source.id,
      product_entity_id: project.id,
      related_entity_ids: entities.map((e) => e.id),
      related_memory_ids: [],
      request_key: `chat-task:${source.id}`,
    };
    try {
      const created = await new ActionRequestService(
        this.repo,
        this.actions,
      ).request(request);
      return {
        content: `Created “${created.result.title}” for ${project.name}. Task ID: ${created.result.task_id}.`,
        metadata: { task_confirmation: created.result },
      };
    } catch (error) {
      if (error instanceof ApprovalRequiredError)
        return {
          content: `I propose creating “${title}” for ${project.name}, ${["low", "normal", "high", "urgent"][priority]} priority${dueDate ? `, due ${dueDate} (${timeZone} calendar date)` : ""}. No task has been created yet. Review the details below to approve or reject it.`,
          metadata: {
            task_proposal: {
              action_id: error.actionId,
              request,
              project_name: project.name,
            },
          },
        };
      if (error instanceof AppError)
        return {
          content: `The task was not confirmed: ${error.message}. Check Action history before retrying.`,
          metadata: { task_error: true },
        };
      throw error;
    }
  }
}
