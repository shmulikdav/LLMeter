export interface CostEvent {
  id: string;
  timestamp: string;
  provider: 'openai' | 'anthropic' | 'custom';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUSD: number;
  outputCostUSD: number;
  totalCostUSD: number;
  latencyMs: number;
  status?: 'success' | 'error';
  errorMessage?: string;
  feature?: string;
  userId?: string;
  sessionId?: string;
  env?: string;
  tags?: Record<string, string>;
}

export type ErrorHandler = (error: Error, event?: CostEvent) => void;

export interface MeterOptions {
  feature?: string;
  userId?: string;
  sessionId?: string;
  env?: string;
  tags?: Record<string, string>;
  /** If true, await adapter writes before returning. Default: false (fire-and-forget). */
  awaitWrites?: boolean;
}

export interface CostMeterConfig {
  provider?: 'openai' | 'anthropic' | 'custom';
  adapters?: Array<string | CostAdapter>;
  localPath?: string;
  defaultTags?: Record<string, string>;
  currency?: string;
  verbose?: boolean;
  /** Called when an adapter write fails. If not set, errors are logged when verbose=true. */
  onError?: ErrorHandler;
}

export interface GlobalConfig {
  adapters: Array<string | CostAdapter>;
  localPath: string;
  defaultTags: Record<string, string>;
  currency: string;
  verbose: boolean;
  /** Called when an adapter write fails. If not set, errors are logged when verbose=true. */
  onError?: ErrorHandler;
  /** If true, warn to console when a model is not found in the pricing table. Default: true. */
  warnOnMissingModel: boolean;
}

export interface CostAdapter {
  name: string;
  write(event: CostEvent): Promise<void>;
  /** Optional cleanup method called on flush/shutdown. */
  flush?(): Promise<void>;
}

export interface ModelPricing {
  input: number;
  output: number;
  unit: string;
}

export interface PricingTable {
  [model: string]: ModelPricing;
}

export interface SummaryRow {
  key: string;
  calls: number;
  totalTokens: number;
  avgCostPerCall: number;
  totalCost: number;
}

export interface ReportOptions {
  groupBy?: string;
  feature?: string;
  env?: string;
  userId?: string;
  from?: string;
  to?: string;
  top?: number;
  format?: 'table' | 'csv' | 'json';
  file?: string;
}

export interface MeterStats {
  eventsTracked: number;
  eventsDropped: number;
  adapterErrors: number;
  unknownModels: Set<string>;
}

// ── Express Middleware Types ────────────────────────────────────

export interface ExpressMiddlewareOptions {
  feature: string;
  extractUserId?: (req: any) => string | undefined;
  extractSessionId?: (req: any) => string | undefined;
  env?: string;
  tags?: Record<string, string>;
}

// ── Webhook Adapter Types ──────────────────────────────────────

export interface WebhookAdapterConfig {
  url: string;
  headers?: Record<string, string>;
  /** Number of events to buffer before sending. Default: 1 (immediate). */
  batchSize?: number;
  /** Flush buffer interval in ms. Only used when batchSize > 1. Default: 5000. */
  flushIntervalMs?: number;
  /** Request timeout in ms. Default: 10000. */
  timeoutMs?: number;
}

// ── OpenTelemetry Adapter Types ────────────────────────────────

export interface OTelAdapterConfig {
  /** OpenTelemetry meter name. Default: 'llm-cost-meter'. */
  meterName?: string;
}

// ── Budget Alert Types ─────────────────────────────────────────

export interface BudgetRule {
  /** Feature name to monitor, or '*' for global (all features). */
  feature: string;
  /** Maximum daily spend in USD. */
  dailyLimitUSD: number;
  /** Called once per day when the limit is exceeded. */
  onExceed: (rule: BudgetRule, currentSpendUSD: number) => void;
}

export interface BudgetConfig {
  rules: BudgetRule[];
}

export interface BudgetStatus {
  feature: string;
  dailyLimitUSD: number;
  currentSpendUSD: number;
  exceeded: boolean;
  date: string;
}
