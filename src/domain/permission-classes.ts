import type { ToolDefinition } from "./permissions";
export const permissionClasses = [
  "READ",
  "WRITE",
  "EXECUTE",
  "COMMUNICATE",
  "DELETE",
  "PURCHASE",
  "ADMIN",
  "PHYSICAL_CONTROL",
  "FINANCIAL",
  "EXTERNAL_PUBLISH",
] as const;
export type PermissionClass = (typeof permissionClasses)[number];
export const permissionBehaviors = [
  "always_allow",
  "ask_every_time",
  "deny",
] as const;
export type PermissionBehavior = (typeof permissionBehaviors)[number];
export const emergencyScope = "nexus-emergency-stop-v1";
/** Server-owned classifications. Provider annotations and request bodies cannot grant authority. */
export function capabilityClasses(
  name: string,
  definition?: ToolDefinition,
): PermissionClass[] {
  if (
    [
      "permissions.policy",
      "permissions.review",
      "permissions.emergency_stop",
    ].includes(name)
  )
    return ["ADMIN"];
  // Opaque remote capabilities can have any effect. Until specifically classified,
  // a class denial must not be bypassed by routing through MCP.
  if (name === "mcp.invoke") return [...permissionClasses];
  if (!definition) return ["EXECUTE"];
  if (definition.permissionClasses) return [...definition.permissionClasses];
  const classes = new Set<PermissionClass>(
    definition.mode === "observe"
      ? ["READ"]
      : definition.mode === "recommend"
        ? ["READ"]
        : definition.mode === "draft"
          ? ["WRITE"]
          : ["EXECUTE", "WRITE"],
  );
  if (/^(gmail\.send|phone\.initiate)$/.test(name)) classes.add("COMMUNICATE");
  if (/(^|[._])delete([._]|$)/.test(name)) classes.add("DELETE");
  if (
    /^(permissions\.|agent\.(create|update|terminate)|mission\.control)/.test(
      name,
    )
  )
    classes.add("ADMIN");
  if (/^(desktop\.|studio\.)/.test(name) && definition.mode !== "observe")
    classes.add("PHYSICAL_CONTROL");
  if (/^(finance\.|economics\.)/.test(name)) classes.add("FINANCIAL");
  return [...classes];
}
export function capabilityExplanation(
  name: string,
  definition?: ToolDefinition,
) {
  if (
    [
      "permissions.policy",
      "permissions.review",
      "permissions.emergency_stop",
    ].includes(name)
  )
    definition = {
      actionType: "permissions",
      mode: "execute",
      defaultLevel: 0,
      description:
        "Owner administration of permissions, exact approvals or emergency-stop state",
      riskLevel: "high",
    };
  return {
    classes: capabilityClasses(name, definition),
    description:
      definition?.description ??
      "Unregistered capability; execution is denied.",
    risk: definition?.riskLevel ?? "unspecified",
    consequences:
      definition?.simulated || name.startsWith("mock.")
        ? "Produces a simulated result; no external effect."
        : definition?.mode === "observe"
          ? "Reads the selected source. Sensitive information may appear in the result and audit context."
          : definition?.mode === "recommend"
            ? "Analyzes selected context and returns a recommendation; model usage may incur cost."
            : definition?.mode === "draft"
              ? "Prepares or stores a draft. This does not authorize sending or external execution."
              : "May change the selected records or external system. Review the exact inputs and domain-specific preview below before approving.",
    reversibility:
      definition?.simulated || name.startsWith("mock.")
        ? "Simulation only."
        : ["gmail.send", "phone.initiate"].includes(name)
          ? "Cannot undo delivery or contact already made."
          : definition?.mode === "observe" || definition?.mode === "recommend"
            ? "No requested state mutation to undo. Data disclosure and incurred costs cannot be reversed."
            : "Automatic undo is not guaranteed. A correcting action may require a separate approval.",
    mandatoryApproval: Boolean(definition?.alwaysRequiresApproval),
  };
}
