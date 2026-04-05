import { v4 as uuidv4 } from 'uuid';
import {
  CostEvent,
  MeterOptions,
  CostMeterConfig,
  GlobalConfig,
  CostAdapter,
} from './types';
import { calculateCost } from './pricing';
import { resolveAdapters } from './adapters';

// Re-export types
export {
  CostEvent,
  MeterOptions,
  CostMeterConfig,
  CostAdapter,
  ModelPricing,
  PricingTable,
  SummaryRow,
  ReportOptions,
  GlobalConfig,
} from './types';

// Re-export pricing utilities
export { calculateCost, getAvailableModels, getAllPricing } from './pricing';

// Re-export adapters
export { ConsoleAdapter, LocalAdapter, createAdapter } from './adapters';

// Global configuration
let globalConfig: GlobalConfig = {
  adapters: ['console'],
  localPath: './.llm-costs/events.ndjson',
  defaultTags: {},
  currency: 'USD',
  verbose: false,
};

/**
 * Configure the global llm-cost-meter settings.
 * Call once at app startup.
 */
export function configure(config: Partial<GlobalConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Get the current global configuration.
 */
export function getConfig(): GlobalConfig {
  return { ...globalConfig };
}

/**
 * Detect the LLM provider from a response object.
 */
function detectProvider(response: any): 'openai' | 'anthropic' | 'custom' {
  if (response?.type === 'message' && response?.usage?.input_tokens !== undefined) {
    return 'anthropic';
  }
  if (response?.usage?.prompt_tokens !== undefined) {
    return 'openai';
  }
  return 'custom';
}

/**
 * Extract model name from a response object.
 */
function extractModel(response: any): string {
  return response?.model ?? 'unknown';
}

/**
 * Extract token counts from a response object.
 */
function extractTokens(
  response: any,
  provider: string
): { inputTokens: number; outputTokens: number } {
  if (provider === 'anthropic') {
    return {
      inputTokens: response?.usage?.input_tokens ?? 0,
      outputTokens: response?.usage?.output_tokens ?? 0,
    };
  }
  if (provider === 'openai') {
    return {
      inputTokens: response?.usage?.prompt_tokens ?? 0,
      outputTokens: response?.usage?.completion_tokens ?? 0,
    };
  }
  return { inputTokens: 0, outputTokens: 0 };
}

/**
 * Write an event to all configured adapters.
 */
async function emitEvent(
  event: CostEvent,
  adapters: CostAdapter[]
): Promise<void> {
  await Promise.all(adapters.map((adapter) => adapter.write(event)));
}

/**
 * Wrap an LLM API call to track cost and usage.
 * The response is passed through unchanged.
 */
export async function meter<T>(
  fn: () => Promise<T>,
  options: MeterOptions = {}
): Promise<T> {
  const startTime = Date.now();
  const response = await fn();
  const latencyMs = Date.now() - startTime;

  const provider = detectProvider(response);
  const model = extractModel(response);
  const { inputTokens, outputTokens } = extractTokens(response, provider);
  const { inputCostUSD, outputCostUSD, totalCostUSD } = calculateCost(
    provider,
    model,
    inputTokens,
    outputTokens
  );

  const mergedTags = {
    ...globalConfig.defaultTags,
    ...options.tags,
  };

  const event: CostEvent = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    inputCostUSD,
    outputCostUSD,
    totalCostUSD,
    latencyMs,
    feature: options.feature,
    userId: options.userId,
    sessionId: options.sessionId,
    env: options.env ?? globalConfig.defaultTags.env,
    tags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
  };

  // Emit to adapters in the background (don't block response)
  const adapters = resolveAdapters(globalConfig.adapters, {
    localPath: globalConfig.localPath,
  });
  emitEvent(event, adapters).catch((err) => {
    if (globalConfig.verbose) {
      console.error('[llm-cost-meter] Error writing event:', err);
    }
  });

  return response;
}

/**
 * Advanced cost meter class with instance-level configuration.
 */
export class CostMeter {
  private config: CostMeterConfig;
  private adapters: CostAdapter[];

  constructor(config: CostMeterConfig = {}) {
    this.config = config;
    this.adapters = resolveAdapters(config.adapters ?? ['console'], {
      localPath: config.localPath,
    });
  }

  /**
   * Wrap an LLM API call to track cost and usage.
   */
  async track<T>(fn: () => Promise<T>, options: MeterOptions = {}): Promise<T> {
    const startTime = Date.now();
    const response = await fn();
    const latencyMs = Date.now() - startTime;

    const provider =
      this.config.provider ?? detectProvider(response);
    const model = extractModel(response);
    const { inputTokens, outputTokens } = extractTokens(response, provider);
    const { inputCostUSD, outputCostUSD, totalCostUSD } = calculateCost(
      provider,
      model,
      inputTokens,
      outputTokens
    );

    const mergedTags = {
      ...this.config.defaultTags,
      ...options.tags,
    };

    const event: CostEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      inputCostUSD,
      outputCostUSD,
      totalCostUSD,
      latencyMs,
      feature: options.feature,
      userId: options.userId,
      sessionId: options.sessionId,
      env: options.env,
      tags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
    };

    emitEvent(event, this.adapters).catch((err) => {
      console.error('[llm-cost-meter] Error writing event:', err);
    });

    return response;
  }

  /**
   * Record a manually-constructed cost event.
   */
  record(data: {
    model: string;
    provider?: 'openai' | 'anthropic' | 'custom';
    inputTokens: number;
    outputTokens: number;
    feature?: string;
    userId?: string;
    sessionId?: string;
    env?: string;
    tags?: Record<string, string>;
    latencyMs?: number;
  }): void {
    const provider = data.provider ?? this.config.provider ?? 'custom';
    const { inputCostUSD, outputCostUSD, totalCostUSD } = calculateCost(
      provider,
      data.model,
      data.inputTokens,
      data.outputTokens
    );

    const mergedTags = {
      ...this.config.defaultTags,
      ...data.tags,
    };

    const event: CostEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      provider,
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalTokens: data.inputTokens + data.outputTokens,
      inputCostUSD,
      outputCostUSD,
      totalCostUSD,
      latencyMs: data.latencyMs ?? 0,
      feature: data.feature,
      userId: data.userId,
      sessionId: data.sessionId,
      env: data.env,
      tags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
    };

    emitEvent(event, this.adapters).catch((err) => {
      console.error('[llm-cost-meter] Error writing event:', err);
    });
  }
}
