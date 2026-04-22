import type { GatewayConfigBinding } from '@/features/settings/agents-admin-api';
import type { CronJob, SessionChatId } from '@/features/cron/cron-api';
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

/** Build a `bindings[].match` for the add-binding form. Custom glob wins over session pick. */
export function buildNewBindingMatch(
  channel: string,
  customPeer: string,
  sessionIdx: number | null,
  sessions: SessionChatId[],
): GatewayConfigBinding['match'] {
  const ch = channel.trim();
  const custom = customPeer.trim();
  if (custom) {
    return { channel: ch, peerId: custom };
  }
  if (sessionIdx != null) {
    const s = sessions[sessionIdx];
    if (!s) {
      return { channel: ch };
    }
    const m: GatewayConfigBinding['match'] = { channel: ch };
    if (s.accountId?.trim()) {
      m.accountId = s.accountId.trim();
    }
    if (s.peerKind?.trim()) {
      m.peerKind = s.peerKind.trim();
    }
    const peer = s.peerId?.trim() || s.chatId?.trim();
    if (peer) {
      m.peerId = peer;
    }
    return m;
  }
  return { channel: ch };
}
