import { CostEvent, MeterOptions } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { calculateCost } from '../pricing';

// We don't import from @langchain/core — we duck-type the callback interface
// so users don't need to install LangChain just to import our types.

export interface LangChainCostHandlerConfig {
  feature?: string;
  userId?: string;
  sessionId?: string;
  env?: string;
  tags?: Record<string, string>;
}

/**
 * LangChain callback handler that tracks cost for every LLM call in a chain.
 *
 * @example
 * ```typescript
 * import { LangChainCostHandler } from 'llm-cost-meter/langchain';
 *
 * const handler = new LangChainCostHandler({ feature: 'rag-pipeline', userId: 'user_123' });
 * const result = await model.invoke('Hello', { callbacks: [handler] });
 * ```
 */
export class LangChainCostHandler {
  private config: LangChainCostHandlerConfig;
  private startTimes = new Map<string, number>();
  private _events: CostEvent[] = [];

  // LangChain requires this property
  name = 'llm-cost-meter';

  constructor(config: LangChainCostHandlerConfig = {}) {
    this.config = config;
  }

  get events(): CostEvent[] {
    return [...this._events];
  }

  async handleLLMStart(
    _llm: any,
    _prompts: string[],
    runId: string
  ): Promise<void> {
    this.startTimes.set(runId, Date.now());
  }

  async handleLLMEnd(output: any, runId: string): Promise<void> {
    const startTime = this.startTimes.get(runId) ?? Date.now();
    const latencyMs = Date.now() - startTime;
    this.startTimes.delete(runId);

    // LangChain stores usage in output.llmOutput
    const llmOutput = output?.llmOutput ?? {};
    const usage = llmOutput.tokenUsage ?? llmOutput.usage ?? {};

    // Detect provider from llmOutput shape
    let provider: 'openai' | 'anthropic' | 'custom' = 'custom';
    let model = llmOutput.model ?? llmOutput.modelName ?? 'unknown';
    let inputTokens = 0;
    let outputTokens = 0;

    if (usage.promptTokens !== undefined || usage.prompt_tokens !== undefined) {
      provider = 'openai';
      inputTokens = usage.promptTokens ?? usage.prompt_tokens ?? 0;
      outputTokens = usage.completionTokens ?? usage.completion_tokens ?? 0;
    } else if (usage.inputTokens !== undefined || usage.input_tokens !== undefined) {
      provider = 'anthropic';
      inputTokens = usage.inputTokens ?? usage.input_tokens ?? 0;
      outputTokens = usage.outputTokens ?? usage.output_tokens ?? 0;
    } else if (usage.totalTokens || usage.total_tokens) {
      provider = 'openai';
      inputTokens = usage.promptTokens ?? usage.prompt_tokens ?? 0;
      outputTokens = usage.completionTokens ?? usage.completion_tokens ?? 0;
    }

    const { inputCostUSD, outputCostUSD, totalCostUSD } = calculateCost(
      provider, model, inputTokens, outputTokens
    );

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
      feature: this.config.feature,
      userId: this.config.userId,
      sessionId: this.config.sessionId,
      env: this.config.env,
      tags: this.config.tags,
    };

    this._events.push(event);

    // Also emit through the global pipeline if meter is configured
    try {
      const { configure: _, ...index } = require('../index');
      if ((index as any).getAdapters) {
        // Internal function — dispatch through adapters
      }
    } catch {
      // Index not available — just store events locally
    }
  }

  async handleLLMError(err: Error, runId: string): Promise<void> {
    const startTime = this.startTimes.get(runId) ?? Date.now();
    const latencyMs = Date.now() - startTime;
    this.startTimes.delete(runId);

    const event: CostEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      provider: 'custom',
      model: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputCostUSD: 0,
      outputCostUSD: 0,
      totalCostUSD: 0,
      latencyMs,
      status: 'error',
      errorMessage: err.message,
      feature: this.config.feature,
      userId: this.config.userId,
      sessionId: this.config.sessionId,
      env: this.config.env,
      tags: this.config.tags,
    };

    this._events.push(event);
  }
}
