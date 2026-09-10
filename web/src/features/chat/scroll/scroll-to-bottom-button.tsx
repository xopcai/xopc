import { ArrowDown } from 'lucide-react';
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
        'group flex shrink-0 items-center justify-center rounded-full text-fg-muted',
        contained
          ? 'absolute bottom-3 right-3 z-20 size-9 border border-edge-subtle bg-surface-panel/95 shadow-elevated backdrop-blur-sm'
          : 'size-10 sm:size-9',
        'hover:bg-surface-hover hover:text-fg',
        interaction.transition,
        interaction.press,
        interaction.focusRingPanel,
      )}
      onClick={onClick}
      title={m.chat.scrollToBottom}
      aria-label={m.chat.scrollToBottom}
    >
      <ArrowDown
        className="size-[1.125rem] transition-transform duration-150 ease-out group-hover:translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        strokeWidth={1.8}
        aria-hidden
      />
    </button>
  );
});
