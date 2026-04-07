import { CostAdapter, CostEvent, OTelAdapterConfig } from '../types';

/**
 * OpenTelemetry adapter that exports LLM cost metrics.
 *
 * Requires `@opentelemetry/api` as a peer dependency.
 * Records: llm.cost.total, llm.tokens.input, llm.tokens.output, llm.request.duration
 *
 * @example
 * ```typescript
 * import { OTelAdapter } from 'llm-cost-meter';
 * configure({ adapters: [new OTelAdapter()] });
 * ```
 */
export class OTelAdapter implements CostAdapter {
  name = 'otel';
  private costHistogram: any;
  private inputTokensCounter: any;
  private outputTokensCounter: any;
  private durationHistogram: any;

  constructor(config: OTelAdapterConfig = {}) {
    let otelApi: any;
    try {
      otelApi = require('@opentelemetry/api');
    } catch {
      throw new Error(
        'OTelAdapter requires @opentelemetry/api. Install it with: npm install @opentelemetry/api'
      );
    }

    const meterName = config.meterName ?? 'llm-cost-meter';
    const meter = otelApi.metrics.getMeter(meterName);

    this.costHistogram = meter.createHistogram('llm.cost.total', {
      description: 'Total cost of LLM API call in USD',
      unit: 'USD',
    });

    this.inputTokensCounter = meter.createCounter('llm.tokens.input', {
      description: 'Input tokens consumed',
      unit: 'tokens',
    });

    this.outputTokensCounter = meter.createCounter('llm.tokens.output', {
      description: 'Output tokens generated',
      unit: 'tokens',
    });

    this.durationHistogram = meter.createHistogram('llm.request.duration', {
      description: 'LLM API call duration',
      unit: 'ms',
    });
  }

  async write(event: CostEvent): Promise<void> {
    const attributes: Record<string, string> = {
      provider: event.provider,
      model: event.model,
    };
    if (event.feature) attributes.feature = event.feature;
    if (event.userId) attributes['user.id'] = event.userId;
    if (event.env) attributes.env = event.env;
    if (event.status) attributes.status = event.status;

    this.costHistogram.record(event.totalCostUSD, attributes);
    this.inputTokensCounter.add(event.inputTokens, attributes);
    this.outputTokensCounter.add(event.outputTokens, attributes);
    this.durationHistogram.record(event.latencyMs, attributes);
  }
}
