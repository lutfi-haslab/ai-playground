import type { Evaluator } from "../core/evaluator";
import type { Task, StandardTask } from "../core/task";
import { isCodingTask } from "../core/task";
import { ExactEvaluator } from "./exact";
import { ContainsEvaluator } from "./contains";
import { RegexEvaluator } from "./regex";
import { JsonEvaluator } from "./json";
import { CommandTestEvaluator } from "./test";
import { LLMJudgeEvaluator } from "./llm-judge";

export class EvaluatorRegistry {
  private static instance: EvaluatorRegistry;
  private evaluators = new Map<string, Evaluator>();

  constructor() {
    this.register(new ExactEvaluator());
    this.register(new ContainsEvaluator());
    this.register(new RegexEvaluator());
    this.register(new JsonEvaluator());
    this.register(new CommandTestEvaluator());
    this.register(new LLMJudgeEvaluator());
  }

  static getInstance(): EvaluatorRegistry {
    if (!EvaluatorRegistry.instance) {
      EvaluatorRegistry.instance = new EvaluatorRegistry();
    }
    return EvaluatorRegistry.instance;
  }

  register(evaluator: Evaluator): void {
    this.evaluators.set(evaluator.id.toLowerCase(), evaluator);
  }

  get(id: string): Evaluator | undefined {
    return this.evaluators.get(id.toLowerCase());
  }

  resolveEvaluator(task: Task, defaultEvaluatorId?: string): Evaluator {
    // 1. Coding task is always evaluated with command/test evaluator
    if (isCodingTask(task)) {
      return this.get("tests") ?? new CommandTestEvaluator();
    }

    const stdTask = task as StandardTask;

    // 2. Explicit task.evaluator
    if (stdTask.evaluator) {
      const ev = this.get(stdTask.evaluator);
      if (ev) return ev;
    }

    // 3. Explicit default evaluator from benchmark
    if (defaultEvaluatorId) {
      const ev = this.get(defaultEvaluatorId);
      if (ev) return ev;
    }

    // 4. Infer from task type or schema/pattern
    if (stdTask.schema || stdTask.type === "json" || stdTask.type === "structured") {
      return this.get("json")!;
    }

    if (stdTask.pattern || stdTask.type === "regex") {
      return this.get("regex")!;
    }

    if (stdTask.type === "contains") {
      return this.get("contains")!;
    }

    if (stdTask.type === "llm-judge") {
      return this.get("llm-judge")!;
    }

    if (stdTask.type === "exact") {
      return this.get("exact")!;
    }

    // Check if expected is array -> contains, else exact
    if (Array.isArray(stdTask.expected)) {
      return this.get("contains")!;
    }

    // Default to exact match
    return this.get("exact")!;
  }
}

export function getEvaluator(id: string): Evaluator | undefined {
  return EvaluatorRegistry.getInstance().get(id);
}

export function resolveEvaluator(task: Task, defaultEvaluatorId?: string): Evaluator {
  return EvaluatorRegistry.getInstance().resolveEvaluator(task, defaultEvaluatorId);
}
