import * as Dialog from '@radix-ui/react-dialog';
import { Menu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

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

  return (
    <div className="flex min-h-screen bg-surface-base">
      <GatewaySseBridge />
      <NavigateToChatListener />
      <TokenDialog />

      <aside
        className={cn(
          'hidden w-56 shrink-0 flex-col border-r border-edge bg-surface-panel lg:flex',
          'dark:border-edge',
        )}
      >
        <div className="border-b border-edge px-3 py-3 dark:border-edge">
          <div className="text-sm font-semibold text-fg">{m.appBrand}</div>
          <div className="text-xs text-fg-subtle">{m.appSubtitle}</div>
          <div className="mt-2">
            <ConnectionIndicator />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge p-2 dark:border-edge">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-edge bg-surface-panel px-3 py-2 lg:hidden dark:border-edge">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{m.appBrand}</div>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <ConnectionIndicator className="max-w-[40%] sm:max-w-none" />
            <LanguageToggle />
            <ThemeToggle />
            <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <Dialog.Trigger asChild>
                <Button type="button" variant="secondary" className="h-9 px-2" aria-label="Menu">
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
                  <div className="border-b border-edge px-3 py-3 dark:border-edge">
                    <div className="text-sm font-semibold text-fg">{m.appBrand}</div>
                    <div className="text-xs text-fg-subtle">{m.appSubtitle}</div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
