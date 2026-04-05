import {
  meterStream,
  CostMeter,
  configure,
  resetConfig,
  resetStats,
  getMeterStats,
  CostAdapter,
  CostEvent,
} from '../src';

class TestAdapter implements CostAdapter {
  name = 'test';
  events: CostEvent[] = [];
  async write(event: CostEvent) { this.events.push(event); }
}

// Mock OpenAI streaming response (async iterable of chunks)
function mockOpenAIStream(chunks: any[], usage?: any) {
  const stream: any = {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
  if (usage) stream.usage = usage;
  return stream;
}

// Mock Anthropic streaming response
function mockAnthropicStream(chunks: any[], message?: any) {
  const stream: any = {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
  if (message) stream.message = message;
  return stream;
}

describe('meterStream()', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });
    resetStats();
  });

  afterEach(() => {
    resetConfig();
    resetStats();
  });

  it('passes through all chunks unchanged', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' } }] },
    ];

    const stream = await meterStream(
      async () => mockOpenAIStream(chunks, { prompt_tokens: 10, completion_tokens: 5 }),
      { feature: 'chat', awaitWrites: true }
    );

    const received: any[] = [];
    for await (const chunk of stream) {
      received.push(chunk);
    }

    expect(received).toHaveLength(2);
    expect(received[0].choices[0].delta.content).toBe('Hello');
    expect(received[1].choices[0].delta.content).toBe(' world');
  });

  it('records cost event after stream ends (OpenAI usage on stream object)', async () => {
    const stream = await meterStream(
      async () => mockOpenAIStream(
        [{ choices: [{ delta: { content: 'Hi' } }] }],
        { prompt_tokens: 100, completion_tokens: 50 }
      ),
      { feature: 'chat', awaitWrites: true }
    );

    for await (const _ of stream) { /* consume */ }

    expect(adapter.events).toHaveLength(1);
    const event = adapter.events[0];
    expect(event.provider).toBe('openai');
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
    expect(event.feature).toBe('chat');
  });

  it('records cost event from Anthropic stream with message property', async () => {
    const stream = await meterStream(
      async () => mockAnthropicStream(
        [{ type: 'content_block_delta', delta: { text: 'Hi' } }],
        { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 200, output_tokens: 80 } }
      ),
      { feature: 'summarizer', awaitWrites: true }
    );

    for await (const _ of stream) { /* consume */ }

    expect(adapter.events).toHaveLength(1);
    const event = adapter.events[0];
    expect(event.provider).toBe('anthropic');
    expect(event.model).toBe('claude-sonnet-4-20250514');
    expect(event.inputTokens).toBe(200);
    expect(event.outputTokens).toBe(80);
  });

  it('extracts usage from OpenAI chunks (include_usage pattern)', async () => {
    const chunks = [
      { model: 'gpt-4o', choices: [{ delta: { content: 'Hi' } }] },
      { model: 'gpt-4o', choices: [{ delta: {} }], usage: { prompt_tokens: 50, completion_tokens: 20 } },
    ];

    const stream = await meterStream(
      async () => mockOpenAIStream(chunks),
      { feature: 'test', awaitWrites: true }
    );

    for await (const _ of stream) {}

    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].inputTokens).toBe(50);
    expect(adapter.events[0].outputTokens).toBe(20);
    expect(adapter.events[0].model).toBe('gpt-4o');
  });

  it('extracts usage from Anthropic chunk events', async () => {
    const chunks = [
      { type: 'message_start', message: { model: 'claude-sonnet-4-20250514', usage: { input_tokens: 150 } } },
      { type: 'content_block_delta', delta: { text: 'Hello' } },
      { type: 'message_delta', usage: { output_tokens: 60 } },
      { type: 'message_stop' },
    ];

    const stream = await meterStream(
      async () => mockAnthropicStream(chunks),
      { feature: 'test', awaitWrites: true }
    );

    for await (const _ of stream) {}

    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].provider).toBe('anthropic');
    expect(adapter.events[0].inputTokens).toBe(150);
    expect(adapter.events[0].outputTokens).toBe(60);
  });

  it('records error event when stream throws', async () => {
    const failingStream = {
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: 'Hi' } }] };
        throw new Error('Stream interrupted');
      },
    };

    const stream = await meterStream(
      async () => failingStream as any,
      { feature: 'chat', awaitWrites: true }
    );

    const received: any[] = [];
    await expect(async () => {
      for await (const chunk of stream) received.push(chunk);
    }).rejects.toThrow('Stream interrupted');

    expect(received).toHaveLength(1); // got first chunk before error
    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].status).toBe('error');
    expect(adapter.events[0].errorMessage).toBe('Stream interrupted');
  });

  it('records error event when fn() throws before streaming', async () => {
    await expect(
      meterStream(async () => { throw new Error('Connection refused'); }, { feature: 'x', awaitWrites: true })
    ).rejects.toThrow('Connection refused');

    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].status).toBe('error');
  });

  it('increments stats', async () => {
    const stream = await meterStream(
      async () => mockOpenAIStream([{ choices: [{}] }], { prompt_tokens: 10, completion_tokens: 5 }),
      { feature: 'test', awaitWrites: true }
    );
    for await (const _ of stream) {}

    expect(getMeterStats().eventsTracked).toBeGreaterThan(0);
  });

  it('measures latency across stream duration', async () => {
    const slowStream = {
      [Symbol.asyncIterator]: async function* () {
        yield { content: 'a' };
        await new Promise(r => setTimeout(r, 80));
        yield { content: 'b' };
      },
    };

    const stream = await meterStream(
      async () => slowStream as any,
      { feature: 'test', awaitWrites: true }
    );
    for await (const _ of stream) {}

    expect(adapter.events[0].latencyMs).toBeGreaterThanOrEqual(70);
  });
});

describe('CostMeter.trackStream()', () => {
  it('works with instance config', async () => {
    const adapter = new TestAdapter();
    const costMeter = new CostMeter({
      adapters: [adapter],
      defaultTags: { env: 'test' },
    });

    const stream = await costMeter.trackStream(
      async () => mockOpenAIStream(
        [{ choices: [{ delta: { content: 'Hi' } }] }],
        { prompt_tokens: 30, completion_tokens: 10 }
      ),
      { feature: 'chat', awaitWrites: true }
    );

    for await (const _ of stream) {}

    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].feature).toBe('chat');
    expect(adapter.events[0].tags?.env).toBe('test');
    expect(adapter.events[0].inputTokens).toBe(30);
  });
});
