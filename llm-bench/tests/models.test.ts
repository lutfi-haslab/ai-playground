import { test, expect, describe } from "bun:test";
import { isModelEnabled, type ModelConfig } from "../src/core/model";
import { loadEnabledModelsConfig, loadModelsConfig } from "../src/cli/models";
import { runCommand } from "../src/cli/run";

describe("Model Enable/Disable Status", () => {
  test("isModelEnabled returns expected boolean", () => {
    expect(isModelEnabled({ id: "m1", provider: "mock", model: "v1", enabled: true })).toBe(true);
    expect(isModelEnabled({ id: "m2", provider: "mock", model: "v1" })).toBe(true);
    expect(isModelEnabled({ id: "m3", provider: "mock", model: "v1", enabled: false })).toBe(false);
    expect(isModelEnabled({ id: "m4", provider: "mock", model: "v1", disabled: true })).toBe(false);
  });

  test("loadEnabledModelsConfig only returns enabled models", async () => {
    const all = await loadModelsConfig("./models.json");
    const enabled = await loadEnabledModelsConfig("./models.json");

    expect(all.length).toBeGreaterThan(enabled.length);
    expect(enabled.map((m) => m.id)).not.toContain("ollama-local");
    expect(enabled.map((m) => m.id)).toContain("muse-spark-1.2-contributor");
  });

  test("runCommand rejects disabled models with clear error", async () => {
    let errorCaught = false;
    try {
      await runCommand("math/v1", {
        models: ["ollama-local"],
        tasks: ["math-001"],
      });
    } catch (e: any) {
      errorCaught = true;
      expect(e.message).toContain("Model 'ollama-local' is disabled in models.json");
    }
    expect(errorCaught).toBe(true);
  });
});
