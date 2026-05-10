import { Search } from 'lucide-react';
import { memo } from 'react';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

/** Opens the global command palette (`open-command-palette`). */
export const CommandPaletteSearchButton = memo(function CommandPaletteSearchButton({
  className,
}: {
  className?: string;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn('size-8 shrink-0 rounded-xl p-0', APP_CHROME_NO_DRAG_CLASS, className)}
      title={m.titleBarCommandPalette}
      aria-label={m.titleBarCommandPalette}
      onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
    >
      <Search className="size-4" strokeWidth={1.5} aria-hidden />
    </Button>
  );
});
