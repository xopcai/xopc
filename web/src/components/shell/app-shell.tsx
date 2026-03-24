import { Outlet } from 'react-router-dom';

import { ThemeToggle } from '@/components/shell/theme-toggle';

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-base">
      <header className="flex shrink-0 items-center justify-between border-b border-edge bg-surface-panel px-4 py-3 dark:border-edge">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-fg">xopcbot</span>
          <span className="text-xs text-fg-subtle">Gateway console</span>
        </div>
        <ThemeToggle />
      </header>
      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
