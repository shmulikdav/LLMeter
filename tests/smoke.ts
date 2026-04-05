#!/usr/bin/env npx ts-node

/**
 * llm-cost-meter Smoke Test — Real API Calls
 *
 * Tests meter() against live LLM APIs to verify end-to-end cost tracking.
 * Uses the cheapest models to minimize cost (~$0.001 per run).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run test:smoke
 *   OPENAI_API_KEY=sk-...       npm run test:smoke
 *
 * Set one or both API keys. Tests for missing keys are skipped.
 */

import * as fs from 'fs';
import * as path from 'path';
import { meter, CostMeter, configure, CostEvent } from '../src';

const SMOKE_FILE = path.join(__dirname, '..', '.llm-costs', 'smoke-test.ndjson');

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function skip(message: string): void {
  console.log(`  �� ${message} (skipped — no API key)`);
  skipped++;
}

function loadEvents(): CostEvent[] {
  if (!fs.existsSync(SMOKE_FILE)) return [];
  return fs
    .readFileSync(SMOKE_FILE, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function testAnthropic(): Promise<void> {
  console.log('\n── Anthropic (claude-haiku-4-5-20251001) ──');

  if (!process.env.ANTHROPIC_API_KEY) {
    skip('Anthropic API call');
    skip('Event recorded with correct provider');
    skip('Cost is greater than zero');
    return;
  }

  try {
    // Dynamic import so it doesn't fail if SDK not installed
    const Anthropic = (await import('@anthropic-ai/sdk' as string)).default;
    const client = new (Anthropic as any)();

    const eventsBefore = loadEvents().length;

    const response: any = await meter(
      () =>
        client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 50,
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        }),
      {
        feature: 'smoke-test-anthropic',
        userId: 'smoke-tester',
        env: 'test',
      }
    );

    // Wait for async adapter write
    await new Promise((r) => setTimeout(r, 200));

    assert(
      response.content && response.content.length > 0,
      'Anthropic API returned a response'
    );

    const eventsAfter = loadEvents();
    assert(eventsAfter.length > eventsBefore, 'Event was recorded to file');

    const lastEvent = eventsAfter[eventsAfter.length - 1];
    assert(lastEvent.provider === 'anthropic', 'Provider detected as anthropic');
    assert(lastEvent.model === 'claude-haiku-4-5-20251001', 'Model is claude-haiku-4-5-20251001');
    assert(lastEvent.inputTokens > 0, `Input tokens tracked (${lastEvent.inputTokens})`);
    assert(lastEvent.outputTokens > 0, `Output tokens tracked (${lastEvent.outputTokens})`);
    assert(lastEvent.totalCostUSD > 0, `Cost calculated ($${lastEvent.totalCostUSD.toFixed(6)})`);
    assert(lastEvent.feature === 'smoke-test-anthropic', 'Feature tag preserved');
    assert(lastEvent.latencyMs > 0, `Latency measured (${lastEvent.latencyMs}ms)`);
  } catch (err: any) {
    console.error(`  ✗ Anthropic test failed: ${err.message}`);
    failed++;
  }
}

async function testOpenAI(): Promise<void> {
  console.log('\n── OpenAI (gpt-4o-mini) ──');

  if (!process.env.OPENAI_API_KEY) {
    skip('OpenAI API call');
    skip('Event recorded with correct provider');
    skip('Cost is greater than zero');
    return;
  }

  try {
    const OpenAI = (await import('openai' as string)).default;
    const client = new (OpenAI as any)();

    const eventsBefore = loadEvents().length;

    const response: any = await meter(
      () =>
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 50,
          messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
        }),
      {
        feature: 'smoke-test-openai',
        userId: 'smoke-tester',
        env: 'test',
      }
    );

    await new Promise((r) => setTimeout(r, 200));

    assert(
      response.choices && response.choices.length > 0,
      'OpenAI API returned a response'
    );

    const eventsAfter = loadEvents();
    assert(eventsAfter.length > eventsBefore, 'Event was recorded to file');

    const lastEvent = eventsAfter[eventsAfter.length - 1];
    assert(lastEvent.provider === 'openai', 'Provider detected as openai');
    assert(lastEvent.model.includes('gpt-4o-mini'), 'Model is gpt-4o-mini');
    assert(lastEvent.inputTokens > 0, `Input tokens tracked (${lastEvent.inputTokens})`);
    assert(lastEvent.outputTokens > 0, `Output tokens tracked (${lastEvent.outputTokens})`);
    assert(lastEvent.totalCostUSD > 0, `Cost calculated ($${lastEvent.totalCostUSD.toFixed(6)})`);
    assert(lastEvent.feature === 'smoke-test-openai', 'Feature tag preserved');
    assert(lastEvent.latencyMs > 0, `Latency measured (${lastEvent.latencyMs}ms)`);
  } catch (err: any) {
    console.error(`  ✗ OpenAI test failed: ${err.message}`);
    failed++;
  }
}

async function testCostMeterRecord(): Promise<void> {
  console.log('\n── CostMeter.record() (no API key needed) ──');

  const eventsBefore = loadEvents().length;

  const costMeter = new CostMeter({
    provider: 'anthropic',
    adapters: ['local'],
    localPath: SMOKE_FILE,
  });

  costMeter.record({
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    inputTokens: 1000,
    outputTokens: 500,
    feature: 'smoke-test-manual',
    userId: 'smoke-tester',
  });

  await new Promise((r) => setTimeout(r, 200));

  const eventsAfter = loadEvents();
  assert(eventsAfter.length > eventsBefore, 'Manual event was recorded');

  const lastEvent = eventsAfter[eventsAfter.length - 1];
  assert(lastEvent.totalCostUSD > 0, `Cost calculated ($${lastEvent.totalCostUSD.toFixed(6)})`);
  assert(lastEvent.totalTokens === 1500, 'Total tokens correct (1500)');
}

async function main(): Promise<void> {
  console.log('╔═══��══════════════════════════════════════════╗');
  console.log('║   llm-cost-meter — Smoke Test               ║');
  console.log('╚════════════��═════════════════════════════════╝');

  // Clean up previous smoke test data
  if (fs.existsSync(SMOKE_FILE)) {
    fs.unlinkSync(SMOKE_FILE);
  }

  // Configure for smoke test
  configure({
    adapters: ['console', 'local'],
    localPath: SMOKE_FILE,
    defaultTags: { env: 'smoke-test' },
    verbose: true,
  });

  await testCostMeterRecord();
  await testAnthropic();
  await testOpenAI();

  // Summary
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('══════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
