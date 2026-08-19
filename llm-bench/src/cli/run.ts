import { mkdir } from "node:fs/promises";
import { getDefaultReportPaths, loadReportRunsFromFile } from "../storage/filestore";
import { loadBenchmark, listBenchmarks } from "../benchmarks/loader";
import { loadModelsConfig, loadEnabledModelsConfig } from "./models";
import { createModel } from "../providers/index";
import { BenchmarkRunner } from "../core/runner";
import type { Model, ModelConfig } from "../core/model";
import { isModelEnabled } from "../core/model";
import type { Run } from "../core/result";
import { formatReport } from "./report";
import { generateHtmlReport } from "./html";

export interface RunCommandOptions {
  models: string[];
  tasks?: string[];
  concurrency?: number;
  temperature?: number;
  maxTokens?: number;
  configPath?: string;
  benchmarksDir?: string;
  reportsDir?: string;
  keepWorkspaces?: boolean;
  htmlPath?: string;
  jsonPath?: string;
  appendHtml?: boolean;
}

export async function runCommand(
  benchmarkId: string,
  options: RunCommandOptions
): Promise<Run[]> {
  const baseDir = options.benchmarksDir ?? "./benchmarks";
  const reportsDir = options.reportsDir ?? "./reports";
  await mkdir(reportsDir, { recursive: true });

  const defaultPaths = getDefaultReportPaths(new Date(), reportsDir);
  const htmlPath = options.htmlPath ?? defaultPaths.htmlPath;
  const jsonPath = options.jsonPath ?? defaultPaths.jsonPath;
  const appendHtml = options.appendHtml ?? true;

  // 1. Determine benchmarks to run
  const isRunAll = benchmarkId === "all" || benchmarkId === "--all";
  let targetBenchmarks: Array<{ id: string; name?: string }> = [];

  if (isRunAll) {
    const discovered = await listBenchmarks(baseDir);
    targetBenchmarks = discovered.map((b) => ({ id: b.id, name: b.name }));
    if (targetBenchmarks.length === 0) {
      console.log(`No benchmarks found in '${baseDir}'.`);
      return [];
    }
    console.log(`\nRunning all ${targetBenchmarks.length} benchmarks: ${targetBenchmarks.map((b) => b.id).join(", ")}`);
  } else {
    targetBenchmarks = [{ id: benchmarkId }];
  }

  // 2. Load configured models
  const modelConfigs = await loadModelsConfig(options.configPath ?? "./models.json");
  const enabledConfigs = await loadEnabledModelsConfig(options.configPath ?? "./models.json");
  const modelInstances: Model[] = [];

  let requestedModelIds = options.models;

  if (!requestedModelIds || requestedModelIds.length === 0) {
    // Default to enabled models or fallback to mock-fast
    if (enabledConfigs.length > 0) {
      requestedModelIds = enabledConfigs.map((m) => m.id);
    } else {
      requestedModelIds = ["mock-fast"];
    }
  }

  for (const mId of requestedModelIds) {
    let config = modelConfigs.find((m) => m.id.toLowerCase() === mId.toLowerCase());

    if (config) {
      if (!isModelEnabled(config)) {
        throw new Error(
          `Model '${config.id}' is disabled in models.json. Please set "enabled": true or remove "disabled": true in models.json to run benchmarks with this model.`
        );
      }
    } else {
      if (mId.includes("/")) {
        const [provider, modelName] = mId.split("/", 2);
        config = {
          id: mId,
          provider: provider!,
          model: modelName!,
          enabled: true,
        };
      } else if (mId.startsWith("mock")) {
        config = {
          id: mId,
          provider: "mock",
          model: mId,
          enabled: true,
        };
      } else {
        config = {
          id: mId,
          provider: "compatible",
          model: mId,
          enabled: true,
        };
      }
    }

    const instance = createModel(config);
    modelInstances.push(instance);
  }

  console.log(`Models (${modelInstances.length}): ${modelInstances.map((m) => m.id).join(", ")}\n`);

  const runner = new BenchmarkRunner();
  const completedRuns: Run[] = [];

  // Run each benchmark
  for (const target of targetBenchmarks) {
    console.log(`\n===============================================================================`);
    console.log(`Loading benchmark '${target.id}'...`);
    console.log(`===============================================================================`);

    const benchmark = await loadBenchmark(target.id, baseDir);
    const tasks = await benchmark.loadTasks(isRunAll ? undefined : options.tasks);
    const datasetHash = await benchmark.computeDatasetHash();

    console.log(`Benchmark:    ${benchmark.name} (v${benchmark.version})`);
    console.log(`Dataset Hash: ${datasetHash}`);
    console.log(`Total Tasks:  ${tasks.length}`);

    if (tasks.length === 0) {
      console.log(`No tasks to run for benchmark '${target.id}'.`);
      continue;
    }

    for (const model of modelInstances) {
      console.log(`\n───────────────────────────────────────────────────────────────────────────────`);
      console.log(`[${benchmark.id}] Running model: ${model.id}`);
      console.log(`───────────────────────────────────────────────────────────────────────────────`);

      const run = await runner.run(benchmark, model, {
        concurrency: options.concurrency ?? 1,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        taskIds: isRunAll ? undefined : options.tasks,
        jsonReportPath: jsonPath,
        keepWorkspaces: options.keepWorkspaces,
        onStreamUpdate: async () => {
          try {
            const currentRuns = await loadReportRunsFromFile(jsonPath);
            const html = await generateHtmlReport(currentRuns, baseDir);
            await Bun.write(htmlPath, html);
          } catch {}
        },
        onTaskComplete: (result, completed, total) => {
          const status = result.passed
            ? `\x1b[32mPASS\x1b[0m (${(result.latencyMs / 1000).toFixed(2)}s, $${result.costUsd.toFixed(4)})`
            : `\x1b[31mFAIL\x1b[0m (${(result.latencyMs / 1000).toFixed(2)}s, score: ${result.score.toFixed(2)})`;
          console.log(`  [${completed}/${total}] ${result.taskId.padEnd(20)} ... ${status}`);
          if (result.error && !result.passed) {
            console.log(`    \x1b[33m└─ Error: ${result.error.slice(0, 80)}\x1b[0m`);
          }
        },
      });

      completedRuns.push(run);
      console.log(`Run completed: ${run.id}`);
    }
  }

  // Print comparison report across all executed models
  console.log(formatReport(completedRuns));

  if (htmlPath) {
    let runsForHtml = completedRuns;
    if (appendHtml) {
      const fileRuns = await loadReportRunsFromFile(jsonPath);
      runsForHtml = fileRuns.length > 0 ? fileRuns : completedRuns;
    }

    const html = await generateHtmlReport(runsForHtml, baseDir);
    await Bun.write(htmlPath, html);
    console.log(`\nHTML report: ${htmlPath} (${runsForHtml.length} total runs recorded)`);
    console.log(`JSON stream: ${jsonPath}`);
  }

  return completedRuns;
}
