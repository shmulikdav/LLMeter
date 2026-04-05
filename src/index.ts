import { v4 as uuidv4 } from 'uuid';
import {
  CostEvent,
  MeterOptions,
  CostMeterConfig,
  GlobalConfig,
  CostAdapter,
  ErrorHandler,
  MeterStats,
} from './types';
import { calculateCost, setUnknownModelHandler } from './pricing';
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
  ErrorHandler,
  MeterStats,
} from './types';

// Re-export pricing utilities
export {
  calculateCost,
  getAvailableModels,
  getAllPricing,
  configurePricing,
  setPricingTable,
  removePricing,
} from './pricing';

// Re-export adapters
export { ConsoleAdapter, LocalAdapter, createAdapter } from './adapters';

// ── Default config ──────────────────────────────────────────────

const DEFAULT_CONFIG: GlobalConfig = {
  adapters: ['console'],
  localPath: './.llm-costs/events.ndjson',
  defaultTags: {},
  currency: 'USD',
  verbose: false,
  onError: undefined,
  warnOnMissingModel: true,
};

let globalConfig: GlobalConfig = { ...DEFAULT_CONFIG };

// ── Adapter cache (P0 fix: resolve once, not per-call) ─────────

let adapterCache: CostAdapter[] | null = null;

function getAdapters(): CostAdapter[] {
  if (!adapterCache) {
    adapterCache = resolveAdapters(globalConfig.adapters, {
      localPath: globalConfig.localPath,
    });
  }
  return adapterCache;
}

// ── Stats ───────────────────────────────────────────────────────

const MAX_UNKNOWN_MODELS = 1000;

const stats: MeterStats = {
  eventsTracked: 0,
  eventsDropped: 0,
  adapterErrors: 0,
  unknownModels: new Set<string>(),
};

// Wire up unknown model warnings
function setupUnknownModelHandler(): void {
  setUnknownModelHandler((provider, model) => {
    if (stats.unknownModels.size >= MAX_UNKNOWN_MODELS) {
      stats.unknownModels.clear();
    }
    stats.unknownModels.add(`${provider}/${model}`);
    if (globalConfig.warnOnMissingModel) {
      console.warn(
        `[llm-cost-meter] Warning: No pricing found for model "${model}" (provider: ${provider}). Cost will be $0.00. Use configurePricing() to add it.`
      );
    }
  });
}
setupUnknownModelHandler();

// ── Configuration ───────────────────────────────────────────────

/**
 * Configure the global llm-cost-meter settings.
 * Merges with current config. Use resetConfig() first for a clean slate.
 */
export function configure(config: Partial<GlobalConfig>): void {
  globalConfig = { ...globalConfig, ...config };
  adapterCache = null; // invalidate — adapters may have changed
}

/**
 * Reset configuration to defaults. Useful for testing.
 */
export function resetConfig(): void {
  globalConfig = { ...DEFAULT_CONFIG };
  adapterCache = null;
}

/**
 * Get the current global configuration.
 */
export function getConfig(): GlobalConfig {
  return { ...globalConfig };
}

/**
 * Get meter health statistics.
 */
export function getMeterStats(): {
  eventsTracked: number;
  eventsDropped: number;
  adapterErrors: number;
  unknownModels: string[];
} {
  return {
    eventsTracked: stats.eventsTracked,
    eventsDropped: stats.eventsDropped,
    adapterErrors: stats.adapterErrors,
    unknownModels: Array.from(stats.unknownModels),
  };
}

/**
 * Reset meter statistics. Useful for testing.
 */
export function resetStats(): void {
  stats.eventsTracked = 0;
  stats.eventsDropped = 0;
  stats.adapterErrors = 0;
  stats.unknownModels.clear();
}

// ── Internal helpers ────────────────────────────────────────────

function detectProvider(response: any): 'openai' | 'anthropic' | 'custom' {
  if (response?.type === 'message' && response?.usage?.input_tokens !== undefined) {
    return 'anthropic';
  }
  if (response?.usage?.prompt_tokens !== undefined) {
    return 'openai';
  }
  return 'custom';
}

function extractModel(response: any): string {
  return response?.model ?? 'unknown';
}

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

function handleAdapterError(
  err: Error,
  event: CostEvent,
  onError?: ErrorHandler,
  verbose?: boolean
): void {
  stats.adapterErrors++;
  if (onError) {
    onError(err, event);
  } else if (verbose) {
    console.error('[llm-cost-meter] Error writing event:', err);
  }
}

async function emitEvent(
  event: CostEvent,
  adapters: CostAdapter[],
  onError?: ErrorHandler,
  verbose?: boolean
): Promise<void> {
  const results = await Promise.allSettled(
    adapters.map((adapter) => adapter.write(event))
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      handleAdapterError(result.reason, event, onError, verbose);
    }
  }
}

function buildEvent(
  provider: 'openai' | 'anthropic' | 'custom',
  model: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  options: MeterOptions,
  defaultTags: Record<string, string>,
  status: 'success' | 'error' = 'success',
  errorMessage?: string
): CostEvent {
  const { inputCostUSD, outputCostUSD, totalCostUSD } = calculateCost(
    provider, model, inputTokens, outputTokens
  );
  const mergedTags = { ...defaultTags, ...options.tags };

  return {
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
    status,
    errorMessage,
    feature: options.feature,
    userId: options.userId,
    sessionId: options.sessionId,
    env: options.env ?? defaultTags.env,
    tags: Object.keys(mergedTags).length > 0 ? mergedTags : undefined,
  };
}

function dispatchEvent(
  event: CostEvent,
  adapters: CostAdapter[],
  awaitWrites: boolean,
  onError?: ErrorHandler,
  verbose?: boolean
): Promise<void> | void {
  if (awaitWrites) {
    return emitEvent(event, adapters, onError, verbose);
  }
  emitEvent(event, adapters, onError, verbose).catch(() => {
    stats.eventsDropped++;
  });
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Wrap an LLM API call to track cost and usage.
 * The response is passed through unchanged. If the wrapped function
 * throws, the error is re-thrown and a failed event is still recorded.
 *
 * By default, adapter writes are fire-and-forget (non-blocking).
 * Set `options.awaitWrites = true` to wait for writes to complete.
 */
export async function meter<T>(
  fn: () => Promise<T>,
  options: MeterOptions = {}
): Promise<T> {
  const startTime = Date.now();
  const adapters = getAdapters();

  let response: T;
  try {
    response = await fn();
  } catch (error) {
    // Track the failed call, then re-throw
    const latencyMs = Date.now() - startTime;
    const event = buildEvent(
      'custom', 'unknown', 0, 0, latencyMs, options,
      globalConfig.defaultTags, 'error',
      error instanceof Error ? error.message : String(error)
    );
    stats.eventsTracked++;
    dispatchEvent(event, adapters, options.awaitWrites ?? false, globalConfig.onError, globalConfig.verbose);
    throw error;
  }

  const latencyMs = Date.now() - startTime;
  const provider = detectProvider(response);
  const model = extractModel(response);
  const { inputTokens, outputTokens } = extractTokens(response, provider);

  const event = buildEvent(
    provider, model, inputTokens, outputTokens, latencyMs,
    options, globalConfig.defaultTags
  );
  stats.eventsTracked++;
  await dispatchEvent(event, adapters, options.awaitWrites ?? false, globalConfig.onError, globalConfig.verbose);

  return response;
}

/**
 * Flush all pending adapter writes. Call before process exit.
 */
export async function flush(): Promise<void> {
  const adapters = getAdapters();
  await Promise.all(
    adapters.map((adapter) => (adapter.flush ? adapter.flush() : Promise.resolve()))
  );
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

  async track<T>(fn: () => Promise<T>, options: MeterOptions = {}): Promise<T> {
    const startTime = Date.now();

    let response: T;
    try {
      response = await fn();
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const event = buildEvent(
        this.config.provider ?? 'custom', 'unknown', 0, 0, latencyMs,
        options, this.config.defaultTags ?? {}, 'error',
        error instanceof Error ? error.message : String(error)
      );
      stats.eventsTracked++;
      dispatchEvent(event, this.adapters, options.awaitWrites ?? false, this.config.onError, this.config.verbose);
      throw error;
    }

    const latencyMs = Date.now() - startTime;
    const provider = this.config.provider ?? detectProvider(response);
    const model = extractModel(response);
    const { inputTokens, outputTokens } = extractTokens(response, provider);

    const event = buildEvent(
      provider, model, inputTokens, outputTokens, latencyMs,
      options, this.config.defaultTags ?? {}
    );
    stats.eventsTracked++;
    await dispatchEvent(event, this.adapters, options.awaitWrites ?? false, this.config.onError, this.config.verbose);

    return response;
  }

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
      provider, data.model, data.inputTokens, data.outputTokens
    );
    const mergedTags = { ...this.config.defaultTags, ...data.tags };

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

    stats.eventsTracked++;
    emitEvent(event, this.adapters, this.config.onError, this.config.verbose).catch(() => {
      stats.eventsDropped++;
    });
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.adapters.map((a) => (a.flush ? a.flush() : Promise.resolve()))
    );
  }
}
