"use client";
import type { Action } from "../domain/models";
import { capabilityExplanation } from "../domain/permission-classes";
import { getToolDefinition } from "../domain/permissions";
import styles from "./permission-engine.module.css";
export function PermissionBrief({ action }: { action: Action }) {
  const detail = (action.metadata.permission_explanation ??
    capabilityExplanation(
      action.tool_name,
      getToolDefinition(action.tool_name),
    )) as ReturnType<typeof capabilityExplanation>;
  return (
    <section className={styles.brief} aria-label="Approval explanation">
      <div className={styles.tags}>
        {detail.classes.map((c) => (
          <span key={c}>{c.replaceAll("_", " ")}</span>
        ))}
        <span>{detail.risk} risk</span>
      </div>
      <dl>
        <div>
          <dt>What Ary wants to do</dt>
          <dd>{detail.description}</dd>
        </div>
        <div>
          <dt>Why</dt>
          <dd>
            {String(
              action.metadata.reason ??
                action.metadata.permission_reason ??
                "No additional reason was supplied. Review the request before proceeding.",
            )}
          </dd>
        </div>
        <div>
          <dt>Requested by</dt>
          <dd>
            {String(
              action.metadata.agent_id ??
                (action.metadata.requesting_agent === "authenticated_user"
                  ? "You (authenticated account owner)"
                  : action.metadata.requesting_agent) ??
                "Not recorded",
            )}
          </dd>
        </div>
        <div>
          <dt>Data and tool</dt>
          <dd>
            {action.tool_name} · {action.workspace}
            {action.product_entity_ids?.length
              ? ` · Projects/entities: ${action.product_entity_ids?.join(", ")}`
              : ""}
            . Exact inputs and source references are shown below.
          </dd>
        </div>
        <div>
          <dt>What could happen</dt>
          <dd>{detail.consequences}</dd>
        </div>
        <div>
          <dt>Can it be undone?</dt>
          <dd>{detail.reversibility}</dd>
        </div>
      </dl>
      {detail.mandatoryApproval && (
        <p>
          This capability always needs approval, including under an always-allow
          policy.
        </p>
      )}
    </section>
  );
}
