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
