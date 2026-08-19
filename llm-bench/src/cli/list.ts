import { listBenchmarks, loadBenchmark } from "../benchmarks/loader";

export interface ListCommandOptions {
  benchmarksDir?: string;
}

export async function listCommand(options?: ListCommandOptions): Promise<void> {
  const baseDir = options?.benchmarksDir ?? "./benchmarks";
  const benchmarks = await listBenchmarks(baseDir);

  if (benchmarks.length === 0) {
    console.log(`No benchmarks found in '${baseDir}'.`);
    return;
  }

  console.log("\nAvailable benchmarks:");
  console.log("─────────────────────────────────────────────────────────────────────────────────");
  console.log(
    `${"ID".padEnd(28)} ${"TYPE".padEnd(14)} ${"VERSION".padEnd(10)} ${"TASKS".padEnd(8)} DESCRIPTION`
  );
  console.log("─────────────────────────────────────────────────────────────────────────────────");

  for (const b of benchmarks) {
    let taskCount = 0;
    try {
      const loaded = await loadBenchmark(b.path, baseDir);
      const tasks = await loaded.loadTasks();
      taskCount = tasks.length;
    } catch {}

    const desc = b.description ? (b.description.length > 35 ? b.description.slice(0, 32) + "..." : b.description) : "";
    console.log(
      `${b.id.padEnd(28)} ${b.type.padEnd(14)} ${b.version.padEnd(10)} ${String(taskCount).padEnd(8)} ${desc}`
    );
  }

  console.log("─────────────────────────────────────────────────────────────────────────────────\n");
}
