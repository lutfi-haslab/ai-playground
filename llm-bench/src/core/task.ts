export interface BaseTask {
  id: string;
  prompt: string;
  systemPrompt?: string;
  category?: string;
  difficulty?: "easy" | "medium" | "hard" | string;
  metadata?: Record<string, unknown>;
  type?: string;
}

export interface StandardTask extends BaseTask {
  type?: "exact" | "contains" | "regex" | "json" | "reasoning" | "math" | "instruction" | "structured" | "llm-judge";
  expected?: string | number | boolean | Record<string, unknown> | Array<unknown>;
  schema?: Record<string, unknown>;
  pattern?: string;
  evaluator?: string;
  judgePrompt?: string;
  judgeModel?: string;
}

export interface CodingTaskEvaluation {
  type: "tests" | "command";
  command: string;
  timeoutMs?: number;
  environment?: Record<string, string>;
}

export interface CodingTask extends BaseTask {
  type: "coding";
  projectPath: string;
  evaluation: CodingTaskEvaluation;
  expectedFiles?: string[];
  contextFiles?: string[];
  contextBudget?: "small" | "medium" | "large";
}

export type Task = StandardTask | CodingTask;

export function isCodingTask(task: Task): task is CodingTask {
  return task.type === "coding" && "projectPath" in task && "evaluation" in task;
}
