import type { Model, ModelConfig } from "../core/model";
import type { Provider } from "../core/provider";
import { OpenAICompatibleModel } from "./compatible";

export class OpenRouterModel extends OpenAICompatibleModel {
  constructor(config: ModelConfig) {
    super(config, {
      baseUrl: config.baseUrl ?? "https://openrouter.ai/api/v1",
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": "https://github.com/llm-bench/llm-bench",
        "X-Title": "LLM-Bench",
      },
    });
  }
}

export class OpenRouterProvider implements Provider {
  readonly id = "openrouter";

  createModel(config: ModelConfig): Model {
    return new OpenRouterModel(config);
  }
}
