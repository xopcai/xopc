import { Menu } from 'lucide-react';
import { memo } from 'react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useLocaleStore } from '@/stores/locale-store';

/** `max-md` only — opens the sidebar drawer (same control as chat). */
export const MobileNavMenuButton = memo(function MobileNavMenuButton() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'size-8 shrink-0 rounded-xl p-0 md:hidden',
        APP_CHROME_NO_DRAG_CLASS,
        mobileNavOpen && 'hidden',
      )}
      aria-expanded={mobileNavOpen}
      aria-controls="app-sidebar"
      aria-label={m.openMenu}
      title={m.openMenu}
      onClick={() => setMobileNavOpen(true)}
    >
      <Menu className="size-4" strokeWidth={1.5} aria-hidden />
    </Button>
  );
});
