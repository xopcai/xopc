import type { GatewayConfigBinding } from '@/features/settings/agents-admin-api';
import type { CronJob } from '@/features/cron/cron-api';
import { cn } from '@/lib/cn';
import { settingsInputFocusClass } from '@/lib/form-field-width';

export type AgentPanel = 'overview' | 'files' | 'tools' | 'skills' | 'channels' | 'cron';

export function agentsSettingsInputClass(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function jobMatchesAgent(job: CronJob, agentId: string, defaultId: string): boolean {
  const raw = job.agentId?.trim().toLowerCase();
  if (raw) {
    return raw === agentId.toLowerCase();
  }
  return agentId.toLowerCase() === defaultId.toLowerCase();
}

export function matchSummary(m: GatewayConfigBinding['match']): string {
  const parts = [m.channel, m.accountId, m.peerKind, m.peerId].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
  return parts.join(' · ') || m.channel;
}
