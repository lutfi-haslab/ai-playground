import { test, expect, describe } from "bun:test";
import {
  getDateTimePrefix,
  getDefaultReportPaths,
  loadReportRunsFromFile,
  saveReportRunsToFile,
  appendOrUpdateRunInFile,
  listAllReportFiles,
  loadAllRunsFromReports,
} from "../src/storage/filestore";
import type { Run, TaskResult } from "../src/core/result";
import { rm } from "node:fs/promises";

describe("Pure JSON Storage Layer (filestore)", () => {
  const testDir = "./reports/test_store";
  const testJsonPath = `${testDir}/test_report.json`;

  test("generates date and time prefixes and paths in reports directory", () => {
    const prefix = getDateTimePrefix();
    expect(prefix).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);

    const paths = getDefaultReportPaths(new Date(), "./reports");
    expect(paths.htmlPath).toContain("reports");
    expect(paths.jsonPath).toContain("reports");
    expect(paths.htmlPath).toMatch(/\.html$/);
    expect(paths.jsonPath).toMatch(/\.json$/);
  });

  test("saves and loads runs from JSON file", async () => {
    const sampleRun: Run = {
      id: "run_json_001",
      benchmarkId: "math/v1",
      benchmarkVersion: "1.0.0",
      datasetHash: "sha256:abc",
      modelId: "mock-fast",
      modelConfig: { provider: "mock", model: "m1" },
      options: { concurrency: 1 },
      startedAt: new Date().toISOString(),
      status: "completed",
      results: [
        {
          id: "res_1",
          runId: "run_json_001",
          taskId: "math-001",
          modelId: "mock-fast",
          passed: true,
          score: 1.0,
          inputTokens: 10,
          outputTokens: 5,
          latencyMs: 100,
          costUsd: 0.0001,
          response: "125",
          createdAt: new Date().toISOString(),
        },
      ],
    };

    await saveReportRunsToFile(testJsonPath, [sampleRun]);

    const loaded = await loadReportRunsFromFile(testJsonPath);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.id).toBe("run_json_001");
    expect(loaded[0]?.results.length).toBe(1);
    expect(loaded[0]?.results[0]?.taskId).toBe("math-001");

    // Clean up
    await rm(testDir, { recursive: true, force: true });
  });

  test("appends and updates runs in JSON file", async () => {
    const run1: Run = {
      id: "run_a",
      benchmarkId: "reasoning/v1",
      benchmarkVersion: "1.0.0",
      datasetHash: "h1",
      modelId: "m1",
      modelConfig: {},
      options: {},
      startedAt: new Date().toISOString(),
      status: "running",
      results: [],
    };

    const updated1 = await appendOrUpdateRunInFile(testJsonPath, run1);
    expect(updated1.length).toBe(1);

    // Update run1
    run1.status = "completed";
    const updated2 = await appendOrUpdateRunInFile(testJsonPath, run1);
    expect(updated2.length).toBe(1);
    expect(updated2[0]?.status).toBe("completed");

    // Append run2
    const run2: Run = {
      id: "run_b",
      benchmarkId: "math/v1",
      benchmarkVersion: "1.0.0",
      datasetHash: "h2",
      modelId: "m2",
      modelConfig: {},
      options: {},
      startedAt: new Date().toISOString(),
      status: "completed",
      results: [],
    };

    const updated3 = await appendOrUpdateRunInFile(testJsonPath, run2);
    expect(updated3.length).toBe(2);

    await rm(testDir, { recursive: true, force: true });
  });
});
