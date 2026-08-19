import { loadAllRunsFromReports } from "../storage/filestore";
import type { Run } from "../core/result";
import { formatReport } from "./report";

export interface CompareCommandOptions {
  reportsDir?: string;
  benchmarkId?: string;
}

export async function compareCommand(
  runIds: string[],
  options?: CompareCommandOptions
): Promise<void> {
  const reportsDir = options?.reportsDir ?? "./reports";
  const allRuns = await loadAllRunsFromReports(reportsDir);
  let runs: Run[] = [];

  if (runIds.length === 0) {
    const filtered = options?.benchmarkId
      ? allRuns.filter((r) => r.benchmarkId.toLowerCase() === options.benchmarkId!.toLowerCase())
      : allRuns;

    const seenModels = new Set<string>();
    for (const r of filtered) {
      if (!seenModels.has(r.modelId)) {
        seenModels.add(r.modelId);
        runs.push(r);
      }
    }
  } else {
    for (const id of runIds) {
      const match = allRuns.find((r) => r.id === id || r.id.startsWith(id));
      if (match) {
        runs.push(match);
      } else {
        console.warn(`Run '${id}' not found in reports.`);
      }
    }
  }

  if (runs.length === 0) {
    console.log("No valid runs found to compare.");
    return;
  }

  console.log(formatReport(runs));
}
