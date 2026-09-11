import type { PermissionService } from "../../services/permission-service";
import { controlSchemas } from "../../domain/digital-control";
import type { BrowserControlProvider } from "../../domain/digital-control";
import type { ToolRegistry } from "../../domain/tool-registry";
import type { Json } from "../../domain/models";
import type { MacAccessibility } from "../control/mac-accessibility";
import type { ControlFiles } from "../control/files";
export function registerControlTools(
  registry: ToolRegistry,
  browser: BrowserControlProvider,
  computer: MacAccessibility,
  files: ControlFiles,
  guard: () => void,
  permissions: Pick<PermissionService, "resolve">,
) {
  const json = (value: unknown): Json => JSON.parse(JSON.stringify(value));
  registry.register("browser.open", {
    inputSchema: controlSchemas["browser.open"],
    preflight: () => browser.assertAvailable(),
    execute: async (i, c) => json(await browser.open(i.url, c.signal)),
  });
  registry.register("browser.inspect", {
    inputSchema: controlSchemas["browser.inspect"],
    preflight: () => browser.assertAvailable(),
    execute: async (i, c) =>
      json(await browser.inspect(i.session_id, c.signal)),
  });
  registry.register("browser.act", {
    inputSchema: controlSchemas["browser.act"],
    preflight: () => browser.assertAvailable(),
    execute: (i, c) => browser.act(i, c.signal),
  });
  registry.register("browser.close", {
    inputSchema: controlSchemas["browser.close"],
    preflight: guard,
    execute: (i) => browser.close(i.session_id),
  });
  registry.register("computer.inspect", {
    inputSchema: controlSchemas["computer.inspect"],
    preflight: () => computer.assertAvailable(),
    execute: async (i, c) => json(await computer.inspect(i.app_id, c.signal)),
  });
  registry.register("computer.act", {
    inputSchema: controlSchemas["computer.act"],
    preflight: () => computer.assertAvailable(),
    execute: (i, c) => computer.act(i, c.signal),
  });
  registry.register("computer.propose_visual", {
    inputSchema: controlSchemas["computer.propose_visual"],
    preflight: () => computer.assertAvailable(),
    execute: async (i, c) =>
      json(
        await computer.propose(
          i.snapshot_id,
          i.element_id,
          i.question,
          c.signal,
          {
            productIds: c.productIds,
            policyHash: (
              await permissions.resolve("perception.capture_window", {
                workspace: "ary-nexus",
                productIds: [...c.productIds],
              })
            ).policyHash,
          },
        ),
      ),
  });
  registry.register("computer.visual_click", {
    inputSchema: controlSchemas["computer.visual_click"],
    preflight: () => computer.assertAvailable(),
    execute: (i, c) =>
      computer.visualClick(i.proposal_id, i, c.signal, c.productIds),
  });
  registry.register("control.files", {
    inputSchema: controlSchemas["control.files"],
    preflight: guard,
    execute: async () => json(await files.list()),
  });
}
