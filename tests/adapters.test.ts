import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConsoleAdapter } from '../src/adapters/console';
import { LocalAdapter } from '../src/adapters/local';
import { createAdapter, resolveAdapters } from '../src/adapters';
import { CostEvent } from '../src/types';

function makeMockEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    id: 'test-id-123',
    timestamp: '2025-04-05T10:00:00Z',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    inputTokens: 420,
    outputTokens: 180,
    totalTokens: 600,
    inputCostUSD: 0.00126,
    outputCostUSD: 0.0027,
    totalCostUSD: 0.00396,
    latencyMs: 1240,
    feature: 'test-feature',
    userId: 'user_123',
    ...overrides,
  };
}

describe('ConsoleAdapter', () => {
  it('has name "console"', () => {
    const adapter = new ConsoleAdapter();
    expect(adapter.name).toBe('console');
  });

  it('logs formatted output', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const adapter = new ConsoleAdapter();
    const event = makeMockEvent();

    await adapter.write(event);

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0];
    expect(output).toContain('[llm-cost-meter]');
    expect(output).toContain('test-feature');
    expect(output).toContain('$0.00396');
    expect(output).toContain('600 tokens');
    expect(output).toContain('1240ms');

    spy.mockRestore();
  });

  it('shows "untagged" when no feature', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    const adapter = new ConsoleAdapter();
    await adapter.write(makeMockEvent({ feature: undefined }));

    expect(spy.mock.calls[0][0]).toContain('untagged');
    spy.mockRestore();
  });
});

describe('LocalAdapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-cost-meter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has name "local"', () => {
    const adapter = new LocalAdapter(path.join(tmpDir, 'events.ndjson'));
    expect(adapter.name).toBe('local');
  });

  it('creates directory and writes NDJSON', async () => {
    const filePath = path.join(tmpDir, 'sub', 'dir', 'events.ndjson');
    const adapter = new LocalAdapter(filePath);
    const event = makeMockEvent();

    await adapter.write(event);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.id).toBe('test-id-123');
    expect(parsed.totalCostUSD).toBe(0.00396);
  });

  it('appends multiple events', async () => {
    const filePath = path.join(tmpDir, 'events.ndjson');
    const adapter = new LocalAdapter(filePath);

    await adapter.write(makeMockEvent({ id: 'evt-1' }));
    await adapter.write(makeMockEvent({ id: 'evt-2' }));
    await adapter.write(makeMockEvent({ id: 'evt-3' }));

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).id).toBe('evt-1');
    expect(JSON.parse(lines[2]).id).toBe('evt-3');
  });

  it('handles concurrent writes without corruption', async () => {
    const filePath = path.join(tmpDir, 'concurrent.ndjson');
    const adapter = new LocalAdapter(filePath);

    // Fire 20 writes concurrently
    const writes = Array.from({ length: 20 }, (_, i) =>
      adapter.write(makeMockEvent({ id: `concurrent-${i}` }))
    );
    await Promise.all(writes);

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(20);
    // All should be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('flush() waits for pending writes', async () => {
    const filePath = path.join(tmpDir, 'flush.ndjson');
    const adapter = new LocalAdapter(filePath);

    adapter.write(makeMockEvent({ id: 'flush-1' }));
    adapter.write(makeMockEvent({ id: 'flush-2' }));
    await adapter.flush();

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});

describe('createAdapter', () => {
  it('creates a ConsoleAdapter', () => {
    const adapter = createAdapter('console');
    expect(adapter.name).toBe('console');
  });

  it('creates a LocalAdapter with default path', () => {
    const adapter = createAdapter('local');
    expect(adapter.name).toBe('local');
  });

  it('creates a LocalAdapter with custom path', () => {
    const adapter = createAdapter('local', { localPath: '/tmp/custom.ndjson' });
    expect(adapter.name).toBe('local');
  });

  it('throws for unknown adapter', () => {
    expect(() => createAdapter('datadog')).toThrow('Unknown adapter: datadog');
  });
});

describe('resolveAdapters', () => {
  it('resolves string names to adapters', () => {
    const adapters = resolveAdapters(['console']);
    expect(adapters).toHaveLength(1);
    expect(adapters[0].name).toBe('console');
  });

  it('passes through CostAdapter instances', () => {
    const custom = { name: 'custom', write: async () => {} };
    const adapters = resolveAdapters([custom, 'console']);
    expect(adapters).toHaveLength(2);
    expect(adapters[0].name).toBe('custom');
    expect(adapters[1].name).toBe('console');
  });
});
