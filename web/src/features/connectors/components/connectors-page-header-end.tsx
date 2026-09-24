import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Loader2, MoreHorizontal, Plus, RefreshCw, Settings, Store, Wrench } from 'lucide-react';
import { memo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConnectorServiceDialog } from '../connector-service-page';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export const ConnectorsPageHeaderEnd = memo(function ConnectorsPageHeaderEnd({
  onRefresh,
  refreshing,
  refreshLabel,
  onBrowseCatalog,
  onAddCustomServer,
  addLabel,
  browseLabel,
  customLabel,
  serviceLabel,
  moreActionsLabel,
}: {
  onRefresh?: () => void;
  refreshing: boolean;
  refreshLabel: string;
  onBrowseCatalog: () => void;
  onAddCustomServer: () => void;
  addLabel: string;
  browseLabel: string;
  customLabel: string;
  serviceLabel: string;
  moreActionsLabel: string;
}) {
  const [serviceOpen, setServiceOpen] = useState(false);
  const menuItemClassName = cn(
    'touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover',
    interaction.transition,
  );
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="primary" className="shrink-0 gap-2" aria-label={addLabel}>
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{addLabel}</span>
            <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="z-50 min-w-[14rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge" sideOffset={6} align="end">
            <DropdownMenu.Item className={menuItemClassName} onSelect={onBrowseCatalog}>
              <Store className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              {browseLabel}
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClassName} onSelect={onAddCustomServer}>
              <Wrench className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              {customLabel}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ConnectorServiceDialog open={serviceOpen} onOpenChange={setServiceOpen} hideTrigger />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="secondary" className="size-9 shrink-0 p-0" aria-label={moreActionsLabel} title={moreActionsLabel}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-50 min-w-[14rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
            sideOffset={6}
            align="end"
          >
            {onRefresh ? (
              <DropdownMenu.Item className={menuItemClassName} disabled={refreshing} onSelect={onRefresh}>
                {refreshing ? <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden /> : <RefreshCw className="size-4 text-fg-muted" aria-hidden />}
                {refreshLabel}
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item className={menuItemClassName} onSelect={() => setServiceOpen(true)}>
              <Settings className="size-4 text-fg-muted" aria-hidden />
              {serviceLabel}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
});
