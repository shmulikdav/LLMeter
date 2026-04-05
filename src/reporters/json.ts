import { SummaryRow, CostEvent } from '../types';

export function summaryToJson(rows: SummaryRow[], groupBy: string): string {
  const output = {
    groupBy,
    summary: rows.map((r) => ({
      [groupBy]: r.key,
      calls: r.calls,
      totalTokens: r.totalTokens,
      avgCostPerCall: Number(r.avgCostPerCall.toFixed(6)),
      totalCost: Number(r.totalCost.toFixed(6)),
    })),
    totals: {
      calls: rows.reduce((sum, r) => sum + r.calls, 0),
      totalTokens: rows.reduce((sum, r) => sum + r.totalTokens, 0),
      totalCost: Number(
        rows.reduce((sum, r) => sum + r.totalCost, 0).toFixed(6)
      ),
    },
  };
  return JSON.stringify(output, null, 2);
}

export function eventsToJson(events: CostEvent[]): string {
  return JSON.stringify(events, null, 2);
}
