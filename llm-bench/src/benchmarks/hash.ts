import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export async function computeDirectoryHash(dirPath: string): Promise<string> {
  const hash = createHash("sha256");
  const fileEntries: Array<{ relPath: string; fullPath: string }> = [];

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      // Ignore git, node_modules, temp artifacts, results
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === ".DS_Store" ||
        entry.name === "results.db"
      ) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        fileEntries.push({
          relPath: relative(dirPath, fullPath),
          fullPath,
        });
      }
    }
  }

  try {
    await walk(dirPath);
  } catch (e: any) {
    return `sha256:unknown_${Date.now()}`;
  }

  // Sort paths deterministically
  fileEntries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  for (const file of fileEntries) {
    hash.update(file.relPath);
    try {
      const content = await Bun.file(file.fullPath).arrayBuffer();
      hash.update(Buffer.from(content));
    } catch {}
  }

  return `sha256:${hash.digest("hex").slice(0, 16)}`;
}
