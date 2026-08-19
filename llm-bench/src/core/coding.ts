import { mkdir, readdir, stat } from "node:fs/promises";
import { join, resolve, relative, normalize } from "node:path";
import type { CodingTask } from "./task";
import { extractJson } from "../evaluators/json";

export function extractFileChanges(responseText: string): Record<string, string> {
  const files: Record<string, string> = {};

  // 1. Try parsing structured JSON
  try {
    const parsed = extractJson(responseText) as any;
    if (parsed && typeof parsed === "object") {
      // Check if it has a "files" dictionary
      if (parsed.files && typeof parsed.files === "object") {
        for (const [path, content] of Object.entries(parsed.files)) {
          if (typeof content === "string") {
            files[path] = content;
          }
        }
        if (Object.keys(files).length > 0) {
          return files;
        }
      }

      // Check if top-level keys look like file paths (e.g. "src/index.ts", "package.json")
      let hasFileKeys = false;
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === "string" && (key.includes("/") || key.includes("."))) {
          files[key] = val;
          hasFileKeys = true;
        }
      }
      if (hasFileKeys) {
        return files;
      }
    }
  } catch {}

  // 2. Fallback: Parse markdown code blocks with file path headers
  // e.g. ```typescript:src/user.ts\n...\n``` or ```ts file="src/user.ts"\n...\n```
  const codeBlockRegex = /```(?:[a-zA-Z0-9_-]+)?(?::|\s+file=|\s+path=|\s+)([^\n\r]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(responseText)) !== null) {
    let filePath = match[1]?.trim().replace(/^["']|["']$/g, "");
    const fileContent = match[2];
    if (filePath && fileContent !== undefined) {
      // If header is like "ts:src/user.ts", strip language prefix
      if (filePath.includes(":")) {
        filePath = filePath.split(":").pop()!.trim();
      }
      if (filePath.includes(".") || filePath.includes("/")) {
        files[filePath] = fileContent;
      }
    }
  }

  // 3. Fallback: Check comments like `// File: src/user.ts` at start of code blocks
  if (Object.keys(files).length === 0) {
    const genericCodeBlockRegex = /```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
    while ((match = genericCodeBlockRegex.exec(responseText)) !== null) {
      const code = match[1] ?? "";
      const firstLine = code.split("\n")[0]?.trim() ?? "";
      const fileHeaderMatch = /(?:\/\/|#|\/\*)\s*(?:File|Path|filename):\s*([a-zA-Z0-9_\-\.\/]+)/i.exec(firstLine);
      if (fileHeaderMatch?.[1]) {
        const filePath = fileHeaderMatch[1].trim();
        // Extract content without the file header line
        const remainingContent = code.slice(code.indexOf("\n") + 1);
        files[filePath] = remainingContent;
      }
    }
  }

  return files;
}

export async function applyFileChanges(
  workspacePath: string,
  files: Record<string, string>
): Promise<string[]> {
  const writtenPaths: string[] = [];
  const normalizedWorkspace = resolve(workspacePath);

  for (const [relPath, content] of Object.entries(files)) {
    const cleanRelPath = normalize(relPath).replace(/^(\.\.[\/\\])+/, "");
    const targetPath = resolve(normalizedWorkspace, cleanRelPath);

    // Security check: ensure targetPath is within workspacePath
    if (!targetPath.startsWith(normalizedWorkspace)) {
      console.warn(`Skipping unsafe file path outside workspace: ${relPath}`);
      continue;
    }

    // Ensure parent directory exists
    const parentDir = targetPath.substring(0, targetPath.lastIndexOf("/"));
    if (parentDir) {
      await mkdir(parentDir, { recursive: true });
    }

    // Write file
    await Bun.write(targetPath, content);
    writtenPaths.push(cleanRelPath);
  }

  return writtenPaths;
}

export async function readProjectFiles(
  projectPath: string,
  filterPaths?: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const resolvedProject = resolve(projectPath);

  async function walk(currentDir: string) {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === ".DS_Store" ||
          entry.name === "dist" ||
          entry.name === "build"
        ) {
          continue;
        }

        const fullPath = join(currentDir, entry.name);
        const relPath = relative(resolvedProject, fullPath);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (!filterPaths || filterPaths.includes(relPath)) {
            try {
              const text = await Bun.file(fullPath).text();
              result[relPath] = text;
            } catch {}
          }
        }
      }
    } catch {}
  }

  await walk(resolvedProject);
  return result;
}

export async function buildCodingPrompt(task: CodingTask): Promise<string> {
  const projectFiles = await readProjectFiles(task.projectPath, task.contextFiles);

  let prompt = `${task.prompt}\n\n`;
  prompt += "### Current Project Files:\n\n";

  for (const [filePath, content] of Object.entries(projectFiles)) {
    prompt += `#### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n\n`;
  }

  prompt +=
    "### Instructions:\n" +
    "Provide the fixed or updated code for the project files.\n" +
    "You MUST respond ONLY with a structured JSON object containing a `files` map with the relative path as key and full file content as value.\n\n" +
    "Example format:\n" +
    "```json\n" +
    "{\n" +
    '  "files": {\n' +
    '    "src/user.ts": "export function getUser() { ... }"\n' +
    "  }\n" +
    "}\n" +
    "```";

  return prompt;
}
