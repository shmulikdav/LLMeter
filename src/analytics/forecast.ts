import { CostEvent } from '../types';

export interface ForecastResult {
  feature: string;
  currentSpend: number;
  daysTracked: number;
  dailyAverage: number;
  projectedMonthly: number;
  trend: 'up' | 'down' | 'flat';
  trendPercent: number;
}

/**
 * Forecast monthly spend based on historical events.
 * Uses daily averages and extrapolates to 30 days.
 */
export function forecast(events: CostEvent[]): ForecastResult[] {
  if (events.length === 0) return [];

  // Group by feature, then by day
  const byFeature = new Map<string, Map<string, number>>();

  // Also track global
  const globalDaily = new Map<string, number>();

  for (const event of events) {
    const feature = event.feature ?? 'untagged';
    const day = event.timestamp.substring(0, 10);

    if (!byFeature.has(feature)) byFeature.set(feature, new Map());
    const featureDays = byFeature.get(feature)!;
    featureDays.set(day, (featureDays.get(day) ?? 0) + event.totalCostUSD);

    globalDaily.set(day, (globalDaily.get(day) ?? 0) + event.totalCostUSD);
  }

  const results: ForecastResult[] = [];

  for (const [feature, dailyCosts] of byFeature) {
    results.push(computeForecast(feature, dailyCosts));
  }

  // Add global forecast
  if (byFeature.size > 1) {
    results.unshift(computeForecast('* (all features)', globalDaily));
  }

  results.sort((a, b) => b.projectedMonthly - a.projectedMonthly);

  return results;
}

function computeForecast(feature: string, dailyCosts: Map<string, number>): ForecastResult {
  const days = Array.from(dailyCosts.entries())
    .sort(([a], [b]) => a.localeCompare(b));

  const daysTracked = days.length;
  const totalSpend = days.reduce((sum, [, cost]) => sum + cost, 0);
  const dailyAverage = daysTracked > 0 ? totalSpend / daysTracked : 0;
  const projectedMonthly = dailyAverage * 30;

  // Trend: compare last 7 days average vs previous 7 days
  let trend: 'up' | 'down' | 'flat' = 'flat';
  let trendPercent = 0;

  if (days.length >= 4) {
    const mid = Math.floor(days.length / 2);
    const recentDays = days.slice(mid);
    const olderDays = days.slice(0, mid);

    const recentAvg = recentDays.reduce((s, [, c]) => s + c, 0) / recentDays.length;
    const olderAvg = olderDays.reduce((s, [, c]) => s + c, 0) / olderDays.length;

    if (olderAvg > 0) {
      trendPercent = ((recentAvg - olderAvg) / olderAvg) * 100;
      if (trendPercent > 10) trend = 'up';
      else if (trendPercent < -10) trend = 'down';
    }
  }

  return {
    feature,
    currentSpend: totalSpend,
    daysTracked,
    dailyAverage,
    projectedMonthly,
    trend,
    trendPercent: Math.round(trendPercent),
  };
}
