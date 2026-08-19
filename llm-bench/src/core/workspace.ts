import { mkdir, rm, cp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export interface WorkspaceOptions {
  baseDir?: string;
  keepOnFailure?: boolean;
}

export async function createTemporaryWorkspace(
  templateProjectPath: string,
  runId: string,
  taskId: string,
  options?: WorkspaceOptions
): Promise<string> {
  const rootTmp = options?.baseDir ?? join(tmpdir(), "llm-bench");
  const randomSuffix = randomBytes(4).toString("hex");
  const sanitizedTaskId = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sanitizedRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "_");

  const workspacePath = join(rootTmp, sanitizedRunId, `${sanitizedTaskId}_${randomSuffix}`);

  await mkdir(workspacePath, { recursive: true });

  const resolvedTemplate = resolve(templateProjectPath);
  const exists = await stat(resolvedTemplate).then(() => true).catch(() => false);

  if (exists) {
    // Copy all project files from template into workspace
    await cp(resolvedTemplate, workspacePath, {
      recursive: true,
      filter: (source) => {
        // Skip .git, results.db, but keep project source/tests/configs
        const baseName = source.split("/").pop() ?? "";
        return baseName !== ".git" && baseName !== ".DS_Store";
      },
    });
  }

  return workspacePath;
}

export async function cleanupWorkspace(workspacePath: string): Promise<void> {
  try {
    await rm(workspacePath, { recursive: true, force: true });
  } catch (e: any) {
    console.error(`Warning: Failed to cleanup workspace ${workspacePath}: ${e.message}`);
  }
}
