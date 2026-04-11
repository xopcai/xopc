import { memo } from 'react';

import type { FollowUpSuggestionId } from '@/features/chat/follow-up-suggestions';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

function labelForFollowUpId(
  chat: ReturnType<typeof messages>['chat'],
  id: FollowUpSuggestionId,
): string {
  switch (id) {
    case 'code_error_handling':
      return chat.followUpChipErrorHandling;
    case 'code_refactor':
      return chat.followUpChipRefactorReadability;
    case 'date_shorter_summary':
      return chat.followUpChipShorterSummary;
    case 'date_main_risks':
      return chat.followUpChipMainRisks;
    case 'generic_simpler_terms':
      return chat.followUpChipSimplerTerms;
    case 'generic_concrete_example':
      return chat.followUpChipConcreteExample;
    case 'what_next':
      return chat.followUpChipWhatNext;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export const ChatFollowUpChips = memo(function ChatFollowUpChips({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: FollowUpSuggestionId[];
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
      {suggestions.map((id) => {
        const label = labelForFollowUpId(m.chat, id);
        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            className={cn(
              'max-w-full rounded-full border border-edge-subtle bg-surface-hover/60 px-3 py-1.5 text-left text-[0.8125rem] leading-snug text-fg hover:border-accent/40 hover:bg-accent-soft/50 dark:border-edge dark:bg-surface-hover/40',
              interaction.transition,
              interaction.press,
              interaction.focusRingPanel,
              'disabled:pointer-events-none disabled:opacity-50',
            )}
            onClick={() => onPick(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});
