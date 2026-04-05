import { meter, CostMeter, configure, getConfig, CostAdapter, CostEvent } from '../src';

// Capture adapter for testing
class TestAdapter implements CostAdapter {
  name = 'test';
  events: CostEvent[] = [];

  async write(event: CostEvent): Promise<void> {
    this.events.push(event);
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

describe('configure and getConfig', () => {
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

  it('merges with defaults', () => {
    configure({ verbose: false });
    const config = getConfig();
    expect(config.currency).toBe('USD');
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
    });
  });

  it('returns Anthropic response unchanged', async () => {
    const response = await meter(mockAnthropicResponse(), { feature: 'test' });
    expect(response.type).toBe('message');
    expect(response.content[0].text).toBe('Hello!');
  });

  it('returns OpenAI response unchanged', async () => {
    const response = await meter(mockOpenAIResponse(), { feature: 'test' });
    expect(response.choices[0].message.content).toBe('Hi!');
  });

  it('detects Anthropic provider and extracts tokens', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test' });

    // Wait for async adapter write
    await new Promise(r => setTimeout(r, 50));

    expect(testAdapter.events).toHaveLength(1);
    const event = testAdapter.events[0];
    expect(event.provider).toBe('anthropic');
    expect(event.model).toBe('claude-sonnet-4-20250514');
    expect(event.inputTokens).toBe(1000);
    expect(event.outputTokens).toBe(500);
    expect(event.totalTokens).toBe(1500);
  });

  it('detects OpenAI provider and extracts tokens', async () => {
    await meter(mockOpenAIResponse(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    const event = testAdapter.events[0];
    expect(event.provider).toBe('openai');
    expect(event.model).toBe('gpt-4o-mini');
    expect(event.inputTokens).toBe(200);
    expect(event.outputTokens).toBe(100);
    expect(event.totalTokens).toBe(300);
  });

  it('handles unknown provider gracefully', async () => {
    await meter(mockUnknownResponse(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    const event = testAdapter.events[0];
    expect(event.provider).toBe('custom');
    expect(event.totalCostUSD).toBe(0);
  });

  it('calculates cost correctly', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    const event = testAdapter.events[0];
    // claude-sonnet-4: input $3/M, output $15/M
    // 1000 input = $0.003, 500 output = $0.0075
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
    });
    await new Promise(r => setTimeout(r, 50));

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
    });

    await meter(mockAnthropicResponse(), {
      feature: 'test',
      tags: { extra: 'tag' },
    });
    await new Promise(r => setTimeout(r, 50));

    const event = testAdapter.events[0];
    expect(event.tags?.service).toBe('my-app');
    expect(event.tags?.extra).toBe('tag');
  });

  it('measures latency', async () => {
    const slowFn = async () => {
      await new Promise(r => setTimeout(r, 80));
      return { type: 'message' as const, model: 'test', usage: { input_tokens: 0, output_tokens: 0 }, content: [] };
    };

    await meter(() => slowFn(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    const event = testAdapter.events[0];
    expect(event.latencyMs).toBeGreaterThanOrEqual(70);
  });

  it('generates unique event IDs', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test' });
    await meter(mockAnthropicResponse(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    expect(testAdapter.events[0].id).not.toBe(testAdapter.events[1].id);
  });

  it('sets ISO timestamp', async () => {
    await meter(mockAnthropicResponse(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    const ts = testAdapter.events[0].timestamp;
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

describe('CostMeter class', () => {
  let testAdapter: TestAdapter;

  beforeEach(() => {
    testAdapter = new TestAdapter();
  });

  it('track() works like meter() with instance config', async () => {
    const costMeter = new CostMeter({
      adapters: [testAdapter],
      defaultTags: { env: 'test' },
    });

    const response = await costMeter.track(mockAnthropicResponse(), { feature: 'chat' });

    expect(response.content[0].text).toBe('Hello!');
    await new Promise(r => setTimeout(r, 50));

    expect(testAdapter.events).toHaveLength(1);
    expect(testAdapter.events[0].feature).toBe('chat');
    expect(testAdapter.events[0].tags?.env).toBe('test');
  });

  it('track() uses explicit provider when set', async () => {
    const costMeter = new CostMeter({
      provider: 'anthropic',
      adapters: [testAdapter],
    });

    await costMeter.track(mockAnthropicResponse(), { feature: 'test' });
    await new Promise(r => setTimeout(r, 50));

    expect(testAdapter.events[0].provider).toBe('anthropic');
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

    await new Promise(r => setTimeout(r, 50));

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

    await new Promise(r => setTimeout(r, 50));

    expect(testAdapter.events[0].provider).toBe('custom');
  });
});
