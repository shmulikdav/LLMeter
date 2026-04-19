import { v4 as uuidv4 } from 'uuid';
import {
  CostEvent,
  MeterOptions,
  CostMeterConfig,
  GlobalConfig,
  CostAdapter,
  ErrorHandler,
  MeterStats,
  ExpressMiddlewareOptions,
  BudgetConfig,
  BudgetStatus,
} from './types';
import { calculateCost, setUnknownModelHandler } from './pricing';
import { resolveAdapters } from './adapters';
import { budgetMonitor } from './budget';

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
  ExpressMiddlewareOptions,
  WebhookAdapterConfig,
  OTelAdapterConfig,
  BudgetRule,
  BudgetConfig,
  BudgetStatus,
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
export { ConsoleAdapter, LocalAdapter, WebhookAdapter, OTelAdapter, createAdapter } from './adapters';

// Re-export middleware
export { createExpressMiddleware } from './middleware/express';

// Re-export integrations
export { LangChainCostHandler } from './integrations/langchain';
export { withCostTracking, withMeteredAction, createNextApiHandler } from './integrations/nextjs';

// Re-export analytics
export { forecast } from './analytics/forecast';
export type { ForecastResult } from './analytics/forecast';
export { detectAnomalies } from './analytics/anomalies';
export type { AnomalyResult, AnomalyOptions } from './analytics/anomalies';

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

// ── Budget API ──────────────────────────────────────────────────

/**
 * Configure budget alert rules. Fires callbacks when daily cost
 * thresholds are exceeded per feature.
 */
export function configureBudget(config: BudgetConfig): void {
  budgetMonitor.configure(config);
}

/**
 * Get current budget status for all configured rules.
 */
export function getBudgetStatus(): BudgetStatus[] {
  return budgetMonitor.getStatus();
}

/**
 * Reset budget accumulators and rules. Useful for testing.
 */
export function resetBudget(): void {
  budgetMonitor.reset();
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
  // Check budget thresholds
  budgetMonitor.check(event);

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

  /**
   * Wrap a streaming LLM call. Passes through the stream unchanged
   * and records cost after the stream completes.
   */
  async trackStream<T extends AsyncIterable<any>>(
    fn: () => Promise<T>,
    options: MeterOptions = {}
  ): Promise<T> {
    const startTime = Date.now();
    const stream = await fn();
    const adapters = this.adapters;
    const config = this.config;

    return wrapStream(stream, startTime, options, adapters, config.defaultTags ?? {}, config.provider, config.onError, config.verbose) as T;
  }

  async flush(): Promise<void> {
    await Promise.all(
      this.adapters.map((a) => (a.flush ? a.flush() : Promise.resolve()))
    );
  }
}

// ── Streaming Support ───────────────────────────────────────────

/**
 * Extract usage from a streaming response's accumulated state.
 * Works with both OpenAI and Anthropic stream objects.
 */
function extractStreamUsage(streamObj: any, chunks: any[]): {
  provider: 'openai' | 'anthropic' | 'custom';
  model: string;
  inputTokens: number;
  outputTokens: number;
} {
  // OpenAI: stream objects often have .usage or finalUsage after iteration
  if (streamObj?.usage?.prompt_tokens !== undefined) {
    return {
      provider: 'openai',
      model: streamObj.model ?? 'unknown',
      inputTokens: streamObj.usage.prompt_tokens,
      outputTokens: streamObj.usage.completion_tokens ?? 0,
    };
  }

  // Anthropic: stream objects accumulate a .message or .finalMessage with usage
  if (streamObj?.message?.usage?.input_tokens !== undefined) {
    return {
      provider: 'anthropic',
      model: streamObj.message.model ?? 'unknown',
      inputTokens: streamObj.message.usage.input_tokens,
      outputTokens: streamObj.message.usage.output_tokens ?? 0,
    };
  }
  if (streamObj?.finalMessage?.usage?.input_tokens !== undefined) {
    return {
      provider: 'anthropic',
      model: streamObj.finalMessage.model ?? 'unknown',
      inputTokens: streamObj.finalMessage.usage.input_tokens,
      outputTokens: streamObj.finalMessage.usage.output_tokens ?? 0,
    };
  }

  // Fallback: scan chunks for usage data
  let model = 'unknown';
  let inputTokens = 0;
  let outputTokens = 0;
  let provider: 'openai' | 'anthropic' | 'custom' = 'custom';

  for (const chunk of chunks) {
    if (chunk?.model) model = chunk.model;

    // OpenAI chunk with usage (last chunk when include_usage is set)
    if (chunk?.usage?.prompt_tokens !== undefined) {
      provider = 'openai';
      inputTokens = chunk.usage.prompt_tokens;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }

    // Anthropic message_start event
    if (chunk?.type === 'message_start' && chunk?.message?.usage) {
      provider = 'anthropic';
      inputTokens = chunk.message.usage.input_tokens ?? 0;
    }

    // Anthropic message_delta event with usage
    if (chunk?.type === 'message_delta' && chunk?.usage) {
      provider = 'anthropic';
      outputTokens = chunk.usage.output_tokens ?? 0;
    }
  }

  return { provider, model, inputTokens, outputTokens };
}

function wrapStream<T extends AsyncIterable<any>>(
  stream: T,
  startTime: number,
  options: MeterOptions,
  adapters: CostAdapter[],
  defaultTags: Record<string, string>,
  providerHint?: 'openai' | 'anthropic' | 'custom',
  onError?: ErrorHandler,
  verbose?: boolean
): AsyncIterable<any> {
  const chunks: any[] = [];

  const wrapped = {
    [Symbol.asyncIterator](): AsyncIterator<any> {
      const iterator = (stream as any)[Symbol.asyncIterator]();

      return {
        async next() {
          try {
            const result = await iterator.next();
            if (!result.done) {
              chunks.push(result.value);
            }
            if (result.done) {
              // Stream ended — record cost event
              const latencyMs = Date.now() - startTime;
              const usage = extractStreamUsage(stream, chunks);
              const provider = providerHint ?? usage.provider;
              const event = buildEvent(
                provider, usage.model, usage.inputTokens, usage.outputTokens,
                latencyMs, options, defaultTags
              );
              stats.eventsTracked++;
              dispatchEvent(event, adapters, options.awaitWrites ?? false, onError, verbose);
            }
            return result;
          } catch (error) {
            // Stream errored — record error event
            const latencyMs = Date.now() - startTime;
            const event = buildEvent(
              providerHint ?? 'custom', 'unknown', 0, 0, latencyMs,
              options, defaultTags, 'error',
              error instanceof Error ? error.message : String(error)
            );
            stats.eventsTracked++;
            dispatchEvent(event, adapters, options.awaitWrites ?? false, onError, verbose);
            throw error;
          }
        },
        async return(value?: any) {
          if (iterator.return) return iterator.return(value);
          return { done: true, value: undefined };
        },
        async throw(error?: any) {
          if (iterator.throw) return iterator.throw(error);
          throw error;
        },
      };
    },
  };

  // Copy over non-iterator properties from the original stream
  // (e.g., OpenAI's .controller, .response, etc.)
  const proto = Object.getOwnPropertyNames(stream).concat(
    Object.getOwnPropertyNames(Object.getPrototypeOf(stream) ?? {})
  );
  for (const key of proto) {
    if (key === 'constructor' || key === Symbol.asyncIterator.toString()) continue;
    if (!(key in wrapped)) {
      try {
        const desc = Object.getOwnPropertyDescriptor(stream, key) ??
                     Object.getOwnPropertyDescriptor(Object.getPrototypeOf(stream), key);
        if (desc) {
          Object.defineProperty(wrapped, key, {
            get: () => (stream as any)[key],
            enumerable: desc.enumerable,
            configurable: true,
          });
        }
      } catch {
        // Skip non-copyable properties
      }
    }
  }

  return wrapped;
}

/**
 * Wrap a streaming LLM API call to track cost and usage.
 * Returns the stream unchanged — cost is recorded after the stream completes.
 *
 * Works with both OpenAI and Anthropic streaming responses.
 *
 * @example
 * ```typescript
 * const stream = await meterStream(
 *   () => openai.chat.completions.create({ model: 'gpt-4o', messages: [...], stream: true }),
 *   { feature: 'chat', userId: 'user_123' }
 * );
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
 * }
 * // Cost event automatically recorded when stream ends
 * ```
 */
export async function meterStream<T extends AsyncIterable<any>>(
  fn: () => Promise<T>,
  options: MeterOptions = {}
): Promise<T> {
  const startTime = Date.now();
  const adapters = getAdapters();

  let stream: T;
  try {
    stream = await fn();
  } catch (error) {
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

  return wrapStream(stream, startTime, options, adapters, globalConfig.defaultTags, undefined, globalConfig.onError, globalConfig.verbose) as T;
}
