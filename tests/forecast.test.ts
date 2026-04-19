import { forecast } from '../src/analytics/forecast';
import { CostEvent } from '../src/types';

function makeEvent(day: string, feature: string, cost: number): CostEvent {
  return {
    id: `evt-${day}-${feature}`, timestamp: `${day}T10:00:00Z`, provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', inputTokens: 1000, outputTokens: 500,
    totalTokens: 1500, inputCostUSD: cost * 0.3, outputCostUSD: cost * 0.7,
    totalCostUSD: cost, latencyMs: 500, feature,
  };
}

describe('forecast', () => {
  it('returns empty for no events', () => {
    expect(forecast([])).toEqual([]);
  });

  it('calculates daily average and projected monthly', () => {
    const events = [
      makeEvent('2025-04-01', 'chat', 10),
      makeEvent('2025-04-02', 'chat', 10),
      makeEvent('2025-04-03', 'chat', 10),
    ];

    const results = forecast(events);
    const chat = results.find(r => r.feature === 'chat')!;

    expect(chat.daysTracked).toBe(3);
    expect(chat.dailyAverage).toBeCloseTo(10, 2);
    expect(chat.projectedMonthly).toBeCloseTo(300, 2); // 10 * 30
    expect(chat.currentSpend).toBeCloseTo(30, 2);
  });

  it('detects upward trend', () => {
    const events = [
      makeEvent('2025-04-01', 'chat', 1),
      makeEvent('2025-04-02', 'chat', 1),
      makeEvent('2025-04-03', 'chat', 1),
      makeEvent('2025-04-04', 'chat', 1),
      makeEvent('2025-04-05', 'chat', 5),
      makeEvent('2025-04-06', 'chat', 5),
      makeEvent('2025-04-07', 'chat', 5),
      makeEvent('2025-04-08', 'chat', 5),
    ];

    const results = forecast(events);
    const chat = results.find(r => r.feature === 'chat')!;
    expect(chat.trend).toBe('up');
    expect(chat.trendPercent).toBeGreaterThan(0);
  });

  it('detects downward trend', () => {
    const events = [
      makeEvent('2025-04-01', 'chat', 10),
      makeEvent('2025-04-02', 'chat', 10),
      makeEvent('2025-04-03', 'chat', 10),
      makeEvent('2025-04-04', 'chat', 10),
      makeEvent('2025-04-05', 'chat', 2),
      makeEvent('2025-04-06', 'chat', 2),
      makeEvent('2025-04-07', 'chat', 2),
      makeEvent('2025-04-08', 'chat', 2),
    ];

    const results = forecast(events);
    const chat = results.find(r => r.feature === 'chat')!;
    expect(chat.trend).toBe('down');
  });

  it('includes global forecast when multiple features', () => {
    const events = [
      makeEvent('2025-04-01', 'chat', 10),
      makeEvent('2025-04-01', 'summarizer', 5),
    ];

    const results = forecast(events);
    const global = results.find(r => r.feature === '* (all features)');
    expect(global).toBeDefined();
    expect(global!.currentSpend).toBeCloseTo(15, 2);
  });

  it('sorts by projected monthly descending', () => {
    const events = [
      makeEvent('2025-04-01', 'cheap', 1),
      makeEvent('2025-04-01', 'expensive', 100),
      makeEvent('2025-04-01', 'medium', 10),
    ];

    const results = forecast(events);
    const features = results.map(r => r.feature).filter(f => !f.startsWith('*'));
    expect(features[0]).toBe('expensive');
    expect(features[features.length - 1]).toBe('cheap');
  });
});
