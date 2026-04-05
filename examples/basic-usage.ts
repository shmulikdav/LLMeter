/**
 * Basic usage example for llm-cost-meter
 *
 * This example shows how to wrap LLM API calls with meter()
 * to track cost per feature and per user.
 */

import { meter, configure } from '../src';

// Configure once at app startup
configure({
  adapters: ['console', 'local'],
  localPath: './.llm-costs/events.ndjson',
  defaultTags: {
    env: 'development',
    service: 'my-app',
  },
});

async function main() {
  // Example with Anthropic (uncomment when using with real API)
  //
  // import Anthropic from '@anthropic-ai/sdk';
  // const client = new Anthropic();
  //
  // const response = await meter(
  //   () => client.messages.create({
  //     model: 'claude-sonnet-4-20250514',
  //     max_tokens: 1024,
  //     messages: [{ role: 'user', content: 'Summarize this article...' }]
  //   }),
  //   {
  //     feature: 'article-summarizer',
  //     userId: 'user_abc123',
  //     sessionId: 'sess_xyz',
  //   }
  // );
  //
  // console.log(response.content);

  // Example with OpenAI (uncomment when using with real API)
  //
  // import OpenAI from 'openai';
  // const openai = new OpenAI();
  //
  // const response = await meter(
  //   () => openai.chat.completions.create({
  //     model: 'gpt-4o-mini',
  //     messages: [{ role: 'user', content: 'Classify this text...' }]
  //   }),
  //   {
  //     feature: 'tag-classifier',
  //     userId: 'user_xyz',
  //   }
  // );
  //
  // console.log(response.choices[0].message.content);

  // Demo with a mock response (works without API keys)
  const mockAnthropicCall = async () => ({
    type: 'message' as const,
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 420, output_tokens: 180 },
    content: [{ type: 'text', text: 'This is a summary...' }],
  });

  const result = await meter(mockAnthropicCall, {
    feature: 'article-summarizer',
    userId: 'user_abc123',
    sessionId: 'sess_001',
  });

  console.log('Response:', result.content);

  // Track multiple calls with different features
  const mockClassifierCall = async () => ({
    object: 'chat.completion',
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 200, completion_tokens: 50 },
    choices: [{ message: { content: 'positive' } }],
  });

  const classification = await meter(mockClassifierCall, {
    feature: 'sentiment-classifier',
    userId: 'user_abc123',
  });

  console.log('Classification:', classification.choices[0].message.content);
}

main().catch(console.error);
