import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type CronGlobalsState = {
  enabled: boolean;
  maxConcurrentJobs: number;
  defaultTimezone: string;
  historyRetentionDays: number;
  enableMetrics: boolean;
};

const DEFAULT_CRON_GLOBALS: CronGlobalsState = {
  enabled: true,
  maxConcurrentJobs: 5,
  defaultTimezone: 'UTC',
  historyRetentionDays: 7,
  enableMetrics: true,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeCronGlobalsFromConfig(config: unknown): CronGlobalsState {
  const c = isRecord(config) ? config : {};
  const cron = isRecord(c.cron) ? c.cron : {};
  return {
    enabled: cron.enabled !== false,
    maxConcurrentJobs:
      typeof cron.maxConcurrentJobs === 'number' && Number.isFinite(cron.maxConcurrentJobs)
        ? Math.max(1, Math.min(100, Math.floor(cron.maxConcurrentJobs)))
        : DEFAULT_CRON_GLOBALS.maxConcurrentJobs,
    defaultTimezone:
      typeof cron.defaultTimezone === 'string' && cron.defaultTimezone.trim()
        ? cron.defaultTimezone.trim()
        : DEFAULT_CRON_GLOBALS.defaultTimezone,
    historyRetentionDays:
      typeof cron.historyRetentionDays === 'number' && Number.isFinite(cron.historyRetentionDays)
        ? Math.max(1, Math.min(365, Math.floor(cron.historyRetentionDays)))
        : DEFAULT_CRON_GLOBALS.historyRetentionDays,
    enableMetrics: cron.enableMetrics !== false,
  };
}

export async function patchCronGlobals(state: CronGlobalsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ cron: state }),
  });
  void revalidateGatewayConfig();
}
