export interface TaskRetry {
  attempt: number;
  error: string;
  retryAfterMs?: number;
  timestamp: string;
}

export interface TaskResult {
  id: string;
  runId: string;
  taskId: string;
  modelId: string;

  passed: boolean;
  score: number;
  details?: Record<string, unknown>;

  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;

  latencyMs: number;
  timeToFirstTokenMs?: number;
  costUsd: number;

  response: string;
  error?: string;
  retries?: TaskRetry[];

  createdAt: string;
}

export interface RunSummary {
  runId: string;
  benchmarkId: string;
  benchmarkVersion: string;
  datasetHash: string;
  modelId: string;

  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  accuracy: number; // 0.0 to 1.0 (pass rate)
  averageScore: number;

  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;

  averageLatencyMs: number;
  totalDurationMs: number;

  errorRate: number;
  retryCount: number;

  codingMetrics?: {
    totalTests?: number;
    testsPassed?: number;
    testsFailed?: number;
    buildSuccessRate?: number;
  };
}

export interface Run {
  id: string;
  benchmarkId: string;
  benchmarkVersion: string;
  datasetHash: string;

  modelId: string;
  modelConfig: Record<string, unknown>;

  options: {
    temperature?: number;
    maxTokens?: number;
    concurrency?: number;
    filterTasks?: string[];
  };

  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed" | "cancelled";

  results: TaskResult[];
  summary?: RunSummary;
  error?: string;
}

export function computeRunSummary(
  run: Pick<Run, "id" | "benchmarkId" | "benchmarkVersion" | "datasetHash" | "modelId" | "startedAt" | "finishedAt">,
  results: TaskResult[]
): RunSummary {
  const totalTasks = results.length;
  const passedTasks = results.filter((r) => r.passed).length;
  const failedTasks = totalTasks - passedTasks;
  const accuracy = totalTasks > 0 ? passedTasks / totalTasks : 0;
  const totalScore = results.reduce((acc, r) => acc + r.score, 0);
  const averageScore = totalTasks > 0 ? totalScore / totalTasks : 0;

  const totalInputTokens = results.reduce((acc, r) => acc + r.inputTokens, 0);
  const totalOutputTokens = results.reduce((acc, r) => acc + r.outputTokens, 0);
  const totalCachedTokens = results.reduce((acc, r) => acc + (r.cachedTokens ?? 0), 0);
  const totalCostUsd = Number(results.reduce((acc, r) => acc + r.costUsd, 0).toFixed(6));

  const totalLatency = results.reduce((acc, r) => acc + r.latencyMs, 0);
  const averageLatencyMs = totalTasks > 0 ? Math.round(totalLatency / totalTasks) : 0;

  const started = new Date(run.startedAt).getTime();
  const finished = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const totalDurationMs = Math.max(0, finished - started);

  const errors = results.filter((r) => r.error !== undefined && r.error !== "").length;
  const errorRate = totalTasks > 0 ? errors / totalTasks : 0;
  const retryCount = results.reduce((acc, r) => acc + (r.retries?.length ?? 0), 0);

  // Check for coding metrics
  let totalTests = 0;
  let testsPassed = 0;
  let testsFailed = 0;
  let hasCodingDetails = false;

  for (const r of results) {
    if (r.details && typeof r.details === "object") {
      const details = r.details as Record<string, unknown>;
      if (typeof details.total === "number" && typeof details.passed === "number") {
        hasCodingDetails = true;
        totalTests += details.total;
        testsPassed += details.passed;
        if (typeof details.failed === "number") {
          testsFailed += details.failed;
        }
      }
    }
  }

  const summary: RunSummary = {
    runId: run.id,
    benchmarkId: run.benchmarkId,
    benchmarkVersion: run.benchmarkVersion,
    datasetHash: run.datasetHash,
    modelId: run.modelId,
    totalTasks,
    passedTasks,
    failedTasks,
    accuracy,
    averageScore,
    totalInputTokens,
    totalOutputTokens,
    totalCachedTokens,
    totalCostUsd,
    averageLatencyMs,
    totalDurationMs,
    errorRate,
    retryCount,
  };

  if (hasCodingDetails) {
    summary.codingMetrics = {
      totalTests,
      testsPassed,
      testsFailed,
    };
  }

  return summary;
}
