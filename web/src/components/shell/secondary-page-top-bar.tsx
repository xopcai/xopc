import { Menu } from 'lucide-react';
import { memo } from 'react';

import { APP_TOP_HEADER_BAR_CLASS } from '@/components/shell/app-chrome';
import { HeaderPreferencesPopover } from '@/components/shell/header-preferences-popover';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useLocaleStore } from '@/stores/locale-store';

/**
 * Mobile / small viewports: secondary routes mirror `ChatHeaderBar` (menu + preferences).
 * Desktop (`lg+`) uses the persistent sidebar — this bar is hidden there.
 */
export const SecondaryPageTopBar = memo(function SecondaryPageTopBar() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);

  return (
    <div
      className={cn(
        'flex gap-3 border-b border-edge-subtle px-4 sm:gap-4 sm:px-8 lg:hidden',
        APP_TOP_HEADER_BAR_CLASS,
        'bg-surface-panel',
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className={cn('size-8 shrink-0 rounded-xl p-0', mobileNavOpen && 'hidden')}
          aria-expanded={mobileNavOpen}
          aria-controls="app-sidebar"
          aria-label={m.openMenu}
          title={m.openMenu}
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu className="size-4" strokeWidth={1.5} aria-hidden />
        </Button>
      </div>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <div className="hidden items-center gap-2 sm:gap-2.5 lg:flex">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <div className="lg:hidden">
          <HeaderPreferencesPopover />
        </div>
      </div>
    </div>
  );
});
