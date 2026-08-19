import type { Model, ModelConfig } from "./model";

export interface Provider {
  readonly id: string;
  createModel(config: ModelConfig): Model;
}
