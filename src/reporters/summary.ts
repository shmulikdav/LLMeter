import { CostEvent, SummaryRow, ReportOptions } from '../types';

export function filterEvents(events: CostEvent[], options: ReportOptions): CostEvent[] {
  let filtered = events;

  if (options.feature) {
    filtered = filtered.filter((e) => e.feature === options.feature);
  }
  if (options.env) {
    filtered = filtered.filter((e) => e.env === options.env);
  }
  if (options.userId) {
    filtered = filtered.filter((e) => e.userId === options.userId);
  }
  if (options.from) {
    const fromDate = new Date(options.from);
    filtered = filtered.filter((e) => new Date(e.timestamp) >= fromDate);
  }
  if (options.to) {
    const toDate = new Date(options.to);
    toDate.setHours(23, 59, 59, 999);
    filtered = filtered.filter((e) => new Date(e.timestamp) <= toDate);
  }

  return filtered;
}

export function summarize(
  events: CostEvent[],
  groupBy: string = 'feature'
): SummaryRow[] {
  const groups = new Map<string, CostEvent[]>();

  for (const event of events) {
    let key: string;
    if (groupBy === 'feature') {
      key = event.feature ?? 'untagged';
    } else if (groupBy === 'userId') {
      key = event.userId ?? 'unknown';
    } else if (groupBy === 'model') {
      key = event.model;
    } else if (groupBy === 'env') {
      key = event.env ?? 'unknown';
    } else if (groupBy === 'provider') {
      key = event.provider;
    } else if (groupBy === 'sessionId') {
      key = event.sessionId ?? 'unknown';
    } else {
      // Try tags
      key = event.tags?.[groupBy] ?? 'unknown';
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(event);
  }

  const rows: SummaryRow[] = [];
  for (const [key, groupEvents] of groups) {
    const calls = groupEvents.length;
    const totalTokens = groupEvents.reduce((sum, e) => sum + e.totalTokens, 0);
    const totalCost = groupEvents.reduce((sum, e) => sum + e.totalCostUSD, 0);
    const avgCostPerCall = calls > 0 ? totalCost / calls : 0;

    rows.push({ key, calls, totalTokens, avgCostPerCall, totalCost });
  }

  // Sort by total cost descending
  rows.sort((a, b) => b.totalCost - a.totalCost);

  return rows;
}

export function generateInsight(rows: SummaryRow[]): string | null {
  if (rows.length < 2) return null;

  const total = rows.reduce((sum, r) => sum + r.totalCost, 0);
  if (total === 0) return null;

  const totalCalls = rows.reduce((sum, r) => sum + r.calls, 0);
  const top = rows[0];
  const costPct = ((top.totalCost / total) * 100).toFixed(0);
  const callsPct = ((top.calls / totalCalls) * 100).toFixed(0);

  if (Number(costPct) > Number(callsPct) + 10) {
    return `'${top.key}' drives ${costPct}% of cost but only ${callsPct}% of calls. Average call cost is ${(top.avgCostPerCall / (rows[1]?.avgCostPerCall || 1)).toFixed(0)}x higher than '${rows[1].key}'.`;
  }

  return `'${top.key}' is the top cost driver at ${costPct}% of total spend.`;
}
