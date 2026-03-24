import type { CronJob, CronJobExecution, SessionChatId } from '@/features/cron/cron-api';

export function truncate(text: string | undefined, max: number): string {
  const s = text?.trim() || '';
  if (!s) return '—';
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function formatDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function formatTime(date: string): string {
  return new Date(date).toLocaleString();
}

type TimeLabels = {
  overdue: string;
  lessThanMinute: string;
  minutes: string;
  hours: string;
};

export function formatNextRun(date: Date | string, labels: TimeLabels): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  if (diff < 0) return labels.overdue;
  if (diff < 60000) return labels.lessThanMinute;
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return labels.minutes.replace('{{count}}', String(mins));
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return labels.hours.replace('{{count}}', String(hours));
  }
  return d.toLocaleString();
}

type LastActiveLabels = {
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
};

export function formatLastActive(date: string, labels: LastActiveLabels): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 0) return labels.justNow;
  if (diff < 60000) return labels.justNow;
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return labels.minutesAgo.replace('{{count}}', String(mins));
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return labels.hoursAgo.replace('{{count}}', String(hours));
  }
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return labels.daysAgo.replace('{{count}}', String(days));
  }
  return d.toLocaleDateString();
}

export function formatRecipientOptionLabel(item: SessionChatId, labels: LastActiveLabels): string {
  const when = formatLastActive(item.lastActive, labels);
  if (item.channel === 'telegram' && item.peerId) {
    const acc = item.accountId ?? 'default';
    const kind = item.peerKind ?? '';
    return `${acc} · ${kind} · ${item.peerId} · ${when}`;
  }
  return `${item.channel}: ${item.chatId} · ${when}`;
}

export function formatDeliveryToSummary(
  job: CronJob,
  channelLocalLabel: string,
): string {
  if (job.delivery?.channel === 'local') {
    return channelLocalLabel;
  }
  const to = job.delivery?.to ?? '';
  const parts = to.split(':');
  if (parts.length === 3 && (parts[1] === 'dm' || parts[1] === 'group')) {
    return `${parts[0]} · ${parts[1]} · ${parts[2]}`;
  }
  return to;
}

export function execStatusLabel(
  status: CronJobExecution['status'],
  labels: {
    running: string;
    success: string;
    failed: string;
    cancelled: string;
  },
): string {
  switch (status) {
    case 'running':
      return labels.running;
    case 'success':
      return labels.success;
    case 'failed':
      return labels.failed;
    case 'cancelled':
      return labels.cancelled;
    default:
      return status;
  }
}
