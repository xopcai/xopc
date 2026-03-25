import { useEffect, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

import { cn } from '@/lib/cn';

export function ThinkingBlock({
  content,
  isStreaming,
  labels,
}: {
  content: string;
  isStreaming: boolean;
  labels: { thoughts: string; thoughtsStreaming: string; thoughtsExpandHint: string };
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isStreaming) setExpanded(false);
  }, [isStreaming]);

  const bodyText = content.trim();
  const placeholder = isStreaming && !bodyText ? '…' : bodyText;
  const showBody = expanded || isStreaming;

  if (!content && !isStreaming) {
    return null;
  }

  const showHint = !showBody && !isStreaming && Boolean(bodyText);

  return (
    <div className="my-1 w-full min-w-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-hover/90 dark:border-edge/80">
      <button
        type="button"
        disabled={isStreaming}
        className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-t-xl px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-hover disabled:cursor-default disabled:opacity-100"
        onClick={() => !isStreaming && setExpanded(!expanded)}
        aria-expanded={showBody}
      >
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-fg" aria-hidden />
        <div className="min-w-0">
          <div className="font-medium text-fg">
            {isStreaming ? (
              <span className="animate-pulse text-fg-subtle">{labels.thoughtsStreaming}</span>
            ) : (
              labels.thoughts
            )}
          </div>
          <div
            className={cn(
              'mt-0.5 min-h-[1.125rem] text-fg-disabled',
              !showHint && 'invisible',
            )}
            aria-hidden={!showHint}
          >
            {labels.thoughtsExpandHint}
          </div>
        </div>
        {!isStreaming ? (
          <ChevronDown
            className={cn('mt-0.5 h-4 w-4 shrink-0', showBody && 'rotate-180')}
            aria-hidden
          />
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}
      </button>
      {showBody ? (
        <>
          <div className="border-t border-edge dark:border-edge" role="presentation" />
          <div
            className={cn(
              'max-h-64 w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-xs text-fg-muted [overflow-wrap:anywhere]',
              isStreaming && 'animate-pulse',
            )}
          >
            {placeholder}
          </div>
        </>
      ) : null}
    </div>
  );
}
