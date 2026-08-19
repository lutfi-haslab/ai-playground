export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  responseFormat?: {
    type: "text" | "json_object" | "json_schema";
    schema?: Record<string, unknown>;
  };
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface ModelTiming {
  latencyMs: number;
  timeToFirstTokenMs?: number;
  totalDurationMs?: number;
}

export interface ModelResponse {
  text: string;
  usage: ModelUsage;
  timing: ModelTiming;
  finishReason?: string;
  raw?: unknown;
}

export interface ModelEvent {
  type: "token" | "done" | "error";
  token?: string;
  usage?: ModelUsage;
  timing?: ModelTiming;
  error?: string;
}

export interface ModelPricing {
  input?: number;
  output?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface ModelConfig {
  id: string;
  provider: string;
  model: string;
  enabled?: boolean;
  disabled?: boolean;
  pricing?: ModelPricing;
  contextWindow?: number;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
}

export function isModelEnabled(config: ModelConfig): boolean {
  if (config.disabled === true) return false;
  if (config.enabled === false) return false;
  return true;
}
export interface Model {
  readonly id: string;
  readonly config: ModelConfig;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream?(request: ModelRequest): AsyncIterable<ModelEvent>;
}
