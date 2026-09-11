import {
  desktopSchemas,
  type DesktopVerb,
  type DesktopProvider,
} from "../../domain/desktop";
import type { ToolRegistry } from "../../domain/tool-registry";
export function registerDesktopTools(
  registry: ToolRegistry,
  provider: DesktopProvider,
) {
  for (const verb of Object.keys(desktopSchemas) as DesktopVerb[]) {
    registry.register<Record<string, unknown>>(`desktop.${verb}`, {
      inputSchema: desktopSchemas[verb],
      preflight: () => provider.assertAvailable(),
      execute: (input) => provider.execute(verb, input),
    });
  }
  return registry;
}
