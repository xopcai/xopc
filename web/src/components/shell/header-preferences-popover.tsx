import * as Popover from '@radix-ui/react-popover';
import { Languages } from 'lucide-react';

import { LanguageToggle } from '@/components/shell/language-toggle';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function HeaderPreferencesPopover() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="h-8 w-8 shrink-0 p-0"
          aria-label={m.appBarPreferences}
        >
          <Languages className="size-4" strokeWidth={1.5} />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-fit min-w-[8rem] max-w-[calc(100vw-2rem)] rounded-xl border border-edge bg-surface-panel p-3 shadow-elevated dark:border-edge"
          sideOffset={8}
          align="end"
          collisionPadding={12}
        >
          <div className="flex flex-col gap-4">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
