import * as Popover from '@radix-ui/react-popover';
import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { BrandLogo } from '@/components/shell/brand-logo';
import { PreferenceSelectFields } from '@/components/shell/preference-select-fields';
import { messages } from '@/i18n/messages';
import { pathForTab } from '@/navigation';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export function SidebarFooter({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const a = m.appearanceSettings;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void import('@/pages/settings-page');
    void import('@/pages/sessions-page');
    void import('@/pages/logs-page');
  }, []);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col',
        'transition-colors duration-150 ease-out hover:bg-surface-hover',
        'motion-reduce:transition-none',
        collapsed && 'mt-auto',
        collapsed ? 'items-center px-1 py-2' : 'px-3 py-3',
      )}
    >
      <Popover.Root open={open} onOpenChange={setOpen}>
        {collapsed ? (
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full outline-none ring-offset-surface-base transition-transform',
                'hover:opacity-95 active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                open && 'ring-2 ring-accent',
                'motion-reduce:opacity-100 motion-reduce:active:scale-100',
              )}
              aria-expanded={open}
              aria-haspopup="dialog"
              title={m.sidebar.appMenuAria}
              aria-label={m.sidebar.appMenuAria}
            >
              <BrandLogo className="size-full rounded-full" alt={m.appBrand} />
            </button>
          </Popover.Trigger>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to="/chat"
              title={m.nav.chat}
              className={cn(
                'size-8 shrink-0 overflow-hidden rounded-full ring-offset-surface-base transition-transform duration-150 ease-out',
                'hover:opacity-95 active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                'motion-reduce:hover:opacity-100 motion-reduce:active:scale-100',
              )}
              onClick={() => onNavigate?.()}
            >
              <BrandLogo className="size-full rounded-full" alt={m.appBrand} />
            </Link>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left outline-none',
                  'hover:bg-surface-active/70',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                )}
                aria-expanded={open}
                aria-haspopup="dialog"
                title={m.sidebar.appMenuAria}
                aria-label={m.sidebar.appMenuAria}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold leading-tight text-fg">{m.appBrand}</div>
                  <div className="truncate text-xs text-fg-muted">{a.quickMenuHint}</div>
                </div>
                <span
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-xl text-fg-muted transition-colors',
                    open && 'bg-accent-soft text-accent-fg',
                  )}
                  aria-hidden
                >
                  <Settings className="size-[18px]" strokeWidth={1.5} />
                </span>
              </button>
            </Popover.Trigger>
          </div>
        )}

        <Popover.Portal>
          <Popover.Content
            className={cn(
              'z-50 max-h-[min(70vh,28rem)] w-[min(calc(100vw-1.5rem),20rem)] overflow-y-auto overflow-x-hidden',
              'rounded-xl border border-edge bg-surface-panel p-4 shadow-popover dark:border-edge',
            )}
            side="top"
            align={collapsed ? 'center' : 'start'}
            sideOffset={8}
            collisionPadding={12}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex flex-col gap-4">
              <PreferenceSelectFields variant="sidebar" />
              <div className="h-px bg-edge-subtle" role="separator" />
              <Link
                to={pathForTab('settingsAppearance')}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-accent-fg',
                  'bg-accent-soft transition-colors hover:bg-accent-soft/90',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                )}
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
              >
                <Settings className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                {a.openFullPreferences}
              </Link>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
