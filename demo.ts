#!/usr/bin/env npx ts-node

/**
 * llm-cost-meter Demo
 *
 * Run: npx ts-node demo.ts
 *
 * This demo simulates a production app with 3 AI features,
 * multiple users, and shows real-time cost tracking + reporting.
 */

import { meter, CostMeter, configure } from './src';
import { execSync } from 'child_process';
import * as fs from 'fs';

// ── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Mock LLM responses that mirror real API shapes
function mockAnthropicResponse(model: string, inputTokens: number, outputTokens: number) {
  return async () => {
    await sleep(randomBetween(50, 150)); // simulate latency
    return {
      type: 'message' as const,
      model,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      content: [{ type: 'text', text: 'Mock response from Anthropic.' }],
    };
  };
}

function mockOpenAIResponse(model: string, promptTokens: number, completionTokens: number) {
  return async () => {
    await sleep(randomBetween(50, 150));
    return {
      object: 'chat.completion',
      model,
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
      choices: [{ message: { role: 'assistant', content: 'Mock response from OpenAI.' } }],
    };
  };
}

// ── Main Demo ────────────────────────────────────────────────────

async function main() {
  const DEMO_FILE = './.llm-costs/demo-events.ndjson';

  // Clean up from previous runs
  if (fs.existsSync(DEMO_FILE)) {
    fs.unlinkSync(DEMO_FILE);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║             llm-cost-meter — Live Demo                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Step 1: Configure ──────────────────────────────────────────

  console.log('━━━ Step 1: Configure llm-cost-meter ━━━');
  console.log('');
  console.log('  configure({');
  console.log("    adapters: ['console', 'local'],");
  console.log(`    localPath: '${DEMO_FILE}',`);
  console.log("    defaultTags: { env: 'production', service: 'demo-app' },");
  console.log('  });');
  console.log('');

  configure({
    adapters: ['console', 'local'],
    localPath: DEMO_FILE,
    defaultTags: { env: 'production', service: 'demo-app' },
  });

  // ── Step 2: Simulate real API calls ────────────────────────────

  console.log('━━━ Step 2: Simulate production traffic (15 LLM calls) ━━━');
  console.log('');

  const users = ['user_alice', 'user_bob', 'user_charlie'];
  const sessions = ['sess_morning', 'sess_afternoon'];

  // Feature 1: Article Summarizer (Anthropic Claude Sonnet — moderate cost)
  for (let i = 0; i < 5; i++) {
    await meter(
      mockAnthropicResponse(
        'claude-sonnet-4-20250514',
        randomBetween(800, 2000),
        randomBetween(200, 600)
      ),
      {
        feature: 'article-summarizer',
        userId: users[i % users.length],
        sessionId: sessions[i % sessions.length],
      }
    );
  }

  // Feature 2: Chat Assistant (Anthropic Claude Opus — expensive)
  for (let i = 0; i < 4; i++) {
    await meter(
      mockAnthropicResponse(
        'claude-opus-4-20250514',
        randomBetween(2000, 5000),
        randomBetween(500, 2000)
      ),
      {
        feature: 'chat',
        userId: users[i % users.length],
        sessionId: sessions[i % sessions.length],
      }
    );
  }

  // Feature 3: Tag Classifier (OpenAI GPT-4o-mini — cheap)
  for (let i = 0; i < 6; i++) {
    await meter(
      mockOpenAIResponse(
        'gpt-4o-mini',
        randomBetween(100, 300),
        randomBetween(10, 50)
      ),
      {
        feature: 'tag-classifier',
        userId: users[i % users.length],
        sessionId: sessions[i % sessions.length],
      }
    );
  }

  console.log('');

  // ── Step 3: Show the CostMeter class ──────────────────────────

  console.log('━━━ Step 3: CostMeter class — manual event recording ━━━');
  console.log('');

  const costMeter = new CostMeter({
    provider: 'openai',
    adapters: ['console', 'local'],
    localPath: DEMO_FILE,
    defaultTags: { env: 'production' },
  });

  costMeter.record({
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 3500,
    outputTokens: 1200,
    feature: 'document-qa',
    userId: 'user_alice',
    tags: { team: 'product' },
  });

  // Wait for async writes to flush
  await sleep(200);

  // ── Step 4: CLI Reports ────────────────────────────────────────

  console.log('');
  console.log('━━━ Step 4: CLI Reports ━━━');
  console.log('');
  console.log('$ npx llm-cost-meter report --file ' + DEMO_FILE);
  console.log('');

  try {
    const output = execSync(`node dist/cli.js report --file ${DEMO_FILE}`, {
      encoding: 'utf-8',
    });
    console.log(output);
  } catch (e: any) {
    console.log(e.stdout || e.message);
  }

  // By user
  console.log('$ npx llm-cost-meter report --group-by userId --file ' + DEMO_FILE);
  console.log('');

  try {
    const output = execSync(
      `node dist/cli.js report --group-by userId --file ${DEMO_FILE}`,
      { encoding: 'utf-8' }
    );
    console.log(output);
  } catch (e: any) {
    console.log(e.stdout || e.message);
  }

  // By model
  console.log('$ npx llm-cost-meter report --group-by model --file ' + DEMO_FILE);
  console.log('');

  try {
    const output = execSync(
      `node dist/cli.js report --group-by model --file ${DEMO_FILE}`,
      { encoding: 'utf-8' }
    );
    console.log(output);
  } catch (e: any) {
    console.log(e.stdout || e.message);
  }

  // JSON export
  console.log('$ npx llm-cost-meter report --format json --top 2 --file ' + DEMO_FILE);
  console.log('');

  try {
    const output = execSync(
      `node dist/cli.js report --format json --top 2 --file ${DEMO_FILE}`,
      { encoding: 'utf-8' }
    );
    console.log(output);
  } catch (e: any) {
    console.log(e.stdout || e.message);
  }

  // CSV export
  console.log('$ npx llm-cost-meter report --format csv --file ' + DEMO_FILE);
  console.log('');

  try {
    const output = execSync(
      `node dist/cli.js report --format csv --file ${DEMO_FILE}`,
      { encoding: 'utf-8' }
    );
    console.log(output);
  } catch (e: any) {
    console.log(e.stdout || e.message);
  }

  // ── Done ───────────────────────────────────────────────────────

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Demo complete! Events saved to:                        ║');
  console.log('║  ' + DEMO_FILE.padEnd(55) + '║');
  console.log('║                                                         ║');
  console.log('║  Try it yourself:                                       ║');
  console.log('║    npx llm-cost-meter report --file ' + DEMO_FILE.padEnd(20) + '║');
  console.log('║    npx llm-cost-meter report --group-by userId          ║');
  console.log('║    npx llm-cost-meter report --format csv > costs.csv   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
}

main().catch(console.error);
