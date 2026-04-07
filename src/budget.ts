import { CostEvent, BudgetRule, BudgetConfig, BudgetStatus } from './types';

function getUTCDate(): string {
  return new Date().toISOString().substring(0, 10);
}

export class BudgetMonitor {
  private rules: BudgetRule[] = [];
  // Map of "feature:date" → accumulated cost
  private accumulators = new Map<string, number>();
  // Set of "feature:date" keys that have already fired onExceed
  private firedAlerts = new Set<string>();
  private currentDate: string = getUTCDate();

  configure(config: BudgetConfig): void {
    this.rules = [...config.rules];
  }

  /**
   * Check an event against all budget rules.
   * Called automatically after each cost event.
   */
  check(event: CostEvent): void {
    if (this.rules.length === 0) return;

    // Reset accumulators if day changed
    const today = getUTCDate();
    if (today !== this.currentDate) {
      this.accumulators.clear();
      this.firedAlerts.clear();
      this.currentDate = today;
    }

    const feature = event.feature ?? 'untagged';
    const cost = event.totalCostUSD;

    // Accumulate for specific feature
    const featureKey = `${feature}:${today}`;
    this.accumulators.set(featureKey, (this.accumulators.get(featureKey) ?? 0) + cost);

    // Accumulate for global (*)
    const globalKey = `*:${today}`;
    this.accumulators.set(globalKey, (this.accumulators.get(globalKey) ?? 0) + cost);

    // Check rules
    for (const rule of this.rules) {
      const key = `${rule.feature}:${today}`;
      const spent = this.accumulators.get(key) ?? 0;

      if (spent >= rule.dailyLimitUSD && !this.firedAlerts.has(key)) {
        this.firedAlerts.add(key);
        try {
          rule.onExceed(rule, spent);
        } catch {
          // Don't let user callback crash the pipeline
        }
      }
    }
  }

  /**
   * Get current budget status for all rules.
   */
  getStatus(): BudgetStatus[] {
    const today = getUTCDate();

    // Reset if day changed
    if (today !== this.currentDate) {
      this.accumulators.clear();
      this.firedAlerts.clear();
      this.currentDate = today;
    }

    return this.rules.map((rule) => {
      const key = `${rule.feature}:${today}`;
      const spent = this.accumulators.get(key) ?? 0;
      return {
        feature: rule.feature,
        dailyLimitUSD: rule.dailyLimitUSD,
        currentSpendUSD: spent,
        exceeded: spent >= rule.dailyLimitUSD,
        date: today,
      };
    });
  }

  /**
   * Reset all accumulators and alerts. Useful for testing.
   */
  reset(): void {
    this.rules = [];
    this.accumulators.clear();
    this.firedAlerts.clear();
    this.currentDate = getUTCDate();
  }
}

// Global singleton
export const budgetMonitor = new BudgetMonitor();
