import { ChevronDown } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export const ScrollToBottomButton = memo(function ScrollToBottomButton({
  visible,
  onClick,
  contained = false,
}: {
  visible: boolean;
  onClick: () => void;
  contained?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={cn(
        'z-20 flex items-center justify-center rounded-full border border-edge bg-surface-panel text-fg-subtle shadow-float',
        contained
          ? 'absolute bottom-4 right-4 size-9'
          : 'fixed bottom-[calc(11rem+env(safe-area-inset-bottom,0px))] right-6 size-11 md:right-10',
        'hover:bg-surface-hover hover:text-fg dark:border-edge dark:shadow-none',
        interaction.transition,
        interaction.press,
        interaction.focusRingPanel,
      )}
      onClick={onClick}
      title={m.chat.scrollToBottom}
      aria-label={m.chat.scrollToBottom}
    >
      <ChevronDown className={contained ? 'size-5' : 'size-6'} aria-hidden />
    </button>
  );
});
