import { ChevronDown } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export const ScrollToBottomButton = memo(function ScrollToBottomButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={cn(
        // Fixed above composer (not in layout flow). `12rem` + safe area — better clearance on narrow viewports.
        'fixed bottom-[calc(11rem+env(safe-area-inset-bottom,0px))] right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-edge bg-surface-panel text-fg-subtle shadow-float',
        'hover:bg-surface-hover hover:text-fg dark:border-edge dark:shadow-none md:right-10',
        interaction.transition,
        interaction.press,
        interaction.focusRingPanel,
      )}
      onClick={onClick}
      title={m.chat.scrollToBottom}
      aria-label={m.chat.scrollToBottom}
    >
      <ChevronDown className="h-6 w-6" aria-hidden />
    </button>
  );
});
