import { LangChainCostHandler } from '../src/integrations/langchain';

describe('LangChainCostHandler', () => {
  it('has name "llm-cost-meter"', () => {
    const handler = new LangChainCostHandler();
    expect(handler.name).toBe('llm-cost-meter');
  });

  it('records events on handleLLMEnd with OpenAI token usage', async () => {
    const handler = new LangChainCostHandler({ feature: 'rag', userId: 'user_1' });

    await handler.handleLLMStart({}, ['Hello'], 'run-1');
    await handler.handleLLMEnd({
      llmOutput: {
        model: 'gpt-4o',
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
      generations: [[{ text: 'Hi!' }]],
    }, 'run-1');

    expect(handler.events).toHaveLength(1);
    const event = handler.events[0];
    expect(event.provider).toBe('openai');
    expect(event.model).toBe('gpt-4o');
    expect(event.inputTokens).toBe(100);
    expect(event.outputTokens).toBe(50);
    expect(event.feature).toBe('rag');
    expect(event.userId).toBe('user_1');
    expect(event.totalCostUSD).toBeGreaterThan(0);
  });

  it('records events with Anthropic token usage', async () => {
    const handler = new LangChainCostHandler({ feature: 'chat' });

    await handler.handleLLMStart({}, ['Hello'], 'run-2');
    await handler.handleLLMEnd({
      llmOutput: {
        model: 'claude-sonnet-4-20250514',
        tokenUsage: { inputTokens: 200, outputTokens: 80 },
      },
      generations: [[{ text: 'Hi!' }]],
    }, 'run-2');

    expect(handler.events).toHaveLength(1);
    expect(handler.events[0].provider).toBe('anthropic');
    expect(handler.events[0].inputTokens).toBe(200);
    expect(handler.events[0].outputTokens).toBe(80);
  });

  it('measures latency between start and end', async () => {
    const handler = new LangChainCostHandler();

    await handler.handleLLMStart({}, ['Hello'], 'run-3');
    await new Promise(r => setTimeout(r, 60));
    await handler.handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 5 } },
      generations: [[{ text: 'ok' }]],
    }, 'run-3');

    expect(handler.events[0].latencyMs).toBeGreaterThanOrEqual(50);
  });

  it('records error events on handleLLMError', async () => {
    const handler = new LangChainCostHandler({ feature: 'test' });

    await handler.handleLLMStart({}, ['Hello'], 'run-4');
    await handler.handleLLMError(new Error('Rate limited'), 'run-4');

    expect(handler.events).toHaveLength(1);
    expect(handler.events[0].status).toBe('error');
    expect(handler.events[0].errorMessage).toBe('Rate limited');
    expect(handler.events[0].feature).toBe('test');
  });

  it('tracks multiple calls independently', async () => {
    const handler = new LangChainCostHandler({ feature: 'multi' });

    await handler.handleLLMStart({}, ['Q1'], 'run-a');
    await handler.handleLLMEnd({
      llmOutput: { model: 'gpt-4o', tokenUsage: { promptTokens: 50, completionTokens: 20 } },
      generations: [[{ text: 'A1' }]],
    }, 'run-a');

    await handler.handleLLMStart({}, ['Q2'], 'run-b');
    await handler.handleLLMEnd({
      llmOutput: { model: 'gpt-4o-mini', tokenUsage: { promptTokens: 30, completionTokens: 10 } },
      generations: [[{ text: 'A2' }]],
    }, 'run-b');

    expect(handler.events).toHaveLength(2);
    expect(handler.events[0].model).toBe('gpt-4o');
    expect(handler.events[1].model).toBe('gpt-4o-mini');
  });

  it('applies config tags to all events', async () => {
    const handler = new LangChainCostHandler({
      feature: 'pipeline',
      env: 'production',
      tags: { team: 'ml' },
    });

    await handler.handleLLMStart({}, ['Hello'], 'run-5');
    await handler.handleLLMEnd({
      llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 5 } },
      generations: [[{ text: 'ok' }]],
    }, 'run-5');

    expect(handler.events[0].env).toBe('production');
    expect(handler.events[0].tags?.team).toBe('ml');
  });
});
