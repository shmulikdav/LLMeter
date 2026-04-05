import { ModelPricing, PricingTable } from '../types';
import openaiPricing from './openai.json';
import anthropicPricing from './anthropic.json';

const pricingTables: Record<string, PricingTable> = {
  openai: { ...(openaiPricing as PricingTable) },
  anthropic: { ...(anthropicPricing as PricingTable) },
};

// Track models we've already warned about to avoid spam
const warnedModels = new Set<string>();

// Callback set by the core module for unknown model warnings
let onUnknownModel: ((provider: string, model: string) => void) | null = null;

export function setUnknownModelHandler(
  handler: ((provider: string, model: string) => void) | null
): void {
  onUnknownModel = handler;
}

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): { inputCostUSD: number; outputCostUSD: number; totalCostUSD: number } {
  const table = pricingTables[provider];
  if (!table) {
    if (provider !== 'custom' && onUnknownModel) {
      const key = `${provider}/${model}`;
      if (!warnedModels.has(key)) {
        warnedModels.add(key);
        onUnknownModel(provider, model);
      }
    }
    return { inputCostUSD: 0, outputCostUSD: 0, totalCostUSD: 0 };
  }

  const pricing = table[model];
  if (!pricing) {
    if (onUnknownModel) {
      const key = `${provider}/${model}`;
      if (!warnedModels.has(key)) {
        warnedModels.add(key);
        onUnknownModel(provider, model);
      }
    }
    return { inputCostUSD: 0, outputCostUSD: 0, totalCostUSD: 0 };
  }

  const inputCostUSD = (inputTokens / 1_000_000) * pricing.input;
  const outputCostUSD = (outputTokens / 1_000_000) * pricing.output;
  const totalCostUSD = inputCostUSD + outputCostUSD;

  return { inputCostUSD, outputCostUSD, totalCostUSD };
}

/**
 * Add or update pricing for a model. Allows users to register custom models
 * or override built-in pricing.
 */
export function configurePricing(
  provider: string,
  model: string,
  pricing: { input: number; output: number }
): void {
  if (!pricingTables[provider]) {
    pricingTables[provider] = {};
  }
  pricingTables[provider][model] = {
    input: pricing.input,
    output: pricing.output,
    unit: 'per_million_tokens',
  };
}

/**
 * Set pricing for an entire provider at once.
 */
export function setPricingTable(provider: string, table: PricingTable): void {
  pricingTables[provider] = { ...table };
}

export function getAvailableModels(provider: string): string[] {
  const table = pricingTables[provider];
  return table ? Object.keys(table) : [];
}

export function getAllPricing(): Record<string, PricingTable> {
  return pricingTables;
}
