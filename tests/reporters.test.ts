import { CostEvent } from '../src/types';
import { filterEvents, summarize, generateInsight } from '../src/reporters/summary';
import { summaryToCsv } from '../src/reporters/csv';
import { summaryToJson } from '../src/reporters/json';

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    id: 'evt-1',
    timestamp: '2025-04-03T10:00:00Z',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 400,
    outputTokens: 200,
    totalTokens: 600,
    inputCostUSD: 0.0012,
    outputCostUSD: 0.003,
    totalCostUSD: 0.0042,
    latencyMs: 500,
    feature: 'chat',
    userId: 'user_a',
    env: 'production',
    ...overrides,
  };
}

const testEvents: CostEvent[] = [
  makeEvent({ id: 'e1', feature: 'chat', userId: 'user_a', totalCostUSD: 0.10, totalTokens: 1000 }),
  makeEvent({ id: 'e2', feature: 'chat', userId: 'user_b', totalCostUSD: 0.08, totalTokens: 800 }),
  makeEvent({ id: 'e3', feature: 'summarizer', userId: 'user_a', totalCostUSD: 0.005, totalTokens: 300, env: 'staging' }),
  makeEvent({ id: 'e4', feature: 'classifier', userId: 'user_c', totalCostUSD: 0.001, totalTokens: 100, model: 'gpt-4o-mini', provider: 'openai' }),
  makeEvent({ id: 'e5', feature: 'chat', userId: 'user_a', totalCostUSD: 0.12, totalTokens: 1200, timestamp: '2025-04-05T10:00:00Z' }),
];

describe('filterEvents', () => {
  it('filters by feature', () => {
    const filtered = filterEvents(testEvents, { feature: 'chat' });
    expect(filtered).toHaveLength(3);
    expect(filtered.every(e => e.feature === 'chat')).toBe(true);
  });

  it('filters by userId', () => {
    const filtered = filterEvents(testEvents, { userId: 'user_a' });
    expect(filtered).toHaveLength(3);
  });

  it('filters by env', () => {
    const filtered = filterEvents(testEvents, { env: 'staging' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].feature).toBe('summarizer');
  });

  it('filters by date range', () => {
    const filtered = filterEvents(testEvents, { from: '2025-04-04', to: '2025-04-05' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('e5');
  });

  it('returns all when no filters', () => {
    const filtered = filterEvents(testEvents, {});
    expect(filtered).toHaveLength(5);
  });

  it('combines multiple filters', () => {
    const filtered = filterEvents(testEvents, { feature: 'chat', userId: 'user_a' });
    expect(filtered).toHaveLength(2);
  });
});

describe('summarize', () => {
  it('groups by feature and sorts by cost desc', () => {
    const rows = summarize(testEvents, 'feature');
    expect(rows[0].key).toBe('chat');
    expect(rows[0].calls).toBe(3);
    expect(rows[0].totalCost).toBeCloseTo(0.30, 4);
    expect(rows[1].key).toBe('summarizer');
    expect(rows[2].key).toBe('classifier');
  });

  it('groups by userId', () => {
    const rows = summarize(testEvents, 'userId');
    expect(rows[0].key).toBe('user_a');
    expect(rows[0].calls).toBe(3);
  });

  it('groups by model', () => {
    const rows = summarize(testEvents, 'model');
    expect(rows.length).toBe(2); // claude-sonnet and gpt-4o-mini
  });

  it('calculates avgCostPerCall', () => {
    const rows = summarize(testEvents, 'feature');
    const chat = rows.find(r => r.key === 'chat')!;
    expect(chat.avgCostPerCall).toBeCloseTo(0.10, 4);
  });

  it('handles empty events', () => {
    const rows = summarize([], 'feature');
    expect(rows).toHaveLength(0);
  });
});

describe('generateInsight', () => {
  it('returns insight when cost skew exists', () => {
    const rows = summarize(testEvents, 'feature');
    const insight = generateInsight(rows);
    expect(insight).toBeTruthy();
    expect(insight).toContain('chat');
  });

  it('returns null for single row', () => {
    const rows = [{ key: 'only', calls: 1, totalTokens: 100, avgCostPerCall: 0.01, totalCost: 0.01 }];
    expect(generateInsight(rows)).toBeNull();
  });

  it('returns null for zero total cost', () => {
    const rows = [
      { key: 'a', calls: 1, totalTokens: 0, avgCostPerCall: 0, totalCost: 0 },
      { key: 'b', calls: 1, totalTokens: 0, avgCostPerCall: 0, totalCost: 0 },
    ];
    expect(generateInsight(rows)).toBeNull();
  });
});

describe('summaryToCsv', () => {
  it('generates valid CSV with header', () => {
    const rows = summarize(testEvents, 'feature');
    const csv = summaryToCsv(rows, 'feature');
    const lines = csv.split('\n');

    expect(lines[0]).toBe('feature,calls,total_tokens,avg_cost_per_call,total_cost');
    expect(lines.length).toBe(4); // header + 3 features
    expect(lines[1]).toContain('chat');
  });
});

describe('summaryToJson', () => {
  it('generates valid JSON with totals', () => {
    const rows = summarize(testEvents, 'feature');
    const json = summaryToJson(rows, 'feature');
    const parsed = JSON.parse(json);

    expect(parsed.groupBy).toBe('feature');
    expect(parsed.summary).toHaveLength(3);
    expect(parsed.totals.calls).toBe(5);
    expect(parsed.totals.totalCost).toBeGreaterThan(0);
  });
});
