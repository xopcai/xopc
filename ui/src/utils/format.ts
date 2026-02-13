export interface FormatUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export function formatUsage(usage: Partial<FormatUsage>): string {
  const parts: string[] = [];
  
  if (usage.input) parts.push(`In: ${formatTokenCount(usage.input)}`);
  if (usage.output) parts.push(`Out: ${formatTokenCount(usage.output)}`);
  if (usage.cacheRead) parts.push(`Cache: ${formatTokenCount(usage.cacheRead)}`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  
  return parts.join(' · ');
}

export function formatTokenCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
