import type { Evaluator, Score, EvaluationContext } from "../core/evaluator";
import type { Task, StandardTask } from "../core/task";
import type { ModelResponse } from "../core/model";

export class ExactEvaluator implements Evaluator {
  readonly id = "exact";

  async evaluate(task: Task, response: ModelResponse, _context?: EvaluationContext): Promise<Score> {
    const stdTask = task as StandardTask;
    const expected = stdTask.expected;

    if (expected === undefined || expected === null) {
      return {
        value: 0,
        passed: false,
        error: "Task is missing 'expected' field for exact evaluation",
      };
    }

    const actual = response.text.trim();
    const expectedStr = String(expected).trim();

    // Check exact string match
    if (actual === expectedStr) {
      return {
        value: 1,
        passed: true,
        details: { expected: expectedStr, actual },
      };
    }

    // Check case-insensitive match if option enabled in metadata
    const caseSensitive = stdTask.metadata?.caseSensitive ?? false;
    if (!caseSensitive && actual.toLowerCase() === expectedStr.toLowerCase()) {
      return {
        value: 1,
        passed: true,
        details: { expected: expectedStr, actual, matchType: "case-insensitive" },
      };
    }

    // Check numeric match if both are valid numbers
    const numExpected = Number(expectedStr);
    const numActual = Number(actual);
    if (!isNaN(numExpected) && !isNaN(numActual) && numExpected === numActual) {
      return {
        value: 1,
        passed: true,
        details: { expected: numExpected, actual: numActual, matchType: "numeric" },
      };
    }

    return {
      value: 0,
      passed: false,
      details: { expected: expectedStr, actual },
    };
  }
}
