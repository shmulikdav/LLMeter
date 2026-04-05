import { calculateCost, getAvailableModels, getAllPricing, configurePricing, setPricingTable, removePricing } from '../src/pricing';

describe('calculateCost', () => {
  describe('Anthropic models', () => {
    it('calculates cost for claude-sonnet-4-20250514', () => {
      const result = calculateCost('anthropic', 'claude-sonnet-4-20250514', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.003, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0075, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.0105, 6);
    });

    it('calculates cost for claude-opus-4-20250514', () => {
      const result = calculateCost('anthropic', 'claude-opus-4-20250514', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.015, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0375, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.0525, 6);
    });

    it('calculates cost for claude-haiku-4-5-20251001', () => {
      const result = calculateCost('anthropic', 'claude-haiku-4-5-20251001', 10000, 5000);
      expect(result.inputCostUSD).toBeCloseTo(0.008, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.02, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.028, 6);
    });

    it('calculates cost for claude-3-5-sonnet-20241022', () => {
      const result = calculateCost('anthropic', 'claude-3-5-sonnet-20241022', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.003, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0075, 6);
    });

    it('calculates cost for claude-3-haiku-20240307', () => {
      const result = calculateCost('anthropic', 'claude-3-haiku-20240307', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.00025, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.000625, 6);
    });
  });

  describe('OpenAI models', () => {
    it('calculates cost for gpt-4o', () => {
      const result = calculateCost('openai', 'gpt-4o', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.0025, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.005, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.0075, 6);
    });

    it('calculates cost for gpt-4o-mini', () => {
      const result = calculateCost('openai', 'gpt-4o-mini', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.00015, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0003, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.00045, 6);
    });

    it('calculates cost for gpt-4-turbo', () => {
      const result = calculateCost('openai', 'gpt-4-turbo', 2000, 1000);
      expect(result.inputCostUSD).toBeCloseTo(0.02, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.03, 6);
      expect(result.totalCostUSD).toBeCloseTo(0.05, 6);
    });

    it('calculates cost for o1', () => {
      const result = calculateCost('openai', 'o1', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.015, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.03, 6);
    });

    it('calculates cost for o3-mini', () => {
      const result = calculateCost('openai', 'o3-mini', 1000, 500);
      expect(result.inputCostUSD).toBeCloseTo(0.0011, 6);
      expect(result.outputCostUSD).toBeCloseTo(0.0022, 6);
    });

    it('calculates cost for dated model variants', () => {
      const result = calculateCost('openai', 'gpt-4o-2024-08-06', 1000, 500);
      expect(result.totalCostUSD).toBeCloseTo(0.0075, 6);
    });
  });

  describe('edge cases', () => {
    it('returns zeros for unknown provider', () => {
      const result = calculateCost('mistral', 'some-model', 1000, 500);
      expect(result.totalCostUSD).toBe(0);
    });

    it('returns zeros for unknown model', () => {
      const result = calculateCost('openai', 'gpt-99', 1000, 500);
      expect(result.totalCostUSD).toBe(0);
    });

    it('handles zero tokens', () => {
      const result = calculateCost('anthropic', 'claude-sonnet-4-20250514', 0, 0);
      expect(result.totalCostUSD).toBe(0);
    });

    it('handles large token counts', () => {
      const result = calculateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
      expect(result.inputCostUSD).toBeCloseTo(2.5, 2);
      expect(result.outputCostUSD).toBeCloseTo(10.0, 2);
      expect(result.totalCostUSD).toBeCloseTo(12.5, 2);
    });
  });
});

describe('configurePricing', () => {
  it('adds custom model pricing', () => {
    configurePricing('openai', 'ft:gpt-4o-mini:my-org', { input: 0.30, output: 1.20 });
    const result = calculateCost('openai', 'ft:gpt-4o-mini:my-org', 1000, 500);
    expect(result.inputCostUSD).toBeCloseTo(0.0003, 6);
    expect(result.outputCostUSD).toBeCloseTo(0.0006, 6);
  });

  it('creates a new provider', () => {
    configurePricing('mistral', 'mistral-large', { input: 2.0, output: 6.0 });
    const result = calculateCost('mistral', 'mistral-large', 1000, 500);
    expect(result.totalCostUSD).toBeCloseTo(0.005, 6);
  });

  it('overrides existing model pricing', () => {
    const before = calculateCost('openai', 'gpt-4o', 1_000_000, 0);
    configurePricing('openai', 'gpt-4o', { input: 5.0, output: 20.0 });
    const after = calculateCost('openai', 'gpt-4o', 1_000_000, 0);
    expect(after.inputCostUSD).toBe(5.0);
    expect(after.inputCostUSD).not.toBe(before.inputCostUSD);

    // Restore original pricing
    configurePricing('openai', 'gpt-4o', { input: 2.5, output: 10.0 });
  });
});

describe('setPricingTable', () => {
  it('sets an entire provider table', () => {
    setPricingTable('deepseek', {
      'deepseek-chat': { input: 0.14, output: 0.28, unit: 'per_million_tokens' },
    });
    const result = calculateCost('deepseek', 'deepseek-chat', 1000, 500);
    expect(result.inputCostUSD).toBeCloseTo(0.00014, 6);
  });
});

describe('getAvailableModels', () => {
  it('returns OpenAI models', () => {
    const models = getAvailableModels('openai');
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gpt-4o-mini');
    expect(models).toContain('o1');
    expect(models).toContain('o3-mini');
  });

  it('returns Anthropic models', () => {
    const models = getAvailableModels('anthropic');
    expect(models).toContain('claude-sonnet-4-20250514');
    expect(models).toContain('claude-opus-4-20250514');
    expect(models).toContain('claude-3-5-sonnet-20241022');
  });

  it('returns empty array for unknown provider', () => {
    expect(getAvailableModels('nonexistent')).toEqual([]);
  });
});

describe('getAllPricing', () => {
  it('returns pricing for both providers', () => {
    const pricing = getAllPricing();
    expect(pricing).toHaveProperty('openai');
    expect(pricing).toHaveProperty('anthropic');
  });

  it('returns a deep copy (mutations do not affect internal state)', () => {
    const pricing = getAllPricing();
    pricing.openai['gpt-4o'].input = 999;

    const fresh = getAllPricing();
    expect(fresh.openai['gpt-4o'].input).toBe(2.5); // unaffected
  });
});

describe('removePricing', () => {
  it('removes an existing model', () => {
    configurePricing('test-provider', 'test-model', { input: 1, output: 2 });
    expect(calculateCost('test-provider', 'test-model', 1_000_000, 0).inputCostUSD).toBe(1);

    const removed = removePricing('test-provider', 'test-model');
    expect(removed).toBe(true);
    expect(calculateCost('test-provider', 'test-model', 1_000_000, 0).inputCostUSD).toBe(0);
  });

  it('returns false for non-existent model', () => {
    expect(removePricing('openai', 'nonexistent-model')).toBe(false);
  });

  it('returns false for non-existent provider', () => {
    expect(removePricing('nonexistent-provider', 'any-model')).toBe(false);
  });
});
