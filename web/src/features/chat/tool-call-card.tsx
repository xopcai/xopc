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
  const [expanded, setExpanded] = useState(isStreaming);

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

  if (isStreaming) {
    return (
      <div className="rounded-lg border border-edge bg-surface-base dark:border-edge">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2 text-xs font-medium text-fg-muted dark:border-edge">
          <Code className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[11px] text-accent-fg">{displayName}</span>
          <span className="text-fg-disabled">running…</span>
        </div>
        <div className="max-h-60 overflow-auto p-3 font-mono text-xs text-fg-muted">
          {paramsJson ? (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-disabled">{labels.input}</div>
              <pre className="whitespace-pre-wrap">{paramsJson}</pre>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-base dark:border-edge">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-fg-muted hover:bg-surface-hover"
        onClick={() => setExpanded(!expanded)}
      >
        <Code className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[11px] text-accent-fg">{displayName}</span>
        {isError ? <span className="text-red-600 dark:text-red-400">error</span> : null}
        <ChevronDown
          className={cn('ml-auto h-4 w-4 transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="max-h-80 overflow-auto border-t border-edge p-3 font-mono text-xs dark:border-edge">
          {paramsJson ? (
            <div className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-disabled">{labels.input}</div>
              <pre className="whitespace-pre-wrap text-fg-muted">{paramsJson}</pre>
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-disabled">{labels.output}</div>
            <pre className="whitespace-pre-wrap text-fg-muted">{outputText}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
