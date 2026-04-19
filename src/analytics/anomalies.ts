import { CostEvent } from '../types';

export interface AnomalyResult {
  feature: string;
  date: string;
  cost: number;
  average: number;
  ratio: number;
  severity: 'normal' | 'warning' | 'high';
}

export interface AnomalyOptions {
  /** Number of days for the rolling average window. Default: 7. */
  windowDays?: number;
  /** Ratio threshold to flag as anomaly. Default: 2.0 (2x average). */
  threshold?: number;
}

/**
 * Detect cost anomalies by comparing each day's spend to its rolling average.
 * Returns days where cost exceeds `threshold` times the rolling average.
 */
export function detectAnomalies(
  events: CostEvent[],
  options: AnomalyOptions = {}
): AnomalyResult[] {
  const windowDays = options.windowDays ?? 7;
  const threshold = options.threshold ?? 2.0;

  if (events.length === 0) return [];

  // Group by feature, then by day
  const byFeature = new Map<string, Map<string, number>>();

  for (const event of events) {
    const feature = event.feature ?? 'untagged';
    const day = event.timestamp.substring(0, 10);

    if (!byFeature.has(feature)) byFeature.set(feature, new Map());
    const featureDays = byFeature.get(feature)!;
    featureDays.set(day, (featureDays.get(day) ?? 0) + event.totalCostUSD);
  }

  const anomalies: AnomalyResult[] = [];

  for (const [feature, dailyCosts] of byFeature) {
    const days = Array.from(dailyCosts.entries())
      .sort(([a], [b]) => a.localeCompare(b));

    for (let i = windowDays; i < days.length; i++) {
      const [date, cost] = days[i];

      // Calculate average of previous windowDays
      let windowSum = 0;
      for (let j = i - windowDays; j < i; j++) {
        windowSum += days[j][1];
      }
      const average = windowSum / windowDays;

      if (average > 0) {
        const ratio = cost / average;
        if (ratio >= threshold) {
          anomalies.push({
            feature,
            date,
            cost,
            average,
            ratio: Math.round(ratio * 100) / 100,
            severity: ratio >= 2.5 ? 'high' : 'warning',
          });
        }
      }
    }
  }

  anomalies.sort((a, b) => b.ratio - a.ratio);

  return anomalies;
}
