import { getDefaultReportPaths, loadReportRunsFromFile, loadAllRunsFromReports, findLatestReportFile } from "../storage/filestore";
import type { Run, RunSummary } from "../core/result";
import { computeRunSummary } from "../core/result";
import { generateHtmlReport } from "./html";

export interface ReportCommandOptions {
  reportsDir?: string;
  htmlPath?: string;
}

export function formatReport(runs: Run[]): string {
  if (runs.length === 0) return "No runs to report.";

  const first = runs[0]!;
  let output = "\nLLM Benchmark Report\n";
  output += "───────────────────────────────────────────────────────────────────────────────\n\n";
  output += `Benchmark:  ${first.benchmarkId} (v${first.benchmarkVersion})\n`;
  output += `Dataset:    ${first.datasetHash}\n`;
  output += `Total Runs: ${runs.length}\n\n`;

  output += `${"MODEL".padEnd(20)} ${"SCORE".padEnd(10)} ${"PASS".padEnd(10)} ${"COST".padEnd(12)} ${"LATENCY".padEnd(12)} ${"TOKENS (IN/OUT)"}\n`;
  output += "───────────────────────────────────────────────────────────────────────────────\n";

  let bestScoreModel = "";
  let bestScoreVal = -1;

  let bestCostModel = "";
  let bestCostVal = Infinity;

  let bestValueModel = "";
  let bestValueVal = -1;

  for (const run of runs) {
    const summary: RunSummary = run.summary ?? computeRunSummary(run, run.results);
    const scoreStr = (summary.averageScore ?? 0).toFixed(2);
    const passPercent = `${Math.round((summary.accuracy ?? 0) * 100)}%`;
    const costStr = `$${(summary.totalCostUsd ?? 0).toFixed(4)}`;
    const latencyStr = `${((summary.averageLatencyMs ?? 0) / 1000).toFixed(2)}s`;
    const inTokens = summary.totalInputTokens > 1000 ? `${(summary.totalInputTokens / 1000).toFixed(1)}k` : `${summary.totalInputTokens}`;
    const outTokens = summary.totalOutputTokens > 1000 ? `${(summary.totalOutputTokens / 1000).toFixed(1)}k` : `${summary.totalOutputTokens}`;
    const tokenStr = `${inTokens} / ${outTokens}`;

    output += `${run.modelId.padEnd(20)} ${scoreStr.padEnd(10)} ${passPercent.padEnd(10)} ${costStr.padEnd(12)} ${latencyStr.padEnd(12)} ${tokenStr}\n`;

    if (summary.averageScore > bestScoreVal) {
      bestScoreVal = summary.averageScore;
      bestScoreModel = run.modelId;
    }

    if (summary.totalCostUsd < bestCostVal && summary.accuracy > 0) {
      bestCostVal = summary.totalCostUsd;
      bestCostModel = run.modelId;
    }

    const valuePerDollar = summary.totalCostUsd > 0 ? summary.accuracy / summary.totalCostUsd : 0;
    if (valuePerDollar > bestValueVal) {
      bestValueVal = valuePerDollar;
      bestValueModel = run.modelId;
    }
  }

  output += "───────────────────────────────────────────────────────────────────────────────\n\n";

  if (bestScoreModel) {
    output += `Best Score:     ${bestScoreModel} (${(bestScoreVal * 100).toFixed(1)}%)\n`;
  }
  if (bestCostModel) {
    output += `Best Cost:      ${bestCostModel} ($${bestCostVal.toFixed(4)})\n`;
  }
  if (bestValueModel && bestValueVal > 0) {
    output += `Best Value:     ${bestValueModel} (${bestValueVal.toFixed(1)} accuracy/$)\n`;
  }

  return output;
}

export async function reportCommand(runIdOrPattern: string = "all", options?: ReportCommandOptions): Promise<void> {
  const reportsDir = options?.reportsDir ?? "./reports";
  let runs: Run[] = [];

  if (runIdOrPattern.endsWith(".json")) {
    runs = await loadReportRunsFromFile(runIdOrPattern);
  } else if (runIdOrPattern === "all" || runIdOrPattern === "--all") {
    runs = await loadAllRunsFromReports(reportsDir);
    if (runs.length === 0) {
      const latestFile = await findLatestReportFile(reportsDir);
      if (latestFile) runs = await loadReportRunsFromFile(latestFile);
    }
  } else {
    // Search across reports for matching runId or benchmarkId
    const all = await loadAllRunsFromReports(reportsDir);
    runs = all.filter(
      (r) =>
        r.id.startsWith(runIdOrPattern) ||
        r.benchmarkId.toLowerCase() === runIdOrPattern.toLowerCase()
    );
  }

  if (runs.length === 0) {
    console.log(`No runs found matching '${runIdOrPattern}' in '${reportsDir}'.`);
    return;
  }

  console.log(formatReport(runs));

  if (options?.htmlPath) {
    const html = await generateHtmlReport(runs);
    await Bun.write(options.htmlPath, html);
    console.log(`\nHTML report saved to: ${options.htmlPath}`);
  }
}
