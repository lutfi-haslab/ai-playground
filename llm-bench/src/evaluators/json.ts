import type { Evaluator, Score, EvaluationContext } from "../core/evaluator";
import type { Task, StandardTask } from "../core/task";
import type { ModelResponse } from "../core/model";

export function extractJson(text: string): unknown {
  const trimmed = text.trim();

  // Try raw parse first
  try {
    return JSON.parse(trimmed);
  } catch {}

  // Try code fence match ```json ... ``` or ``` ... ```
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // Try finding first { or [ and matching last } or ]
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  let startIdx = -1;

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx !== -1) {
    const isObject = trimmed[startIdx] === "{";
    const endIdx = isObject ? trimmed.lastIndexOf("}") : trimmed.lastIndexOf("]");
    if (endIdx > startIdx) {
      const candidate = trimmed.substring(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch {}
    }
  }

  throw new Error("Failed to extract valid JSON from response text");
}

export function validateSimpleSchema(data: any, schema: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      errors.push(`Expected object, got ${Array.isArray(data) ? "array" : typeof data}`);
      return { valid: false, errors };
    }

    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (!(reqKey in data) || data[reqKey] === undefined) {
          errors.push(`Missing required property: '${reqKey}'`);
        }
      }
    }

    if (schema.properties && typeof schema.properties === "object") {
      const props = schema.properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in data && data[key] !== undefined) {
          const val = data[key];
          if (propSchema.type) {
            const expectedType = propSchema.type;
            if (expectedType === "array") {
              if (!Array.isArray(val)) errors.push(`Property '${key}' should be array, got ${typeof val}`);
            } else if (expectedType === "number" || expectedType === "integer") {
              if (typeof val !== "number" || isNaN(val)) errors.push(`Property '${key}' should be number, got ${typeof val}`);
            } else if (typeof val !== expectedType) {
              errors.push(`Property '${key}' should be ${expectedType}, got ${typeof val}`);
            }
          }
          if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(val)) {
            errors.push(`Property '${key}' value '${val}' is not in allowed enum [${propSchema.enum.join(", ")}]`);
          }
        }
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(data)) {
      errors.push(`Expected array, got ${typeof data}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export class JsonEvaluator implements Evaluator {
  readonly id = "json";

  async evaluate(task: Task, response: ModelResponse, _context?: EvaluationContext): Promise<Score> {
    const stdTask = task as StandardTask;
    let parsed: unknown;

    try {
      parsed = extractJson(response.text);
    } catch (e: any) {
      return {
        value: 0,
        passed: false,
        error: e.message,
        details: { rawText: response.text },
      };
    }

    // If schema is provided, validate schema
    const schema = stdTask.schema ?? (stdTask.metadata?.schema as Record<string, unknown>);
    if (schema) {
      const { valid, errors } = validateSimpleSchema(parsed, schema);
      return {
        value: valid ? 1 : 0,
        passed: valid,
        details: {
          parsed,
          schema,
          validationErrors: errors,
        },
        error: errors.length > 0 ? errors.join("; ") : undefined,
      };
    }

    // If expected object is provided, deep compare or check matching fields
    if (stdTask.expected !== undefined) {
      const expected = stdTask.expected;
      const matches = JSON.stringify(parsed) === JSON.stringify(expected);

      return {
        value: matches ? 1 : 0,
        passed: matches,
        details: { parsed, expected, matches },
      };
    }

    // If only valid JSON was expected, passing parse is enough
    return {
      value: 1,
      passed: true,
      details: { parsed },
    };
  }
}
