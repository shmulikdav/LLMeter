# llm-cost-meter

**Per-feature, per-user LLM cost attribution for production AI apps.**

Every team running AI in production knows their monthly bill. No team knows which feature is responsible for which cost. `llm-cost-meter` wraps your LLM API calls, calculates actual cost from token usage, and tags every call by feature, user, and environment — so you can finally see where the money goes.

## Installation

```bash
npm install llm-cost-meter
```

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
  verbose: false,                        // true = log errors to console
});
```

## Advanced: CostMeter Class

For apps that need instance-level configuration:

```typescript
import { CostMeter } from 'llm-cost-meter';

const meter = new CostMeter({
  provider: 'anthropic',
  adapters: ['console', 'local'],
  localPath: './.llm-costs/events.ndjson',
  defaultTags: { env: 'production' },
});

// Wrap a call
const response = await meter.track(
  () => client.messages.create({ ... }),
  { feature: 'chat', userId: req.user.id }
);

// Or record a manual event
meter.record({
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  inputTokens: 450,
  outputTokens: 210,
  feature: 'classifier',
  userId: 'user_123',
});
```

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

Appends events as NDJSON (newline-delimited JSON) to a file. Ideal for production.

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
    // Send to DataDog, PostHog, Segment, etc.
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

### OpenAI

| Model | Input | Output |
|-------|-------|--------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gpt-4-turbo | $10.00 | $30.00 |
| gpt-3.5-turbo | $0.50 | $1.50 |

Pricing tables are stored as JSON files in the package at `src/pricing/`. To update pricing, modify the JSON files and rebuild.

## FAQ

**Does it add latency to my API calls?**
No. The `meter()` wrapper records timing but does not add any delay. Cost events are emitted asynchronously after the response is returned.

**Does it send my data anywhere?**
No. All data stays local by default. The `console` adapter prints to stdout and the `local` adapter writes to a file on disk. No network calls are made unless you add a custom adapter.

**What happens if the pricing table doesn't have my model?**
Cost will be reported as $0.00. The response is still passed through unchanged.

**Can I use it with streaming responses?**
V1 does not support streaming token counting. Streaming support is planned for V2.

**Does it work with fine-tuned models?**
V1 uses the base model pricing table. Custom model pricing is planned for a future release.

## License

MIT
