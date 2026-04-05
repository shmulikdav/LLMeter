import { CostAdapter, CostEvent } from '../types';

export class ConsoleAdapter implements CostAdapter {
  name = 'console';

  async write(event: CostEvent): Promise<void> {
    const feature = event.feature ?? 'untagged';
    const cost = `$${event.totalCostUSD.toFixed(5)}`;
    const tokens = `${event.totalTokens} tokens`;
    const latency = `${event.latencyMs}ms`;
    console.log(`[llm-cost-meter] ${feature} — ${cost} (${tokens}, ${latency})`);
  }
}
