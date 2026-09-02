import * as Popover from '@radix-ui/react-popover';
import { Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AboutDialog } from '@/components/shell/about-dialog';
import { BrandLogo } from '@/components/shell/brand-logo';
import { SidebarAppMenu } from '@/components/shell/sidebar-app-menu';
import { openSupportReport } from '@/features/support/support-report-host';
import { UserAvatarDisplay } from '@/features/user-context/user-avatar-display';
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
          <div className="flex flex-col items-center gap-1.5">
            <Link
              to="/you"
              onClick={() => onNavigate?.()}
              className="rounded-full outline-none ring-offset-surface-base transition-transform hover:opacity-95 active:scale-95 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 motion-reduce:active:scale-100"
              title={m.nav.profile}
              aria-label={m.nav.profile}
            >
              <UserAvatarDisplay
                callName={language === 'zh' ? '你' : 'You'}
                size={40}
                className="size-10"
                fallback={<BrandLogo className="size-full" alt={m.appBrand} />}
              />
            </Link>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-xl text-fg-muted outline-none ring-offset-surface-base transition-colors',
                  'hover:bg-surface-hover hover:text-fg',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  open && 'bg-accent-soft text-accent-fg',
                )}
                aria-expanded={open}
                aria-haspopup="dialog"
                title={m.sidebar.appMenuAria}
                aria-label={m.sidebar.appMenuAria}
              >
                <Settings className="size-[17px]" strokeWidth={1.5} />
              </button>
            </Popover.Trigger>
          </div>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-1 rounded-xl p-1">
            <Link
              to="/you"
              onClick={() => onNavigate?.()}
              className={cn(
                'shrink-0 rounded-full p-1 text-left outline-none transition-transform duration-150 ease-out',
                'hover:bg-surface-active/70',
                'hover:opacity-95 active:scale-95',
                'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
              )}
              title={m.nav.profile}
              aria-label={m.nav.profile}
            >
              <UserAvatarDisplay
                callName={language === 'zh' ? '你' : 'You'}
                size={32}
                className="size-8"
                fallback={<BrandLogo className="size-full" alt={m.appBrand} />}
              />
            </Link>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  'flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2 text-left text-fg-muted transition-colors',
                  'outline-none hover:bg-surface-hover hover:text-fg',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
                  open && 'bg-accent-soft text-accent-fg',
                )}
                aria-expanded={open}
                aria-haspopup="dialog"
                title={m.sidebar.appMenuAria}
                aria-label={m.sidebar.appMenuAria}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold leading-tight text-fg">{m.appBrand}</div>
                  <div className="truncate text-xs text-fg-muted">{m.appearanceSettings.quickMenuHint}</div>
                </div>
                <Settings className="size-[18px] shrink-0" strokeWidth={1.5} />
              </button>
            </Popover.Trigger>
          </div>
        )}

        <Popover.Portal>
          <Popover.Content
            className={cn(
              'z-50 w-max max-w-[min(calc(100vw-1rem),28rem)] overflow-visible',
              'rounded-xl border border-edge bg-surface-panel p-2 shadow-popover dark:border-edge',
            )}
            side="top"
            align={collapsed ? 'center' : 'end'}
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
