import * as Dialog from '@radix-ui/react-dialog';
import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { messages } from '@/i18n/messages';
import { ConnectionIndicator } from '@/components/shell/connection-indicator';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { SidebarNav } from '@/components/shell/sidebar';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { TokenDialog } from '@/components/shell/token-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { GatewaySseBridge } from '@/features/gateway/gateway-sse-bridge';
import { useLocaleStore } from '@/stores/locale-store';

/** Align with `ui` `navigate-to-chat` custom event from session manager. */
function NavigateToChatListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ sessionKey: string }>).detail;
      if (d?.sessionKey) {
        navigate(`/chat/${encodeURIComponent(d.sessionKey)}`);
      }
    };
    window.addEventListener('navigate-to-chat', handler as EventListener);
    return () => window.removeEventListener('navigate-to-chat', handler as EventListener);
  }, [navigate]);
  return null;
}

export function AppShell() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();
  const isChatRoute = pathname.startsWith('/chat');

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base">
      <GatewaySseBridge />
      <NavigateToChatListener />
      <TokenDialog />

      {/* Full-width app bar (design: content surface + top strip) */}
      <header className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface-panel px-3 py-2.5 sm:px-4 lg:px-5 dark:border-edge">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold tracking-tight text-fg">{m.appBrand}</span>
            <span className="truncate text-xs font-normal text-fg-subtle">{m.appSubtitle}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ConnectionIndicator className="max-w-[min(42vw,9rem)] lg:hidden" />
          <LanguageToggle />
          <ThemeToggle />
          <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <Dialog.Trigger asChild>
              <Button type="button" variant="secondary" className="h-9 px-2 lg:hidden" aria-label="Menu">
                <Menu className="size-4" strokeWidth={1.75} />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 lg:hidden" />
              <Dialog.Content
                className={cn(
                  'fixed left-0 top-0 z-50 flex h-full w-[min(100%-3rem,18rem)] flex-col border-r border-edge bg-surface-panel shadow-popover lg:hidden',
                  'dark:border-edge',
                )}
              >
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
                </div>
                <div className="shrink-0 border-t border-edge-subtle px-3 py-3 dark:border-edge">
                  <ConnectionIndicator />
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <aside
          className={cn(
            'hidden h-full min-h-0 w-60 shrink-0 flex-col border-r border-edge bg-surface-base',
            'dark:border-edge',
            'lg:flex',
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SidebarNav />
          </div>
          <div className="shrink-0 border-t border-edge-subtle px-3 py-3 dark:border-edge">
            <ConnectionIndicator />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-panel">
          <main
            className={cn(
              'flex min-h-0 flex-1 flex-col',
              isChatRoute ? 'overflow-hidden' : 'overflow-y-auto',
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
