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

  return (
    <div className="my-1 rounded-xl border border-edge-subtle bg-surface-hover/90 dark:border-edge/80">
      <button
        type="button"
        disabled={isStreaming}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-muted hover:bg-surface-hover disabled:cursor-default disabled:opacity-100"
        onClick={() => !isStreaming && setExpanded(!expanded)}
        aria-expanded={showBody}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
        <span className="font-medium text-fg">
          {isStreaming ? (
            <span className="animate-pulse text-fg-subtle">{labels.thoughtsStreaming}</span>
          ) : (
            labels.thoughts
          )}
        </span>
        {!showBody && !isStreaming && bodyText ? (
          <span className="text-fg-disabled">{labels.thoughtsExpandHint}</span>
        ) : null}
        {!isStreaming ? (
          <ChevronDown className={cn('ml-auto h-4 w-4', showBody && 'rotate-180')} aria-hidden />
        ) : null}
      </button>
      {showBody ? (
        <>
          <div className="border-t border-edge dark:border-edge" role="presentation" />
          <div
            className={cn(
              'max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 text-xs text-fg-muted',
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
