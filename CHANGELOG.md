# Changelog

## 0.1.0 (2026-04-05)

### Features

- `meter()` wrapper function for tracking LLM API call costs
- `CostMeter` class for advanced instance-level configuration
- `configure()` for global configuration
- Built-in pricing tables for OpenAI (gpt-4o, gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo) and Anthropic (claude-opus-4, claude-sonnet-4, claude-haiku-4.5)
- Tagging system: feature, userId, sessionId, env, and arbitrary custom tags
- Console adapter for development logging
- Local file adapter for NDJSON event storage
- CLI `report` command with grouping, filtering, date ranges, and export formats (table, CSV, JSON)
- Auto-detection of OpenAI and Anthropic response formats
- Cost calculation from token usage and model pricing
