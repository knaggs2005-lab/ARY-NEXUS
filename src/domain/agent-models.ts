import type { LanguageModelProvider } from "./providers";
import { AppError } from "./validation";
/** Server composition supplies the allowlist. No client base URLs, API keys or arbitrary provider constructors. */
export class AgentModelRegistry {
  constructor(
    private readonly models: ReadonlyMap<string, LanguageModelProvider>,
  ) {}
  list() {
    return [...this.models].map(([id, provider]) => ({
      id,
      model: provider.name,
      usage_reporting: !!provider.reasonWithUsage,
    }));
  }
  resolve(id: string) {
    const provider = this.models.get(id);
    if (!provider)
      throw new AppError("Agent model is not enabled on this server", 400);
    return provider;
  }
}
