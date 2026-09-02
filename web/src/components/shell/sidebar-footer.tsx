import * as Popover from '@radix-ui/react-popover';
import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AboutDialog } from '@/components/shell/about-dialog';
import { BrandLogo } from '@/components/shell/brand-logo';
import { SidebarAppMenu } from '@/components/shell/sidebar-app-menu';
import { openSupportReport } from '@/features/support/support-report-host';
import { messages } from '@/i18n/messages';
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
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    void import('@/pages/settings-page');
    void import('@/pages/sessions-page');
    void import('@/pages/logs-page');
    void import('@/pages/automations-page');
    void import('@/pages/skills-page');
  }, []);

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col',
        collapsed && 'mt-auto',
        collapsed ? 'items-center px-1 py-2' : 'p-3',
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
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full min-w-0 items-center gap-2 rounded-xl p-1 text-left outline-none transition-colors duration-150 ease-out',
                'hover:bg-surface-active/70',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                open && 'bg-surface-active/70',
              )}
              aria-expanded={open}
              aria-haspopup="dialog"
              title={m.sidebar.appMenuAria}
              aria-label={m.sidebar.appMenuAria}
            >
              <span className="size-8 shrink-0 overflow-hidden rounded-full" aria-hidden>
                <BrandLogo className="size-full rounded-full" alt="" aria-hidden />
              </span>
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
        )}

        <Popover.Portal>
          <Popover.Content
            className={cn(
              'z-50 w-max max-w-[min(calc(100vw-1rem),28rem)] overflow-visible',
              'rounded-xl border border-edge bg-surface-panel p-2 shadow-popover dark:border-edge',
            )}
            side="top"
            align={collapsed ? 'center' : 'start'}
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <SidebarAppMenu
              onNavigate={() => {
                setOpen(false);
                onNavigate?.();
              }}
              onAboutClick={() => {
                setAboutOpen(true);
                setOpen(false);
              }}
              onSupportClick={() => {
                setOpen(false);
                openSupportReport();
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
