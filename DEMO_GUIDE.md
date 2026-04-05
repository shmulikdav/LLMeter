# llm-cost-meter — Demo Guide

A step-by-step guide for presenting the llm-cost-meter demo.

---

## Prerequisites

Make sure you have **Node.js 18+** installed.

```bash
node --version   # should be v18 or higher
```

---

## Step 1: Install Dependencies

```bash
cd llmeter
npm install
```

This installs TypeScript, Commander, Chalk, cli-table3, and uuid. No API keys needed.

---

## Step 2: Build the Project

```bash
npm run build
```

Compiles TypeScript from `src/` into `dist/`. You should see no errors.

---

## Step 3: Run the Demo

```bash
npm run demo
```

**What to show the audience:**

1. **Configuration** — the demo prints the `configure()` call that sets up adapters and default tags
2. **Live cost tracking** — 16 LLM calls fire in real-time, each printing a line like:
   ```
   [llm-cost-meter] chat — $0.13413 (5278 tokens, 135ms)
   ```
   Point out how different features have wildly different costs (chat vs tag-classifier)
3. **Manual recording** — the `CostMeter.record()` call shows you can log events without wrapping a live API call
4. **CLI reports** — five reports run automatically:
   - **By feature** — shows which feature is most expensive
   - **By user** — shows per-user cost breakdown
   - **By model** — shows cost across Claude Opus, Sonnet, GPT-4o-mini
   - **JSON export** — structured data for programmatic use
   - **CSV export** — ready to pipe into a spreadsheet

**Key talking point:** Chat uses only 25% of calls but drives ~89% of cost — the "Insight" line at the bottom highlights this automatically.

---

## Step 4: Open the Dashboard

```bash
npm run dashboard
```

Then open **http://localhost:3000** in your browser.

**What to show the audience:**

### Top Row — KPI Cards
- **Total Spend** — total dollar amount across all tracked calls
- **Avg Cost / Call** — helps set expectations for per-request cost
- **Total Tokens** — combined input + output token volume
- **Most Expensive Feature** — instantly shows where money goes

### Charts (middle section)
- **Cost by Feature** (doughnut) — visual breakdown; chat dominates
- **Calls by Model** (horizontal bar) — shows call volume per model
- **Cost by User** (bar) — per-user attribution for chargebacks
- **Cost vs Calls** (bubble) — reveals which features are expensive per call vs high volume; bubble size = token count

### Tables (bottom section)
- **Feature breakdown** — calls, tokens, avg cost, total cost, and % share bar
- **User breakdown** — per-user totals
- **Recent events** — scrollable log of every tracked call with timestamps

**Key talking points:**
- Everything runs locally, no data leaves your machine
- Zero configuration needed — just wrap your calls with `meter()`
- Works with both OpenAI and Anthropic out of the box

---

## Step 5: Show the Code (Optional)

If presenting to developers, show how simple the integration is:

### Minimal example (3 lines of new code)

```typescript
import { meter, configure } from 'llm-cost-meter';

// 1. Configure once at startup
configure({ adapters: ['console', 'local'] });

// 2. Wrap your existing LLM call
const response = await meter(
  () => client.messages.create({           // your existing code
    model: 'claude-sonnet-4-20250514',     // unchanged
    max_tokens: 1024,                      // unchanged
    messages: [{ role: 'user', content: 'Hello' }]
  }),
  { feature: 'chat', userId: 'user_123' } // add tags
);

// 3. Response is unchanged — use it normally
console.log(response.content);
```

### Show the CLI

```bash
# Default report by feature
npx llm-cost-meter report

# Group by user
npx llm-cost-meter report --group-by userId

# Export to CSV for spreadsheets
npx llm-cost-meter report --format csv > costs.csv

# Filter by feature
npx llm-cost-meter report --feature chat

# Top 3 most expensive
npx llm-cost-meter report --top 3
```

---

## Step 6: Cleanup

The demo data is stored at `.llm-costs/demo-events.ndjson`. To reset:

```bash
rm -rf .llm-costs
```

To stop the dashboard server, press `Ctrl+C`.

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run demo` | Generate sample data + show CLI reports |
| `npm run dashboard` | Start web dashboard on http://localhost:3000 |
| `npx llm-cost-meter report` | Run a CLI cost report |
| `npx llm-cost-meter report --format csv` | Export as CSV |
| `npx llm-cost-meter report --format json` | Export as JSON |
| `npx llm-cost-meter report --group-by userId` | Group by user |
| `npx llm-cost-meter report --group-by model` | Group by model |

---

## Presenter Script (2 minute version)

> "Every team running AI in production knows their monthly bill. Nobody knows which feature is responsible."
>
> *Run `npm run demo`*
>
> "With one function — `meter()` — we wrap our existing LLM calls and immediately see cost per feature, per user, per model. No API changes. No servers. No accounts."
>
> *Point to the insight line*
>
> "Chat drives 89% of our cost but only 25% of calls. That's the kind of visibility you need."
>
> *Run `npm run dashboard`, open browser*
>
> "And here's the dashboard. Cost by feature, cost by user, cost by model — all from data that never leaves your machine."
>
> *Click through charts and tables*
>
> "Three lines of code. Zero configuration. That's llm-cost-meter."
