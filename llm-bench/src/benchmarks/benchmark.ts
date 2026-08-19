import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Benchmark, BenchmarkMeta, BenchmarkType } from "../core/benchmark";
import type { Task, CodingTask } from "../core/task";
import type { ModelResponse } from "../core/model";
import type { Score, EvaluationContext } from "../core/evaluator";
import { resolveEvaluator } from "../evaluators/registry";
import { computeDirectoryHash } from "./hash";

export class FilesystemBenchmark implements Benchmark {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: BenchmarkType;
  readonly description?: string;
  readonly benchmarkPath: string;
  readonly meta: BenchmarkMeta;

  constructor(benchmarkPath: string, meta: BenchmarkMeta) {
    this.benchmarkPath = resolve(benchmarkPath);
    this.id = meta.id;
    this.name = meta.name;
    this.version = meta.version;
    this.type = meta.type;
    this.description = meta.description;
    this.meta = meta;
  }

  async loadTasks(filterTaskIds?: string[]): Promise<Task[]> {
    const tasks: Task[] = [];
    const filterSet = filterTaskIds ? new Set(filterTaskIds) : null;

    // 1. Check if tasks are defined directly inside benchmark.json
    const metaTasks = (this.meta as any).tasks;
    if (Array.isArray(metaTasks) && metaTasks.length > 0) {
      for (const t of metaTasks) {
        if (!filterSet || filterSet.has(t.id)) {
          tasks.push(this.normalizeTask(t, this.benchmarkPath));
        }
      }
    }

    // 2. Check for tasks.json in benchmark directory
    const tasksJsonPath = join(this.benchmarkPath, "tasks.json");
    if (await Bun.file(tasksJsonPath).exists()) {
      try {
        const content = await Bun.file(tasksJsonPath).json();
        const jsonTasks = Array.isArray(content) ? content : content.tasks;
        if (Array.isArray(jsonTasks)) {
          for (const t of jsonTasks) {
            if (!filterSet || filterSet.has(t.id)) {
              tasks.push(this.normalizeTask(t, this.benchmarkPath));
            }
          }
        }
      } catch (e: any) {
        console.error(`Error loading ${tasksJsonPath}: ${e.message}`);
      }
    }

    // 3. Check for subdirectories (e.g. task-001/task.json, task-002/task.json)
    try {
      const entries = await readdir(this.benchmarkPath, { withFileTypes: true });
      // Sort entries for deterministic ordering
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const taskDir = join(this.benchmarkPath, entry.name);
          const taskJsonPath = join(taskDir, "task.json");

          if (await Bun.file(taskJsonPath).exists()) {
            try {
              const taskData = await Bun.file(taskJsonPath).json();
              if (!taskData.id) {
                taskData.id = entry.name;
              }

              if (!filterSet || filterSet.has(taskData.id)) {
                // If coding task, project folder is usually inside taskDir/project
                const projectSubdir = join(taskDir, "project");
                const hasProjectSubdir = await stat(projectSubdir).then(() => true).catch(() => false);
                if (hasProjectSubdir && !taskData.projectPath) {
                  taskData.projectPath = projectSubdir;
                }

                tasks.push(this.normalizeTask(taskData, taskDir));
              }
            } catch (e: any) {
              console.error(`Error loading task from ${taskJsonPath}: ${e.message}`);
            }
          }
        }
      }
    } catch {}

    // Deduplicate by task ID if duplicate entries exist
    const seen = new Set<string>();
    const uniqueTasks: Task[] = [];
    for (const task of tasks) {
      if (!seen.has(task.id)) {
        seen.add(task.id);
        uniqueTasks.push(task);
      }
    }

    return uniqueTasks;
  }

  private normalizeTask(rawTask: any, contextDir: string): Task {
    const task = { ...rawTask };

    // Default type from benchmark type if not specified
    if (!task.type) {
      task.type = this.type;
    }

    // If it's a coding task, ensure projectPath is resolved
    if (task.type === "coding") {
      const codingTask = task as CodingTask;
      if (codingTask.projectPath) {
        codingTask.projectPath = resolve(contextDir, codingTask.projectPath);
      } else {
        codingTask.projectPath = resolve(contextDir, "project");
      }
    }

    return task;
  }

  async evaluate(task: Task, response: ModelResponse, context?: EvaluationContext): Promise<Score> {
    const evaluator = resolveEvaluator(task, this.meta.evaluator);
    return evaluator.evaluate(task, response, context);
  }

  async computeDatasetHash(): Promise<string> {
    return computeDirectoryHash(this.benchmarkPath);
  }
}
