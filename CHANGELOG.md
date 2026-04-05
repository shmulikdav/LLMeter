# Changelog

## 0.1.0 (2026-04-05)

Initial release of llm-cost-meter.

### Core Features

- `meter()` wrapper function — wrap any LLM API call to track cost, tokens, and latency
- `CostMeter` class for instance-level configuration (multiple meters, separate pipelines)
- `configure()` / `resetConfig()` for global configuration with merge semantics
- Auto-detection of OpenAI and Anthropic response formats (no explicit provider needed)
- Tagging system: `feature`, `userId`, `sessionId`, `env`, and arbitrary custom `tags`
- `awaitWrites` option for guaranteed event persistence on critical paths
- `flush()` for draining pending writes before process shutdown

### Pricing

- Built-in pricing tables for 22 models:
  - **Anthropic**: Claude Opus 4, Sonnet 4, Haiku 4.5, Claude 3.5 Sonnet/Haiku, Claude 3 Opus/Sonnet/Haiku
  - **OpenAI**: GPT-4o, GPT-4o-mini, GPT-4-turbo, GPT-4, GPT-3.5-turbo, o1, o1-mini, o3, o3-mini (including dated variants)
- `configurePricing()` — add custom or fine-tuned model pricing at runtime
- `removePricing()` — remove a model's pricing entry
- `setPricingTable()` — set an entire provider's pricing at once
- Unknown model warnings with `warnOnMissingModel` flag (default: true)

### Adapters

- Console adapter — prints cost per call to stdout (ideal for development)
- Local file adapter — appends events as NDJSON with async write queue
  - Sequential write queue prevents file corruption from concurrent calls
  - Automatic retry (1 retry after 100ms) on write failure
  - Queue recovers from errors instead of stalling
- Bring-your-own adapter via `CostAdapter` interface (with optional `flush()`)

### Error Handling & Observability

- `onError` callback — notified when adapter writes fail (replaces silent swallowing)
- Failed LLM calls tracked as `status: 'error'` events with `errorMessage`
- `getMeterStats()` — monitor eventsTracked, eventsDropped, adapterErrors, unknownModels
- `resetStats()` — reset counters for test isolation
- Memory-safe: unknownModels and warnedModels Sets capped at 1000 entries
- `getAllPricing()` returns a deep copy (mutations don't affect internal state)

### CLI

- `llm-cost-meter report` command with:
  - `--group-by` (feature, userId, model, env, provider, sessionId)
  - `--feature`, `--env`, `--user` filters
  - `--from`, `--to` date range filtering
  - `--format` (table, csv, json)
  - `--top N` to limit results
  - `--file` for custom events file path
- Streaming file reader (handles large NDJSON files without loading into memory)
- Malformed line warnings logged to stderr
- Auto-generated insights (e.g., "chat drives 53% of cost but only 24% of calls")

### Dashboard

- Web dashboard at `http://localhost:3000` (no external services needed)
- Date range picker with from/to date inputs
- Feature, User, Model, Environment dropdown filters
- Active filter pills with one-click removal
- Click-to-drill-down on chart segments and table rows
- Export CSV / Export JSON buttons on every table
- 5 KPI cards: Total Spend, Avg Cost/Call, Total Tokens, Most Expensive Feature, Costliest User
- Charts: Daily Cost Trend, Cost by Feature (doughnut), Calls by Model (bar), Cost by User (bar), Cost vs Calls (bubble)
- Scrollable event log with full model names
- Runs on plain Node.js — no ts-node required

### Package Quality

- TypeScript-first with full type declarations
- 110 tests (unit, integration, CLI subprocess, error handling)
- Real API smoke test (`npm run test:smoke`) for Anthropic and OpenAI
- 24 KB published tarball (no source maps, no tests, no dev files)
- `"type": "commonjs"` + `"exports"` field for modern bundler support
- MIT license
