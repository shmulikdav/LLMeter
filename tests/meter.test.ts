import {
  meter,
  CostMeter,
  configure,
  getConfig,
  resetConfig,
  getMeterStats,
  resetStats,
  flush,
  configurePricing,
  CostAdapter,
  CostEvent,
} from '../src';

// Capture adapter for testing
class TestAdapter implements CostAdapter {
  name = 'test';
  events: CostEvent[] = [];

  async write(event: CostEvent): Promise<void> {
    this.events.push(event);
  }
}

// Failing adapter for error testing
class FailingAdapter implements CostAdapter {
  name = 'failing';
  errors: Error[] = [];

  async write(): Promise<void> {
    throw new Error('Adapter write failed');
  }
}

// Mock responses
function mockAnthropicResponse() {
  return async () => ({
    type: 'message' as const,
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 1000, output_tokens: 500 },
    content: [{ type: 'text', text: 'Hello!' }],
  });
}

function mockOpenAIResponse() {
  return async () => ({
    object: 'chat.completion',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 200, completion_tokens: 100 },
    choices: [{ message: { role: 'assistant', content: 'Hi!' } }],
  });
}

function mockUnknownResponse() {
  return async () => ({
    result: 'something',
    data: [1, 2, 3],
  });
}

describe('configure, resetConfig, and getConfig', () => {
  afterEach(() => resetConfig());

  it('sets and reads global config', () => {
    configure({
      adapters: ['console'],
      localPath: '/tmp/test.ndjson',
      verbose: true,
    });

    const config = getConfig();
    expect(config.localPath).toBe('/tmp/test.ndjson');
    expect(config.verbose).toBe(true);
  });

  it('merges with current config', () => {
    configure({ verbose: true });
    configure({ localPath: '/tmp/x.ndjson' });
    const config = getConfig();
    expect(config.verbose).toBe(true);
    expect(config.localPath).toBe('/tmp/x.ndjson');
  });

  it('resetConfig() restores defaults', () => {
    configure({ verbose: true, localPath: '/tmp/custom.ndjson' });
    resetConfig();
    const config = getConfig();
    expect(config.verbose).toBe(false);
    expect(config.localPath).toBe('./.llm-costs/events.ndjson');
  });

  it('warnOnMissingModel defaults to true', () => {
    expect(getConfig().warnOnMissingModel).toBe(true);
  });
});

describe('getMeterStats and resetStats', () => {
  afterEach(() => {
    resetConfig();
    resetStats();
  });

  it('tracks events', async () => {
    const adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });

    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });
    await meter(mockOpenAIResponse(), { feature: 'test', awaitWrites: true });

    const stats = getMeterStats();
    expect(stats.eventsTracked).toBe(2);
    expect(stats.eventsDropped).toBe(0);
    expect(stats.adapterErrors).toBe(0);
  });

  it('tracks adapter errors', async () => {
    const failing = new FailingAdapter();
    configure({ adapters: [failing], warnOnMissingModel: false });

    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    const stats = getMeterStats();
    expect(stats.eventsTracked).toBe(1);
    expect(stats.adapterErrors).toBe(1);
  });

  it('tracks unknown models', async () => {
    const adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-totally-unknown',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [],
      }),
      { feature: 'test', awaitWrites: true }
    );

    const stats = getMeterStats();
    expect(stats.unknownModels).toContain('anthropic/claude-totally-unknown');
  });

  it('resetStats() clears counters', async () => {
    const adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });

    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });
    resetStats();

    const stats = getMeterStats();
    expect(stats.eventsTracked).toBe(0);
  });
});

describe('meter()', () => {
  let testAdapter: TestAdapter;

  beforeEach(() => {
    testAdapter = new TestAdapter();
    configure({
      adapters: [testAdapter],
      defaultTags: {},
      verbose: false,
      warnOnMissingModel: false,
    });
    resetStats();
  });

  afterEach(() => resetConfig());

  it('returns Anthropic response unchanged', async () => {
    const response = await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });
    expect(response.type).toBe('message');
    expect(response.content[0].text).toBe('Hello!');
  });

  it('returns OpenAI response unchanged', async () => {
    const response = await meter(mockOpenAIResponse(), { feature: 'test', awaitWrites: true });
    expect(response.choices[0].message.content).toBe('Hi!');
  });

  it('detects Anthropic provider and extracts tokens', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    expect(testAdapter.events).toHaveLength(1);
    const event = testAdapter.events[0];
    expect(event.provider).toBe('anthropic');
    expect(event.model).toBe('claude-sonnet-4-20250514');
    expect(event.inputTokens).toBe(1000);
    expect(event.outputTokens).toBe(500);
    expect(event.totalTokens).toBe(1500);
  });

  it('detects OpenAI provider and extracts tokens', async () => {
    await meter(mockOpenAIResponse(), { feature: 'test', awaitWrites: true });

    const event = testAdapter.events[0];
    expect(event.provider).toBe('openai');
    expect(event.model).toBe('gpt-4o-mini');
    expect(event.inputTokens).toBe(200);
    expect(event.outputTokens).toBe(100);
    expect(event.totalTokens).toBe(300);
  });

  it('handles unknown provider gracefully', async () => {
    await meter(mockUnknownResponse(), { feature: 'test', awaitWrites: true });

    const event = testAdapter.events[0];
    expect(event.provider).toBe('custom');
    expect(event.totalCostUSD).toBe(0);
  });

  it('calculates cost correctly', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    const event = testAdapter.events[0];
    expect(event.inputCostUSD).toBeCloseTo(0.003, 6);
    expect(event.outputCostUSD).toBeCloseTo(0.0075, 6);
    expect(event.totalCostUSD).toBeCloseTo(0.0105, 6);
  });

  it('records metadata from options', async () => {
    await meter(mockAnthropicResponse(), {
      feature: 'chat',
      userId: 'user_42',
      sessionId: 'sess_1',
      env: 'test',
      tags: { team: 'eng' },
      awaitWrites: true,
    });

    const event = testAdapter.events[0];
    expect(event.feature).toBe('chat');
    expect(event.userId).toBe('user_42');
    expect(event.sessionId).toBe('sess_1');
    expect(event.env).toBe('test');
    expect(event.tags).toEqual({ team: 'eng' });
  });

  it('includes defaultTags from config', async () => {
    configure({
      adapters: [testAdapter],
      defaultTags: { service: 'my-app', env: 'production' },
      warnOnMissingModel: false,
    });

    await meter(mockAnthropicResponse(), {
      feature: 'test',
      tags: { extra: 'tag' },
      awaitWrites: true,
    });

    const event = testAdapter.events[0];
    expect(event.tags?.service).toBe('my-app');
    expect(event.tags?.extra).toBe('tag');
  });

  it('measures latency', async () => {
    const slowFn = async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { type: 'message' as const, model: 'test', usage: { input_tokens: 0, output_tokens: 0 }, content: [] };
    };

    await meter(() => slowFn(), { feature: 'test', awaitWrites: true });

    const event = testAdapter.events[0];
    expect(event.latencyMs).toBeGreaterThanOrEqual(70);
  });

  it('generates unique event IDs', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });
    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    expect(testAdapter.events[0].id).not.toBe(testAdapter.events[1].id);
  });

  it('sets ISO timestamp', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    const ts = testAdapter.events[0].timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it('awaitWrites: true waits for adapter', async () => {
    let written = false;
    const slowAdapter: CostAdapter = {
      name: 'slow',
      async write() {
        await new Promise((r) => setTimeout(r, 50));
        written = true;
      },
    };
    configure({ adapters: [slowAdapter], warnOnMissingModel: false });

    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });
    expect(written).toBe(true);
  });

  it('awaitWrites: false (default) does not wait', async () => {
    let written = false;
    const slowAdapter: CostAdapter = {
      name: 'slow',
      async write() {
        await new Promise((r) => setTimeout(r, 100));
        written = true;
      },
    };
    configure({ adapters: [slowAdapter], warnOnMissingModel: false });

    await meter(mockAnthropicResponse(), { feature: 'test' });
    expect(written).toBe(false); // Not yet — fire and forget
  });
});

describe('onError callback', () => {
  afterEach(() => {
    resetConfig();
    resetStats();
  });

  it('calls onError when adapter fails', async () => {
    const errors: Array<{ err: Error; event?: CostEvent }> = [];
    const failing = new FailingAdapter();

    configure({
      adapters: [failing],
      onError: (err, event) => errors.push({ err, event }),
      warnOnMissingModel: false,
    });

    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    expect(errors).toHaveLength(1);
    expect(errors[0].err.message).toBe('Adapter write failed');
    expect(errors[0].event?.feature).toBe('test');
  });

  it('logs to console.error when verbose=true and no onError', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    const failing = new FailingAdapter();

    configure({
      adapters: [failing],
      verbose: true,
      warnOnMissingModel: false,
    });

    await meter(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    expect(spy).toHaveBeenCalledWith(
      '[llm-cost-meter] Error writing event:',
      expect.any(Error)
    );
    spy.mockRestore();
  });
});

describe('flush()', () => {
  afterEach(() => resetConfig());

  it('calls flush on adapters that support it', async () => {
    let flushed = false;
    const adapter: CostAdapter = {
      name: 'test',
      async write() {},
      async flush() { flushed = true; },
    };
    configure({ adapters: [adapter], warnOnMissingModel: false });

    await flush();
    expect(flushed).toBe(true);
  });
});

describe('CostMeter class', () => {
  let testAdapter: TestAdapter;

  beforeEach(() => {
    testAdapter = new TestAdapter();
    resetStats();
  });

  afterEach(() => resetConfig());

  it('track() works with instance config', async () => {
    const costMeter = new CostMeter({
      adapters: [testAdapter],
      defaultTags: { env: 'test' },
    });

    const response = await costMeter.track(mockAnthropicResponse(), { feature: 'chat', awaitWrites: true });

    expect(response.content[0].text).toBe('Hello!');
    expect(testAdapter.events).toHaveLength(1);
    expect(testAdapter.events[0].feature).toBe('chat');
    expect(testAdapter.events[0].tags?.env).toBe('test');
  });

  it('track() uses explicit provider when set', async () => {
    const costMeter = new CostMeter({
      provider: 'anthropic',
      adapters: [testAdapter],
    });

    await costMeter.track(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    expect(testAdapter.events[0].provider).toBe('anthropic');
  });

  it('track() with awaitWrites', async () => {
    let written = false;
    const slowAdapter: CostAdapter = {
      name: 'slow',
      async write() {
        await new Promise((r) => setTimeout(r, 50));
        written = true;
      },
    };
    const costMeter = new CostMeter({ adapters: [slowAdapter] });

    await costMeter.track(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });
    expect(written).toBe(true);
  });

  it('record() creates event from manual data', async () => {
    const costMeter = new CostMeter({
      adapters: [testAdapter],
    });

    costMeter.record({
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      inputTokens: 500,
      outputTokens: 200,
      feature: 'manual-test',
      userId: 'user_1',
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(testAdapter.events).toHaveLength(1);
    const event = testAdapter.events[0];
    expect(event.feature).toBe('manual-test');
    expect(event.inputTokens).toBe(500);
    expect(event.outputTokens).toBe(200);
    expect(event.totalTokens).toBe(700);
    expect(event.totalCostUSD).toBeGreaterThan(0);
  });

  it('record() defaults to custom provider', async () => {
    const costMeter = new CostMeter({
      adapters: [testAdapter],
    });

    costMeter.record({
      model: 'some-model',
      inputTokens: 100,
      outputTokens: 50,
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(testAdapter.events[0].provider).toBe('custom');
  });

  it('onError callback works on CostMeter', async () => {
    const errors: Error[] = [];
    const failing = new FailingAdapter();

    const costMeter = new CostMeter({
      adapters: [failing],
      onError: (err) => errors.push(err),
    });

    await costMeter.track(mockAnthropicResponse(), { feature: 'test', awaitWrites: true });

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Adapter write failed');
  });

  it('flush() waits for pending writes', async () => {
    let flushed = false;
    const adapter: CostAdapter = {
      name: 'test',
      async write() {},
      async flush() { flushed = true; },
    };

    const costMeter = new CostMeter({ adapters: [adapter] });
    await costMeter.flush();
    expect(flushed).toBe(true);
  });
});

describe('unknown model warning', () => {
  afterEach(() => {
    resetConfig();
    resetStats();
  });

  it('warns to console when warnOnMissingModel is true', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: true });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-nonexistent-model',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [],
      }),
      { feature: 'test', awaitWrites: true }
    );

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('claude-nonexistent-model')
    );
    spy.mockRestore();
  });

  it('suppresses warning when warnOnMissingModel is false', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'claude-another-unknown',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [],
      }),
      { feature: 'test', awaitWrites: true }
    );

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('configurePricing integration', () => {
  afterEach(() => {
    resetConfig();
    resetStats();
  });

  it('custom pricing works with meter()', async () => {
    configurePricing('anthropic', 'my-fine-tuned-model', { input: 10.0, output: 30.0 });
    const adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });

    await meter(
      async () => ({
        type: 'message' as const,
        model: 'my-fine-tuned-model',
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [],
      }),
      { feature: 'test', awaitWrites: true }
    );

    const event = adapter.events[0];
    expect(event.inputCostUSD).toBeCloseTo(0.01, 6);
    expect(event.outputCostUSD).toBeCloseTo(0.015, 6);
  });
});
