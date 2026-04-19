import { detectAnomalies } from '../src/analytics/anomalies';
import { CostEvent } from '../src/types';

function makeEvent(day: string, feature: string, cost: number): CostEvent {
  return {
    id: `evt-${day}-${feature}`, timestamp: `${day}T10:00:00Z`, provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', inputTokens: 1000, outputTokens: 500,
    totalTokens: 1500, inputCostUSD: cost * 0.3, outputCostUSD: cost * 0.7,
    totalCostUSD: cost, latencyMs: 500, feature,
  };
}

describe('detectAnomalies', () => {
  it('returns empty for no events', () => {
    expect(detectAnomalies([])).toEqual([]);
  });

  it('returns empty when no anomalies exist', () => {
    // 10 days of steady $10/day
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'chat', 10)
    );

    const anomalies = detectAnomalies(events, { windowDays: 7 });
    expect(anomalies).toHaveLength(0);
  });

  it('detects a spike day', () => {
    // 7 days of $10/day, then day 8 = $50
    const events = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'chat', 10)
      ),
      makeEvent('2025-04-08', 'chat', 50), // 5x spike
    ];

    const anomalies = detectAnomalies(events, { windowDays: 7, threshold: 2.0 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].date).toBe('2025-04-08');
    expect(anomalies[0].feature).toBe('chat');
    expect(anomalies[0].ratio).toBe(5);
    expect(anomalies[0].severity).toBe('high');
  });

  it('respects custom threshold', () => {
    const events = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'chat', 10)
      ),
      makeEvent('2025-04-08', 'chat', 15), // 1.5x — below 2.0 threshold
    ];

    expect(detectAnomalies(events, { threshold: 2.0 })).toHaveLength(0);
    expect(detectAnomalies(events, { threshold: 1.3 })).toHaveLength(1);
  });

  it('classifies severity correctly', () => {
    const events = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'chat', 10)
      ),
      makeEvent('2025-04-08', 'chat', 22), // 2.2x = warning
      makeEvent('2025-04-09', 'chat', 10), // normal (but window shifted)
    ];

    const anomalies = detectAnomalies(events, { windowDays: 7, threshold: 2.0 });
    const warning = anomalies.find(a => a.date === '2025-04-08');
    expect(warning?.severity).toBe('warning');
  });

  it('tracks multiple features independently', () => {
    const events = [
      ...Array.from({ length: 7 }, (_, i) => makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'chat', 10)),
      ...Array.from({ length: 7 }, (_, i) => makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'summarizer', 5)),
      makeEvent('2025-04-08', 'chat', 50),       // chat spike
      makeEvent('2025-04-08', 'summarizer', 5),  // summarizer normal
    ];

    const anomalies = detectAnomalies(events, { windowDays: 7, threshold: 2.0 });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].feature).toBe('chat');
  });

  it('sorts by ratio descending', () => {
    const events = [
      ...Array.from({ length: 7 }, (_, i) => makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'chat', 10)),
      ...Array.from({ length: 7 }, (_, i) => makeEvent(`2025-04-${String(i + 1).padStart(2, '0')}`, 'summarizer', 5)),
      makeEvent('2025-04-08', 'chat', 30),       // 3x
      makeEvent('2025-04-08', 'summarizer', 25), // 5x
    ];

    const anomalies = detectAnomalies(events, { windowDays: 7, threshold: 2.0 });
    expect(anomalies[0].feature).toBe('summarizer'); // higher ratio first
    expect(anomalies[1].feature).toBe('chat');
  });

  it('respects custom window size', () => {
    // 3-day window
    const events = [
      makeEvent('2025-04-01', 'chat', 10),
      makeEvent('2025-04-02', 'chat', 10),
      makeEvent('2025-04-03', 'chat', 10),
      makeEvent('2025-04-04', 'chat', 30), // 3x spike
    ];

    const anomalies = detectAnomalies(events, { windowDays: 3, threshold: 2.0 });
    expect(anomalies).toHaveLength(1);
  });
});
