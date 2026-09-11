import { presenceOperation } from "./presence/store";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const authClient = url && key ? createClient(url, key) : null;
export async function api(
  path: string,
  options: RequestInit = {},
  approvalRetry = false,
): Promise<Response> {
  const session = authClient
    ? (await authClient.auth.getSession()).data.session
    : null;
  const activity =
    path === "actions/request" && options.method === "POST"
      ? presenceOperation("Waiting for action validation")
      : null;
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(activity ? { Accept: "application/x-ary-presence+ndjson" } : {}),
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...options.headers,
      },
    });
    if (
      activity &&
      response.headers
        .get("content-type")
        ?.includes("application/x-ary-presence+ndjson")
    ) {
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        result: { status: number; body: unknown } | undefined;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "presence") activity.update(event.event);
        if (event.type === "result") result = event;
      };
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        lines.forEach(consume);
        if (done) {
          consume(buffer);
          break;
        }
      }
      if (!result)
        throw new Error(
          "Action connection ended. Check Action History before retrying.",
        );
      response = new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    activity?.finish(
      response.ok ? "complete" : response.status === 409 ? "waiting" : "error",
      response.ok
        ? "Action result recorded"
        : response.status === 409
          ? "Action needs review"
          : "Action request failed",
    );
  } catch (error) {
    activity?.finish("error", "Action connection interrupted · check history");
    throw error;
  }
  if (typeof window !== "undefined" && (activity || path.endsWith("/review")))
    window.dispatchEvent(new Event("ary:action-settled"));
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    if (
      body.code === "approval_required" &&
      !approvalRetry &&
      typeof window !== "undefined"
    ) {
      const approved = await new Promise<boolean>((respond) =>
        window.dispatchEvent(
          new CustomEvent("ary:approval", {
            detail: {
              actionId: body.action_id,
              tool: body.tool,
              signal: options.signal,
              respond,
            },
          }),
        ),
      );
      if (approved) return api(path, options, true);
      throw new Error("Action rejected. Nothing was executed.");
    }
    throw new Error(body.error ?? "Request failed");
  }
  return response;
}
