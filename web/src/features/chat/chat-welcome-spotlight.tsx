import { ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { Loopi } from '@/components/brand/loopi';
import type {
  WelcomeSpotlightModel,
  WelcomeSuggestionSelection,
} from '@/features/chat/welcome/welcome-suggestions';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

export const ChatWelcomeSpotlight = memo(function ChatWelcomeSpotlight({
  spotlight,
  onPickPrompt,
  compact = false,
}: {
  spotlight: WelcomeSpotlightModel;
  onPickPrompt: (selection: WelcomeSuggestionSelection) => void;
  compact?: boolean;
}) {
  const language = useLocaleStore((state) => state.language);
  const recommendation = spotlight.recommendation;

  return (
    <div
      className={cn(
        'flex flex-col items-center px-3 text-center',
        compact
          ? 'gap-4 pb-3 pt-5'
          : 'gap-5 pb-6 pt-32 sm:pt-36 [@media(max-height:800px)]:pt-12',
      )}
    >
      <Loopi
        className={cn(
          'shrink-0',
          compact
            ? 'size-24'
            : 'size-28 sm:size-32 [@media(max-height:800px)]:size-24',
        )}
        interactive
        language={language}
        mood="listen"
      />
      <h1 className="max-w-xl text-balance text-xl font-semibold tracking-tight text-fg">
        {spotlight.headline}
      </h1>

      {recommendation ? (
        <button
          type="button"
          onClick={() => onPickPrompt({
            suggestionId: recommendation.id,
            contextKind: spotlight.contextKind,
            prompt: recommendation.prompt,
          })}
          className={cn(
            'mt-4 flex min-h-16 w-full max-w-xl items-center gap-3 rounded-xl border border-edge bg-surface-panel px-4 py-3 text-left hover:border-edge-strong hover:bg-surface-hover',
            interaction.transition,
            interaction.press,
            interaction.focusRingPanel,
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-sm font-medium leading-snug text-fg sm:text-[0.9375rem]">
              {recommendation.title}
            </span>
            <span className="mt-1 block truncate text-xs text-fg-muted">
              {recommendation.reason}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  );
});
