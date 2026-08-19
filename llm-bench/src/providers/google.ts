import type {
  Model,
  ModelConfig,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from "../core/model";
import type { Provider } from "../core/provider";

export class GoogleModel implements Model {
  readonly id: string;
  readonly config: ModelConfig;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ModelConfig) {
    this.id = config.id;
    this.config = config;
    this.baseUrl = (
      config.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = performance.now();
    const endpoint = `${this.baseUrl}/models/${this.config.model}:generateContent?key=${this.apiKey}`;

    let systemInstruction: { parts: Array<{ text: string }> } | undefined = undefined;
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemInstruction = {
          parts: [{ text: msg.content }],
        };
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: Record<string, unknown> = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
        ...(request.stop ? { stopSequences: request.stop } : {}),
      },
      ...this.config.options,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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

      const error = new Error(`Google Gemini error (${response.status}): ${errorMessage}`);
      (error as any).status = response.status;
      throw error;
    }

    let data: Record<string, unknown> | null = null;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Google Gemini returned invalid JSON: ${msg}`);
    }

    if (!data || typeof data !== "object") {
      throw new Error("Google Gemini returned empty or invalid response object");
    }

    const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> | undefined;
    const candidate = candidates?.[0];
    let text = "";
    if (Array.isArray(candidate?.content?.parts)) {
      for (const part of candidate.content.parts) {
        if (typeof part?.text === "string") {
          text += part.text;
        }
      }
    }

    const usageMetadata = data.usageMetadata as Record<string, unknown> | undefined;
    const usage: ModelUsage = {
      inputTokens: (usageMetadata?.promptTokenCount as number) ?? 0,
      outputTokens: (usageMetadata?.candidatesTokenCount as number) ?? 0,
      cachedInputTokens: (usageMetadata?.cachedContentTokenCount as number) ?? undefined,
    };

    return {
      text,
      usage,
      timing: {
        latencyMs,
        totalDurationMs: latencyMs,
      },
      finishReason: candidate?.finishReason ?? undefined,
      raw: data,
    };
  }
}

export class GoogleProvider implements Provider {
  readonly id = "google";

  createModel(config: ModelConfig): Model {
    return new GoogleModel(config);
  }
}
