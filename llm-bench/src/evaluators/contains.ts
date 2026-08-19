import type { Evaluator, Score, EvaluationContext } from "../core/evaluator";
import type { Task, StandardTask } from "../core/task";
import type { ModelResponse } from "../core/model";

export class ContainsEvaluator implements Evaluator {
  readonly id = "contains";

  async evaluate(task: Task, response: ModelResponse, _context?: EvaluationContext): Promise<Score> {
    const stdTask = task as StandardTask;
    const expected = stdTask.expected;

    if (expected === undefined || expected === null) {
      return {
        value: 0,
        passed: false,
        error: "Task is missing 'expected' field for contains evaluation",
      };
    }

    const actual = response.text;
    const caseSensitive = Boolean(stdTask.metadata?.caseSensitive ?? false);
    const targetText = caseSensitive ? actual : actual.toLowerCase();

    // If expected is an array: check all or any based on metadata.mode
    if (Array.isArray(expected)) {
      const mode = (stdTask.metadata?.mode as "all" | "any") ?? "all";
      const checks = expected.map((item) => {
        const itemStr = caseSensitive ? String(item) : String(item).toLowerCase();
        return {
          item: String(item),
          found: targetText.includes(itemStr),
        };
      });

      const foundCount = checks.filter((c) => c.found).length;
      const totalCount = checks.length;
      const passed = mode === "all" ? foundCount === totalCount : foundCount > 0;
      const value = totalCount > 0 ? foundCount / totalCount : 0;

      return {
        value: passed ? 1 : value,
        passed,
        details: { mode, checks, foundCount, totalCount },
      };
    }

    // Single expected string
    const expectedStr = caseSensitive ? String(expected) : String(expected).toLowerCase();
    const passed = targetText.includes(expectedStr);

    return {
      value: passed ? 1 : 0,
      passed,
      details: { expected: String(expected), passed },
    };
  }
}
