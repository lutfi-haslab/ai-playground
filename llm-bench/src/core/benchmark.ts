import type { Task } from "./task";
import type { ModelResponse } from "./model";
import type { Score, EvaluationContext } from "./evaluator";

export type BenchmarkType =
  | "coding"
  | "reasoning"
  | "math"
  | "instruction"
  | "structured"
  | "classification"
  | "generation";

export interface BenchmarkMeta {
  id: string;
  name: string;
  version: string;
  type: BenchmarkType;
  description?: string;
  evaluator?: string;
  author?: string;
  tags?: string[];
}

export interface Benchmark {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: BenchmarkType;
  readonly description?: string;
  readonly benchmarkPath?: string;

  loadTasks(filterTaskIds?: string[]): Promise<Task[]>;
  evaluate(task: Task, response: ModelResponse, context?: EvaluationContext): Promise<Score>;
  computeDatasetHash(): Promise<string>;
}
