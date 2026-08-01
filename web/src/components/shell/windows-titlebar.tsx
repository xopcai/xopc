import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { memo, useEffect, useState } from 'react';

import { APP_CHROME_DRAG_CLASS, APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { ShellQuickActions } from '@/components/shell/shell-quick-actions';
import { cn } from '@/lib/cn';
import { isElectronWin32 } from '@/lib/electron-window-chrome';
import { useLocaleStore } from '@/stores/locale-store';
import type { ElectronMenuGroupModel, ElectronMenuItemModel } from '@/types/electron';

function formatAccelerator(accelerator: string | undefined): string | null {
  if (!accelerator) return null;
  return accelerator
    .replace(/CmdOrCtrl/g, 'Ctrl')
    .replace(/Command/g, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function MenuItemRow({
  item,
  onInvoke,
}: {
  item: ElectronMenuItemModel;
  onInvoke: (id: string) => void;
}) {
  if (item.type === 'separator') {
    return <DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" />;
  }

  const accelerator = formatAccelerator(item.accelerator);

  return (
    <DropdownMenu.Item
      className={cn(
        'flex min-h-7 cursor-default select-none items-center gap-6 rounded-md px-2 py-1.5 text-xs text-fg outline-none',
        'data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg',
      )}
      onSelect={() => onInvoke(item.id)}
    >
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {accelerator ? (
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-fg-subtle">
          {accelerator}
        </span>
      ) : null}
    </DropdownMenu.Item>
  );
}

function WindowsTitlebarMenu({ groups }: { groups: ElectronMenuGroupModel[] }) {
  const onInvoke = (id: string) => {
    void window.electronAPI?.menu?.invoke(id);
  };

  return (
    <div
      className={cn('windows-titlebar-interactive flex min-w-0 items-center gap-1', APP_CHROME_NO_DRAG_CLASS)}
      role="menubar"
    >
      {groups.map((group) => (
        <DropdownMenu.Root key={group.id} modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm font-normal text-fg-muted',
                'outline-none transition-colors hover:bg-surface-hover hover:text-fg',
                'focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=open]:bg-surface-hover data-[state=open]:text-fg',
                APP_CHROME_NO_DRAG_CLASS,
              )}
              role="menuitem"
            >
              {group.label}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={4}
              className={cn(
                'windows-titlebar-interactive z-[90] min-w-52 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover outline-none',
                APP_CHROME_NO_DRAG_CLASS,
              )}
            >
              {group.items.map((menuItem, index) => (
                <MenuItemRow
                  key={menuItem.type === 'item' ? menuItem.id : `${group.id}-separator-${index}`}
                  item={menuItem}
                  onInvoke={onInvoke}
                />
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ))}
    </div>
  );
}

export const WindowsTitlebar = memo(function WindowsTitlebar() {
  const language = useLocaleStore((s) => s.language);
  const [groups, setGroups] = useState<ElectronMenuGroupModel[]>([]);

  useEffect(() => {
    if (!isElectronWin32()) return;
    let cancelled = false;
    void window.electronAPI?.menu
      ?.getModel()
      .then((model) => {
        if (!cancelled) setGroups(model);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  if (!isElectronWin32()) return null;

  return (
    <header
      className={cn(
        'windows-titlebar flex h-9 min-w-0 shrink-0 items-center gap-2 border-b border-edge-subtle',
      )}
    >
      <div className={cn('windows-titlebar-interactive flex shrink-0 items-center gap-0.5', APP_CHROME_NO_DRAG_CLASS)}>
        <ShellQuickActions sidebarToggleVariant="main" />
      </div>
      <WindowsTitlebarMenu groups={groups} />
      <div className={cn('min-w-8 flex-1 self-stretch', APP_CHROME_DRAG_CLASS)} aria-hidden />
    </header>
  );
});
