import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Plus, Search, Settings2, Store, Wrench } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export const ConnectorSearchField = memo(function ConnectorSearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={cn(
      'relative flex min-h-9 min-w-0 flex-1 cursor-text items-center rounded-pill border border-edge bg-surface-panel py-1.5 pl-9 pr-3 shadow-surface',
      className,
    )}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-disabled"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-0.5 text-sm leading-normal text-fg caret-current placeholder:text-fg-disabled focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
      />
    </label>
  );
});

export const ConnectorsPageHeaderEnd = memo(function ConnectorsPageHeaderEnd({
  onBrowseCatalog,
  onAddCustomServer,
  onOpenRuntimeSettings,
  addLabel,
  browseLabel,
  customLabel,
  settingsLabel,
}: {
  onBrowseCatalog: () => void;
  onAddCustomServer: () => void;
  onOpenRuntimeSettings: () => void;
  addLabel: string;
  browseLabel: string;
  customLabel: string;
  settingsLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        className="shrink-0 gap-2"
        aria-label={settingsLabel}
        title={settingsLabel}
        onClick={onOpenRuntimeSettings}
      >
        <Settings2 className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="hidden sm:inline">{settingsLabel}</span>
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="primary" className="shrink-0 gap-2">
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            {addLabel}
            <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="z-50 min-w-[14rem] rounded-xl border border-edge bg-surface-panel p-1 shadow-popover dark:border-edge"
            sideOffset={6}
            align="end"
          >
            <DropdownMenu.Item
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover',
                interaction.transition,
              )}
              onSelect={onBrowseCatalog}
            >
              <Store className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              {browseLabel}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover',
                interaction.transition,
              )}
              onSelect={onAddCustomServer}
            >
              <Wrench className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              {customLabel}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
});
