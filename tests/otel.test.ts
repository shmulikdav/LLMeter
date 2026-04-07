import { CostEvent } from '../src/types';

// Mock @opentelemetry/api before importing OTelAdapter
const mockHistogram = { record: jest.fn() };
const mockCounter = { add: jest.fn() };
const mockMeter = {
  createHistogram: jest.fn(() => mockHistogram),
  createCounter: jest.fn(() => mockCounter),
};

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(() => mockMeter),
  },
}), { virtual: true });

import { OTelAdapter } from '../src/adapters/otel';

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    id: 'evt-1', timestamp: '2025-04-05T10:00:00Z', provider: 'anthropic',
    model: 'claude-sonnet-4-20250514', inputTokens: 400, outputTokens: 200,
    totalTokens: 600, inputCostUSD: 0.0012, outputCostUSD: 0.003,
    totalCostUSD: 0.0042, latencyMs: 500, feature: 'chat', userId: 'user_1',
    env: 'production', ...overrides,
  };
}

describe('OTelAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has name "otel"', () => {
    const adapter = new OTelAdapter();
    expect(adapter.name).toBe('otel');
  });

  it('creates meter with default name', () => {
    const otelApi = require('@opentelemetry/api');
    new OTelAdapter();
    expect(otelApi.metrics.getMeter).toHaveBeenCalledWith('llm-cost-meter');
  });

  it('creates meter with custom name', () => {
    const otelApi = require('@opentelemetry/api');
    new OTelAdapter({ meterName: 'my-app' });
    expect(otelApi.metrics.getMeter).toHaveBeenCalledWith('my-app');
  });

  it('creates 4 instruments', () => {
    new OTelAdapter();
    expect(mockMeter.createHistogram).toHaveBeenCalledTimes(2); // cost + duration
    expect(mockMeter.createCounter).toHaveBeenCalledTimes(2); // input + output tokens
  });

  it('records cost histogram on write', async () => {
    const adapter = new OTelAdapter();
    await adapter.write(makeEvent());

    expect(mockHistogram.record).toHaveBeenCalledWith(
      0.0042,
      expect.objectContaining({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        feature: 'chat',
        'user.id': 'user_1',
        env: 'production',
      })
    );
  });

  it('records token counters on write', async () => {
    const adapter = new OTelAdapter();
    await adapter.write(makeEvent());

    expect(mockCounter.add).toHaveBeenCalledWith(400, expect.any(Object)); // input
    expect(mockCounter.add).toHaveBeenCalledWith(200, expect.any(Object)); // output
  });

  it('records duration histogram on write', async () => {
    const adapter = new OTelAdapter();
    await adapter.write(makeEvent({ latencyMs: 1234 }));

    // Second call to histogram.record is for duration
    const durationCalls = mockHistogram.record.mock.calls.filter(
      (call: any[]) => call[0] === 1234
    );
    expect(durationCalls).toHaveLength(1);
  });

  it('omits undefined attributes', async () => {
    const adapter = new OTelAdapter();
    await adapter.write(makeEvent({ feature: undefined, userId: undefined, env: undefined }));

    const attrs = mockHistogram.record.mock.calls[0][1];
    expect(attrs).not.toHaveProperty('feature');
    expect(attrs).not.toHaveProperty('user.id');
    expect(attrs).not.toHaveProperty('env');
    expect(attrs).toHaveProperty('provider');
    expect(attrs).toHaveProperty('model');
  });
});
