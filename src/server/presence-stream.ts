import { z } from "zod";
import { ApprovalRequiredError } from "../services/action-service";
import { AppError } from "../domain/validation";
import { presenceTelemetry } from "../services/presence-telemetry";
/** Opt-in envelope. Existing JSON callers and the action permission pipeline are unchanged. */
export function presenceResponse(operation: () => Promise<unknown>): Response {
  let disconnected = false;
  const stream = new ReadableStream({
    cancel() {
      disconnected = true;
    },
    async start(controller) {
      const send = (event: unknown) => {
        if (!disconnected)
          try {
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify(event) + "\n"),
            );
          } catch {
            disconnected = true;
          }
      };
      try {
        const body = await presenceTelemetry.run(
          (event) => send({ type: "presence", event }),
          operation,
        );
        send({ type: "result", status: 201, body });
      } catch (error) {
        const status =
          error instanceof ApprovalRequiredError
            ? 409
            : error instanceof z.ZodError
              ? 400
              : error instanceof AppError
                ? error.status
                : 500;
        const body =
          error instanceof ApprovalRequiredError
            ? {
                error: error.message,
                code: "approval_required",
                action_id: error.actionId,
                tool: error.tool,
              }
            : {
                error:
                  error instanceof AppError
                    ? error.message
                    : error instanceof z.ZodError
                      ? "Validation failed"
                      : "Internal server error",
              };
        send({ type: "result", status, body });
      } finally {
        if (!disconnected) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ary-presence+ndjson",
      "Cache-Control": "no-store",
    },
  });
}
