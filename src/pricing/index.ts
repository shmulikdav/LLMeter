import { PricingTable } from '../types';
import openaiPricing from './openai.json';
import anthropicPricing from './anthropic.json';

const pricingTables: Record<string, PricingTable> = {
  openai: openaiPricing as PricingTable,
  anthropic: anthropicPricing as PricingTable,
};

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): { inputCostUSD: number; outputCostUSD: number; totalCostUSD: number } {
  const table = pricingTables[provider];
  if (!table) {
    return { inputCostUSD: 0, outputCostUSD: 0, totalCostUSD: 0 };
  }

  const pricing = table[model];
  if (!pricing) {
    return { inputCostUSD: 0, outputCostUSD: 0, totalCostUSD: 0 };
  }

  const inputCostUSD = (inputTokens / 1_000_000) * pricing.input;
  const outputCostUSD = (outputTokens / 1_000_000) * pricing.output;
  const totalCostUSD = inputCostUSD + outputCostUSD;

  return { inputCostUSD, outputCostUSD, totalCostUSD };
}

export function getAvailableModels(provider: string): string[] {
  const table = pricingTables[provider];
  return table ? Object.keys(table) : [];
}

export function getAllPricing(): Record<string, PricingTable> {
  return pricingTables;
}
