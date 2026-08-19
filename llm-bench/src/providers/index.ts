import type { Model, ModelConfig } from "../core/model";
import type { Provider } from "../core/provider";
import { OpenAICompatibleProvider } from "./compatible";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { OpenRouterProvider } from "./openrouter";
import { MockProvider } from "./mock";

export * from "./compatible";
export * from "./openai";
export * from "./anthropic";
export * from "./google";
export * from "./openrouter";
export * from "./mock";

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers = new Map<string, Provider>();

  constructor() {
    this.register(new OpenAICompatibleProvider());
    this.register(new OpenAIProvider());
    this.register(new AnthropicProvider());
    this.register(new GoogleProvider());
    this.register(new OpenRouterProvider());
    this.register(new MockProvider());
  }

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  register(provider: Provider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  get(providerId: string): Provider | undefined {
    return this.providers.get(providerId.toLowerCase());
  }

  createModel(config: ModelConfig): Model {
    const provider = this.get(config.provider);
    if (!provider) {
      // Fallback to OpenAI-compatible provider if unknown provider specified
      const compatible = this.get("compatible")!;
      return compatible.createModel(config);
    }
    return provider.createModel(config);
  }
}

export function createModel(config: ModelConfig): Model {
  return ProviderRegistry.getInstance().createModel(config);
}
