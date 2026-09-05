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
        'flex shrink-0 items-center justify-center rounded-full text-fg-subtle',
        contained
          ? 'absolute bottom-4 right-4 z-20 size-9 border border-edge bg-surface-panel shadow-float'
          : 'size-11',
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
