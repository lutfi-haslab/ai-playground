import type { Task } from "./task";
import type { Model, ModelConfig, ModelResponse } from "./model";

export interface Score {
  value: number; // 0.0 to 1.0
  passed: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

export interface EvaluationContext {
  task: Task;
  response: ModelResponse;
  workspacePath?: string;
  modelConfig?: ModelConfig;
  judgeModel?: Model;
}

export interface Evaluator {
  readonly id: string;
  evaluate(task: Task, response: ModelResponse, context?: EvaluationContext): Promise<Score>;
}
