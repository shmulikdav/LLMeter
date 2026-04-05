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
  feature?: string;
  userId?: string;
  sessionId?: string;
  env?: string;
  tags?: Record<string, string>;
}

export interface MeterOptions {
  feature?: string;
  userId?: string;
  sessionId?: string;
  env?: string;
  tags?: Record<string, string>;
}

export interface CostMeterConfig {
  provider?: 'openai' | 'anthropic' | 'custom';
  adapters?: Array<string | CostAdapter>;
  localPath?: string;
  defaultTags?: Record<string, string>;
  currency?: string;
  verbose?: boolean;
}

export interface GlobalConfig {
  adapters: Array<string | CostAdapter>;
  localPath: string;
  defaultTags: Record<string, string>;
  currency: string;
  verbose: boolean;
}

export interface CostAdapter {
  name: string;
  write(event: CostEvent): Promise<void>;
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
