import { CloudAdapter } from '../src/adapters/cloud';
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

describe('CloudAdapter', () => {
  let server: http.Server;
  let port: number;
  let receivedBodies: any[];
  let receivedHeaders: any;

  beforeEach((done) => {
    receivedBodies = [];
    receivedHeaders = {};
    server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        receivedBodies.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"received":1}');
      });
    });
    server.listen(0, () => {
      port = (server.address() as any).port;
      done();
    });
  });

  afterEach((done) => { server.close(done); });

  it('has name "cloud"', () => {
    const adapter = new CloudAdapter({ apiKey: 'test-key' });
    expect(adapter.name).toBe('cloud');
  });

  it('sends Authorization header with API key', async () => {
    const adapter = new CloudAdapter({
      apiKey: 'lm_live_test123',
      endpoint: `http://localhost:${port}/v1/events`,
      batchSize: 1,
    });

    await adapter.write(makeEvent());
    await adapter.flush();

    expect(receivedHeaders['authorization']).toBe('Bearer lm_live_test123');
    expect(receivedHeaders['x-source']).toBe('llm-cost-meter');
  });

  it('sends events as { events: [...] } batch', async () => {
    const adapter = new CloudAdapter({
      apiKey: 'test-key',
      endpoint: `http://localhost:${port}/v1/events`,
      batchSize: 1,
    });

    await adapter.write(makeEvent({ id: 'cloud-1' }));
    await adapter.flush();

    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0].events).toHaveLength(1);
    expect(receivedBodies[0].events[0].id).toBe('cloud-1');
  });

  it('batches events before sending', async () => {
    const adapter = new CloudAdapter({
      apiKey: 'test-key',
      endpoint: `http://localhost:${port}/v1/events`,
      batchSize: 3,
      flushIntervalMs: 60000,
    });

    await adapter.write(makeEvent({ id: 'b1' }));
    await adapter.write(makeEvent({ id: 'b2' }));
    expect(receivedBodies).toHaveLength(0);

    await adapter.write(makeEvent({ id: 'b3' }));
    // Wait for async flush
    await new Promise(r => setTimeout(r, 50));

    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0].events).toHaveLength(3);

    await adapter.flush();
  });

  it('flush() sends remaining buffer', async () => {
    const adapter = new CloudAdapter({
      apiKey: 'test-key',
      endpoint: `http://localhost:${port}/v1/events`,
      batchSize: 100,
      flushIntervalMs: 60000,
    });

    await adapter.write(makeEvent({ id: 'f1' }));
    await adapter.write(makeEvent({ id: 'f2' }));
    expect(receivedBodies).toHaveLength(0);

    await adapter.flush();
    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0].events).toHaveLength(2);
  });

  it('handles server errors gracefully', async () => {
    server.close();
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          res.writeHead(500);
          res.end('Server Error');
        });
      });
      server.listen(port, resolve);
    });

    const adapter = new CloudAdapter({
      apiKey: 'test-key',
      endpoint: `http://localhost:${port}/v1/events`,
      batchSize: 1,
    });

    // Should not throw
    await adapter.write(makeEvent());
    await adapter.flush();
  });
});
