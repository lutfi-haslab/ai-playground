import { test, expect, describe } from "bun:test";
import { MockModel, MockProvider } from "../src/providers/mock";
import { OpenAICompatibleModel } from "../src/providers/compatible";
import { ProviderRegistry, createModel } from "../src/providers/index";

describe("Providers", () => {
  describe("MockProvider & MockModel", () => {
    test("generates configurable responses and tracks tokens", async () => {
      const model = new MockModel(
        { id: "mock-1", provider: "mock", model: "m1" },
        "42"
      );

      const response = await model.generate({
        messages: [{ role: "user", content: "What is 6 * 7?" }],
      });

      expect(response.text).toBe("42");
      expect(response.usage.inputTokens).toBeGreaterThan(0);
      expect(response.usage.outputTokens).toBeGreaterThan(0);
      expect(response.timing.latencyMs).toBeGreaterThanOrEqual(0);
    });

    test("supports function-based dynamic mock handler", async () => {
      const model = new MockModel(
        { id: "mock-dyn", provider: "mock", model: "m2" },
        (req) => {
          const userMsg = req.messages[0]?.content ?? "";
          if (userMsg.includes("email")) return "valid@example.com";
          return "default";
        }
      );

      const res1 = await model.generate({ messages: [{ role: "user", content: "give me email" }] });
      expect(res1.text).toBe("valid@example.com");

      const res2 = await model.generate({ messages: [{ role: "user", content: "other" }] });
      expect(res2.text).toBe("default");
    });

    test("supports streaming tokens", async () => {
      const model = new MockModel(
        { id: "mock-stream", provider: "mock", model: "m3" },
        "hello beautiful world"
      );

      const tokens: string[] = [];
      for await (const event of model.stream({ messages: [{ role: "user", content: "hi" }] })) {
        if (event.type === "token" && event.token) {
          tokens.push(event.token);
        }
      }

      expect(tokens.join("")).toBe("hello beautiful world");
    });
  });

  describe("ProviderRegistry", () => {
    test("instantiates models from config", () => {
      const model = createModel({
        id: "test-mock",
        provider: "mock",
        model: "mock-model-v1",
      });

      expect(model.id).toBe("test-mock");
      expect(model.config.provider).toBe("mock");
    });

    test("falls back to compatible provider for unknown providers", () => {
      const model = createModel({
        id: "custom-gateway",
        provider: "custom-gateway",
        model: "llama-3",
        baseUrl: "http://localhost:8080/v1",
      });

      expect(model.id).toBe("custom-gateway");
    });
  });
});
