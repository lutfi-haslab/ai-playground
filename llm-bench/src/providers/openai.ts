import type { Model, ModelConfig } from "../core/model";
import type { Provider } from "../core/provider";
import { OpenAICompatibleModel } from "./compatible";

export class OpenAIModel extends OpenAICompatibleModel {
  constructor(config: ModelConfig) {
    super(config, {
      baseUrl: config.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
    });
  }
}

export class OpenAIProvider implements Provider {
  readonly id = "openai";

  createModel(config: ModelConfig): Model {
    return new OpenAIModel(config);
  }
}
