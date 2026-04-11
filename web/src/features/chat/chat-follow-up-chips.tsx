import { memo } from 'react';

import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

export const ChatFollowUpChips = memo(function ChatFollowUpChips({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: string[];
  disabled?: boolean;
  onPick: (text: string) => void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  if (suggestions.length === 0) return null;

  return (
    <div
      className="mb-2 flex flex-wrap gap-2"
      role="group"
      aria-label={m.chat.followUpSuggestionsAria}
    >
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          className={cn(
            'max-w-full rounded-full border border-edge-subtle bg-surface-hover/60 px-3 py-1.5 text-left text-[0.8125rem] leading-snug text-fg hover:border-accent/40 hover:bg-accent-soft/50 dark:border-edge dark:bg-surface-hover/40',
            interaction.transition,
            interaction.press,
            interaction.focusRingPanel,
            'disabled:pointer-events-none disabled:opacity-50',
          )}
          onClick={() => onPick(s)}
        >
          {s}
        </button>
      ))}
    </div>
  );
});
