import type { UsageEvent, UsageTotals } from '@xopcai/gateway-contract';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type UsageSummary = {
  totals: UsageTotals;
  byCategory: Array<{ key: string; totals: UsageTotals }>;
  byModel: Array<{ key: string; provider: string; model: string; totals: UsageTotals }>;
};

export function usageQuery(days: number): string {
  const to = Date.now() + 1;
  const from = to - days * 24 * 60 * 60 * 1_000;
  return new URLSearchParams({ from: String(from), to: String(to) }).toString();
}

export function getUsageSummary(query: string): Promise<UsageSummary> {
  return fetchJson<UsageSummary>(apiUrl(`/api/usage/summary?${query}`));
}

export function getUsageEvents(query: string): Promise<{ items: UsageEvent[]; nextCursor?: string }> {
  return fetchJson<{ items: UsageEvent[]; nextCursor?: string }>(apiUrl(`/api/usage/events?${query}&limit=50`));
}
