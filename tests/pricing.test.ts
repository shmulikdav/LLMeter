import { calculateCost, getAvailableModels, getAllPricing } from '../src/pricing';

describe('calculateCost', () => {
  describe('Anthropic models', () => {
    it('calculates cost for claude-sonnet-4-20250514', () => {
      const result = calculateCost('anthropic', 'claude-sonnet-4-20250514', 1000, 500);
      // input: 1000 / 1M * $3.00 = $0.003
      // output: 500 / 1M * $15.00 = $0.0075
      expect(result.inputCostUSD).toBeCloseTo(0.003, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0075, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.0105, 6);
    });

    it('calculates cost for claude-opus-4-20250514', () => {
      const result = calculateCost('anthropic', 'claude-opus-4-20250514', 1000, 500);
      // input: 1000 / 1M * $15.00 = $0.015
      // output: 500 / 1M * $75.00 = $0.0375
      expect(result.inputCostUSD).toBeCloseTo(0.015, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0375, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.0525, 6);
    });

    it('calculates cost for claude-haiku-4-5-20251001', () => {
      const result = calculateCost('anthropic', 'claude-haiku-4-5-20251001', 10000, 5000);
      // input: 10000 / 1M * $0.80 = $0.008
      // output: 5000 / 1M * $4.00 = $0.02
      expect(result.inputCostUSD).toBeCloseTo(0.008, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.02, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.028, 6);
    });
  });

  describe('OpenAI models', () => {
    it('calculates cost for gpt-4o', () => {
      const result = calculateCost('openai', 'gpt-4o', 1000, 500);
      // input: 1000 / 1M * $2.50 = $0.0025
      // output: 500 / 1M * $10.00 = $0.005
      expect(result.inputCostUSD).toBeCloseTo(0.0025, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.005, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.0075, 6);
    });

    it('calculates cost for gpt-4o-mini', () => {
      const result = calculateCost('openai', 'gpt-4o-mini', 1000, 500);
      // input: 1000 / 1M * $0.15 = $0.00015
      // output: 500 / 1M * $0.60 = $0.0003
      expect(result.inputCostUSD).toBeCloseTo(0.00015, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0003, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.00045, 6);
    });

    it('calculates cost for gpt-4-turbo', () => {
      const result = calculateCost('openai', 'gpt-4-turbo', 2000, 1000);
      // input: 2000 / 1M * $10.00 = $0.02
      // output: 1000 / 1M * $30.00 = $0.03
      expect(result.inputCostUSD).toBeCloseTo(0.02, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.03, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.05, 6);
    });

    it('calculates cost for gpt-3.5-turbo', () => {
      const result = calculateCost('openai', 'gpt-3.5-turbo', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.0005, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.00075, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.00125, 6);
    });
  });

  describe('edge cases', () => {
    it('returns zeros for unknown provider', () => {
      const result = calculateCost('mistral', 'some-model', 1000, 500);
      expect(result.inputCostUSD).toBe(0);
      expect(result.outputCostUSD).toBe(0);
      expect(result.totalCostUSD).toBe(0);
    });

    it('returns zeros for unknown model', () => {
      const result = calculateCost('openai', 'gpt-99', 1000, 500);
      expect(result.inputCostUSD).toBe(0);
      expect(result.outputCostUSD).toBe(0);
      expect(result.totalCostUSD).toBe(0);
    });

    it('handles zero tokens', () => {
      const result = calculateCost('anthropic', 'claude-sonnet-4-20250514', 0, 0);
      expect(result.totalCostUSD).toBe(0);
    });

    it('handles large token counts', () => {
      const result = calculateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
      // input: 1M / 1M * $2.50 = $2.50
      // output: 1M / 1M * $10.00 = $10.00
      expect(result.inputCostUSD).toBeCloseTo(2.5, 2);
      expect(result.outputCostUSD).toBeCloseTo(10.0, 2);
      expect(result.totalCostUSD).toBeCloseTo(12.5, 2);
    });
  });
});

describe('getAvailableModels', () => {
  it('returns OpenAI models', () => {
    const models = getAvailableModels('openai');
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gpt-4o-mini');
  });

  it('returns Anthropic models', () => {
    const models = getAvailableModels('anthropic');
    expect(models).toContain('claude-sonnet-4-20250514');
    expect(models).toContain('claude-opus-4-20250514');
  });

  it('returns empty array for unknown provider', () => {
    expect(getAvailableModels('unknown')).toEqual([]);
  });
});

describe('getAllPricing', () => {
  it('returns pricing for both providers', () => {
    const pricing = getAllPricing();
    expect(pricing).toHaveProperty('openai');
    expect(pricing).toHaveProperty('anthropic');
  });
});
