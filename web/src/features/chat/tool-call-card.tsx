import { useState } from 'react';
import { ChevronDown, Code } from 'lucide-react';

import { cn } from '@/lib/cn';

function formatParamsJson(params: unknown): string {
  if (params === undefined) return '';
  try {
    return JSON.stringify(JSON.parse(params as string), null, 2);
  } catch {
    try {
      return JSON.stringify(params, null, 2);
    } catch {
      return String(params);
    }
  }
}

export function ToolCallCard({
  toolName,
  params,
  resultText,
  isStreaming,
  isError,
  labels,
}: {
  toolName: string;
  params?: unknown;
  resultText?: string;
  isStreaming: boolean;
  isError: boolean;
  labels: { input: string; output: string; noOutput: string };
}) {
  const [expanded, setExpanded] = useState(false);

  const displayName = toolName.trim() || 'Tool';
  const paramsJson = params !== undefined ? formatParamsJson(params) : '';

  let outputText = resultText?.trim() ?? '';
  if (!outputText) {
    outputText = isStreaming ? '' : labels.noOutput;
  } else {
    try {
      outputText = JSON.stringify(JSON.parse(outputText), null, 2);
    } catch {
      /* keep raw */
    }
  }

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl bg-surface-hover/35 dark:bg-surface-hover/25">
      <button
        type="button"
        className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-t-xl px-3 py-2 text-left text-xs font-medium text-fg-muted hover:bg-surface-hover"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <Code className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="max-w-full truncate rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[11px] text-accent-fg">
              {displayName}
            </span>
            {isStreaming ? (
              <span className="shrink-0 text-fg-disabled">running…</span>
            ) : isError ? (
              <span className="shrink-0 text-red-600 dark:text-red-400">error</span>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn('mt-0.5 h-4 w-4 shrink-0 transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="max-h-80 w-full min-w-0 max-w-full overflow-x-auto overflow-y-auto border-t border-edge-subtle/90 bg-surface-hover/20 p-3 font-mono text-xs dark:border-edge-subtle">
          {paramsJson ? (
            <div className="mb-3 min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-disabled">{labels.input}</div>
              <pre className="whitespace-pre-wrap break-words text-fg-muted [overflow-wrap:anywhere]">{paramsJson}</pre>
            </div>
          ) : null}
          {!isStreaming ? (
            <div className="min-w-0">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-disabled">{labels.output}</div>
              <pre className="whitespace-pre-wrap break-words text-fg-muted [overflow-wrap:anywhere]">{outputText}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
