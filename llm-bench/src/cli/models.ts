import { resolve } from "node:path";
import type { ModelConfig } from "../core/model";
import { isModelEnabled } from "../core/model";

export interface ModelsCommandOptions {
  configPath?: string;
  onlyEnabled?: boolean;
}

export async function resolveModelsConfigPath(configPath: string = "./models.json"): Promise<string> {
  if (await Bun.file(configPath).exists()) return configPath;
  const inModule = resolve(import.meta.dir, "../../models.json");
  if (await Bun.file(inModule).exists()) return inModule;
  const inLlmBench = resolve("./llm-bench/models.json");
  if (await Bun.file(inLlmBench).exists()) return inLlmBench;
  return configPath;
}

export async function loadModelsConfig(configPath: string = "./models.json"): Promise<ModelConfig[]> {
  const resolvedPath = await resolveModelsConfigPath(configPath);
  if (!(await Bun.file(resolvedPath).exists())) {
    return [];
  }

  try {
    const data = await Bun.file(resolvedPath).json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.models)) return data.models;
  } catch (e: any) {
    console.error(`Error loading models config from ${resolvedPath}: ${e.message}`);
  }

  return [];
}

export async function loadEnabledModelsConfig(configPath: string = "./models.json"): Promise<ModelConfig[]> {
  const all = await loadModelsConfig(configPath);
  return all.filter(isModelEnabled);
}

export async function modelsCommand(options?: ModelsCommandOptions): Promise<void> {
  const configPath = options?.configPath ?? "./models.json";
  const models = await loadModelsConfig(configPath);

  if (models.length === 0) {
    console.log(`No models configured in '${configPath}'.`);
    console.log("Create a 'models.json' file with your model configurations.");
    return;
  }

  console.log("\nConfigured Models:");
  console.log("─────────────────────────────────────────────────────────────────────────────────────────────────────────────");
  console.log(
    `${"ID".padEnd(30)} ${"STATUS".padEnd(12)} ${"PROVIDER".padEnd(12)} ${"MODEL".padEnd(30)} ${"IN/OUT ($/1M)".padEnd(16)} CTX`
  );
  console.log("─────────────────────────────────────────────────────────────────────────────────────────────────────────────");

  for (const m of models) {
    if (options?.onlyEnabled && !isModelEnabled(m)) {
      continue;
    }

    const enabled = isModelEnabled(m);
    const statusStr = enabled ? "\x1b[32mENABLED \x1b[0m    " : "\x1b[90mDISABLED\x1b[0m    ";
    const inputPrice = m.pricing?.inputPricePerMillion ?? m.pricing?.input ?? 0;
    const outputPrice = m.pricing?.outputPricePerMillion ?? m.pricing?.output ?? 0;
    const pricingStr = `$${inputPrice}/$${outputPrice}`;
    const ctxStr = m.contextWindow ? `${Math.round(m.contextWindow / 1024)}k` : "-";

    console.log(
      `${m.id.padEnd(30)} ${statusStr} ${m.provider.padEnd(12)} ${m.model.padEnd(30)} ${pricingStr.padEnd(16)} ${ctxStr}`
    );
  }

  console.log("─────────────────────────────────────────────────────────────────────────────────────────────────────────────\n");
}
