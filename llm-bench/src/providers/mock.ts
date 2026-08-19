import type {
  Model,
  ModelConfig,
  ModelEvent,
  ModelRequest,
  ModelResponse,
  ModelUsage,
} from "../core/model";
import type { Provider } from "../core/provider";

export type MockResponseFn = (request: ModelRequest) => string | Partial<ModelResponse>;

export class MockModel implements Model {
  readonly id: string;
  readonly config: ModelConfig;
  private responseHandler?: MockResponseFn | string;
  private failureRate: number = 0;
  private simulateLatencyMs: number = 10;

  constructor(config: ModelConfig, handler?: MockResponseFn | string) {
    this.id = config.id;
    this.config = config;
    this.responseHandler = handler ?? (config.options?.defaultResponse as any);
    this.failureRate = (config.options?.failureRate as number) ?? 0;
    this.simulateLatencyMs = (config.options?.latencyMs as number) ?? 10;
  }

  setResponse(handler: MockResponseFn | string) {
    this.responseHandler = handler;
  }

  setFailureRate(rate: number) {
    this.failureRate = rate;
  }

  setLatency(ms: number) {
    this.simulateLatencyMs = ms;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const startTime = performance.now();

    if (this.simulateLatencyMs > 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, this.simulateLatencyMs);
      await promise;
    }

    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      const error = new Error(`Simulated mock failure for ${this.id}`);
      (error as any).status = 500;
      throw error;
    }

    let responseText = "Mock response";
    let partialUsage: Partial<ModelUsage> = {};

    if (typeof this.responseHandler === "function") {
      const res = this.responseHandler(request);
      if (typeof res === "string") {
        responseText = res;
      } else {
        responseText = res.text ?? responseText;
        if (res.usage) partialUsage = res.usage;
      }
    } else if (typeof this.responseHandler === "string") {
      responseText = this.responseHandler;
    } else {
      // Default: echo back prompt or smart mock response
      const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
      responseText = lastUserMsg?.content ?? "Mock response";
    }

    const inputChars = request.messages.reduce((acc, m) => acc + m.content.length, 0);
    const outputChars = responseText.length;
    const inputTokens = partialUsage.inputTokens ?? Math.ceil(inputChars / 4);
    const outputTokens = partialUsage.outputTokens ?? Math.ceil(outputChars / 4);

    const latencyMs = Math.round(performance.now() - startTime);

    return {
      text: responseText,
      usage: {
        inputTokens,
        outputTokens,
      },
      timing: {
        latencyMs,
        totalDurationMs: latencyMs,
      },
      finishReason: "stop",
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const res = await this.generate(request);
    const words = res.text.split(" ");

    for (let i = 0; i < words.length; i++) {
      yield {
        type: "token",
        token: (i > 0 ? " " : "") + words[i],
      };
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 5);
      await promise;
    }

    yield {
      type: "done",
      usage: res.usage,
      timing: res.timing,
    };
  }
}

export class MockProvider implements Provider {
  readonly id = "mock";

  createModel(config: ModelConfig): Model {
    return new MockModel(config);
  }
}
