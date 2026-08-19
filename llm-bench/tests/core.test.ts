import { test, expect, describe } from "bun:test";
import { calculateCost } from "../src/core/cost";
import { computeRunSummary, type TaskResult, type Run } from "../src/core/result";
import { isCodingTask, type Task } from "../src/core/task";

describe("Core", () => {
  describe("Cost calculation", () => {
    test("calculates token cost accurately per 1M tokens", () => {
      const pricing = {
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.60,
      };

      // 1,000,000 in, 1,000,000 out -> 0.15 + 0.60 = 0.75
      expect(calculateCost(1_000_000, 1_000_000, pricing)).toBe(0.75);

      // 100,000 in, 50,000 out -> (100k/1M)*0.15 + (50k/1M)*0.60 = 0.015 + 0.030 = 0.045
      expect(calculateCost(100_000, 50_000, pricing)).toBe(0.045);

      // Zero tokens or missing pricing
      expect(calculateCost(0, 0, pricing)).toBe(0);
      expect(calculateCost(100_000, 50_000, undefined)).toBe(0);
    });

    test("handles input/output alias pricing fields", () => {
      const pricing = { input: 2.0, output: 8.0 };
      expect(calculateCost(500_000, 250_000, pricing)).toBe(3.0);
    });
  });

  describe("Task type guard", () => {
    test("correctly identifies coding tasks", () => {
      const codingTask: Task = {
        id: "c-1",
        type: "coding",
        prompt: "Fix bug",
        projectPath: "./project",
        evaluation: { type: "tests", command: "bun test" },
      };

      const stdTask: Task = {
        id: "s-1",
        type: "exact",
        prompt: "What is 2+2?",
        expected: "4",
      };

      expect(isCodingTask(codingTask)).toBe(true);
      expect(isCodingTask(stdTask)).toBe(false);
    });
  });

  describe("Run summary calculation", () => {
    test("computes accurate accuracy, costs, tokens and coding metrics", () => {
      const results: TaskResult[] = [
        {
          id: "r1",
          runId: "run_test",
          taskId: "t1",
          modelId: "m1",
          passed: true,
          score: 1.0,
          inputTokens: 1000,
          outputTokens: 200,
          cachedTokens: 50,
          latencyMs: 1200,
          costUsd: 0.005,
          response: "res1",
          details: { passed: 10, failed: 0, total: 10 },
          createdAt: new Date().toISOString(),
        },
        {
          id: "r2",
          runId: "run_test",
          taskId: "t2",
          modelId: "m1",
          passed: false,
          score: 0.5,
          inputTokens: 2000,
          outputTokens: 400,
          latencyMs: 1800,
          costUsd: 0.010,
          response: "res2",
          error: "1 test failed",
          details: { passed: 5, failed: 5, total: 10 },
          createdAt: new Date().toISOString(),
        },
      ];

      const runInfo = {
        id: "run_test",
        benchmarkId: "coding/typescript-v1",
        benchmarkVersion: "1.0.0",
        datasetHash: "sha256:1234",
        modelId: "m1",
        startedAt: new Date(Date.now() - 5000).toISOString(),
        finishedAt: new Date().toISOString(),
      };

      const summary = computeRunSummary(runInfo, results);

      expect(summary.totalTasks).toBe(2);
      expect(summary.passedTasks).toBe(1);
      expect(summary.failedTasks).toBe(1);
      expect(summary.accuracy).toBe(0.5);
      expect(summary.averageScore).toBe(0.75);
      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(600);
      expect(summary.totalCachedTokens).toBe(50);
      expect(summary.totalCostUsd).toBe(0.015);
      expect(summary.averageLatencyMs).toBe(1500);
      expect(summary.codingMetrics?.totalTests).toBe(20);
      expect(summary.codingMetrics?.testsPassed).toBe(15);
      expect(summary.codingMetrics?.testsFailed).toBe(5);
    });
  });
});
