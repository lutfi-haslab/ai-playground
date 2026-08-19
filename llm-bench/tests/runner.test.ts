import { test, expect, describe } from "bun:test";
import { BenchmarkRunner } from "../src/core/runner";
import { loadBenchmark } from "../src/benchmarks/loader";
import { MockModel } from "../src/providers/mock";
import { loadReportRunsFromFile } from "../src/storage/filestore";
import { rm } from "node:fs/promises";

describe("Benchmark Runner", () => {
  const testJsonPath = "./reports/test_runner_report.json";

  test("runs standard reasoning benchmark with mock model and streams to json", async () => {
    const benchmark = await loadBenchmark("reasoning/v1", "./benchmarks");

    // Smart mock model that returns the right answers for task-001, 002, 003
    const model = new MockModel(
      {
        id: "mock-smart",
        provider: "mock",
        model: "smart-v1",
        pricing: { input: 0.1, output: 0.5 },
      },
      (req) => {
        const prompt = req.messages.find((m) => m.role === "user")?.content ?? "";
        if (prompt.includes("brothers")) return "1";
        if (prompt.includes("runners")) return "E, D, C, A, B";
        if (prompt.includes("knights")) return "A is a Knave, B is a Knight";
        return "unknown";
      }
    );

    const runner = new BenchmarkRunner();
    let streamUpdateCount = 0;

    const run = await runner.run(benchmark, model, {
      concurrency: 2,
      jsonReportPath: testJsonPath,
      onStreamUpdate: () => {
        streamUpdateCount++;
      },
    });

    expect(run.status).toBe("completed");
    expect(run.results.length).toBe(3);
    expect(run.summary?.accuracy).toBe(1.0);
    expect(run.summary?.totalTasks).toBe(3);
    expect(run.summary?.passedTasks).toBe(3);
    expect(run.summary?.totalCostUsd).toBeGreaterThan(0);
    expect(streamUpdateCount).toBeGreaterThan(0);

    // Verify JSON file persistence
    const fileRuns = await loadReportRunsFromFile(testJsonPath);
    expect(fileRuns.length).toBe(1);
    expect(fileRuns[0]?.id).toBe(run.id);
    expect(fileRuns[0]?.status).toBe("completed");
    expect(fileRuns[0]?.results.length).toBe(3);

    await rm(testJsonPath, { force: true });
  });

  test("runs coding benchmark end-to-end with workspace patching and bun test", async () => {
    const benchmark = await loadBenchmark("coding/typescript-v1", "./benchmarks");

    const fixedUserServiceCode = `export interface User {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

export function validateEmail(email: string): boolean {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);
}

export function formatUser(user: User): string {
  if (!user.isActive) {
    return \`[INACTIVE] \${user.name} <\${user.email}>\`;
  }
  return \`\${user.name} <\${user.email}>\`;
}
`;

    const model = new MockModel(
      {
        id: "mock-coder",
        provider: "mock",
        model: "coder-v1",
        pricing: { input: 0.2, output: 0.8 },
      },
      (req) => {
        const prompt = req.messages.find((m) => m.role === "user")?.content ?? "";
        if (prompt.includes("userService.ts")) {
          return JSON.stringify({
            files: {
              "src/userService.ts": fixedUserServiceCode,
            },
          });
        }
        return "unsupported task";
      }
    );

    const runner = new BenchmarkRunner();
    const run = await runner.run(benchmark, model, {
      taskIds: ["task-001"],
    });

    expect(run.status).toBe("completed");
    expect(run.results.length).toBe(1);
    const result = run.results[0]!;
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.details?.passed).toBe(4);
    expect(result.details?.failed).toBe(0);
    expect(result.details?.total).toBe(4);
  });

  test("handles task retries on model failure", async () => {
    const benchmark = await loadBenchmark("math/v1", "./benchmarks");

    let attempts = 0;
    const flakyModel = new MockModel(
      { id: "mock-flaky", provider: "mock", model: "flaky-v1" },
      () => {
        attempts++;
        if (attempts === 1) {
          const err = new Error("Rate limit exceeded 429");
          (err as any).retryAfterMs = 10;
          throw err;
        }
        return "125";
      }
    );

    const runner = new BenchmarkRunner();
    const run = await runner.run(benchmark, flakyModel, {
      taskIds: ["math-001"],
      maxRetries: 2,
    });

    expect(run.results.length).toBe(1);
    const result = run.results[0]!;
    expect(result.passed).toBe(true);
    expect(result.retries?.length).toBe(1);
    expect(result.retries?.[0]?.error).toContain("Rate limit exceeded 429");
  });
});
