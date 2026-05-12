import { comparePromptVersions } from '../src/analytics/compare';
import { CostEvent } from '../src/types';

function makeEvent(promptName: string, promptVersion: string, cost: number, inputTokens = 100, outputTokens = 50): CostEvent {
  return {
    id: `evt-${promptName}-${promptVersion}`, timestamp: '2025-04-05T10:00:00Z',
    provider: 'anthropic', model: 'claude-sonnet-4-20250514',
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    inputCostUSD: cost * 0.3, outputCostUSD: cost * 0.7, totalCostUSD: cost,
    latencyMs: 500, feature: 'chat', promptName, promptVersion,
  };
}

describe('comparePromptVersions', () => {
  it('returns empty for no events', () => {
    expect(comparePromptVersions([])).toEqual([]);
  });

  it('returns empty for events without prompt metadata', () => {
    const events: CostEvent[] = [{
      id: '1', timestamp: '2025-04-05T10:00:00Z', provider: 'anthropic',
      model: 'claude-sonnet-4-20250514', inputTokens: 100, outputTokens: 50,
      totalTokens: 150, inputCostUSD: 0.003, outputCostUSD: 0.007,
      totalCostUSD: 0.01, latencyMs: 500, feature: 'chat',
    }];
    expect(comparePromptVersions(events)).toEqual([]);
  });

  it('compares versions of the same prompt', () => {
    const events = [
      makeEvent('greeting', 'v1', 0.01),
      makeEvent('greeting', 'v1', 0.01),
      makeEvent('greeting', 'v2', 0.03),
      makeEvent('greeting', 'v2', 0.03),
    ];

    const results = comparePromptVersions(events, 'greeting');
    expect(results).toHaveLength(2);

    const v1 = results.find(r => r.version === 'v1')!;
    const v2 = results.find(r => r.version === 'v2')!;

    expect(v1.calls).toBe(2);
    expect(v1.avgCostPerCall).toBeCloseTo(0.01, 4);
    expect(v1.changeFromBaseline).toBe(0); // baseline

    expect(v2.calls).toBe(2);
    expect(v2.avgCostPerCall).toBeCloseTo(0.03, 4);
    expect(v2.changeFromBaseline).toBe(200); // +200%
  });

  it('filters by prompt name', () => {
    const events = [
      makeEvent('greeting', 'v1', 0.01),
      makeEvent('summary', 'v1', 0.05),
    ];

    const results = comparePromptVersions(events, 'greeting');
    expect(results).toHaveLength(1);
    expect(results[0].promptName).toBe('greeting');
  });

  it('shows all prompts when no name filter', () => {
    const events = [
      makeEvent('greeting', 'v1', 0.01),
      makeEvent('summary', 'v1', 0.05),
    ];

    const results = comparePromptVersions(events);
    expect(results).toHaveLength(2);
  });

  it('calculates average tokens', () => {
    const events = [
      makeEvent('greeting', 'v1', 0.01, 100, 50),
      makeEvent('greeting', 'v1', 0.01, 200, 100),
    ];

    const results = comparePromptVersions(events, 'greeting');
    expect(results[0].avgInputTokens).toBe(150);
    expect(results[0].avgOutputTokens).toBe(75);
  });
});
