import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Benchmark, BenchmarkMeta } from "../core/benchmark";
import { FilesystemBenchmark } from "./benchmark";

export interface BenchmarkInfo {
  id: string;
  name: string;
  version: string;
  type: string;
  description?: string;
  path: string;
}

export async function resolveBenchmarksDir(baseDir: string = "./benchmarks"): Promise<string> {
  const direct = resolve(baseDir);
  const directExists = await stat(direct).then((s) => s.isDirectory()).catch(() => false);
  if (directExists) {
    const entries = await readdir(direct).catch(() => []);
    if (entries.length > 0) return direct;
  }

  // Try relative to package directory
  const moduleRelative = resolve(import.meta.dir, "../../benchmarks");
  const moduleExists = await stat(moduleRelative).then((s) => s.isDirectory()).catch(() => false);
  if (moduleExists) return moduleRelative;

  // Try ./llm-bench/benchmarks
  const relPkg = resolve("./llm-bench/benchmarks");
  const relExists = await stat(relPkg).then((s) => s.isDirectory()).catch(() => false);
  if (relExists) return relPkg;

  return direct;
}

export async function findBenchmarkFiles(baseDir: string = "./benchmarks"): Promise<string[]> {
  const resolvedBase = await resolveBenchmarksDir(baseDir);
  const found: string[] = [];

  async function walk(currentDir: string) {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".DS_Store") {
          continue;
        }

        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          const benchJson = join(fullPath, "benchmark.json");
          if (await Bun.file(benchJson).exists()) {
            found.push(fullPath);
          } else {
            await walk(fullPath);
          }
        }
      }
    } catch {}
  }

  // Also check if baseDir itself has benchmark.json
  if (await Bun.file(join(resolvedBase, "benchmark.json")).exists()) {
    found.push(resolvedBase);
  } else {
    await walk(resolvedBase);
  }

  return found;
}

export async function listBenchmarks(baseDir: string = "./benchmarks"): Promise<BenchmarkInfo[]> {
  const resolvedBase = await resolveBenchmarksDir(baseDir);
  const benchDirs = await findBenchmarkFiles(resolvedBase);
  const results: BenchmarkInfo[] = [];

  for (const dir of benchDirs) {
    try {
      const meta = (await Bun.file(join(dir, "benchmark.json")).json()) as BenchmarkMeta;
      results.push({
        id: meta.id,
        name: meta.name,
        version: meta.version,
        type: meta.type,
        description: meta.description,
        path: dir,
      });
    } catch (e: any) {
      console.error(`Failed to read benchmark metadata from ${dir}: ${e.message}`);
    }
  }

  return results;
}

export async function loadBenchmark(
  benchmarkIdOrPath: string,
  baseDir: string = "./benchmarks"
): Promise<Benchmark> {
  const resolvedBase = await resolveBenchmarksDir(baseDir);

  // 1. Check if direct path with benchmark.json
  const directPath = resolve(benchmarkIdOrPath);
  const directBenchJson = join(directPath, "benchmark.json");

  if (await Bun.file(directBenchJson).exists()) {
    const meta = (await Bun.file(directBenchJson).json()) as BenchmarkMeta;
    return new FilesystemBenchmark(directPath, meta);
  }

  // 2. Search under resolved baseDir
  const allBenchmarks = await listBenchmarks(resolvedBase);

  // Exact ID match
  const matchById = allBenchmarks.find(
    (b) => b.id.toLowerCase() === benchmarkIdOrPath.toLowerCase()
  );
  if (matchById) {
    const meta = (await Bun.file(join(matchById.path, "benchmark.json")).json()) as BenchmarkMeta;
    return new FilesystemBenchmark(matchById.path, meta);
  }

  // Subpath match (e.g. "coding/typescript-v1")
  const matchByPath = allBenchmarks.find((b) =>
    b.path.replace(/\\/g, "/").endsWith(benchmarkIdOrPath.replace(/\\/g, "/"))
  );
  if (matchByPath) {
    const meta = (await Bun.file(join(matchByPath.path, "benchmark.json")).json()) as BenchmarkMeta;
    return new FilesystemBenchmark(matchByPath.path, meta);
  }

  throw new Error(
    `Benchmark '${benchmarkIdOrPath}' not found in '${resolvedBase}'. Available benchmarks:\n` +
      allBenchmarks.map((b) => `  - ${b.id} (${b.path})`).join("\n")
  );
}
