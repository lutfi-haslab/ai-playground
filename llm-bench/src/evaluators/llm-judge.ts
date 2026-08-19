import type { Evaluator, Score, EvaluationContext } from "../core/evaluator";
import type { Task, StandardTask } from "../core/task";
import type { Model, ModelResponse } from "../core/model";
import { extractJson } from "./json";

export class LLMJudgeEvaluator implements Evaluator {
  readonly id = "llm-judge";
  private defaultJudge?: Model;

  constructor(defaultJudge?: Model) {
    this.defaultJudge = defaultJudge;
  }

  async evaluate(task: Task, response: ModelResponse, context?: EvaluationContext): Promise<Score> {
    const stdTask = task as StandardTask;
    const judge = context?.judgeModel ?? this.defaultJudge;

    if (!judge) {
      return {
        value: 0,
        passed: false,
        error: "No judge model available for LLM judge evaluation",
      };
    }

    const customPrompt = stdTask.judgePrompt ?? (stdTask.metadata?.judgePrompt as string);
    const expected = stdTask.expected ? `Expected Answer/Criteria: ${JSON.stringify(stdTask.expected)}\n` : "";

    const systemPrompt =
      "You are an impartial, strict AI benchmark judge. Evaluate the given candidate response against the task prompt and criteria. " +
      "Return ONLY a JSON object with this exact schema:\n" +
      "{\n" +
      '  "score": number (between 0.0 and 1.0),\n' +
      '  "passed": boolean (true if score >= 0.7, false otherwise),\n' +
      '  "reasoning": string (brief explanation of judgment)\n' +
      "}";

    const userPrompt =
      `Task Prompt:\n${stdTask.prompt}\n\n` +
      expected +
      (customPrompt ? `Evaluation Criteria:\n${customPrompt}\n\n` : "") +
      `Candidate Response:\n${response.text}\n\n` +
      "Judge this candidate response strictly:";

    try {
      const judgeResponse = await judge.generate({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
      });

      const parsed = extractJson(judgeResponse.text) as {
        score?: number;
        passed?: boolean;
        reasoning?: string;
      };

      const scoreValue = typeof parsed.score === "number" ? Math.min(1, Math.max(0, parsed.score)) : 0;
      const passed = typeof parsed.passed === "boolean" ? parsed.passed : scoreValue >= 0.7;

      return {
        value: scoreValue,
        passed,
        details: {
          judgeModel: judge.id,
          reasoning: parsed.reasoning ?? judgeResponse.text,
          judgeText: judgeResponse.text,
        },
      };
    } catch (e: any) {
      return {
        value: 0,
        passed: false,
        error: `LLM Judge failed: ${e.message}`,
      };
    }
  }
}
