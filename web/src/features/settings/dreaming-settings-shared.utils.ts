import type { DreamingGatewayStatus } from '@/features/settings/dreaming-api';
import type { MessageBundle } from '@/i18n/messages';

type DreamingSettingsI18n = MessageBundle['dreamingSettings'];

export function isoShort(v: string | null | undefined): string {
  if (!v) return '—';
  return v.replace('T', ' ').replace('Z', '');
}

export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function lockStatusLabel(
  s: DreamingGatewayStatus['lock'],
  labels: Pick<DreamingSettingsI18n, 'lockValueLocked' | 'lockValueUnlocked'>,
): { text: string; className: string } {
  if (s.locked) {
    return { text: labels.lockValueLocked, className: 'text-amber-600 dark:text-amber-400' };
  }
  return { text: labels.lockValueUnlocked, className: 'text-emerald-600 dark:text-emerald-400' };
}
