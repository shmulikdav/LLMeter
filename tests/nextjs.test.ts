import {
  withCostTracking,
  createNextApiHandler,
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

function mockAnthropicResponse() {
  return async () => ({
    type: 'message' as const,
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 500, output_tokens: 200 },
    content: [{ type: 'text', text: 'Hello!' }],
  });
}

describe('withCostTracking (Next.js App Router)', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });
    resetStats();
  });

  afterEach(() => { resetConfig(); resetStats(); });

  it('attaches req.meter() and tracks calls', async () => {
    const handler = withCostTracking({ feature: 'chat' }, async (req) => {
      const response = await req.meter(mockAnthropicResponse(), { awaitWrites: true });
      return new Response(JSON.stringify(response));
    });

    const req: any = { headers: new Map() };
    await handler(req);

    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].feature).toBe('chat');
  });

  it('extracts userId from headers', async () => {
    const handler = withCostTracking({ feature: 'chat' }, async (req) => {
      await req.meter(mockAnthropicResponse(), { awaitWrites: true });
      return new Response('ok');
    });

    const headers = new Map([['x-user-id', 'user_from_header']]);
    const req: any = { headers };
    await handler(req);

    expect(adapter.events[0].userId).toBe('user_from_header');
  });

  it('uses custom extractUserId', async () => {
    const handler = withCostTracking({
      feature: 'chat',
      extractUserId: (req) => req.auth?.userId,
    }, async (req) => {
      await req.meter(mockAnthropicResponse(), { awaitWrites: true });
      return new Response('ok');
    });

    const req: any = { headers: new Map(), auth: { userId: 'custom_user' } };
    await handler(req);

    expect(adapter.events[0].userId).toBe('custom_user');
  });

  it('applies env and tags from config', async () => {
    const handler = withCostTracking({
      feature: 'chat',
      env: 'production',
      tags: { version: '2.0' },
    }, async (req) => {
      await req.meter(mockAnthropicResponse(), { awaitWrites: true });
      return new Response('ok');
    });

    const req: any = { headers: new Map() };
    await handler(req);

    expect(adapter.events[0].env).toBe('production');
    expect(adapter.events[0].tags?.version).toBe('2.0');
  });

  it('attaches req.meterStream()', async () => {
    const handler = withCostTracking({ feature: 'chat' }, async (req) => {
      expect(typeof req.meterStream).toBe('function');
      return new Response('ok');
    });

    const req: any = { headers: new Map() };
    await handler(req);
  });
});

describe('createNextApiHandler (Next.js Pages Router)', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
    configure({ adapters: [adapter], warnOnMissingModel: false });
    resetStats();
  });

  afterEach(() => { resetConfig(); resetStats(); });

  it('attaches req.meter() and tracks calls', async () => {
    const handler = createNextApiHandler({ feature: 'api-chat' }, async (req, res) => {
      const response = await req.meter(mockAnthropicResponse(), { awaitWrites: true });
      res.json(response);
    });

    const req: any = { headers: {} };
    const res: any = { json: jest.fn() };
    await handler(req, res);

    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].feature).toBe('api-chat');
    expect(res.json).toHaveBeenCalled();
  });

  it('extracts userId from request headers object', async () => {
    const handler = createNextApiHandler({ feature: 'chat' }, async (req, res) => {
      await req.meter(mockAnthropicResponse(), { awaitWrites: true });
      res.end();
    });

    const req: any = { headers: { 'x-user-id': 'pages_user' } };
    const res: any = { end: jest.fn() };
    await handler(req, res);

    expect(adapter.events[0].userId).toBe('pages_user');
  });
});
