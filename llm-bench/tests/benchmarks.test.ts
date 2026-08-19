import { test, expect, describe } from "bun:test";
import { listBenchmarks, loadBenchmark } from "../src/benchmarks/loader";
import { computeDirectoryHash } from "../src/benchmarks/hash";

describe("Benchmarks & Loaders", () => {
  test("lists all built-in benchmarks", async () => {
    const benchmarks = await listBenchmarks("./benchmarks");
    const ids = benchmarks.map((b) => b.id);

    expect(ids).toContain("coding/typescript-v1");
    expect(ids).toContain("reasoning/v1");
    expect(ids).toContain("math/v1");
    expect(ids).toContain("instruction/v1");
    expect(ids).toContain("structured/v1");
  });

  test("loads coding benchmark tasks from subdirectories", async () => {
    const bench = await loadBenchmark("coding/typescript-v1", "./benchmarks");
    expect(bench.id).toBe("coding/typescript-v1");
    expect(bench.type).toBe("coding");

    const tasks = await bench.loadTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    expect(tasks.map((t) => t.id)).toContain("task-001");
    expect(tasks.map((t) => t.id)).toContain("task-002");
  });

  test("filters tasks by task IDs", async () => {
    const bench = await loadBenchmark("reasoning/v1", "./benchmarks");
    const tasks = await bench.loadTasks(["reasoning-001"]);
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.id).toBe("reasoning-001");
  });

  test("computes deterministic dataset SHA256 hash", async () => {
    const hash1 = await computeDirectoryHash("./benchmarks/math/v1");
    const hash2 = await computeDirectoryHash("./benchmarks/math/v1");

    expect(hash1).toBe(hash2);
    expect(hash1.startsWith("sha256:")).toBe(true);
  });
});
