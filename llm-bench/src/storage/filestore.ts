import { dirname, resolve, join } from "node:path";
import { mkdir, readdir, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { Run } from "../core/result";

// Per-file mutex to serialize read-modify-write cycles
const fileLocks = new Map<string, Promise<void>>();

function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const resolved = resolve(path);
  const prev = fileLocks.get(resolved) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  fileLocks.set(resolved, next.then(() => {}, () => {}));
  return next;
}

export function getDateTimePrefix(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}_${hh}-${mm}-${ss}`;
}

export function getDefaultReportPaths(date: Date = new Date(), baseDir: string = "./reports"): {
  datePrefix: string;
  htmlPath: string;
  jsonPath: string;
} {
  const datePrefix = getDateTimePrefix(date);
  const resolvedDir = resolve(baseDir);
  return {
    datePrefix,
    htmlPath: join(resolvedDir, `${datePrefix}_report.html`),
    jsonPath: join(resolvedDir, `${datePrefix}_report.json`),
  };
}

export async function loadReportRunsFromFile(jsonPath: string): Promise<Run[]> {
  const file = Bun.file(jsonPath);
  if (!(await file.exists())) {
    return [];
  }

  // Retry once on parse failure — handles transient partial-write reads
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.runs)) return data.runs;
      return [];
    } catch {
      if (attempt === 0) {
        const { promise, resolve: wake } = Promise.withResolvers<void>();
        setTimeout(wake, 50);
        await promise;
        continue;
      }
    }
  }

  return [];
}

export async function saveReportRunsToFile(jsonPath: string, runs: Run[]): Promise<void> {
  const dir = dirname(jsonPath);
  if (dir && dir !== ".") {
    await mkdir(dir, { recursive: true });
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    totalRuns: runs.length,
    isCompleted: runs.every((r) => r.status === "completed" || r.status === "failed"),
    runs,
  };

  // Atomic write: temp file → rename
  const tmpPath = `${jsonPath}.${randomBytes(4).toString("hex")}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(payload, null, 2));
  await rename(tmpPath, jsonPath);
}

export async function appendOrUpdateRunInFile(jsonPath: string, run: Run): Promise<Run[]> {
  return withFileLock(jsonPath, async () => {
    const existingRuns = await loadReportRunsFromFile(jsonPath);
    const index = existingRuns.findIndex((r) => r.id === run.id);

    if (index >= 0) {
      existingRuns[index] = run;
    } else {
      existingRuns.push(run);
    }

    await saveReportRunsToFile(jsonPath, existingRuns);
    return existingRuns;
  });
}

export async function listAllReportFiles(reportsDir: string = "./reports"): Promise<string[]> {
  const resolved = resolve(reportsDir);
  try {
    const entries = await readdir(resolved, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith("_report.json"))
      .map((e) => join(resolved, e.name))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

export async function findLatestReportFile(reportsDir: string = "./reports"): Promise<string | null> {
  const files = await listAllReportFiles(reportsDir);
  return files[0] ?? null;
}

export async function loadAllRunsFromReports(reportsDir: string = "./reports"): Promise<Run[]> {
  const files = await listAllReportFiles(reportsDir);
  const allRuns: Run[] = [];
  const seenIds = new Set<string>();

  for (const f of files) {
    const runs = await loadReportRunsFromFile(f);
    for (const r of runs) {
      if (!seenIds.has(r.id)) {
        seenIds.add(r.id);
        allRuns.push(r);
      }
    }
  }

  return allRuns;
}
