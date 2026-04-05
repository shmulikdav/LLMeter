import { PricingTable } from '../types';
import openaiPricing from './openai.json';
import anthropicPricing from './anthropic.json';

const pricingTables: Record<string, PricingTable> = {
  openai: { ...(openaiPricing as PricingTable) },
  anthropic: { ...(anthropicPricing as PricingTable) },
};

// Track models we've already warned about to avoid spam (capped to prevent memory leak)
const MAX_WARNED = 1000;
const warnedModels = new Set<string>();

let onUnknownModel: ((provider: string, model: string) => void) | null = null;

export function setUnknownModelHandler(
  handler: ((provider: string, model: string) => void) | null
): void {
  onUnknownModel = handler;
}

function trackWarned(key: string, provider: string, model: string): void {
  if (warnedModels.has(key)) return;
  if (warnedModels.size >= MAX_WARNED) warnedModels.clear();
  warnedModels.add(key);
  if (onUnknownModel) onUnknownModel(provider, model);
}

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): { inputCostUSD: number; outputCostUSD: number; totalCostUSD: number } {
  const table = pricingTables[provider];
  if (!table) {
    if (provider !== 'custom') {
      trackWarned(`${provider}/${model}`, provider, model);
    }
    return { inputCostUSD: 0, outputCostUSD: 0, totalCostUSD: 0 };
  }

  const pricing = table[model];
  if (!pricing) {
    trackWarned(`${provider}/${model}`, provider, model);
    return { inputCostUSD: 0, outputCostUSD: 0, totalCostUSD: 0 };
  }

  const inputCostUSD = (inputTokens / 1_000_000) * pricing.input;
  const outputCostUSD = (outputTokens / 1_000_000) * pricing.output;
  const totalCostUSD = inputCostUSD + outputCostUSD;

  return { inputCostUSD, outputCostUSD, totalCostUSD };
}

/**
 * Add or update pricing for a model.
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
 * Remove pricing for a specific model. Returns true if the model existed.
 */
export function removePricing(provider: string, model: string): boolean {
  const table = pricingTables[provider];
  if (!table || !table[model]) return false;
  delete table[model];
  return true;
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

/**
 * Returns a deep copy of all pricing tables. Mutations to the returned
 * object do not affect the internal state.
 */
export function getAllPricing(): Record<string, PricingTable> {
  return JSON.parse(JSON.stringify(pricingTables));
}
