import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { BookOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

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
  icon: LucideIcon;
  title: string;
  subtitle: string;
  vm: ChannelHubCardVm;
  toggleDisabled: boolean;
  onOpen: () => void;
  onReviewPairing: () => void;
  onToggle: (next: boolean) => void | Promise<void>;
  onRemove: () => void;
  onViewDocs: () => void;
  ch: ChannelsSettingsMessages;
};

export function ChannelHubCard({
  icon: Icon,
  title,
  subtitle,
  vm,
  toggleDisabled,
  onOpen,
  onReviewPairing,
  onToggle,
  onRemove,
  onViewDocs,
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
          <Icon className="size-5 text-accent" strokeWidth={1.75} />
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

      <div className="mt-auto flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          className="min-w-0 flex-1"
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="size-9 shrink-0 p-0"
              aria-label={ch.menuMoreAria}
            >
              <MoreHorizontal className="size-5 text-fg-muted" strokeWidth={1.75} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={cn(
                'min-w-[11rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge',
                SETTINGS_SHELL_POPOVER_Z,
              )}
              sideOffset={6}
              align="end"
            >
              {vm.configured ? (
                <DropdownMenu.Item
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                  onSelect={() => onOpen()}
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} />
                    {ch.menuEditConfig}
                  </span>
                </DropdownMenu.Item>
              ) : null}
              <DropdownMenu.Item
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                onSelect={() => onViewDocs()}
              >
                <span className="flex items-center gap-2">
                  <BookOpen className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} />
                  {ch.hubViewDocs}
                </span>
              </DropdownMenu.Item>
              {vm.configured && vm.manageable ? (
                <DropdownMenu.Item
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                  onSelect={() => onRemove()}
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="size-4 shrink-0" strokeWidth={1.75} />
                    {ch.menuRemoveConfig}
                  </span>
                </DropdownMenu.Item>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </article>
  );
}
