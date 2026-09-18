import { ArrowDown } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export const ScrollToBottomDock = memo(function ScrollToBottomDock({
  visible,
  onClick,
  edge = 'top',
  running = false,
}: {
  visible: boolean;
  onClick: () => void;
  edge?: 'top' | 'bottom';
  running?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  return (
    <div
      data-scroll-to-bottom-dock
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center transition-opacity duration-150 ease-out motion-reduce:transition-none',
        edge === 'top' ? '-top-2 -translate-y-full' : 'bottom-2',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <button
        type="button"
        className={cn(
          'group pointer-events-auto flex size-8 shrink-0 items-center justify-center rounded-full border border-edge-subtle bg-surface-panel text-fg-muted shadow-surface',
          'hover:bg-surface-hover hover:text-fg',
          interaction.transition,
          interaction.press,
          interaction.focusRingPanel,
          visible
            ? 'scale-100 opacity-100'
            : 'pointer-events-none translate-y-1 scale-95 opacity-0',
          'motion-reduce:translate-y-0 motion-reduce:scale-100',
        )}
        tabIndex={visible ? undefined : -1}
        onClick={onClick}
        title={m.chat.scrollToBottom}
        aria-label={m.chat.scrollToBottom}
      >
        {running ? (
          <span className="flex items-center gap-1" aria-hidden>
            {[-0.4, -0.2, 0].map((delay) => (
              <span
                key={delay}
                data-scroll-to-bottom-running-dot
                className="size-1 rounded-full bg-current animate-pulse motion-reduce:animate-none"
                style={{ animationDelay: `${delay}s`, animationDuration: '1.2s' }}
              />
            ))}
          </span>
        ) : (
          <ArrowDown
            data-scroll-to-bottom-arrow
            className="size-4 transition-transform duration-150 ease-out group-hover:translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
            strokeWidth={1.8}
            aria-hidden
          />
        )}
      </button>
    </div>
  );
});
