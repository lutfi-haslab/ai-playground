import type {
  Model,
  ModelConfig,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from "../core/model";
import type { Provider } from "../core/provider";

export class AnthropicModel implements Model {
  readonly id: string;
  readonly config: ModelConfig;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ModelConfig) {
    this.id = config.id;
    this.config = config;
    this.baseUrl = (
      config.baseUrl ??
      process.env.ANTHROPIC_BASE_URL ??
      "https://api.anthropic.com/v1"
    ).replace(/\/+$/, "");
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = performance.now();
    const endpoint = `${this.baseUrl}/messages`;

    // Separate system messages from user/assistant messages
    let systemPrompt: string | undefined = undefined;
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      } else {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop ? { stop_sequences: request.stop } : {}),
      ...this.config.options,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      ...this.config.headers,
    };

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

      const error = new Error(`Anthropic error (${response.status}): ${errorMessage}`);
      (error as any).status = response.status;
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        (error as any).retryAfterMs = parseInt(retryAfter, 10) * 1000 || 2000;
      }
      throw error;
    }

    const data = (await response.json()) as any;
    let text = "";
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
    }

    const usage: ModelUsage = {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cachedInputTokens: data.usage?.cache_read_input_tokens ?? undefined,
    };

    return {
      text,
      usage,
      timing: {
        latencyMs,
        totalDurationMs: latencyMs,
      },
      finishReason: data.stop_reason ?? undefined,
      raw: data,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const startTime = performance.now();
    const endpoint = `${this.baseUrl}/messages`;

    let systemPrompt: string | undefined = undefined;
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      } else {
        messages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: true,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stop ? { stop_sequences: request.stop } : {}),
      ...this.config.options,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      ...this.config.headers,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield {
        type: "error",
        error: `Anthropic stream error (${response.status}): ${errorText}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: "error", error: "No response body for Anthropic stream" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let firstTokenTime: number | undefined = undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const event = JSON.parse(trimmed.slice(6));
              if (event.type === "message_start") {
                inputTokens = event.message?.usage?.input_tokens ?? 0;
              } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                if (firstTokenTime === undefined) {
                  firstTokenTime = performance.now() - startTime;
                }
                yield {
                  type: "token",
                  token: event.delta.text,
                };
              } else if (event.type === "message_delta") {
                outputTokens = event.usage?.output_tokens ?? outputTokens;
              }
            } catch {}
          }
        }
      }

      const totalDurationMs = Math.round(performance.now() - startTime);
      yield {
        type: "done",
        usage: { inputTokens, outputTokens },
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

export class AnthropicProvider implements Provider {
  readonly id = "anthropic";

  createModel(config: ModelConfig): Model {
    return new AnthropicModel(config);
  }
}
