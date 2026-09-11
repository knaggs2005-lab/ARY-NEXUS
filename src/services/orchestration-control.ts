import type { Message, NewRecord, Json } from "../domain/models";
import type { ExecutionPlan } from "../domain/orchestration";
/** Existing durable control format, shared by mission controls and owner emergency stop. */
export function orchestrationControlRecord(
  plan: ExecutionPlan,
  command: "pause" | "cancel" | "resume",
  messages: Message[],
): NewRecord<Message> {
  const sequence =
    Math.max(
      0,
      ...messages
        .filter(
          (m) =>
            (m.metadata.orchestration_control as Json | undefined)?.plan_id ===
            plan.id,
        )
        .map((m) =>
          Number((m.metadata.orchestration_control as Json).sequence ?? 0),
        ),
    ) + 1;
  return {
    conversation_id: plan.conversation_id,
    role: "system",
    content: `Owner requested ${command} for execution plan ${plan.id}.`,
    metadata: {
      orchestration_control: { plan_id: plan.id, command, sequence },
    },
  };
}
