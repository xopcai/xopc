import { RefreshCw } from 'lucide-react';

import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { ChannelsHubSummaryVm } from './channel-hub-view-model';

export function ChannelsSummaryStrip(props: {
  summary: ChannelsHubSummaryVm;
  ch: ChannelsSettingsMessages;
  saveOk: boolean;
  refreshing?: boolean;
  resolveChannelTitle: (id: string) => string;
  onRefresh: () => void;
}) {
  const { summary, ch, saveOk, refreshing, resolveChannelTitle, onRefresh } = props;

  const segments: string[] = [];

  if (summary.pendingPairingTotal > 0) {
    segments.push(
      ch.hubSummaryPending.replace('{{count}}', String(summary.pendingPairingTotal)),
    );
  }

  if (summary.offlineChannelIds.length > 0) {
    const names = summary.offlineChannelIds.map((id) => resolveChannelTitle(id)).join(', ');
    segments.push(ch.hubSummaryOffline.replace('{{names}}', names));
  }

  const hasLeftContent =
    segments.length > 0 ||
    saveOk ||
    summary.stalePairingTotal > 0 ||
    summary.atCapacity;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge-subtle bg-surface-base px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      {hasLeftContent ? (
        <div className="min-w-0 flex-1 space-y-1">
          {segments.length > 0 ? <p className="text-sm text-fg">{segments.join(' · ')}</p> : null}
          {saveOk ? <p className="text-xs text-success">{ch.saved}</p> : null}
          {summary.stalePairingTotal > 0 ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              {ch.pairingStaleBanner.replace('{{count}}', String(summary.stalePairingTotal))}
            </p>
          ) : null}
          {summary.atCapacity ? (
            <p className="text-xs text-amber-800 dark:text-amber-200">{ch.pairingAtCapacityBanner}</p>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        className={cn(
          'inline-flex shrink-0 items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
          !hasLeftContent && 'sm:ml-auto',
        )}
        onClick={onRefresh}
        aria-busy={refreshing}
      >
        <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
        {ch.refresh}
      </button>
    </div>
  );
}
