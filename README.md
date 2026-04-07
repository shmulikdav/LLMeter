# llm-cost-meter

[![npm version](https://img.shields.io/npm/v/llm-cost-meter.svg)](https://www.npmjs.com/package/llm-cost-meter)
[![license](https://img.shields.io/npm/l/llm-cost-meter.svg)](https://github.com/shmulikdav/llmeter/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/llm-cost-meter.svg)](https://nodejs.org)

**Per-feature, per-user LLM cost attribution for production AI apps.**

Every team running AI in production knows their monthly bill. No team knows which feature is responsible for which cost. `llm-cost-meter` wraps your LLM API calls, calculates actual cost from token usage, and tags every call by feature, user, and environment — so you can finally see where the money goes.

## Installation

```bash
npm install llm-cost-meter
```

Requires Node.js >= 18.

## Quick Start (60 seconds)

### 1. Wrap your LLM call

```typescript
import { meter, configure } from 'llm-cost-meter';
import Anthropic from '@anthropic-ai/sdk';

configure({ adapters: ['console'] });

const client = new Anthropic();

const response = await meter(
  () => client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Summarize this article...' }]
  }),
  {
    feature: 'article-summarizer',
    userId: 'user_abc123',
  }
);

// Your response is unchanged
console.log(response.content);
// Console output: [llm-cost-meter] article-summarizer — $0.00396 (600 tokens, 1240ms)
```

### 2. Enable local storage

```typescript
configure({
  adapters: ['console', 'local'],
  localPath: './.llm-costs/events.ndjson',
});
```

### 3. View your report

```bash
npx llm-cost-meter report
```

```
llm-cost-meter report — 2025-04-01 to 2025-04-05
Source: ./.llm-costs/events.ndjson (1,284 events)

By feature:
┌─────────────────────┬────────┬──────────────┬────────────────┬────────────────┐
│ Feature             │ Calls  │ Total Tokens │ Avg Cost/Call  │ Total Cost     │
├─────────────────────┼────────┼──────────────┼────────────────┼────────────────┤
│ article-summarizer  │ 843    │ 2,104,200    │ $0.0039        │ $3.29          │
│ chat                │ 312    │ 987,400      │ $0.0121        │ $3.78          │
│ tag-classifier      │ 129    │ 198,300      │ $0.0002        │ $0.02          │
├─────────────────────┼────────┼──────────────┼────────────────┼────────────────┤
│ TOTAL               │ 1,284  │ 3,289,900    │ —              │ $7.09          │
└─────────────────────┴────────┴──────────────┴────────────────┴────────────────┘

Insight: 'chat' drives 53% of cost but only 24% of calls.
```

## Streaming Support

Track costs from streaming LLM responses. The stream is passed through unchanged — cost is recorded automatically when the stream ends.

```typescript
import { meterStream } from 'llm-cost-meter';

// OpenAI streaming
const stream = await meterStream(
  () => openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Write a poem' }],
    stream: true,
    stream_options: { include_usage: true },
  }),
  { feature: 'chat', userId: 'user_123' }
);

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
// Cost event automatically recorded when stream ends

// Anthropic streaming
const stream = await meterStream(
  () => anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Write a poem' }],
  }),
  { feature: 'chat' }
);

for await (const event of stream) {
  // handle events
}
```

Works with both OpenAI and Anthropic streaming. Extracts usage from the stream object, final chunk, or accumulated message events. If the stream errors mid-way, a `status: 'error'` event is recorded.

## Express Middleware

Drop-in middleware that attaches `req.meter()` to every request:

```typescript
import { createExpressMiddleware, configure } from 'llm-cost-meter';

configure({ adapters: ['console', 'local'] });

// Attach to specific routes
app.post('/api/chat',
  createExpressMiddleware({ feature: 'chat' }),
  async (req, res) => {
    const response = await req.meter(() =>
      client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: req.body.message }],
      })
    );
    res.json(response);
  }
);

// With custom user/session extraction
app.use('/api', createExpressMiddleware({
  feature: 'api',
  extractUserId: (req) => req.headers['x-user-id'],
  extractSessionId: (req) => req.cookies?.sid,
  env: 'production',
  tags: { team: 'backend' },
}));
```

The middleware automatically fills in `feature`, `userId`, `sessionId`, `env`, and `tags` — your route handlers just call `req.meter()`.

## Tagging Guide

Every `meter()` call accepts these tags:

| Tag | Purpose | Example |
|-----|---------|---------|
| `feature` | Which product feature made the call | `'article-summarizer'` |
| `userId` | Which user triggered it | `'user_abc123'` |
| `sessionId` | Group calls within a session | `'sess_xyz'` |
| `env` | Environment | `'production'` |
| `tags` | Arbitrary key-value pairs | `{ team: 'product', tier: 'pro' }` |

```typescript
await meter(llmCall, {
  feature: 'chat',
  userId: req.user.id,
  sessionId: req.sessionId,
  env: 'production',
  tags: { team: 'product', tier: 'pro' },
});
```

## Webhook Adapter

POST cost events to any URL — Slack, Zapier, custom backends:

```typescript
import { WebhookAdapter, configure } from 'llm-cost-meter';

configure({
  adapters: [
    'console',
    new WebhookAdapter({
      url: 'https://hooks.slack.com/services/...',
      headers: { 'Authorization': 'Bearer ...' },
      batchSize: 10,        // buffer 10 events before sending
      flushIntervalMs: 5000 // or flush every 5 seconds
    })
  ]
});
```

Supports single-event mode (default) or batch mode. Retries once on failure. Uses native `fetch()` — no new dependencies.

## OpenTelemetry Adapter

Export cost metrics to Datadog, New Relic, Honeycomb, Grafana — any OpenTelemetry backend:

```typescript
import { OTelAdapter, configure } from 'llm-cost-meter';

configure({
  adapters: ['local', new OTelAdapter()]
});
```

Records 4 metrics per event:
- `llm.cost.total` (histogram) — USD cost
- `llm.tokens.input` (counter) — input tokens consumed
- `llm.tokens.output` (counter) — output tokens generated
- `llm.request.duration` (histogram) — latency in ms

Each metric is tagged with `feature`, `user.id`, `model`, `provider`, `env`. Requires `@opentelemetry/api` as a peer dependency (`npm install @opentelemetry/api`).

## Budget Alerts

Set daily cost limits per feature. Get notified when thresholds are exceeded:

```typescript
import { configureBudget } from 'llm-cost-meter';

configureBudget({
  rules: [
    {
      feature: 'chat',
      dailyLimitUSD: 50,
      onExceed: (rule, spent) => {
        console.warn(`${rule.feature} exceeded $${rule.dailyLimitUSD}/day! Current: $${spent.toFixed(2)}`);
        // Send Slack alert, page on-call, etc.
      }
    },
    {
      feature: '*',          // global limit across all features
      dailyLimitUSD: 200,
      onExceed: (rule, spent) => sendSlackAlert(`Total LLM spend exceeded $200/day: $${spent.toFixed(2)}`),
    }
  ]
});
```

- Alerts fire **once per day** per rule (not on every subsequent event)
- Counters reset at UTC midnight
- `getBudgetStatus()` returns current spend vs limits
- `resetBudget()` for testing
- Callback errors never crash your app

## Global Configuration

Call `configure()` once at app startup:

```typescript
import { configure } from 'llm-cost-meter';

configure({
  adapters: ['console', 'local'],       // Output destinations
  localPath: './.llm-costs/events.ndjson', // File path for local adapter
  defaultTags: {                         // Applied to every event
    env: process.env.NODE_ENV ?? 'development',
    service: 'my-app',
  },
  verbose: false,                        // true = log adapter errors to console
  warnOnMissingModel: true,              // true = warn when model not in pricing table
  onError: (err, event) => {             // Called when adapter writes fail
    myLogger.warn('Cost tracking error', { err, feature: event?.feature });
  },
});
```

`configure()` merges with the current config. To start fresh, call `resetConfig()` first:

```typescript
import { resetConfig, configure } from 'llm-cost-meter';

resetConfig();  // Back to defaults
configure({ adapters: ['local'] });
```

## Error Handling

By default, adapter errors are silent (your LLM calls are never affected). To catch them:

```typescript
// Option 1: onError callback (recommended for production)
configure({
  onError: (err, event) => {
    console.error('Failed to write cost event:', err.message);
    // Send to your error tracker, Sentry, DataDog, etc.
  },
});

// Option 2: verbose mode (logs to console.error)
configure({ verbose: true });

// Option 3: await writes to guarantee persistence
const response = await meter(llmCall, {
  feature: 'billing-critical',
  awaitWrites: true,  // Will throw if adapter fails
});
```

### Monitoring meter health

```typescript
import { getMeterStats } from 'llm-cost-meter';

const stats = getMeterStats();
console.log(stats);
// {
//   eventsTracked: 1284,
//   eventsDropped: 0,
//   adapterErrors: 0,
//   unknownModels: ['openai/ft:gpt-4o-mini:my-org']
// }
```

## Custom Pricing

Add pricing for fine-tuned models, new models, or entirely new providers:

```typescript
import { configurePricing, setPricingTable } from 'llm-cost-meter';

// Add a single model
configurePricing('openai', 'ft:gpt-4o-mini:my-org', { input: 0.30, output: 1.20 });

// Add a new provider
configurePricing('mistral', 'mistral-large', { input: 2.00, output: 6.00 });

// Override existing pricing
configurePricing('anthropic', 'claude-sonnet-4-20250514', { input: 3.50, output: 16.00 });

// Set an entire provider at once
setPricingTable('deepseek', {
  'deepseek-chat': { input: 0.14, output: 0.28, unit: 'per_million_tokens' },
  'deepseek-coder': { input: 0.14, output: 0.28, unit: 'per_million_tokens' },
});
```

When a model isn't found in the pricing table, cost is reported as $0.00 and a warning is logged (disable with `warnOnMissingModel: false`).

## Guaranteed Write Mode

By default, `meter()` is fire-and-forget — adapter writes happen in the background so your LLM response is returned immediately. For billing-critical paths:

```typescript
// Wait for adapters to finish writing before continuing
const response = await meter(llmCall, {
  feature: 'billing',
  awaitWrites: true,
});

// Flush all pending writes before process exit
import { flush } from 'llm-cost-meter';

process.on('SIGTERM', async () => {
  await flush();
  process.exit(0);
});
```

## Advanced: CostMeter Class

Use `CostMeter` when you need multiple independent meters (e.g., different adapters for different teams, separate configs for billing vs analytics):

```typescript
import { CostMeter } from 'llm-cost-meter';

const billingMeter = new CostMeter({
  provider: 'anthropic',
  adapters: ['local'],
  localPath: './billing/events.ndjson',
  onError: (err) => alertOps('billing tracking failed', err),
});

const analyticsMeter = new CostMeter({
  adapters: [new DataDogAdapter()],
  defaultTags: { team: 'analytics' },
});

// Each meter writes to its own destination
const response = await billingMeter.track(
  () => client.messages.create({ ... }),
  { feature: 'chat', userId: req.user.id }
);

// Manual event recording
billingMeter.record({
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  inputTokens: 450,
  outputTokens: 210,
  feature: 'classifier',
  userId: 'user_123',
});

// Flush before shutdown
await billingMeter.flush();
```

**When to use `meter()` vs `CostMeter`:**
- `meter()` — simple apps, single config, most use cases
- `CostMeter` — multi-team apps, separate billing/analytics pipelines, multiple output destinations

## CLI Reference

```bash
# Default report grouped by feature
npx llm-cost-meter report

# Group by different dimensions
npx llm-cost-meter report --group-by userId
npx llm-cost-meter report --group-by model
npx llm-cost-meter report --group-by env

# Filter by tag
npx llm-cost-meter report --feature article-summarizer
npx llm-cost-meter report --env production
npx llm-cost-meter report --user user_abc123

# Date range
npx llm-cost-meter report --from 2025-04-01 --to 2025-04-05

# Export formats
npx llm-cost-meter report --format csv > costs.csv
npx llm-cost-meter report --format json > costs.json

# Show top N most expensive
npx llm-cost-meter report --top 5

# Custom events file path
npx llm-cost-meter report --file ./path/to/events.ndjson
```

## Adapter Reference

### Console Adapter

Prints cost per call to stdout. Ideal for development.

```typescript
configure({ adapters: ['console'] });
// Output: [llm-cost-meter] article-summarizer — $0.00396 (600 tokens, 1240ms)
```

### Local File Adapter

Appends events as NDJSON (newline-delimited JSON) to a file. Uses an async write queue to prevent file corruption from concurrent calls.

```typescript
configure({
  adapters: ['local'],
  localPath: './.llm-costs/events.ndjson',
});
```

### Bring Your Own Adapter

Implement the `CostAdapter` interface:

```typescript
import { CostAdapter, CostEvent, configure } from 'llm-cost-meter';

class DataDogAdapter implements CostAdapter {
  name = 'datadog';

  async write(event: CostEvent): Promise<void> {
    await fetch('https://api.datadoghq.com/api/v1/series', {
      method: 'POST',
      body: JSON.stringify({
        series: [{
          metric: 'llm.cost',
          points: [[Date.now() / 1000, event.totalCostUSD]],
          tags: [`feature:${event.feature}`, `model:${event.model}`],
        }],
      }),
    });
  }

  // Optional: called by flush() before shutdown
  async flush(): Promise<void> {
    // Drain any internal buffers
  }
}

configure({
  adapters: [new DataDogAdapter(), 'local'],
});
```

## Integration Recipes

### Express.js Middleware

```typescript
import { meter } from 'llm-cost-meter';

function withCostTracking(feature: string) {
  return (req, res, next) => {
    req.llmMeter = (fn) =>
      meter(fn, {
        feature,
        userId: req.user?.id,
        sessionId: req.sessionId,
        env: process.env.NODE_ENV,
      });
    next();
  };
}

router.post('/summarize', withCostTracking('article-summarizer'), async (req, res) => {
  const result = await req.llmMeter(() =>
    client.messages.create({ ... })
  );
  res.json(result);
});
```

### Next.js API Route

```typescript
import { meter, configure } from 'llm-cost-meter';

configure({ adapters: ['local'], defaultTags: { env: 'production' } });

export default async function handler(req, res) {
  const response = await meter(
    () => openai.chat.completions.create({ ... }),
    { feature: 'chat', userId: req.body.userId }
  );
  res.json(response);
}
```

## Pricing Tables

Built-in pricing for current models (USD per million tokens):

### Anthropic

| Model | Input | Output |
|-------|-------|--------|
| claude-opus-4-20250514 | $15.00 | $75.00 |
| claude-sonnet-4-20250514 | $3.00 | $15.00 |
| claude-haiku-4-5-20251001 | $0.80 | $4.00 |
| claude-3-5-sonnet-20241022 | $3.00 | $15.00 |
| claude-3-5-haiku-20241022 | $0.80 | $4.00 |
| claude-3-opus-20240229 | $15.00 | $75.00 |
| claude-3-sonnet-20240229 | $3.00 | $15.00 |
| claude-3-haiku-20240307 | $0.25 | $1.25 |

### OpenAI

| Model | Input | Output |
|-------|-------|--------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4-turbo | $10.00 | $30.00 |
| gpt-4 | $30.00 | $60.00 |
| gpt-3.5-turbo | $0.50 | $1.50 |
| o1 | $15.00 | $60.00 |
| o1-mini | $3.00 | $12.00 |
| o3 | $10.00 | $40.00 |
| o3-mini | $1.10 | $4.40 |

Dated model variants (e.g., `gpt-4o-2024-08-06`) are also included. Use `configurePricing()` to add models not in this table.

## Testing Your Code

Use `resetConfig()` and `resetStats()` in test setup to avoid state leaking between tests:

```typescript
import { configure, resetConfig, resetStats, meter, CostAdapter, CostEvent } from 'llm-cost-meter';

class TestAdapter implements CostAdapter {
  name = 'test';
  events: CostEvent[] = [];
  async write(event: CostEvent) { this.events.push(event); }
}

beforeEach(() => {
  resetConfig();
  resetStats();
  const adapter = new TestAdapter();
  configure({ adapters: [adapter], warnOnMissingModel: false });
});
```

## FAQ

**Does it add latency to my API calls?**
No. By default, adapter writes are fire-and-forget. Your LLM response is returned immediately. Use `awaitWrites: true` only when you need guaranteed persistence.

**Does it send my data anywhere?**
No. All data stays local by default. The `console` adapter prints to stdout and the `local` adapter writes to a file on disk. No network calls are made unless you add a custom adapter.

**What happens if the pricing table doesn't have my model?**
A warning is logged (unless `warnOnMissingModel: false`) and cost is reported as $0.00. Use `configurePricing()` to add the model. Check `getMeterStats().unknownModels` to see which models are missing.

**What if an adapter fails?**
By default, errors are silent — your app is never affected. Use `onError` callback or `verbose: true` to catch errors. Use `getMeterStats().adapterErrors` to monitor.

**Can I use it with streaming responses?**
V1 does not support streaming token counting. Streaming support is planned for V2. For now, check the final response's usage field after streaming completes.

**Does it work with fine-tuned models?**
Yes. Use `configurePricing()` to set pricing for your fine-tuned model IDs.

**Is it safe for high-traffic apps?**
The local file adapter uses an async write queue that serializes writes — no file corruption from concurrent calls. For high-throughput, consider a custom adapter that batches writes.

## License

MIT
