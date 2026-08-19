import { test, expect, describe } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractFileChanges,
  applyFileChanges,
  readProjectFiles,
  buildCodingPrompt,
} from "../src/core/coding";
import { resolveBenchmarksDir } from "../src/benchmarks/loader";
import { createTemporaryWorkspace, cleanupWorkspace } from "../src/core/workspace";
import type { CodingTask } from "../src/core/task";

describe("Coding Tasks & Workspaces", () => {
  describe("extractFileChanges", () => {
    test("extracts from structured json with files map", () => {
      const response = JSON.stringify({
        files: {
          "src/auth.ts": "export const auth = true;",
          "src/user.ts": "export const user = 'Alice';",
        },
      });

      const extracted = extractFileChanges(response);
      expect(extracted["src/auth.ts"]).toBe("export const auth = true;");
      expect(extracted["src/user.ts"]).toBe("export const user = 'Alice';");
    });

    test("extracts from markdown codeblock with file header", () => {
      const response =
        "Here are the fixes:\n\n```typescript:src/service.ts\nexport function run() { return 42; }\n```";

      const extracted = extractFileChanges(response);
      expect(extracted["src/service.ts"]).toContain("export function run()");
    });

    test("extracts from comments in code block", () => {
      const response =
        "```ts\n// File: src/config.ts\nexport const PORT = 3000;\n```";

      const extracted = extractFileChanges(response);
      expect(extracted["src/config.ts"]).toContain("export const PORT = 3000;");
    });
  });

  describe("Workspace creation and file patching", () => {
    test("creates workspace, writes patched files, and cleans up", async () => {
      const benchmarksDir = await resolveBenchmarksDir();
      const templatePath = join(benchmarksDir, "coding/typescript-v1/task-001/project");
      const runId = "test_run_workspace";
      const taskId = "task-001";

      const workspacePath = await createTemporaryWorkspace(templatePath, runId, taskId);
      expect(await Bun.file(join(workspacePath, "package.json")).exists()).toBe(true);
      expect(await Bun.file(join(workspacePath, "src/userService.ts")).exists()).toBe(true);

      // Apply a patch
      const patch = {
        "src/userService.ts": "export function validateEmail() { return true; }\nexport function formatUser() { return 'ok'; }",
        "src/newModule.ts": "export const hello = 'world';",
      };

      const applied = await applyFileChanges(workspacePath, patch);
      expect(applied).toContain("src/userService.ts");
      expect(applied).toContain("src/newModule.ts");

      const patchedContent = await Bun.file(join(workspacePath, "src/userService.ts")).text();
      expect(patchedContent).toContain("validateEmail");

      // Verify cleanup
      await cleanupWorkspace(workspacePath);
      expect(await Bun.file(join(workspacePath, "package.json")).exists()).toBe(false);
    });

    test("prevents directory traversal attacks in file paths", async () => {
      const benchmarksDir = await resolveBenchmarksDir();
      const templatePath = join(benchmarksDir, "coding/typescript-v1/task-001/project");
      const workspacePath = await createTemporaryWorkspace(templatePath, "run_sec", "task-sec");

      const maliciousPatch = {
        "../../evil.txt": "malicious content",
      };

      const applied = await applyFileChanges(workspacePath, maliciousPatch);
      // Normalized path strips leading ../ and keeps inside workspace
      for (const p of applied) {
        expect(p.startsWith("..")).toBe(false);
      }

      await cleanupWorkspace(workspacePath);
    });
  });

  describe("buildCodingPrompt", () => {
    test("reads project files and builds structured coding prompt", async () => {
      const task: CodingTask = {
        id: "task-001",
        type: "coding",
        prompt: "Fix the user service bug",
        projectPath: join(await resolveBenchmarksDir(), "coding/typescript-v1/task-001/project"),
        evaluation: { type: "tests", command: "bun test" },
      };

      const prompt = await buildCodingPrompt(task);
      expect(prompt).toContain("Fix the user service bug");
      expect(prompt).toContain("src/userService.ts");
      expect(prompt).toContain("package.json");
      expect(prompt).toContain("```json");
      expect(prompt).toContain('"files":');
    });
  });
});
