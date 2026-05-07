import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { memo, useMemo } from 'react';
import useSWR from 'swr';

import { estimateConversationContextTokens } from '@/features/chat/estimate-context-usage';
import type { Message } from '@/features/chat/messages.types';
import { CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached } from '@/features/chat/registry-api';
import { interpolate } from '@/features/chat/composer.types';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

const R = 7;
const STROKE = 2.25;
const C = 2 * Math.PI * R;

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}M`.replace(/\.0M$/, 'M');
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) {
    const v = n / 1000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1)}k`.replace(/\.0k$/, 'k');
  }
  return String(Math.round(n));
}

/** Percent 0–100 for display, one decimal when < 10 else whole number. */
function formatContextPercent(used: number, limit: number): string {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return '0';
  const pct = Math.min(100, Math.max(0, (100 * used) / limit));
  if (pct >= 10 || pct === 0) return String(Math.round(pct));
  return pct.toFixed(1).replace(/\.0$/, '');
}

export const ModelContextRing = memo(function ModelContextRing({
  sessionModel,
  messages,
  draftChars,
  chat,
  disabled,
}: {
  sessionModel: string;
  messages: readonly Message[];
  draftChars: number;
  chat: MessageBundle['chat'];
  disabled?: boolean;
}) {
  const { data: models = [] } = useSWR(CONFIGURED_MODELS_SWR_KEY, fetchConfiguredModelsCached, {
    revalidateOnFocus: false,
  });

  const limit = useMemo(() => models.find((x) => x.id === sessionModel)?.contextWindow, [models, sessionModel]);

  const used = useMemo(
    () => estimateConversationContextTokens(messages, draftChars),
    [messages, draftChars],
  );
  const ratio = limit != null && limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const dash = ratio * C;

  const ariaSummary = useMemo(() => {
    if (limit != null && limit > 0) {
      return interpolate(chat.contextWindowAriaSummary, {
        used: formatTokenCount(used),
        limit: formatTokenCount(limit),
      });
    }
    return interpolate(chat.contextWindowAriaSummaryNoLimit, { used: formatTokenCount(used) });
  }, [chat, limit, used]);

  const hoverLabel = useMemo(() => {
    if (limit != null && limit > 0) {
      return interpolate(chat.contextWindowHoverShort, {
        percent: formatContextPercent(used, limit),
      });
    }
    return interpolate(chat.contextWindowHoverNoLimit, { used: formatTokenCount(used) });
  }, [chat, limit, used]);

  const tooltipContentClass =
    '!z-[10000] whitespace-nowrap rounded-lg border border-edge bg-surface-panel px-2 py-1 text-xs font-medium text-fg shadow-md';

  return (
    <TooltipProvider delayDuration={280}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-disabled={disabled || undefined}
            aria-label={ariaSummary}
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle',
              'hover:bg-surface-hover hover:text-fg-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              disabled && 'cursor-default opacity-40',
            )}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              className="shrink-0"
              aria-hidden
            >
              <circle
                cx="9"
                cy="9"
                r={R}
                fill="none"
                stroke="currentColor"
                className="text-fg-subtle opacity-[0.35]"
                strokeWidth={STROKE}
              />
              <circle
                cx="9"
                cy="9"
                r={R}
                fill="none"
                stroke="currentColor"
                className="text-fg-muted"
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${C}`}
                transform="rotate(-90 9 9)"
              />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent side="top" sideOffset={6} collisionPadding={12} className={tooltipContentClass}>
            {hoverLabel}
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
  );
});
