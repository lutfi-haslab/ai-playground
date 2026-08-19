import type {
  Model,
  ModelConfig,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from "../core/model";
import type { Provider } from "../core/provider";

export interface OpenAICompatibleOptions {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
}

export class OpenAICompatibleModel implements Model {
  readonly id: string;
  readonly config: ModelConfig;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly customHeaders: Record<string, string>;

  constructor(config: ModelConfig, options?: OpenAICompatibleOptions) {
    this.id = config.id;
    this.config = config;
    this.baseUrl = (
      config.baseUrl ??
      options?.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1"
    ).replace(/\/+$/, "");
    const providerKey = config.provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const idKey = config.id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    this.apiKey =
      config.apiKey ??
      options?.apiKey ??
      process.env[`${providerKey}_API_KEY`] ??
      process.env[`${idKey}_API_KEY`] ??
      process.env.OPENAI_API_KEY ??
      process.env.API_KEY ??
      "";
    this.customHeaders = {
      ...options?.headers,
      ...config.headers,
    };
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = performance.now();
    const endpoint = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: request.messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop !== undefined ? { stop: request.stop } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      ...this.config.options,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.customHeaders,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {}

      const error = new Error(`Model ${this.id} error (${response.status}): ${errorMessage}`);
      (error as any).status = response.status;
      (error as any).headers = response.headers;
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        (error as any).retryAfterMs = parseInt(retryAfter, 10) * 1000 || 2000;
      }
      throw error;
    }

    let data: any = null;
    try {
      data = await response.json();
    } catch (e: any) {
      throw new Error(`Model ${this.id} returned invalid JSON: ${e.message}`);
    }

    if (!data || typeof data !== "object") {
      throw new Error(`Model ${this.id} returned empty or invalid response object`);
    }

    if (data.error) {
      const errMsg = typeof data.error === "string" ? data.error : data.error.message ?? JSON.stringify(data.error);
      throw new Error(`Model ${this.id} API error: ${errMsg}`);
    }

    const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
    const msg = choice?.message as Record<string, unknown> | undefined;
    let text = (typeof msg?.content === "string" ? msg.content : "") ?? "";
    if (!text.trim()) {
      if (typeof msg?.reasoning === "string" && msg.reasoning.trim()) {
        text = msg.reasoning;
      } else if (typeof msg?.reasoning_content === "string" && msg.reasoning_content.trim()) {
        text = msg.reasoning_content;
      }
    }
    const finishReason = (choice?.finish_reason as string) ?? undefined;
    const usage: ModelUsage = {
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      cachedInputTokens:
        data?.usage?.prompt_tokens_details?.cached_tokens ??
        data?.usage?.cached_tokens ??
        undefined,
    };
    return {
      text,
      usage,
      timing: {
        latencyMs,
        totalDurationMs: latencyMs,
      },
      finishReason,
      raw: data,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const startTime = performance.now();
    const endpoint = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop !== undefined ? { stop: request.stop } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      ...this.config.options,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.customHeaders,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) errorMessage = parsed.error.message;
      } catch {}
      yield {
        type: "error",
        error: `Model ${this.id} streaming error: ${errorMessage}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", error: "No response body received for stream" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let firstTokenTime: number | undefined = undefined;
    let accumulatedUsage: ModelUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") {
            continue;
          }
          if (trimmed.startsWith("data: ")) {
            try {
              const rawJson = trimmed.slice(6).trim();
              if (rawJson && rawJson !== "[DONE]") {
                const data = JSON.parse(rawJson);
                if (data && typeof data === "object") {
                  const delta = (data as Record<string, unknown>).choices as Array<{ delta?: { content?: string; reasoning?: string; reasoning_content?: string } }> | undefined;
                  const content = delta?.[0]?.delta?.content || delta?.[0]?.delta?.reasoning || delta?.[0]?.delta?.reasoning_content;
                  if (content) {
                    if (firstTokenTime === undefined) {
                      firstTokenTime = performance.now() - startTime;
                    }
                    yield {
                      type: "token",
                      token: content,
                    };
                  }

                  const usageData = (data as Record<string, unknown>).usage as Record<string, unknown> | undefined;
                  if (usageData) {
                    const details = usageData.prompt_tokens_details as Record<string, unknown> | undefined;
                    accumulatedUsage = {
                      inputTokens: (usageData.prompt_tokens as number) ?? accumulatedUsage.inputTokens,
                      outputTokens: (usageData.completion_tokens as number) ?? accumulatedUsage.outputTokens,
                      cachedInputTokens:
                        (details?.cached_tokens as number) ??
                        (usageData.cached_tokens as number) ??
                        accumulatedUsage.cachedInputTokens,
                    };
                  }
                }
              }
            } catch {}
          }
        }
      }

      const totalDurationMs = Math.round(performance.now() - startTime);
      yield {
        type: "done",
        usage: accumulatedUsage,
        timing: {
          latencyMs: totalDurationMs,
          timeToFirstTokenMs: firstTokenTime ? Math.round(firstTokenTime) : undefined,
          totalDurationMs,
        },
      };
    } finally {
      reader.releaseLock();
    }
  }
}

export class OpenAICompatibleProvider implements Provider {
  readonly id = "compatible";

  createModel(config: ModelConfig): Model {
    return new OpenAICompatibleModel(config);
  }
}
