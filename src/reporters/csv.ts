import { SummaryRow, CostEvent } from '../types';

export function summaryToCsv(rows: SummaryRow[], groupBy: string): string {
  const header = `${groupBy},calls,total_tokens,avg_cost_per_call,total_cost`;
  const lines = rows.map(
    (r) =>
      `${r.key},${r.calls},${r.totalTokens},${r.avgCostPerCall.toFixed(6)},${r.totalCost.toFixed(6)}`
  );
  return [header, ...lines].join('\n');
}

export function eventsToCsv(events: CostEvent[]): string {
  const header =
    'id,timestamp,provider,model,inputTokens,outputTokens,totalTokens,inputCostUSD,outputCostUSD,totalCostUSD,latencyMs,feature,userId,sessionId,env';
  const lines = events.map(
    (e) =>
      `${e.id},${e.timestamp},${e.provider},${e.model},${e.inputTokens},${e.outputTokens},${e.totalTokens},${e.inputCostUSD.toFixed(6)},${e.outputCostUSD.toFixed(6)},${e.totalCostUSD.toFixed(6)},${e.latencyMs},${e.feature ?? ''},${e.userId ?? ''},${e.sessionId ?? ''},${e.env ?? ''}`
  );
  return [header, ...lines].join('\n');
}
