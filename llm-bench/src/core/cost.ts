import type { ModelPricing } from "./model";

export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing?: ModelPricing
): number {
  if (!pricing) return 0;

  const inputPrice = pricing.inputPricePerMillion ?? pricing.input ?? 0;
  const outputPrice = pricing.outputPricePerMillion ?? pricing.output ?? 0;

  const inputCost = (inputTokens / 1_000_000) * inputPrice;
  const outputCost = (outputTokens / 1_000_000) * outputPrice;

  return Number((inputCost + outputCost).toFixed(6));
}
