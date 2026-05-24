import { SessionChannelIcon } from '@/components/shell/session-channel-icon';
import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import type { ChannelHubCardVm, ChannelHubPrimaryAction, ChannelHubStatus } from './channel-hub-view-model';

function statusPillClass(status: ChannelHubStatus): string {
  switch (status) {
    case 'running':
      return 'bg-success-soft text-success';
    case 'offline':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200';
    case 'disabled':
      return 'bg-surface-hover text-fg-muted';
    default:
      return 'bg-surface-hover text-fg-muted';
  }
}

function statusLabel(ch: ChannelsSettingsMessages, status: ChannelHubStatus): string {
  switch (status) {
    case 'running':
      return ch.hubStatusRunning;
    case 'offline':
      return ch.hubStatusOffline;
    case 'disabled':
      return ch.hubStatusDisabled;
    default:
      return ch.hubStatusNotConfigured;
  }
}

function primaryActionLabel(ch: ChannelsSettingsMessages, action: ChannelHubPrimaryAction): string {
  switch (action) {
    case 'setup':
      return ch.hubSetupButton;
    case 'fix':
      return ch.hubFixButton;
    case 'pairing':
      return ch.hubPairingButton;
    default:
      return ch.hubManageButton;
  }
}

export type ChannelHubCardProps = {
  channelId: string;
  title: string;
  subtitle: string;
  vm: ChannelHubCardVm;
  toggleDisabled: boolean;
  onOpen: () => void;
  onReviewPairing: () => void;
  onToggle: (next: boolean) => void | Promise<void>;
  ch: ChannelsSettingsMessages;
};

export function ChannelHubCard({
  channelId,
  title,
  subtitle,
  vm,
  toggleDisabled,
  onOpen,
  onReviewPairing,
  onToggle,
  ch,
}: ChannelHubCardProps) {
  const showToggle = vm.configured && vm.manageable;

  return (
    <article
      className={cn(
        'flex h-full min-h-0 flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-panel p-4 shadow-sm transition-colors',
        'hover:border-edge',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-edge-subtle/40',
            vm.status === 'running' ? 'bg-accent-soft' : 'bg-surface-base',
          )}
          aria-hidden
        >
          <SessionChannelIcon sourceChannel={channelId} className="size-5" />
        </div>
        {showToggle ? (
          <button
            type="button"
            role="switch"
            aria-checked={vm.enabled}
            aria-label={`${title} — ${ch.enableChannelAria}`}
            disabled={toggleDisabled}
            className={cn(
              'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
              vm.enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
              toggleDisabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={(e) => {
              e.stopPropagation();
              void onToggle(!vm.enabled);
            }}
          >
            <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
          </button>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              statusPillClass(vm.status),
            )}
          >
            {statusLabel(ch, vm.status)}
          </span>
          {vm.pendingPairing > 0 ? (
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
              onClick={(e) => {
                e.stopPropagation();
                onReviewPairing();
              }}
            >
              {ch.hubPairingPendingBadge.replace('{{count}}', String(vm.pendingPairing))}
            </button>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-fg-muted">{subtitle}</p>
        {vm.summaryLines.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {vm.summaryLines.map((line) => (
              <li key={line} className="text-xs text-fg-muted">
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-auto">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={() => {
            if (vm.manageable && (vm.primaryAction === 'pairing' || vm.pendingPairing > 0)) {
              onReviewPairing();
              return;
            }
            onOpen();
          }}
        >
          {primaryActionLabel(ch, vm.primaryAction)}
        </Button>
      </div>
    </article>
  );
}
