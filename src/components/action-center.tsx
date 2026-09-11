"use client";
import { PermissionBrief } from "./permission-brief";
import { PerceptionReport } from "./perception/perception-panel";
import type { VisionFinding } from "../domain/perception";
import { StudioReportView } from "./studio/studio-panel";
import type { StudioReport } from "../domain/studio";
import { CallReview } from "./calls/call-review";
import { FinanceImportReview } from "./finance/finance-review";
import { MailReview } from "./gmail/mail-review";
import { CalendarReview } from "./calendar/calendar-review";
import { projectUpdateInput, changedProject } from "../domain/project-actions";
import { ProjectChangeReview } from "./project-change-review";
import { taskUpdateInput, changedTask } from "../domain/task-actions";
import { TaskChangeReview } from "./task-change-review";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  Action,
  Entity,
  Json,
  ModelCall,
  Outcome,
} from "../domain/models";
import type { ActionApproval } from "../domain/permissions";
import type { ActionRequestService } from "../services/action-request-service";
import { api } from "./api";
import { TaskProgress, TaskReceipt, type TaskPhase } from "./task-experience";
import styles from "./permissions.module.css";

type Catalog = Awaited<ReturnType<ActionRequestService["catalog"]>>;
type Row = Action & {
  approval: ActionApproval | null;
  outcomes: Outcome[];
  model_calls: ModelCall[];
};
type History = { total: number; offset: number; items: Row[] };
export function ActionCenter({
  view,
  onTaskCreated,
  commandTool,
}: {
  view: "Approvals" | "Action history";
  onTaskCreated?: () => Promise<unknown>;
  commandTool?: { name: string; revision: number } | null;
}) {
  const [taskOperation, setTaskOperation] = useState<"create" | "update">(
    "create",
  );
  const [taskPhase, setTaskPhase] = useState<TaskPhase | null>(null);
  const [catalog, setCatalog] = useState<Catalog>([]);
  const [history, setHistory] = useState<History>({
    total: 0,
    offset: 0,
    items: [],
  });
  const [products, setProducts] = useState<Entity[]>([]);
  const [offset, setOffset] = useState(0);
  const [tool, setTool] = useState("create_task");
  const [input, setInput] = useState("{}");
  const [reason, setReason] = useState("Owner proposes an internal action.");
  const [product, setProduct] = useState("");
  const [memoryIds, setMemoryIds] = useState("");
  const [entityIds, setEntityIds] = useState("");
  const [sourceContext, setSourceContext] = useState<{
    conversation_id: string | null;
    source_message_id: string | null;
    source_action_id?: string;
  }>({ conversation_id: null, source_message_id: null });
  const [revision, setRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Json | null>(null);
  const key = useRef<string | null>(null);
  useEffect(() => {
    if (!commandTool) return;
    setTool(commandTool.name);
    setInput("{}");
    setReason("User selected this action in the Ary command palette.");
    setRevision(null);
    setProduct("");
    setEntityIds("");
    setMemoryIds("");
    setSourceContext({ conversation_id: null, source_message_id: null });
    setTaskPhase(null);
    key.current = null;
    setResult(null);
  }, [commandTool]);
  const selected = catalog.find((t) => t.name === tool);
  const refresh = useCallback(async () => {
    const response = await api(
      `actions/history?offset=${offset}&pending=${view === "Approvals"}`,
    );
    setHistory(await response.json());
  }, [offset, view]);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api("actions/tools").then((r) => r.json()),
      api("permissions").then((r) => r.json()),
    ])
      .then(([tools, settings]) => {
        if (active) {
          setCatalog(tools);
          setProducts(settings.products);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  function changed() {
    setTaskPhase(null);
    key.current = null;
    setResult(null);
  }
  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      const message = (e as Error).message;
      setTaskPhase((current) =>
        current
          ? message.startsWith("Approval required")
            ? "review"
            : "error"
          : null,
      );
      if (message.startsWith("Approval required"))
        setNotice("Request queued. Inspect it below before approving.");
      else setError(message);
    } finally {
      try {
        await refresh();
      } catch {
        setError((value) => value || "Could not refresh action history.");
      }
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      if (["create_task", "update_task"].includes(tool))
        setTaskPhase("checking");
      setTaskOperation(tool === "update_task" ? "update" : "create");
      key.current ??= crypto.randomUUID();
      const response = await api(
        revision ? `actions/${revision}/revise` : "actions/request",
        {
          method: "POST",
          body: JSON.stringify({
            ...sourceContext,
            tool,
            input: JSON.parse(input),
            reason,
            product_entity_id: product || null,
            related_entity_ids: entityIds
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
            related_memory_ids: memoryIds
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
            request_key: key.current,
          }),
        },
        true,
      ).catch((error: Error) => {
        if (error.message.startsWith("Approval required")) setRevision(null);
        throw error;
      }); // Queue page handles pending approval explicitly instead of opening the global dialog.
      const payload = await response.json();
      setResult(payload);
      if (["create_task", "update_task"].includes(payload.tool))
        setTaskPhase("succeeded");
      if (
        ["create_task", "update_task", "update_project_status"].includes(
          payload.tool,
        )
      )
        void onTaskCreated?.().catch(() => {});
      setNotice(
        "Action completed. Inspect the recorded result in Action history.",
      );
      setRevision(null);
    });
  }
  function edit(action: Row) {
    const request = action.metadata.request_envelope as Json;
    setSourceContext({
      conversation_id: (request.conversation_id as string | null) ?? null,
      source_message_id: (request.source_message_id as string | null) ?? null,
      ...(request.source_action_id
        ? { source_action_id: String(request.source_action_id) }
        : {}),
    });
    setTool(String(request.tool));
    setInput(JSON.stringify(request.input, null, 2));
    setReason(String(request.reason));
    setProduct(String(request.product_entity_id ?? ""));
    setMemoryIds((request.related_memory_ids as string[]).join(", "));
    setEntityIds((request.related_entity_ids as string[]).join(", "));
    setRevision(action.id);
    changed();
    setNotice(
      "Editing a copy. Submitting it rejects the original and requests a fresh decision.",
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function review(action: Row, decision: "approved" | "rejected") {
    await perform(async () => {
      setTaskOperation(
        action.tool_name === "update_task" ? "update" : "create",
      );
      setTaskPhase(
        ["create_task", "update_task"].includes(action.tool_name)
          ? "approving"
          : null,
      );
      await api(`permissions/attempts/${action.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          reason: `Owner ${decision} this exact request in the approval queue.`,
        }),
      });
      if (["create_task", "update_task"].includes(action.tool_name))
        setTaskPhase(decision === "approved" ? "executing" : "rejected");
      if (decision === "approved" && action.metadata.request_envelope) {
        const response = await api(
          "actions/request",
          {
            method: "POST",
            body: JSON.stringify(action.metadata.request_envelope),
          },
          true,
        );
        const payload = await response.json();
        setResult(payload);
        if (["create_task", "update_task"].includes(payload.tool))
          setTaskPhase("succeeded");
        if (
          ["create_task", "update_task", "update_project_status"].includes(
            payload.tool,
          )
        )
          void onTaskCreated?.().catch(() => {});
        setNotice("Approved action completed.");
      } else
        setNotice(
          decision === "rejected"
            ? "Rejected. No tool ran."
            : "Approved. Retry this legacy action from its original screen.",
        );
    });
  }
  return (
    <section className={styles.panel} aria-label={view}>
      <div className={styles.heading}>
        <h2>{view}</h2>
        <button
          disabled={busy}
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          Refresh
        </button>
      </div>
      {taskPhase && (
        <TaskProgress phase={taskPhase} operation={taskOperation} />
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {(view === "Approvals" || revision) && (
        <form className={styles.card} onSubmit={submit}>
          <h3>
            {revision ? "Modify pending request" : "Propose an internal action"}
          </h3>
          <p>
            create_task, update_task and update_project_status write real
            internal records after permission checks. Tools prefixed mock.
            remain simulations. Every registered tool retains its own
            validation, permissions and approval requirements.
          </p>
          <label>
            Tool
            <select
              value={tool}
              disabled={busy}
              onChange={(e) => {
                setTool(e.target.value);
                changed();
              }}
            >
              {catalog.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <p>
                {selected.description} · {selected.risk_level} risk ·{" "}
                {selected.permission_requirements.mode} · default level{" "}
                {selected.permission_requirements.default_level}
              </p>
              <p>
                Workspace permission: level {selected.permission.level}.{" "}
                {selected.permission.reason}. Entity scope is checked when
                submitted.
              </p>
              <details>
                <summary>Required inputs and available action</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(
                    {
                      actions: selected.available_actions,
                      required: selected.required_inputs,
                      input_schema: selected.input_schema,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
          <label>
            Why Ary should do this
            <textarea
              required
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                changed();
              }}
            />
          </label>
          <label>
            Inputs (JSON)
            <textarea
              required
              rows={5}
              value={input}
              disabled={busy}
              onChange={(e) => {
                setInput(e.target.value);
                changed();
              }}
            />
          </label>
          <label>
            Project / company scope
            <select
              value={product}
              disabled={busy}
              onChange={(e) => {
                setProduct(e.target.value);
                changed();
              }}
            >
              <option value="">Workspace</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Related entity IDs (comma-separated)
            <textarea
              value={entityIds}
              disabled={busy}
              onChange={(e) => {
                setEntityIds(e.target.value);
                changed();
              }}
            />
          </label>
          <label>
            Related memory IDs (comma-separated)
            <textarea
              value={memoryIds}
              disabled={busy}
              onChange={(e) => {
                setMemoryIds(e.target.value);
                changed();
              }}
            />
          </label>
          <div className={styles.row}>
            <button disabled={busy} className="primary">
              {busy
                ? "Processing…"
                : revision
                  ? "Submit revised request"
                  : "Submit action request"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRevision(null);
                changed();
                setSourceContext({
                  conversation_id: null,
                  source_message_id: null,
                });
                setNotice("New request key ready.");
              }}
            >
              New request
            </button>
          </div>
          <p>
            Retries retain the same key until you edit the request or choose New
            request.
          </p>
        </form>
      )}
      {result && (
        <details className={styles.card} open>
          <summary>Latest result</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
      <div className={styles.card}>
        <h3>
          {view === "Approvals" ? "Approval queue" : "Complete action history"}{" "}
          · {history.total}
        </h3>
        {!history.items.length && (
          <p>
            {view === "Approvals"
              ? "No requests awaiting review or retry."
              : "No actions recorded."}
          </p>
        )}
        {history.items.map((action) => (
          <details key={action.id} className={styles.attempt}>
            <summary>
              <strong>{action.tool_name}</strong>
              <span>
                {action.approval
                  ? `${action.approval.decision} · ${action.status}`
                  : action.status}{" "}
                · level {action.permission_level}
              </span>
              <time>{new Date(action.created_at).toLocaleString()}</time>
            </summary>
            <PermissionBrief action={action} />
            <p>
              <b>Why:</b>{" "}
              {String(
                action.metadata.reason ??
                  action.metadata.permission_reason ??
                  "Legacy request",
              )}
            </p>
            <p>
              User: {action.user_id} · Requested by:{" "}
              {String(
                action.metadata.requesting_agent ??
                  "Not recorded on legacy action",
              )}
            </p>
            <p>
              Action: {action.action_type} ·{" "}
              {String(action.metadata.permission_reason ?? "")}
            </p>
            {action.tool_name === "perception.analyze" &&
              !!action.output.result && (
                <PerceptionReport
                  report={
                    action.output.result as {
                      finding: VisionFinding;
                      model: string;
                      provider: string;
                      latency_ms: number;
                    }
                  }
                />
              )}
            {action.tool_name === "studio.execute_scene" &&
              !!action.output.result && (
                <StudioReportView
                  report={action.output.result as unknown as StudioReport}
                />
              )}
            {["create_task", "update_task"].includes(action.tool_name) &&
              action.status === "succeeded" &&
              !!action.output.result && (
                <TaskReceipt
                  operation={
                    action.tool_name === "update_task" ? "update" : "create"
                  }
                  title={String((action.output.result as Json).title)}
                  taskId={String((action.output.result as Json).task_id)}
                  project={String((action.output.result as Json).project_name)}
                  actionId={String(action.metadata.replay_of ?? action.id)}
                  replay={!!action.metadata.replay_of}
                />
              )}
            {action.tool_name === "update_project_status" &&
              action.status === "succeeded" &&
              !!action.output.result && (
                <p role="status">
                  Action {String(action.metadata.replay_of ?? action.id)} →
                  saved project{" "}
                  {String((action.output.result as Json).project_name)} ·
                  Project ID {String((action.output.result as Json).project_id)}
                </p>
              )}
            {action?.tool_name === "update_project_status" &&
              (() => {
                const parsed = projectUpdateInput.safeParse(
                  (action.metadata.request_envelope as Json)?.input,
                );
                return parsed.success ? (
                  <ProjectChangeReview
                    before={parsed.data.before}
                    after={changedProject(
                      parsed.data.before,
                      parsed.data.changes,
                    )}
                  />
                ) : null;
              })()}
            {action?.tool_name === "phone.initiate" && (
              <CallReview
                input={
                  (action.metadata.request_envelope as { input?: unknown })
                    ?.input
                }
              />
            )}
            {action.tool_name === "finance.import" && (
              <FinanceImportReview
                input={
                  (action.input.action_request as { input?: unknown })?.input
                }
              />
            )}
            {action.tool_name === "gmail.send" && (
              <MailReview
                input={(action.metadata.request_envelope as Json)?.input}
              />
            )}
            {action.tool_name.startsWith("google_calendar.") && (
              <CalendarReview
                input={(action.metadata.request_envelope as Json)?.input}
              />
            )}
            {action.tool_name === "update_task" &&
              (() => {
                const parsed = taskUpdateInput.safeParse(
                  (action.metadata.request_envelope as Json)?.input,
                );
                return parsed.success ? (
                  <TaskChangeReview
                    before={parsed.data.before}
                    after={changedTask(parsed.data.before, parsed.data.changes)}
                    entities={products}
                  />
                ) : null;
              })()}
            <pre>
              {JSON.stringify(
                {
                  inputs: action.input,
                  entities:
                    action.metadata.related_entity_ids ??
                    action.product_entity_ids,
                  memories: action.metadata.related_memory_ids ?? [],
                  revision_of: action.metadata.revision_of,
                  replay_of: action.metadata.replay_of,
                  result: action.output,
                  error: action.error,
                  approval: action.approval,
                  approval_required: action.approval_required,
                  source_action_id: action.metadata.source_action_id,
                  outcomes: action.outcomes,
                  model_cost: action.model_calls.length
                    ? action.model_calls.map((call) => ({
                        estimated_cost_usd: call.estimated_cost_usd,
                        model: call.model,
                        latency_ms: call.latency_ms,
                      }))
                    : "No model call recorded",
                  created_at: action.created_at,
                  updated_at: action.updated_at,
                },
                null,
                2,
              )}
            </pre>
            <div className={styles.row}>
              {action.status === "approval_required" && !action.approval && (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void review(action, "approved")}
                  >
                    Approve
                    {action.metadata.request_envelope ? " and run" : " once"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void review(action, "rejected")}
                  >
                    Reject
                  </button>
                  {!!action.metadata.request_envelope && (
                    <button disabled={busy} onClick={() => edit(action)}>
                      Modify request
                    </button>
                  )}
                </>
              )}
              {!!action.metadata.request_envelope &&
                action.approval?.decision === "approved" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        if (
                          ["create_task", "update_task"].includes(
                            action.tool_name,
                          )
                        )
                          setTaskPhase("checking");
                        const response = await api(
                          "actions/request",
                          {
                            method: "POST",
                            body: JSON.stringify(
                              action.metadata.request_envelope,
                            ),
                          },
                          true,
                        );
                        const payload = await response.json();
                        setResult(payload);
                        if (
                          ["create_task", "update_task"].includes(payload.tool)
                        )
                          setTaskPhase("succeeded");
                        if (
                          [
                            "create_task",
                            "update_task",
                            "update_project_status",
                          ].includes(payload.tool)
                        )
                          void onTaskCreated?.().catch(() => {});
                      })
                    }
                  >
                    Retry same request
                  </button>
                )}
              {action.status === "succeeded" &&
                !!action.metadata.request_envelope &&
                !action.tool_name.startsWith("gmail.") &&
                !action.tool_name.startsWith("finance.") &&
                !action.metadata.replay_of && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const response = await api(
                          `actions/${action.id}/remember`,
                          { method: "POST" },
                        );
                        const payload = await response.json();
                        setResult(payload);
                        if (
                          ["create_task", "update_task"].includes(payload.tool)
                        )
                          setTaskPhase("succeeded");
                        if (
                          [
                            "create_task",
                            "update_task",
                            "update_project_status",
                          ].includes(payload.tool)
                        )
                          void onTaskCreated?.().catch(() => {});
                        setNotice(
                          "Saved a reviewed episodic action record. Existing facts are unchanged.",
                        );
                      })
                    }
                  >
                    Accept episodic memory proposal
                  </button>
                )}
            </div>
          </details>
        ))}
        <div className={styles.row}>
          <button
            disabled={busy || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous
          </button>
          <button
            disabled={busy || offset + 50 >= history.total}
            onClick={() => setOffset(offset + 50)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
