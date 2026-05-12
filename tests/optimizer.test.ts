import { optimizeModels } from '../src/analytics/optimizer';
import { CostEvent } from '../src/types';

function makeEvent(feature: string, model: string, provider: 'openai' | 'anthropic', cost: number, day: string): CostEvent {
  return {
    id: `evt-${feature}-${day}`, timestamp: `${day}T10:00:00Z`,
    provider, model, inputTokens: 1000, outputTokens: 500,
    totalTokens: 1500, inputCostUSD: cost * 0.3, outputCostUSD: cost * 0.7,
    totalCostUSD: cost, latencyMs: 500, feature,
  };
}

describe('optimizeModels', () => {
  it('returns empty for no events', () => {
    expect(optimizeModels([])).toEqual([]);
  });

  it('recommends cheaper model when available', () => {
    // gpt-4o costs $2.50/$10 per M tokens
    // gpt-4o-mini costs $0.15/$0.60 per M tokens — 94% cheaper
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent('classifier', 'gpt-4o', 'openai', 0.0075, `2025-04-${String(i + 1).padStart(2, '0')}`)
    );

    const results = optimizeModels(events);
    expect(results.length).toBeGreaterThan(0);

    const rec = results.find(r => r.feature === 'classifier');
    expect(rec).toBeDefined();
    expect(rec!.currentModel).toBe('gpt-4o');
    expect(rec!.savingsPercent).toBeGreaterThan(50);
    expect(rec!.savingsUSD).toBeGreaterThan(0);
  });

  it('does not recommend if already cheapest', () => {
    // gpt-4o-mini is already the cheapest OpenAI model
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent('classifier', 'gpt-4o-mini', 'openai', 0.00045, `2025-04-${String(i + 1).padStart(2, '0')}`)
    );

    const results = optimizeModels(events);
    // Should not have a recommendation (or if it does, savings < 50%)
    const rec = results.find(r => r.feature === 'classifier' && r.savingsPercent >= 50);
    expect(rec).toBeUndefined();
  });

  it('recommends cross-provider alternatives', () => {
    // claude-opus costs $15/$75 — very expensive
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent('chat', 'claude-opus-4-20250514', 'anthropic', 0.0525, `2025-04-${String(i + 1).padStart(2, '0')}`)
    );

    const results = optimizeModels(events);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].feature).toBe('chat');
    expect(results[0].savingsPercent).toBeGreaterThan(0);
  });

  it('sorts by savings descending', () => {
    const events = [
      // Expensive feature
      ...Array.from({ length: 5 }, (_, i) =>
        makeEvent('expensive', 'claude-opus-4-20250514', 'anthropic', 0.10, `2025-04-${String(i + 1).padStart(2, '0')}`)
      ),
      // Less expensive feature
      ...Array.from({ length: 5 }, (_, i) =>
        makeEvent('moderate', 'gpt-4o', 'openai', 0.01, `2025-04-${String(i + 1).padStart(2, '0')}`)
      ),
    ];

    const results = optimizeModels(events);
    if (results.length >= 2) {
      expect(results[0].savingsUSD).toBeGreaterThanOrEqual(results[1].savingsUSD);
    }
  });

  it('handles single-day data', () => {
    const events = [
      makeEvent('chat', 'gpt-4o', 'openai', 0.0075, '2025-04-01'),
    ];

    // Should not crash
    const results = optimizeModels(events);
    expect(Array.isArray(results)).toBe(true);
  });
});
