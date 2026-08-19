import type { Evaluator, Score, EvaluationContext } from "../core/evaluator";
import type { Task, StandardTask } from "../core/task";
import type { ModelResponse } from "../core/model";

export class RegexEvaluator implements Evaluator {
  readonly id = "regex";

  async evaluate(task: Task, response: ModelResponse, _context?: EvaluationContext): Promise<Score> {
    const stdTask = task as StandardTask;
    const pattern = stdTask.pattern ?? (typeof stdTask.expected === "string" ? stdTask.expected : undefined);

    if (!pattern) {
      return {
        value: 0,
        passed: false,
        error: "Task is missing 'pattern' or 'expected' field for regex evaluation",
      };
    }

    const flags = (stdTask.metadata?.flags as string) ?? "i";
    let regex: RegExp;

    try {
      regex = new RegExp(pattern, flags);
    } catch (e: any) {
      return {
        value: 0,
        passed: false,
        error: `Invalid regex pattern '${pattern}': ${e.message}`,
      };
    }

    const match = regex.exec(response.text);
    const passed = match !== null;

    return {
      value: passed ? 1 : 0,
      passed,
      details: {
        pattern,
        flags,
        matched: passed,
        groups: match ? Array.from(match) : null,
      },
    };
  }
}
