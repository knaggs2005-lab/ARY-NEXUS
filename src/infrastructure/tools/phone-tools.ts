import { callInput, callReference, callCancel } from "../../domain/phone";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { PhoneService } from "../../services/phone-service";
/** PhoneTool: all provider effects remain behind the existing registry/action runner. */
export function registerPhoneTools(
  registry: ToolRegistry,
  phone: PhoneService,
) {
  return registry
    .register("phone.initiate", {
      inputSchema: callInput,
      preflight: () => phone.assertAvailable(),
      execute: (input, context) => phone.initiate(input, context),
    })
    .register("phone.reconcile", {
      inputSchema: callReference,
      preflight: () => phone.assertAvailable(),
      execute: (input) => phone.reconcileRejected(input.call_action_id),
    })
    .register("phone.refresh", {
      inputSchema: callReference,
      preflight: () => phone.assertAvailable(),
      execute: (input, context) => phone.refresh(input.call_action_id, context),
    })
    .register("phone.cancel", {
      inputSchema: callCancel,
      preflight: () => phone.assertAvailable(),
      execute: (input, context) =>
        phone.refresh(input.call_action_id, context, true),
    });
}
