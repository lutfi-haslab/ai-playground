#!/usr/bin/env bun
import { listCommand } from "./list";
import { modelsCommand } from "./models";
import { runCommand } from "./run";
import { reportCommand } from "./report";
import { resultCommand } from "./result";
import { compareCommand } from "./compare";
import { getDefaultReportPaths } from "../storage/filestore";

function printHelp(): void {
  console.log(`
LLM Benchmark & Evaluation Framework (Bun + TypeScript)

USAGE:
  bench <command> [options]

COMMANDS:
  list                          List all available benchmarks
  models                        List configured models in models.json
  run <benchmark-id>|--all      Run a benchmark (or all benchmarks) against enabled models
  report [run-id|all]           View summary report from recorded JSON reports
  html [run-id] [output.html]   Generate an interactive HTML benchmark report
  result <run-id>               Inspect per-task results
  compare <run-id-1> [run-id-2] Compare multiple benchmark runs side-by-side

OPTIONS for 'run':
  --all, -a                     Run all discovered benchmarks sequentially
  --model, -m <model-id>        Model(s) to benchmark (can specify multiple times)
  --task, -t <task-ids>         Comma-separated list of specific task IDs to run
  --concurrency, -c <number>    Concurrency limit for tasks (default: 1)
  --temperature <number>        Sampling temperature for model requests
  --max-tokens <number>         Max generation tokens
  --config <path>               Custom models config path (default: ./models.json)
  --benchmarks-dir <path>       Custom benchmarks folder (default: ./benchmarks)
  --reports-dir <path>          Custom reports folder (default: ./reports)
  --keep-workspaces             Keep temporary workspace directories for debugging
  --html <path>                 Custom HTML report destination
  --json <path>                 Custom JSON stream destination

EXAMPLES:
  bench list
  bench models
  bench run --all --concurrency 3
  bench run coding/typescript-v1 --model muse-spark-1.2-contributor
  bench html
  bench report
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    return;
  }

  const command = argv[0]?.toLowerCase();
  const rest = argv.slice(1);

  function getFlagValue(flags: string[], defaultValue?: string): string | undefined {
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      for (const flag of flags) {
        if (arg === flag && i + 1 < rest.length) {
          return rest[i + 1];
        }
        if (arg.startsWith(`${flag}=`)) {
          return arg.slice(flag.length + 1);
        }
      }
    }
    return defaultValue;
  }

  function getMultipleFlagValues(flags: string[]): string[] {
    const values: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!;
      for (const flag of flags) {
        if (arg === flag && i + 1 < rest.length) {
          values.push(rest[i + 1]!);
        } else if (arg.startsWith(`${flag}=`)) {
          values.push(arg.slice(flag.length + 1));
        }
      }
    }
    return values;
  }

  function hasFlag(flags: string[]): boolean {
    return rest.some((arg) => flags.includes(arg));
  }

  try {
    switch (command) {
      case "list": {
        const benchmarksDir = getFlagValue(["--benchmarks-dir", "-b"]);
        await listCommand({ benchmarksDir });
        break;
      }

      case "models": {
        const configPath = getFlagValue(["--config", "-c"]);
        await modelsCommand({ configPath });
        break;
      }

      case "run": {
        const isRunAll = hasFlag(["--all", "-a"]) || rest.includes("all");
        let benchmarkId = rest.find((arg) => !arg.startsWith("-"));
        if (isRunAll) {
          benchmarkId = "all";
        }
        if (!benchmarkId) {
          console.error("Error: Please specify a benchmark ID or use '--all'. Run 'bench list' to see available benchmarks.");
          process.exit(1);
        }

        const models = getMultipleFlagValues(["--model", "-m"]);
        const tasksRaw = getFlagValue(["--task", "-t"]);
        const tasks = tasksRaw ? tasksRaw.split(",").map((s) => s.trim()) : undefined;
        const concurrencyStr = getFlagValue(["--concurrency", "-c"]);
        const concurrency = concurrencyStr ? parseInt(concurrencyStr, 10) : undefined;
        const tempStr = getFlagValue(["--temperature"]);
        const temperature = tempStr ? parseFloat(tempStr) : undefined;
        const maxTokensStr = getFlagValue(["--max-tokens"]);
        const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : undefined;
        const configPath = getFlagValue(["--config"]);
        const benchmarksDir = getFlagValue(["--benchmarks-dir"]);
        const reportsDir = getFlagValue(["--reports-dir"]);
        const keepWorkspaces = hasFlag(["--keep-workspaces"]);
        const htmlPath = getFlagValue(["--html"]);
        const jsonPath = getFlagValue(["--json"]);

        await runCommand(benchmarkId, {
          models,
          tasks,
          concurrency,
          temperature,
          maxTokens,
          configPath,
          benchmarksDir,
          reportsDir,
          keepWorkspaces,
          htmlPath,
          jsonPath,
        });
        break;
      }

      case "report": {
        const runId = rest.find((arg) => !arg.startsWith("-")) ?? "all";
        const reportsDir = getFlagValue(["--reports-dir"]);
        const htmlPath = getFlagValue(["--html"]);
        await reportCommand(runId, { reportsDir, htmlPath });
        break;
      }

      case "html": {
        const positional = rest.filter((arg) => !arg.startsWith("-"));
        let runId = positional[0];
        let outputPath: string;

        const defaultPaths = getDefaultReportPaths();
        if (!runId || runId.endsWith(".html")) {
          outputPath = runId ?? getFlagValue(["--output", "-o"]) ?? defaultPaths.htmlPath;
          runId = "all";
        } else {
          outputPath = positional[1] ?? getFlagValue(["--output", "-o"]) ?? defaultPaths.htmlPath;
        }

        const reportsDir = getFlagValue(["--reports-dir"]);
        await reportCommand(runId, { reportsDir, htmlPath: outputPath });
        break;
      }

      case "result": {
        const runId = rest.find((arg) => !arg.startsWith("-"));
        if (!runId) {
          console.error("Error: Please specify a run ID.");
          process.exit(1);
        }
        const taskId = getFlagValue(["--task", "-t"]);
        const reportsDir = getFlagValue(["--reports-dir"]);
        await resultCommand(runId, { taskId, reportsDir });
        break;
      }

      case "compare": {
        const runIds = rest.filter((arg) => !arg.startsWith("-"));
        const reportsDir = getFlagValue(["--reports-dir"]);
        const benchmarkId = getFlagValue(["--benchmark", "-b"]);
        await compareCommand(runIds, { reportsDir, benchmarkId });
        break;
      }

      default:
        console.error(`Unknown command: '${command}'. Run 'bench --help' for usage.`);
        process.exit(1);
    }
  } catch (e: any) {
    console.error(`\nError: ${e.message}\n`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
