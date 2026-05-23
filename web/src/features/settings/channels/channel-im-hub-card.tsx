import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { ChannelsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { SETTINGS_SHELL_POPOVER_Z } from '@/lib/settings-shell-dialog-layer';

export type ChannelImHubCardProps = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  configured: boolean;
  enabled: boolean;
  pendingPairingCount?: number;
  onToggle: (next: boolean) => void | Promise<void>;
  toggleDisabled: boolean;
  onConfigure: () => void;
  onEdit: () => void;
  onRemove: () => void;
  ch: ChannelsSettingsMessages;
};

export function ChannelImHubCard({
  icon,
  title,
  subtitle,
  configured,
  enabled,
  pendingPairingCount = 0,
  onToggle,
  toggleDisabled,
  onConfigure,
  onEdit,
  onRemove,
  ch,
}: ChannelImHubCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface-base p-4 dark:border-edge sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-surface-hover" aria-hidden>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{title}</h2>
            {configured ? (
              <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                {ch.hubConnectedBadge}
              </span>
            ) : null}
            {pendingPairingCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                {ch.hubPairingPendingBadge.replace('{{count}}', String(pendingPairingCount))}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{subtitle}</p>
        </div>
      </div>

      {!configured ? (
        <div className="flex shrink-0 justify-end sm:justify-end">
          <Button type="button" variant="primary" className="shrink-0" onClick={onConfigure}>
            {ch.hubConfigureButton}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="ghost" className="size-9 shrink-0 p-0" aria-label={ch.menuMoreAria}>
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
                <DropdownMenu.Item
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                  onSelect={() => onEdit()}
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="size-4 shrink-0 text-fg-muted" strokeWidth={1.75} />
                    {ch.menuEditConfig}
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover data-[highlighted]:bg-surface-hover"
                  onSelect={() => onRemove()}
                >
                  <span className="flex items-center gap-2">
                    <Trash2 className="size-4 shrink-0" strokeWidth={1.75} />
                    {ch.menuRemoveConfig}
                  </span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${title} — ${ch.enableChannelAria}`}
            disabled={toggleDisabled}
            className={cn(
              'inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-edge p-0.5 transition-colors',
              enabled ? 'justify-end bg-accent' : 'justify-start bg-surface-hover',
              toggleDisabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => void onToggle(!enabled)}
          >
            <span className="size-4 rounded-full bg-surface-panel shadow-surface ring-1 ring-edge/40 dark:ring-edge/55" />
          </button>
        </div>
      )}
    </div>
  );
}
