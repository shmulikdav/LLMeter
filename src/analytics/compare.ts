import { CostEvent } from '../types';

export interface VersionComparison {
  promptName: string;
  version: string;
  calls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCostPerCall: number;
  totalCost: number;
  changeFromBaseline?: number;
}

/**
 * Compare cost across prompt versions for a given prompt name.
 * The first version (alphabetically or by earliest event) is used as the baseline.
 */
export function comparePromptVersions(
  events: CostEvent[],
  promptName?: string
): VersionComparison[] {
  // Filter to events with prompt metadata
  let filtered = events.filter((e) => e.promptName && e.promptVersion);
  if (promptName) {
    filtered = filtered.filter((e) => e.promptName === promptName);
  }

  if (filtered.length === 0) return [];

  // Group by promptName + promptVersion
  const groups = new Map<string, CostEvent[]>();
  for (const event of filtered) {
    const key = `${event.promptName}::${event.promptVersion}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }

  const results: VersionComparison[] = [];
  for (const [key, groupEvents] of groups) {
    const [name, version] = key.split('::');
    const calls = groupEvents.length;
    const avgInputTokens = Math.round(
      groupEvents.reduce((s, e) => s + e.inputTokens, 0) / calls
    );
    const avgOutputTokens = Math.round(
      groupEvents.reduce((s, e) => s + e.outputTokens, 0) / calls
    );
    const totalCost = groupEvents.reduce((s, e) => s + e.totalCostUSD, 0);
    const avgCostPerCall = totalCost / calls;

    results.push({
      promptName: name,
      version,
      calls,
      avgInputTokens,
      avgOutputTokens,
      avgCostPerCall,
      totalCost,
    });
  }

  // Sort by promptName, then version
  results.sort((a, b) => {
    const nameCompare = a.promptName.localeCompare(b.promptName);
    if (nameCompare !== 0) return nameCompare;
    return a.version.localeCompare(b.version);
  });

  // Calculate change from baseline (first version per prompt)
  const baselines = new Map<string, number>();
  for (const r of results) {
    if (!baselines.has(r.promptName)) {
      baselines.set(r.promptName, r.avgCostPerCall);
    }
    const baseline = baselines.get(r.promptName)!;
    if (baseline > 0) {
      r.changeFromBaseline = Math.round(
        ((r.avgCostPerCall - baseline) / baseline) * 100
      );
    }
  }

  return results;
}
