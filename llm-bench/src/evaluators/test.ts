import type { Evaluator, Score, EvaluationContext } from "../core/evaluator";
import type { Task, CodingTask } from "../core/task";
import type { ModelResponse } from "../core/model";

export interface TestStats {
  passed: number;
  failed: number;
  total: number;
  skipped?: number;
}

export function parseTestOutput(output: string): TestStats | null {
  // Bun test output format:
  // e.g. " 14 pass\n 0 fail\n 14 expect() calls\nRan 14 tests across 2 files. [45.00ms]"
  // or " 1 fail\n 3 pass"
  const bunPassMatch = /(\d+)\s+pass/i.exec(output);
  const bunFailMatch = /(\d+)\s+fail/i.exec(output);

  // Jest / Vitest output:
  // "Tests:       2 passed, 2 total" or "Tests: 1 failed, 3 passed, 4 total"
  const jestPassMatch = /(\d+)\s+passed/i.exec(output);
  const jestFailMatch = /(\d+)\s+failed/i.exec(output);
  const jestTotalMatch = /(\d+)\s+total/i.exec(output);

  // Pytest output:
  // "== 5 passed, 1 failed in 0.12s =="
  const pytestPassMatch = /(\d+)\s+passed/i.exec(output);
  const pytestFailMatch = /(\d+)\s+failed/i.exec(output);

  let passed = 0;
  let failed = 0;
  let total = 0;
  let found = false;

  if (bunPassMatch || bunFailMatch) {
    passed = bunPassMatch ? parseInt(bunPassMatch[1]!, 10) : 0;
    failed = bunFailMatch ? parseInt(bunFailMatch[1]!, 10) : 0;
    total = passed + failed;
    found = true;
  } else if (jestTotalMatch || jestPassMatch || jestFailMatch) {
    passed = jestPassMatch ? parseInt(jestPassMatch[1]!, 10) : 0;
    failed = jestFailMatch ? parseInt(jestFailMatch[1]!, 10) : 0;
    total = jestTotalMatch ? parseInt(jestTotalMatch[1]!, 10) : passed + failed;
    found = true;
  } else if (pytestPassMatch || pytestFailMatch) {
    passed = pytestPassMatch ? parseInt(pytestPassMatch[1]!, 10) : 0;
    failed = pytestFailMatch ? parseInt(pytestFailMatch[1]!, 10) : 0;
    total = passed + failed;
    found = true;
  }

  if (found && total > 0) {
    return { passed, failed, total };
  }

  return null;
}

export class CommandTestEvaluator implements Evaluator {
  readonly id = "tests";

  async evaluate(task: Task, _response: ModelResponse, context?: EvaluationContext): Promise<Score> {
    const codingTask = task as CodingTask;
    const workspacePath = context?.workspacePath;

    if (!workspacePath) {
      return {
        value: 0,
        passed: false,
        error: "No workspace path provided for command test evaluation",
      };
    }

    const command = codingTask.evaluation?.command;
    if (!command) {
      return {
        value: 0,
        passed: false,
        error: "Coding task has no evaluation command specified",
      };
    }

    const timeoutMs = codingTask.evaluation?.timeoutMs ?? 30000;
    const startTime = performance.now();

    try {
      // Execute command in temporary workspace using Bun.spawn
      const proc = Bun.spawn(["sh", "-c", command], {
        cwd: workspacePath,
        env: {
          ...process.env,
          ...codingTask.evaluation.environment,
          CI: "true",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Handle timeout
      let timedOut = false;
      const timeoutPromise = (async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(() => {
          timedOut = true;
          try {
            proc.kill();
          } catch {}
          resolve();
        }, timeoutMs);
        await promise;
      })();

      const exitCodePromise = proc.exited;
      await Promise.race([exitCodePromise, timeoutPromise]);

      const durationMs = Math.round(performance.now() - startTime);

      if (timedOut) {
        return {
          value: 0,
          passed: false,
          error: `Test execution timed out after ${timeoutMs}ms`,
          details: {
            command,
            durationMs,
            timedOut: true,
          },
        };
      }

      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const combinedOutput = `${stdout}\n${stderr}`;

      const stats = parseTestOutput(combinedOutput);

      if (stats && stats.total > 0) {
        const scoreValue = Number((stats.passed / stats.total).toFixed(4));
        const passed = stats.failed === 0 && exitCode === 0;

        return {
          value: passed ? 1.0 : scoreValue,
          passed,
          details: {
            command,
            exitCode,
            passed: stats.passed,
            failed: stats.failed,
            total: stats.total,
            score: scoreValue,
            stdout,
            stderr,
            durationMs,
          },
        };
      }

      // Exit code fallback
      const passed = exitCode === 0;
      return {
        value: passed ? 1.0 : 0.0,
        passed,
        details: {
          command,
          exitCode,
          stdout,
          stderr,
          durationMs,
        },
        error: !passed ? `Command exited with code ${exitCode}` : undefined,
      };
    } catch (e: any) {
      return {
        value: 0,
        passed: false,
        error: `Failed to execute test command: ${e.message}`,
        details: { command, error: e.message },
      };
    }
  }
}
