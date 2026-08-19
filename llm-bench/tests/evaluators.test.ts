import { test, expect, describe } from "bun:test";
import { ExactEvaluator } from "../src/evaluators/exact";
import { ContainsEvaluator } from "../src/evaluators/contains";
import { RegexEvaluator } from "../src/evaluators/regex";
import { JsonEvaluator, extractJson } from "../src/evaluators/json";
import { parseTestOutput } from "../src/evaluators/test";
import { LLMJudgeEvaluator } from "../src/evaluators/llm-judge";
import { EvaluatorRegistry, resolveEvaluator } from "../src/evaluators/registry";
import { MockModel } from "../src/providers/mock";
import type { Task, StandardTask, CodingTask } from "../src/core/task";
import type { ModelResponse } from "../src/core/model";

function createDummyResponse(text: string): ModelResponse {
  return {
    text,
    usage: { inputTokens: 10, outputTokens: 10 },
    timing: { latencyMs: 10 },
  };
}

describe("Evaluators", () => {
  describe("ExactEvaluator", () => {
    const evaluator = new ExactEvaluator();

    test("matches exact text", async () => {
      const task: StandardTask = { id: "t1", prompt: "", expected: "42" };
      const score = await evaluator.evaluate(task, createDummyResponse("42"));
      expect(score.passed).toBe(true);
      expect(score.value).toBe(1.0);
    });

    test("handles trim and numeric equivalence", async () => {
      const task: StandardTask = { id: "t1", prompt: "", expected: "125" };
      const score = await evaluator.evaluate(task, createDummyResponse("  125 \n"));
      expect(score.passed).toBe(true);
      expect(score.value).toBe(1.0);
    });

    test("handles case-insensitive matching when option configured", async () => {
      const task: StandardTask = {
        id: "t1",
        prompt: "",
        expected: "Hello World",
        metadata: { caseSensitive: false },
      };
      const score = await evaluator.evaluate(task, createDummyResponse("hello world"));
      expect(score.passed).toBe(true);
    });

    test("fails on mismatch", async () => {
      const task: StandardTask = { id: "t1", prompt: "", expected: "42" };
      const score = await evaluator.evaluate(task, createDummyResponse("43"));
      expect(score.passed).toBe(false);
      expect(score.value).toBe(0);
    });
  });

  describe("ContainsEvaluator", () => {
    const evaluator = new ContainsEvaluator();

    test("checks single substring", async () => {
      const task: StandardTask = { id: "t1", prompt: "", expected: "needle" };
      const score = await evaluator.evaluate(task, createDummyResponse("There is a needle in this haystack"));
      expect(score.passed).toBe(true);
      expect(score.value).toBe(1);
    });

    test("checks array with all mode", async () => {
      const task: StandardTask = { id: "t1", prompt: "", expected: ["alpha", "beta", "gamma"] };
      const passedScore = await evaluator.evaluate(task, createDummyResponse("alpha and beta and gamma are Greek"));
      expect(passedScore.passed).toBe(true);

      const failedScore = await evaluator.evaluate(task, createDummyResponse("only alpha and beta"));
      expect(failedScore.passed).toBe(false);
      expect(failedScore.value).toBeCloseTo(2 / 3, 2);
    });
  });

  describe("RegexEvaluator", () => {
    const evaluator = new RegexEvaluator();

    test("matches pattern correctly", async () => {
      const task: StandardTask = {
        id: "t1",
        prompt: "",
        pattern: "^\\* [A-Z]+\\n\\* [A-Z]+$",
      };
      const score = await evaluator.evaluate(task, createDummyResponse("* RUST\n* PYTHON"));
      expect(score.passed).toBe(true);
      expect(score.value).toBe(1);
    });

    test("fails when pattern does not match", async () => {
      const task: StandardTask = {
        id: "t1",
        prompt: "",
        pattern: "^\\d{3}-\\d{3}-\\d{4}$",
      };
      const score = await evaluator.evaluate(task, createDummyResponse("123-456"));
      expect(score.passed).toBe(false);
    });
  });

  describe("JsonEvaluator", () => {
    const evaluator = new JsonEvaluator();

    test("extracts JSON from markdown code block", () => {
      const markdown = "Here is the response:\n```json\n{\n  \"name\": \"Alice\",\n  \"age\": 30\n}\n```";
      const extracted = extractJson(markdown) as any;
      expect(extracted.name).toBe("Alice");
      expect(extracted.age).toBe(30);
    });

    test("validates JSON schema types and required properties", async () => {
      const task: StandardTask = {
        id: "t1",
        prompt: "",
        schema: {
          type: "object",
          required: ["name", "age", "email"],
          properties: {
            name: { type: "string" },
            age: { type: "number" },
            email: { type: "string" },
          },
        },
      };

      const validResponse = createDummyResponse('{"name": "Bob", "age": 25, "email": "bob@example.com"}');
      const validScore = await evaluator.evaluate(task, validResponse);
      expect(validScore.passed).toBe(true);

      const invalidResponse = createDummyResponse('{"name": "Bob", "age": "twenty-five"}');
      const invalidScore = await evaluator.evaluate(task, invalidResponse);
      expect(invalidScore.passed).toBe(false);
      expect(invalidScore.error).toContain("Missing required property: 'email'");
    });
  });

  describe("Command & Test parser", () => {
    test("parses bun test output format", () => {
      const bunOutput = " 14 pass\n 0 fail\n 14 expect() calls\nRan 14 tests across 2 files.";
      const stats = parseTestOutput(bunOutput);
      expect(stats).not.toBeNull();
      expect(stats?.passed).toBe(14);
      expect(stats?.failed).toBe(0);
      expect(stats?.total).toBe(14);
    });

    test("parses jest/vitest output format", () => {
      const jestOutput = "Tests:       2 passed, 2 total";
      const stats = parseTestOutput(jestOutput);
      expect(stats).not.toBeNull();
      expect(stats?.passed).toBe(2);
      expect(stats?.failed).toBe(0);
      expect(stats?.total).toBe(2);
    });
  });

  describe("LLMJudgeEvaluator", () => {
    test("evaluates candidate response using judge model", async () => {
      const judgeModel = new MockModel(
        { id: "mock-judge", provider: "mock", model: "judge-v1" },
        JSON.stringify({
          score: 0.95,
          passed: true,
          reasoning: "Comprehensive and accurate answer",
        })
      );

      const judgeEvaluator = new LLMJudgeEvaluator(judgeModel);
      const task: StandardTask = {
        id: "judge-task",
        prompt: "Explain quantum entanglement simply.",
        judgePrompt: "Must mention correlated states and distance independence.",
      };

      const score = await judgeEvaluator.evaluate(
        task,
        createDummyResponse("Quantum entanglement is when two particles share states..."),
        { task, response: createDummyResponse(""), judgeModel }
      );

      expect(score.passed).toBe(true);
      expect(score.value).toBe(0.95);
      expect(score.details?.reasoning).toBe("Comprehensive and accurate answer");
    });
  });

  describe("EvaluatorRegistry", () => {
    test("resolves appropriate evaluators based on task type and fields", () => {
      const codingTask: CodingTask = {
        id: "c1",
        type: "coding",
        prompt: "",
        projectPath: "",
        evaluation: { type: "tests", command: "bun test" },
      };
      expect(resolveEvaluator(codingTask).id).toBe("tests");

      const jsonTask: StandardTask = {
        id: "j1",
        prompt: "",
        schema: { type: "object" },
      };
      expect(resolveEvaluator(jsonTask).id).toBe("json");

      const regexTask: StandardTask = {
        id: "r1",
        prompt: "",
        pattern: "^[0-9]+$",
      };
      expect(resolveEvaluator(regexTask).id).toBe("regex");

      const exactTask: StandardTask = {
        id: "e1",
        prompt: "",
        expected: "exact-val",
      };
      expect(resolveEvaluator(exactTask).id).toBe("exact");
    });
  });
});
