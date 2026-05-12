import { CostEvent } from '../types';
import { getAllPricing, calculateCost } from '../pricing';

export interface ModelRecommendation {
  feature: string;
  currentModel: string;
  currentProvider: string;
  currentMonthlyCost: number;
  recommendedModel: string;
  recommendedProvider: string;
  projectedMonthlyCost: number;
  savingsPercent: number;
  savingsUSD: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  calls: number;
}

/**
 * Analyze events and recommend cheaper models for each feature.
 * Finds alternative models in the pricing table that would cost less
 * for the same token usage patterns.
 */
export function optimizeModels(events: CostEvent[]): ModelRecommendation[] {
  if (events.length === 0) return [];

  // Group by feature + model
  const groups = new Map<string, CostEvent[]>();
  for (const event of events) {
    const feature = event.feature ?? 'untagged';
    const key = `${feature}::${event.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }

  const pricing = getAllPricing();
  const recommendations: ModelRecommendation[] = [];

  for (const [key, groupEvents] of groups) {
    const [feature, currentModel] = key.split('::');
    const currentProvider = groupEvents[0].provider;
    const calls = groupEvents.length;

    const avgInputTokens = Math.round(
      groupEvents.reduce((s, e) => s + e.inputTokens, 0) / calls
    );
    const avgOutputTokens = Math.round(
      groupEvents.reduce((s, e) => s + e.outputTokens, 0) / calls
    );
    const totalCost = groupEvents.reduce((s, e) => s + e.totalCostUSD, 0);

    // Extrapolate to 30 days
    const timestamps = groupEvents.map((e) => e.timestamp).sort();
    const firstDay = new Date(timestamps[0]);
    const lastDay = new Date(timestamps[timestamps.length - 1]);
    const daySpan = Math.max(1, (lastDay.getTime() - firstDay.getTime()) / 86400000);
    const dailyCost = totalCost / daySpan;
    const currentMonthlyCost = dailyCost * 30;

    // Find cheaper alternatives across all providers
    let bestAlternative: { provider: string; model: string; monthlyCost: number } | null = null;

    for (const [provider, table] of Object.entries(pricing)) {
      for (const [model, _modelPricing] of Object.entries(table)) {
        if (model === currentModel && provider === currentProvider) continue;

        const { totalCostUSD } = calculateCost(provider, model, avgInputTokens, avgOutputTokens);
        const altMonthlyCost = (totalCostUSD * calls) / daySpan * 30;

        if (altMonthlyCost < currentMonthlyCost * 0.5) {
          // At least 50% cheaper
          if (!bestAlternative || altMonthlyCost < bestAlternative.monthlyCost) {
            bestAlternative = { provider, model, monthlyCost: altMonthlyCost };
          }
        }
      }
    }

    if (bestAlternative && currentMonthlyCost > 0.01) {
      const savingsUSD = currentMonthlyCost - bestAlternative.monthlyCost;
      const savingsPercent = Math.round((savingsUSD / currentMonthlyCost) * 100);

      recommendations.push({
        feature,
        currentModel,
        currentProvider,
        currentMonthlyCost: Math.round(currentMonthlyCost * 100) / 100,
        recommendedModel: bestAlternative.model,
        recommendedProvider: bestAlternative.provider,
        projectedMonthlyCost: Math.round(bestAlternative.monthlyCost * 100) / 100,
        savingsPercent,
        savingsUSD: Math.round(savingsUSD * 100) / 100,
        avgInputTokens,
        avgOutputTokens,
        calls,
      });
    }
  }

  // Sort by savings descending
  recommendations.sort((a, b) => b.savingsUSD - a.savingsUSD);

  return recommendations;
}
