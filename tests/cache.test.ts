import {
  cachedMeter,
  getCacheStats,
  resetCache,
  configure,
  resetConfig,
  resetStats,
  CostAdapter,
  CostEvent,
} from '../src';

class TestAdapter implements CostAdapter {
  name = 'test';
  events: CostEvent[] = [];
  async write(event: CostEvent) { this.events.push(event); }
}

describe('cachedMeter()', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });
    resetStats();
    resetCache();
  });

  afterEach(() => { resetConfig(); resetStats(); resetCache(); });

  it('returns response on cache miss', async () => {
    const response = await cachedMeter(
      async () => ({
        type: 'message' as const, model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: 'text', text: 'Hello!' }],
      }),
      { feature: 'test', cacheKey: 'key-1', awaitWrites: true }
    );

    expect(response.content[0].text).toBe('Hello!');
    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].cached).toBeUndefined();
  });

  it('returns cached response on cache hit', async () => {
    const fn = async () => ({
      type: 'message' as const, model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: 'Hello!' }],
    });

    await cachedMeter(fn, { feature: 'test', cacheKey: 'key-2', awaitWrites: true });
    await cachedMeter(fn, { feature: 'test', cacheKey: 'key-2', awaitWrites: true });

    expect(adapter.events).toHaveLength(2);
    expect(adapter.events[0].cached).toBeUndefined();
    expect(adapter.events[1].cached).toBe(true);
    expect(adapter.events[1].totalCostUSD).toBe(0);
    expect(adapter.events[1].inputTokens).toBe(0);
  });

  it('tracks cache stats', async () => {
    const fn = async () => ({
      type: 'message' as const, model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 5 }, content: [],
    });

    await cachedMeter(fn, { feature: 'test', cacheKey: 'stats-key', awaitWrites: true });
    await cachedMeter(fn, { feature: 'test', cacheKey: 'stats-key', awaitWrites: true });
    await cachedMeter(fn, { feature: 'test', cacheKey: 'stats-key', awaitWrites: true });

    const stats = getCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
  });

  it('respects TTL', async () => {
    const fn = async () => ({
      type: 'message' as const, model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 5 }, content: [],
    });

    await cachedMeter(fn, { feature: 'test', cacheKey: 'ttl-key', ttlMs: 1, awaitWrites: true });
    await new Promise(r => setTimeout(r, 50));
    await cachedMeter(fn, { feature: 'test', cacheKey: 'ttl-key', ttlMs: 1, awaitWrites: true });

    // Both should be misses (TTL expired)
    expect(adapter.events).toHaveLength(2);
    expect(adapter.events[1].cached).toBeUndefined();
  });

  it('resetCache() clears everything', async () => {
    const fn = async () => ({
      type: 'message' as const, model: 'test', usage: { input_tokens: 1, output_tokens: 1 }, content: [],
    });

    await cachedMeter(fn, { feature: 'test', cacheKey: 'reset-key', awaitWrites: true });
    resetCache();
    await cachedMeter(fn, { feature: 'test', cacheKey: 'reset-key', awaitWrites: true });

    expect(adapter.events).toHaveLength(2);
    expect(adapter.events[1].cached).toBeUndefined(); // not from cache
    expect(getCacheStats().hits).toBe(0);
  });

  it('passes prompt fields through', async () => {
    await cachedMeter(
      async () => ({
        type: 'message' as const, model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 10, output_tokens: 5 }, content: [],
      }),
      { feature: 'chat', promptName: 'greeting', promptVersion: 'v1', cacheKey: 'prompt-key', awaitWrites: true }
    );

    expect(adapter.events[0].promptName).toBe('greeting');
    expect(adapter.events[0].promptVersion).toBe('v1');
  });
});
