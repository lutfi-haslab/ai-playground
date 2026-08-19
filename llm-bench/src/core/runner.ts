import { randomBytes } from "node:crypto";
import type { Benchmark } from "./benchmark";
import type { Score } from "./evaluator";
import type { Model, ModelRequest, ModelResponse } from "./model";
import type { Task, CodingTask } from "./task";
import { isCodingTask } from "./task";
import type { Run, TaskResult, TaskRetry } from "./result";
import { computeRunSummary } from "./result";
import { calculateCost } from "./cost";
import { createTemporaryWorkspace, cleanupWorkspace } from "./workspace";
import { buildCodingPrompt, extractFileChanges, applyFileChanges } from "./coding";
import { appendOrUpdateRunInFile } from "../storage/filestore";

export interface RunnerOptions {
  concurrency?: number;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  taskIds?: string[];
  keepWorkspaces?: boolean;
  judgeModel?: Model;
  jsonReportPath?: string;
  onStreamUpdate?: (run: Run) => Promise<void> | void;

  // Event callbacks
  onRunStart?: (run: Run, totalTasks: number) => void;
  onTaskStart?: (task: Task, index: number, total: number) => void;
  onTaskComplete?: (result: TaskResult, index: number, total: number) => void;
  onRunComplete?: (run: Run) => void;
}

export function generateRunId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const rand = randomBytes(2).toString("hex");

  return `run_${year}${month}${day}_${hours}${minutes}${seconds}_${rand}`;
}

export class BenchmarkRunner {
  constructor() {}

  async run(benchmark: Benchmark, model: Model, options?: RunnerOptions): Promise<Run> {
    const runId = generateRunId();
    const tasks = await benchmark.loadTasks(options?.taskIds);
    const datasetHash = await benchmark.computeDatasetHash();
    const startedAt = new Date().toISOString();

    const run: Run = {
      id: runId,
      benchmarkId: benchmark.id,
      benchmarkVersion: benchmark.version,
      datasetHash,
      modelId: model.id,
      modelConfig: model.config as any,
      options: {
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        concurrency: options?.concurrency ?? 1,
        filterTasks: options?.taskIds,
      },
      startedAt,
      status: "running",
      results: [],
    };

    if (options?.jsonReportPath) {
      await appendOrUpdateRunInFile(options.jsonReportPath, run);
    }
    if (options?.onStreamUpdate) {
      await options.onStreamUpdate(run);
    }

    if (options?.onRunStart) {
      options.onRunStart(run, tasks.length);
    }

    const concurrency = Math.max(1, options?.concurrency ?? 1);
    const maxRetries = options?.maxRetries ?? 2;
    const results: TaskResult[] = [];
    let completedCount = 0;

    // Run tasks with controlled concurrency
    const queue = tasks.map((task, index) => ({ task, index }));
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        const { task, index } = item;
        if (options?.onTaskStart) {
          options.onTaskStart(task, index + 1, tasks.length);
        }

        const taskResult = await this.executeTask(
          runId,
          benchmark,
          task,
          model,
          maxRetries,
          options
        );

        results.push(taskResult);
        completedCount++;

        // Stream progress to file store
        run.results = [...results];
        run.summary = computeRunSummary(run, results);
        if (options?.jsonReportPath) {
          await appendOrUpdateRunInFile(options.jsonReportPath, run);
        }
        if (options?.onStreamUpdate) {
          await options.onStreamUpdate(run);
        }

        if (options?.onTaskComplete) {
          options.onTaskComplete(taskResult, completedCount, tasks.length);
        }
      }
    });

    await Promise.all(workers);

    // Sort results by task ID for deterministic output
    results.sort((a, b) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true }));

    const finishedAt = new Date().toISOString();
    run.finishedAt = finishedAt;
    run.status = "completed";
    run.results = results;
    run.summary = computeRunSummary(run, results);

    if (options?.jsonReportPath) {
      await appendOrUpdateRunInFile(options.jsonReportPath, run);
    }
    if (options?.onStreamUpdate) {
      await options.onStreamUpdate(run);
    }

    if (options?.onRunComplete) {
      options.onRunComplete(run);
    }

    return run;
  }

  async runMultiple(
    benchmark: Benchmark,
    models: Model[],
    options?: RunnerOptions
  ): Promise<Run[]> {
    const runs: Run[] = [];

    for (const model of models) {
      const run = await this.run(benchmark, model, options);
      runs.push(run);
    }

    return runs;
  }

  private async executeTask(
    runId: string,
    benchmark: Benchmark,
    task: Task,
    model: Model,
    maxRetries: number,
    options?: RunnerOptions
  ): Promise<TaskResult> {
    const resultId = `res_${randomBytes(6).toString("hex")}`;
    const retries: TaskRetry[] = [];
    const createdAt = new Date().toISOString();

    let modelResponse: ModelResponse | null = null;
    let modelError: string | undefined = undefined;
    let attempts = 0;

    // Prepare prompt
    let promptContent = task.prompt;
    if (isCodingTask(task)) {
      try {
        promptContent = await buildCodingPrompt(task);
      } catch (e: any) {
        promptContent = `${task.prompt}\n(Failed to load project context: ${e.message})`;
      }
    }

    const messages: ModelRequest["messages"] = [];
    if (task.systemPrompt) {
      messages.push({ role: "system", content: task.systemPrompt });
    }
    messages.push({ role: "user", content: promptContent });

    const request: ModelRequest = {
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    };

    // Retry loop
    while (attempts <= maxRetries) {
      attempts++;
      try {
        modelResponse = await model.generate(request);
        break;
      } catch (e: any) {
        const errorMsg = e.message || String(e);
        const retryAfterMs = e.retryAfterMs ?? Math.min(1000 * Math.pow(2, attempts - 1), 10000);

        retries.push({
          attempt: attempts,
          error: errorMsg,
          retryAfterMs,
          timestamp: new Date().toISOString(),
        });

        if (attempts <= maxRetries) {
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, retryAfterMs);
          await promise;
        } else {
          modelError = errorMsg;
        }
      }
    }

    // Fallback if model completely failed
    if (!modelResponse) {
      return {
        id: resultId,
        runId,
        taskId: task.id,
        modelId: model.id,
        passed: false,
        score: 0,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        costUsd: 0,
        response: "",
        error: modelError ?? "Model failed without response",
        retries: retries.length > 0 ? retries : undefined,
        createdAt,
      };
    }

    // Evaluate response
    let workspacePath: string | undefined = undefined;
    let score: Score = { value: 0, passed: false };

    try {
      if (isCodingTask(task)) {
        // 1. Create temporary workspace
        workspacePath = await createTemporaryWorkspace(task.projectPath, runId, task.id);

        // 2. Extract and apply file modifications
        const fileChanges = extractFileChanges(modelResponse.text);
        const appliedFiles = await applyFileChanges(workspacePath, fileChanges);

        // 3. Evaluate in temporary workspace
        score = await benchmark.evaluate(task, modelResponse, {
          task,
          response: modelResponse,
          workspacePath,
          modelConfig: model.config,
          judgeModel: options?.judgeModel,
        });

        if (score.details) {
          score.details.appliedFiles = appliedFiles;
        }
      } else {
        score = await benchmark.evaluate(task, modelResponse, {
          task,
          response: modelResponse,
          modelConfig: model.config,
          judgeModel: options?.judgeModel,
        });
      }
    } catch (e: any) {
      score = {
        value: 0,
        passed: false,
        details: { evaluationError: e.message },
        error: `Evaluation failed: ${e.message}`,
      };
    } finally {
      // Clean up workspace unless explicitly requested to keep
      if (workspacePath && !options?.keepWorkspaces) {
        await cleanupWorkspace(workspacePath);
      }
    }

    const costUsd = calculateCost(
      modelResponse.usage.inputTokens,
      modelResponse.usage.outputTokens,
      model.config.pricing
    );

    const details = {
      ...(score.details ?? {}),
      prompt: task.prompt,
      expected:
        (task as any).expected ??
        (task as any).pattern ??
        (task as any).schema ??
        (task as any).evaluation?.command,
      category: task.category,
      difficulty: task.difficulty,
      taskType: task.type,
    };

    return {
      id: resultId,
      runId,
      taskId: task.id,
      modelId: model.id,
      passed: score.passed,
      score: score.value,
      details,
      inputTokens: modelResponse.usage.inputTokens,
      outputTokens: modelResponse.usage.outputTokens,
      cachedTokens: modelResponse.usage.cachedInputTokens,
      latencyMs: modelResponse.timing.latencyMs,
      timeToFirstTokenMs: modelResponse.timing.timeToFirstTokenMs,
      costUsd,
      response: modelResponse.text,
      error: score.error,
      retries: retries.length > 0 ? retries : undefined,
      createdAt,
    };
  }
}
