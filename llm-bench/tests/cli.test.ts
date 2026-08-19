import { test, expect, describe } from "bun:test";
import { listCommand } from "../src/cli/list";
import { modelsCommand } from "../src/cli/models";
import { runCommand } from "../src/cli/run";
import { reportCommand } from "../src/cli/report";
import { resultCommand } from "../src/cli/result";
import { compareCommand } from "../src/cli/compare";
import { rm } from "node:fs/promises";

describe("CLI Commands", () => {
  const testReportsDir = "./reports/test_cli_reports";

  test("runs bench list without error", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args) => {
      output += args.join(" ") + "\n";
    };

    try {
      await listCommand({ benchmarksDir: "./benchmarks" });
      expect(output).toContain("Available benchmarks:");
      expect(output).toContain("coding/typescript-v1");
      expect(output).toContain("reasoning/v1");
    } finally {
      console.log = origLog;
    }
  });

  test("runs bench models without error", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args) => {
      output += args.join(" ") + "\n";
    };

    try {
      await modelsCommand({ configPath: "./models.json" });
      expect(output).toContain("Configured Models:");
      expect(output).toContain("muse-spark-1.2-contributor");
    } finally {
      console.log = origLog;
    }
  });

  test("runs bench run, report, result, and compare with file store", async () => {
    const runs = await runCommand("math/v1", {
      models: ["mock-fast"],
      tasks: ["math-001"],
      reportsDir: testReportsDir,
    });

    expect(runs.length).toBe(1);
    const runId = runs[0]!.id;

    // Report
    let reportOut = "";
    const origLog = console.log;
    console.log = (...args) => {
      reportOut += args.join(" ") + "\n";
    };

    try {
      await reportCommand(runId, { reportsDir: testReportsDir });
      expect(reportOut).toContain("LLM Benchmark Report");
      expect(reportOut).toContain("math/v1");

      // Result
      let resultOut = "";
      console.log = (...args) => {
        resultOut += args.join(" ") + "\n";
      };
      await resultCommand(runId, { taskId: "math-001", reportsDir: testReportsDir });
      expect(resultOut).toContain("Task Result Details:");
      expect(resultOut).toContain("math-001");

      // Compare
      let compOut = "";
      console.log = (...args) => {
        compOut += args.join(" ") + "\n";
      };
      await compareCommand([runId], { reportsDir: testReportsDir });
      expect(compOut).toContain("LLM Benchmark Report");
    } finally {
      console.log = origLog;
      await rm(testReportsDir, { recursive: true, force: true });
    }
  });
});
