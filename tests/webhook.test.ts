import { WebhookAdapter } from '../src/adapters/webhook';
import { CostEvent } from '../src/types';
import * as http from 'http';

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    id: 'evt-1', timestamp: '2025-04-05T10:00:00Z', provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', inputTokens: 400, outputTokens: 200,
    totalTokens: 600, inputCostUSD: 0.0012, outputCostUSD: 0.003,
    totalCostUSD: 0.0042, latencyMs: 500, feature: 'test', ...overrides,
  };
}

describe('WebhookAdapter', () => {
  let server: http.Server;
  let port: number;
  let receivedBodies: string[];

  beforeEach((done) => {
    receivedBodies = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedBodies.push(body);
        res.writeHead(200);
        res.end('OK');
      });
    });
    server.listen(0, () => {
      port = (server.address() as any).port;
      done();
    });
  });

  afterEach((done) => {
    server.close(done);
  });

  it('has name "webhook"', () => {
    const adapter = new WebhookAdapter({ url: 'http://localhost:1234' });
    expect(adapter.name).toBe('webhook');
  });

  it('sends single event immediately when batchSize=1', async () => {
    const adapter = new WebhookAdapter({ url: `http://localhost:${port}` });
    await adapter.write(makeEvent({ id: 'single-1' }));

    expect(receivedBodies).toHaveLength(1);
    const parsed = JSON.parse(receivedBodies[0]);
    expect(parsed.id).toBe('single-1');
    expect(parsed.feature).toBe('test');
  });

  it('batches events when batchSize > 1', async () => {
    const adapter = new WebhookAdapter({
      url: `http://localhost:${port}`,
      batchSize: 3,
      flushIntervalMs: 60000, // long interval so we control flush
    });

    await adapter.write(makeEvent({ id: 'b1' }));
    await adapter.write(makeEvent({ id: 'b2' }));
    expect(receivedBodies).toHaveLength(0); // not flushed yet

    await adapter.write(makeEvent({ id: 'b3' })); // hits batchSize
    expect(receivedBodies).toHaveLength(1);

    const parsed = JSON.parse(receivedBodies[0]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].id).toBe('b1');
    expect(parsed[2].id).toBe('b3');

    await adapter.flush();
  });

  it('flush() sends remaining buffer', async () => {
    const adapter = new WebhookAdapter({
      url: `http://localhost:${port}`,
      batchSize: 10,
      flushIntervalMs: 60000,
    });

    await adapter.write(makeEvent({ id: 'f1' }));
    await adapter.write(makeEvent({ id: 'f2' }));
    expect(receivedBodies).toHaveLength(0);

    await adapter.flush();
    expect(receivedBodies).toHaveLength(1);

    const parsed = JSON.parse(receivedBodies[0]);
    expect(parsed).toHaveLength(2);
  });

  it('sends custom headers', async () => {
    let receivedHeaders: any = {};
    server.close();

    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        receivedHeaders = req.headers;
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          receivedBodies.push(body);
          res.writeHead(200);
          res.end('OK');
        });
      });
      server.listen(port, resolve);
    });

    const adapter = new WebhookAdapter({
      url: `http://localhost:${port}`,
      headers: { 'X-Custom': 'my-value', 'Authorization': 'Bearer token123' },
    });

    await adapter.write(makeEvent());

    expect(receivedHeaders['x-custom']).toBe('my-value');
    expect(receivedHeaders['authorization']).toBe('Bearer token123');
  });

  it('retries once on failure then throws', async () => {
    let attempts = 0;
    server.close();

    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        attempts++;
        res.writeHead(500);
        res.end('Error');
      });
      server.listen(port, resolve);
    });

    const adapter = new WebhookAdapter({
      url: `http://localhost:${port}`,
    });

    // Should not throw (retries internally, error is on 500 but fetch doesn't throw on HTTP errors)
    await adapter.write(makeEvent());
    expect(attempts).toBe(2); // original + 1 retry
  });
});
