import {
  createExpressMiddleware,
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

describe('createExpressMiddleware', () => {
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

  it('attaches req.meter() function', () => {
    const middleware = createExpressMiddleware({ feature: 'chat' });
    const req: any = {};
    const res: any = {};
    let nextCalled = false;

    middleware(req, res, () => { nextCalled = true; });

    expect(typeof req.meter).toBe('function');
    expect(nextCalled).toBe(true);
  });

  it('req.meter() tracks calls with feature pre-filled', async () => {
    const middleware = createExpressMiddleware({ feature: 'chat' });
    const req: any = {};

    middleware(req, {}, () => {});

    const response = await req.meter(mockAnthropicResponse(), { awaitWrites: true });

    expect(response.content[0].text).toBe('Hello!');
    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].feature).toBe('chat');
  });

  it('extracts userId from req.user.id by default', async () => {
    const middleware = createExpressMiddleware({ feature: 'chat' });
    const req: any = { user: { id: 'user_alice' } };

    middleware(req, {}, () => {});
    await req.meter(mockAnthropicResponse(), { awaitWrites: true });

    expect(adapter.events[0].userId).toBe('user_alice');
  });

  it('extracts sessionId from req.sessionID by default', async () => {
    const middleware = createExpressMiddleware({ feature: 'chat' });
    const req: any = { sessionID: 'sess_abc' };

    middleware(req, {}, () => {});
    await req.meter(mockAnthropicResponse(), { awaitWrites: true });

    expect(adapter.events[0].sessionId).toBe('sess_abc');
  });

  it('uses custom extractUserId function', async () => {
    const middleware = createExpressMiddleware({
      feature: 'chat',
      extractUserId: (req) => req.headers['x-user-id'],
    });
    const req: any = { headers: { 'x-user-id': 'custom_user' } };

    middleware(req, {}, () => {});
    await req.meter(mockAnthropicResponse(), { awaitWrites: true });

    expect(adapter.events[0].userId).toBe('custom_user');
  });

  it('uses custom extractSessionId function', async () => {
    const middleware = createExpressMiddleware({
      feature: 'chat',
      extractSessionId: (req) => req.cookies?.sid,
    });
    const req: any = { cookies: { sid: 'cookie_sess' } };

    middleware(req, {}, () => {});
    await req.meter(mockAnthropicResponse(), { awaitWrites: true });

    expect(adapter.events[0].sessionId).toBe('cookie_sess');
  });

  it('applies env and tags from middleware config', async () => {
    const middleware = createExpressMiddleware({
      feature: 'chat',
      env: 'production',
      tags: { team: 'backend' },
    });
    const req: any = {};

    middleware(req, {}, () => {});
    await req.meter(mockAnthropicResponse(), { awaitWrites: true });

    expect(adapter.events[0].env).toBe('production');
    expect(adapter.events[0].tags?.team).toBe('backend');
  });

  it('allows per-call option overrides', async () => {
    const middleware = createExpressMiddleware({ feature: 'chat' });
    const req: any = {};

    middleware(req, {}, () => {});
    await req.meter(mockAnthropicResponse(), {
      feature: 'override-feature',
      userId: 'override-user',
      awaitWrites: true,
    });

    expect(adapter.events[0].feature).toBe('override-feature');
    expect(adapter.events[0].userId).toBe('override-user');
  });
});
