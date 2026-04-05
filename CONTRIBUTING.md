# Contributing to llm-cost-meter

Thanks for your interest in contributing! This guide will help you get set up.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/shmulikdav/LLMeter.git
cd LLMeter

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run demo (no API keys needed)
npm run demo

# Start dashboard
npm run dashboard
```

## Development Workflow

1. **Fork** the repo and create a branch from `main`
2. **Make your changes** in `src/`
3. **Add tests** in `tests/` for any new functionality
4. **Run `npm test`** — all 110+ tests must pass
5. **Run `npm run build`** — must compile cleanly
6. **Submit a PR** against `main`

## Project Structure

```
src/
├── index.ts          # Core API: meter(), CostMeter, configure()
├── cli.ts            # CLI entry point (llm-cost-meter report)
├── types.ts          # Shared TypeScript interfaces
├── pricing/
│   ├── index.ts      # Cost calculation + configurePricing()
│   ├── openai.json   # OpenAI model pricing
│   └── anthropic.json # Anthropic model pricing
├── adapters/
│   ├── index.ts      # Adapter factory + resolveAdapters()
│   ├── console.ts    # Console output adapter
│   └── local.ts      # NDJSON file adapter (with write queue)
└── reporters/
    ├── summary.ts    # Aggregation + filtering logic
    ├── csv.ts        # CSV export
    └── json.ts       # JSON export

tests/               # Jest tests (mirrors src/ structure)
dashboard/           # Web dashboard (HTML + server)
examples/            # Integration examples
```

## What We're Looking For

### High Priority
- **Streaming support** — track costs from streaming LLM responses
- **New adapters** — DataDog, PostHog, OpenTelemetry, S3, SQLite
- **Framework middleware** — Express, Fastify, Next.js, tRPC plug-and-play
- **New model pricing** — keep pricing tables up to date

### Always Welcome
- Bug fixes with test coverage
- Performance improvements
- Documentation improvements
- New CLI features

## Adding a New Adapter

1. Create `src/adapters/myAdapter.ts` implementing `CostAdapter`:
   ```typescript
   import { CostAdapter, CostEvent } from '../types';

   export class MyAdapter implements CostAdapter {
     name = 'my-adapter';
     async write(event: CostEvent): Promise<void> { ... }
     async flush?(): Promise<void> { ... }  // optional
   }
   ```
2. Register it in `src/adapters/index.ts`
3. Add tests in `tests/adapters.test.ts`

## Adding Model Pricing

Edit `src/pricing/openai.json` or `src/pricing/anthropic.json`:

```json
{
  "model-name": {
    "input": 2.50,
    "output": 10.00,
    "unit": "per_million_tokens"
  }
}
```

Prices are in USD per million tokens. Verify with the provider's pricing page.

## Code Style

- TypeScript strict mode
- No unnecessary abstractions — simple > clever
- Test every public function
- Don't add dependencies unless absolutely necessary

## Running Tests

```bash
npm test                    # All tests (110+)
npm run test:smoke          # Real API smoke test (needs API keys)
npx jest tests/pricing      # Single test file
npx jest --watch            # Watch mode
```

## Questions?

Open an issue or start a discussion. We're happy to help!
