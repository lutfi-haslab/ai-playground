import { loadAllRunsFromReports } from "../storage/filestore";

export interface ResultCommandOptions {
  taskId?: string;
  reportsDir?: string;
}

export async function resultCommand(runId: string, options?: ResultCommandOptions): Promise<void> {
  const reportsDir = options?.reportsDir ?? "./reports";
  const allRuns = await loadAllRunsFromReports(reportsDir);
  const run = allRuns.find((r) => r.id === runId || r.id.startsWith(runId));

  if (!run) {
    console.log(`Run '${runId}' not found in reports.`);
    return;
  }

  if (options?.taskId) {
    const result = run.results.find((r) => r.taskId === options.taskId);
    if (!result) {
      console.log(`Task '${options.taskId}' not found in run '${runId}'.`);
      return;
    }

    console.log("\nTask Result Details:");
    console.log("────────────────────────────────────────────");
    console.log(`Task:     ${result.taskId}`);
    console.log(`Model:    ${result.modelId}`);
    console.log(`Run ID:   ${result.runId}`);
    console.log(`Result:   ${result.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}`);
    console.log(`Score:    ${result.score.toFixed(2)}`);

    if (result.details) {
      const details = result.details as any;
      if (details.prompt) {
        console.log(`\nPrompt:\n  ${details.prompt}`);
      }
      if (details.expected) {
        console.log(`\nExpected:\n  ${typeof details.expected === "object" ? JSON.stringify(details.expected) : details.expected}`);
      }
      if (details.passed !== undefined && details.total !== undefined) {
        console.log("\nTests:");
        console.log(`  ✓ ${details.passed} passed`);
        console.log(`  ✗ ${details.failed ?? 0} failed`);
        console.log(`  Total: ${details.total}`);
      }

      if (details.appliedFiles && details.appliedFiles.length > 0) {
        console.log("\nModified Files:");
        for (const f of details.appliedFiles) {
          console.log(`  • ${f}`);
        }
      }
    }

    console.log("\nLatency:");
    console.log(`  ${(result.latencyMs / 1000).toFixed(2)}s`);

    console.log("\nTokens:");
    console.log(`  Input:  ${result.inputTokens.toLocaleString()}`);
    console.log(`  Output: ${result.outputTokens.toLocaleString()}`);
    if (result.cachedTokens) {
      console.log(`  Cached: ${result.cachedTokens.toLocaleString()}`);
    }

    console.log("\nCost:");
    console.log(`  $${result.costUsd.toFixed(6)}`);

    if (result.error) {
      console.log("\nError:");
      console.log(`  \x1b[31m${result.error}\x1b[0m`);
    }

    if (result.retries && result.retries.length > 0) {
      console.log(`\nRetries: ${result.retries.length} attempt(s)`);
      for (const r of result.retries) {
        console.log(`  Attempt ${r.attempt}: ${r.error} (waited ${r.retryAfterMs}ms)`);
      }
    }

    if (result.response) {
      console.log("\nResponse Text (Preview):");
      const preview = result.response.length > 500 ? result.response.slice(0, 500) + "\n...(truncated)" : result.response;
      console.log(`  ${preview.replace(/\n/g, "\n  ")}`);
    }

    console.log("────────────────────────────────────────────\n");
    return;
  }

  // If no taskId given, list all task results in this run
  console.log(`\nTask Results for run '${run.id}':`);
  console.log("─────────────────────────────────────────────────────────────────────────");
  console.log(
    `${"TASK ID".padEnd(20)} ${"STATUS".padEnd(10)} ${"SCORE".padEnd(8)} ${"COST".padEnd(12)} ${"LATENCY".padEnd(10)} TOKENS`
  );
  console.log("─────────────────────────────────────────────────────────────────────────");

  for (const r of run.results) {
    const status = r.passed ? "\x1b[32mPASS      \x1b[0m" : "\x1b[31mFAIL      \x1b[0m";
    const scoreStr = r.score.toFixed(2);
    const costStr = `$${r.costUsd.toFixed(4)}`;
    const latencyStr = `${(r.latencyMs / 1000).toFixed(2)}s`;
    const tokenStr = `${r.inputTokens}/${r.outputTokens}`;

    console.log(
      `${r.taskId.padEnd(20)} ${status} ${scoreStr.padEnd(8)} ${costStr.padEnd(12)} ${latencyStr.padEnd(10)} ${tokenStr}`
    );
  }

  console.log("─────────────────────────────────────────────────────────────────────────\n");
}
