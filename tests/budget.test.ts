import {
  meter,
  configure,
  resetConfig,
  resetStats,
  configureBudget,
  getBudgetStatus,
  resetBudget,
  CostAdapter,
  CostEvent,
} from '../src';

class TestAdapter implements CostAdapter {
  name = 'test';
  events: CostEvent[] = [];
  async write(event: CostEvent) { this.events.push(event); }
}

function mockResponse(cost: { input: number; output: number }) {
  return async () => ({
    type: 'message' as const,
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: cost.input, output_tokens: cost.output },
    content: [{ type: 'text', text: 'ok' }],
  });
}

describe('Budget Alerts', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });
    resetStats();
    resetBudget();
  });

  afterEach(() => {
    resetConfig();
    resetStats();
    resetBudget();
  });

  it('fires onExceed when daily limit is reached', async () => {
    const exceeded: Array<{ feature: string; spent: number }> = [];

    configureBudget({
      rules: [{
        feature: 'chat',
        dailyLimitUSD: 0.01,
        onExceed: (rule, spent) => exceeded.push({ feature: rule.feature, spent }),
      }],
    });

    // claude-sonnet-4: input $3/M, output $15/M
    // 10000 input tokens = $0.03 (exceeds $0.01 limit)
    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10000, output_tokens: 0 },
        content: [],
      }),
      { feature: 'chat', awaitWrites: true }
    );

    expect(exceeded).toHaveLength(1);
    expect(exceeded[0].feature).toBe('chat');
    expect(exceeded[0].spent).toBeGreaterThanOrEqual(0.01);
  });

  it('fires only once per day per rule', async () => {
    let fireCount = 0;

    configureBudget({
      rules: [{
        feature: 'chat',
        dailyLimitUSD: 0.001,
        onExceed: () => fireCount++,
      }],
    });

    // Each call exceeds limit
    for (let i = 0; i < 5; i++) {
      await meter(
        async () => ({
          type: 'message' as const,
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 1000, output_tokens: 500 },
          content: [],
        }),
        { feature: 'chat', awaitWrites: true }
      );
    }

    expect(fireCount).toBe(1); // Not 5
  });

  it('wildcard rule (*) matches all features', async () => {
    let globalExceeded = false;

    configureBudget({
      rules: [{
        feature: '*',
        dailyLimitUSD: 0.001,
        onExceed: () => { globalExceeded = true; },
      }],
    });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 5000, output_tokens: 0 },
        content: [],
      }),
      { feature: 'summarizer', awaitWrites: true }
    );

    expect(globalExceeded).toBe(true);
  });

  it('does not fire when under limit', async () => {
    let fired = false;

    configureBudget({
      rules: [{
        feature: 'chat',
        dailyLimitUSD: 100, // very high limit
        onExceed: () => { fired = true; },
      }],
    });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [],
      }),
      { feature: 'chat', awaitWrites: true }
    );

    expect(fired).toBe(false);
  });

  it('tracks different features independently', async () => {
    const exceeded: string[] = [];

    configureBudget({
      rules: [
        { feature: 'chat', dailyLimitUSD: 0.001, onExceed: (r) => exceeded.push(r.feature) },
        { feature: 'summarizer', dailyLimitUSD: 100, onExceed: (r) => exceeded.push(r.feature) },
      ],
    });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 5000, output_tokens: 0 },
        content: [],
      }),
      { feature: 'chat', awaitWrites: true }
    );

    expect(exceeded).toEqual(['chat']); // summarizer not exceeded
  });

  it('getBudgetStatus() returns current spend', async () => {
    configureBudget({
      rules: [
        { feature: 'chat', dailyLimitUSD: 10, onExceed: () => {} },
      ],
    });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [],
      }),
      { feature: 'chat', awaitWrites: true }
    );

    const status = getBudgetStatus();
    expect(status).toHaveLength(1);
    expect(status[0].feature).toBe('chat');
    expect(status[0].currentSpendUSD).toBeGreaterThan(0);
    expect(status[0].exceeded).toBe(false);
    expect(status[0].dailyLimitUSD).toBe(10);
  });

  it('resetBudget() clears everything', async () => {
    configureBudget({
      rules: [
        { feature: 'chat', dailyLimitUSD: 10, onExceed: () => {} },
      ],
    });

    resetBudget();

    const status = getBudgetStatus();
    expect(status).toHaveLength(0);
  });

  it('onExceed callback errors do not crash the pipeline', async () => {
    configureBudget({
      rules: [{
        feature: 'chat',
        dailyLimitUSD: 0.0001,
        onExceed: () => { throw new Error('Callback crashed!'); },
      }],
    });

    // Should not throw
    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 5000, output_tokens: 0 },
        content: [],
      }),
      { feature: 'chat', awaitWrites: true }
    );

    expect(adapter.events).toHaveLength(1); // Event still recorded
  });
});
