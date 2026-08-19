import { test, expect, describe } from "bun:test";
import { generateHtmlReport } from "../src/cli/html";
import type { Run } from "../src/core/result";

describe("HTML Report Generator", () => {
  test("generates unified multi-benchmark report with tabs, master prompt, and expected criteria", async () => {
    const runs: Run[] = [
      {
        id: "run_html_test_1",
        benchmarkId: "coding/typescript-v1",
        benchmarkVersion: "1.0.0",
        datasetHash: "sha256:abc123456789",
        modelId: "claude-sonnet",
        modelConfig: { provider: "anthropic", model: "claude-3-5-sonnet" },
        options: { temperature: 0 },
        startedAt: "2026-08-19T10:00:00Z",
        finishedAt: "2026-08-19T10:00:15Z",
        status: "completed",
        results: [
          {
            id: "res_1",
            runId: "run_html_test_1",
            taskId: "task-001",
            modelId: "claude-sonnet",
            passed: true,
            score: 1.0,
            inputTokens: 820,
            outputTokens: 210,
            latencyMs: 3200,
            costUsd: 0.0056,
            response: '{"files": {"src/userService.ts": "fixed code"}}',
            details: {
              prompt: "Fix the user service email validation bug",
              expected: "bun test tests/userService.test.ts",
              passed: 4,
              failed: 0,
              total: 4,
              appliedFiles: ["src/userService.ts"],
            },
            createdAt: "2026-08-19T10:00:05Z",
          },
        ],
      },
      {
        id: "run_html_test_2",
        benchmarkId: "math/v1",
        benchmarkVersion: "1.0.0",
        datasetHash: "sha256:math123456",
        modelId: "claude-sonnet",
        modelConfig: { provider: "anthropic", model: "claude-3-5-sonnet" },
        options: { temperature: 0 },
        startedAt: "2026-08-19T10:10:00Z",
        finishedAt: "2026-08-19T10:10:05Z",
        status: "completed",
        results: [
          {
            id: "res_2",
            runId: "run_html_test_2",
            taskId: "math-001",
            modelId: "claude-sonnet",
            passed: true,
            score: 1.0,
            inputTokens: 100,
            outputTokens: 10,
            latencyMs: 1200,
            costUsd: 0.0003,
            response: "125",
            details: {
              prompt: "What is (17 * 23) - (14 * 19)?",
              expected: "125",
            },
            createdAt: "2026-08-19T10:10:03Z",
          },
        ],
      },
    ];

    const html = await generateHtmlReport(runs);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("LLM Benchmark Suite");
    expect(html).toContain("Global Overview");
    expect(html).toContain("coding/typescript-v1");
    expect(html).toContain("math/v1");
    expect(html).toContain("claude-sonnet");
    expect(html).toContain("Top Global Performer");
    expect(html).toContain("Master Prompt / Instruction");
    expect(html).toContain("userService.ts");
    expect(html).toContain("Evaluation Target / Expected Criteria");
    expect(html).toContain("What is (17 * 23) - (14 * 19)?");
    expect(html).toContain("125");
    expect(html).toContain("switchTab(");
    expect(html).toContain("toggleTheme()");
  });
});
