import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(__dirname, '..', 'dist', 'cli.js');

// Sample events for testing
const sampleEvents = [
  {
    id: 'e1', timestamp: '2025-04-01T10:00:00Z', provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', inputTokens: 400, outputTokens: 200,
    totalTokens: 600, inputCostUSD: 0.0012, outputCostUSD: 0.003,
    totalCostUSD: 0.0042, latencyMs: 500, feature: 'chat', userId: 'user_a', env: 'production',
  },
  {
    id: 'e2', timestamp: '2025-04-02T11:00:00Z', provider: 'openai',
    model: 'gpt-4o-mini', inputTokens: 200, outputTokens: 50,
    totalTokens: 250, inputCostUSD: 0.00003, outputCostUSD: 0.00003,
    totalCostUSD: 0.00006, latencyMs: 300, feature: 'classifier', userId: 'user_b', env: 'production',
  },
  {
    id: 'e3', timestamp: '2025-04-03T12:00:00Z', provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', inputTokens: 1000, outputTokens: 500,
    totalTokens: 1500, inputCostUSD: 0.003, outputCostUSD: 0.0075,
    totalCostUSD: 0.0105, latencyMs: 1200, feature: 'chat', userId: 'user_a', env: 'staging',
  },
];

describe('CLI report', () => {
  let tmpDir: string;
  let eventsFile: string;

  beforeAll(() => {
    // Ensure dist is built
    if (!fs.existsSync(CLI_PATH)) {
      execSync('npm run build', { cwd: path.join(__dirname, '..') });
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-cost-meter-cli-'));
    eventsFile = path.join(tmpDir, 'events.ndjson');

    const ndjson = sampleEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(eventsFile, ndjson);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runCli(args: string): string {
    return execSync(`node ${CLI_PATH} report --file ${eventsFile} ${args}`, {
      encoding: 'utf-8',
    });
  }

  it('default report shows features', () => {
    const output = runCli('');
    expect(output).toContain('chat');
    expect(output).toContain('classifier');
    expect(output).toContain('3 events');
  });

  it('--format json returns valid JSON', () => {
    const output = runCli('--format json');
    const parsed = JSON.parse(output);

    expect(parsed.groupBy).toBe('feature');
    expect(parsed.summary).toHaveLength(2);
    expect(parsed.totals.calls).toBe(3);
  });

  it('--format csv returns valid CSV', () => {
    const output = runCli('--format csv');
    const lines = output.trim().split('\n');

    expect(lines[0]).toBe('feature,calls,total_tokens,avg_cost_per_call,total_cost');
    expect(lines.length).toBe(3); // header + 2 features
  });

  it('--group-by userId groups by user', () => {
    const output = runCli('--group-by userId --format json');
    const parsed = JSON.parse(output);

    expect(parsed.groupBy).toBe('userId');
    const keys = parsed.summary.map((r: any) => r.userId);
    expect(keys).toContain('user_a');
    expect(keys).toContain('user_b');
  });

  it('--feature filters by feature', () => {
    const output = runCli('--feature classifier --format json');
    const parsed = JSON.parse(output);

    expect(parsed.summary).toHaveLength(1);
    expect(parsed.summary[0].feature).toBe('classifier');
    expect(parsed.totals.calls).toBe(1);
  });

  it('--top 1 limits results', () => {
    const output = runCli('--top 1 --format json');
    const parsed = JSON.parse(output);

    expect(parsed.summary).toHaveLength(1);
    expect(parsed.summary[0].feature).toBe('chat'); // highest cost
  });

  it('--group-by model groups by model', () => {
    const output = runCli('--group-by model --format json');
    const parsed = JSON.parse(output);

    const keys = parsed.summary.map((r: any) => r.model);
    expect(keys).toContain('claude-sonnet-4-20250514');
    expect(keys).toContain('gpt-4o-mini');
  });

  it('--env filters by environment', () => {
    const output = runCli('--env staging --format json');
    const parsed = JSON.parse(output);

    expect(parsed.totals.calls).toBe(1);
  });

  it('--from and --to filter by date range', () => {
    const output = runCli('--from 2025-04-02 --to 2025-04-02 --format json');
    const parsed = JSON.parse(output);

    expect(parsed.totals.calls).toBe(1);
  });

  it('exits with error for missing file', () => {
    expect(() => {
      execSync(`node ${CLI_PATH} report --file /tmp/nonexistent.ndjson`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }).toThrow();
  });

  it('warns about malformed lines', () => {
    const malformedFile = path.join(tmpDir, 'malformed.ndjson');
    fs.writeFileSync(malformedFile, [
      JSON.stringify(sampleEvents[0]),
      'NOT VALID JSON',
      '{ broken',
      JSON.stringify(sampleEvents[1]),
    ].join('\n') + '\n');

    const output = execSync(
      `node ${CLI_PATH} report --file ${malformedFile} --format json`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(output);
    expect(parsed.totals.calls).toBe(2);
  });

  it('exits with error for file with only malformed lines', () => {
    const badFile = path.join(tmpDir, 'all-bad.ndjson');
    fs.writeFileSync(badFile, 'NOT JSON\nALSO NOT JSON\n');

    expect(() => {
      execSync(`node ${CLI_PATH} report --file ${badFile}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    }).toThrow();
  });
});
