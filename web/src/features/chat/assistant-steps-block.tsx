import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, CircleDot, Loader2, XCircle } from 'lucide-react';

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages.types';
import { stringToToolResultMessage } from '@/features/chat/tool-result';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

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

function extractSearchQuery(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj = typeof input === 'string' ? (JSON.parse(input) as Record<string, unknown>) : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  const q = obj?.query ?? obj?.q ?? obj?.query_string ?? obj?.search_term ?? obj?.searchQuery;
  if (typeof q === 'string') return q;
  if (typeof q === 'number') return String(q);
  return '';
}

function extractPathPreview(input: unknown): string {
  if (input == null) return '';
  let obj: Record<string, unknown> | null = null;
  try {
    obj = typeof input === 'string' ? (JSON.parse(input) as Record<string, unknown>) : (input as Record<string, unknown>);
  } catch {
    return '';
  }
  const p = obj?.path ?? obj?.file_path ?? obj?.filepath ?? obj?.file;
  if (typeof p === 'string') return p;
  return '';
}

function toolStepTitle(
  name: string,
  labels: { searchedWeb: string; readFile: string },
): string {
  const n = name.toLowerCase().replace(/-/g, '_');
  if (n.includes('search') || n === 'web_search' || n === 'brave_search') return labels.searchedWeb;
  if (n.includes('read_file') || n === 'read_file' || n.includes('file_read')) return labels.readFile;
  return name.trim() || 'tool';
}

function filterVisibleSteps(blocks: Array<ThinkingContent | ToolUseContent>): Array<ThinkingContent | ToolUseContent> {
  return blocks.filter(
    (b) =>
      b.type !== 'thinking' ||
      Boolean(b.text?.trim()) ||
      Boolean(b.streaming),
  );
}

function viewStepsLabel(
  count: number,
  m: { viewSteps_one: string; viewSteps_other: string },
): string {
  const key = count === 1 ? m.viewSteps_one : m.viewSteps_other;
  return key.replace(/\{\{count\}\}/g, String(count));
}

export function AssistantStepsBlock({
  blocks,
  toolLabels,
  stepLabels,
}: {
  blocks: Array<ThinkingContent | ToolUseContent>;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    viewSteps_one: string;
    viewSteps_other: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
  };
}) {
  const visibleBlocks = useMemo(() => filterVisibleSteps(blocks), [blocks]);
  const stepCount = visibleBlocks.length;
  const anyActive = visibleBlocks.some(
    (b) =>
      (b.type === 'thinking' && b.streaming) || (b.type === 'tool_use' && b.status === 'running'),
  );

  const [expanded, setExpanded] = useState(anyActive);

  useEffect(() => {
    if (anyActive) {
      setExpanded(true);
    }
  }, [anyActive]);

  if (stepCount === 0) {
    return null;
  }

  return (
    <div className="my-1 w-full min-w-0 overflow-hidden rounded-xl bg-surface-hover/50 dark:bg-surface-hover/30">
      <button
        type="button"
        className={cn(
          'grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-t-xl px-3 py-2 text-left',
          interaction.transition,
          interaction.press,
          'hover:bg-surface-hover/80 dark:hover:bg-surface-hover/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
        )}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-accent-fg" aria-hidden />
        <div className="min-w-0">
          <span className="inline-flex max-w-full rounded-md bg-accent-soft/70 px-2 py-0.5 text-xs font-medium text-fg dark:bg-accent-soft/40">
            {viewStepsLabel(stepCount, stepLabels)}
          </span>
        </div>
        <ChevronDown
          className={cn('mt-0.5 h-4 w-4 shrink-0 text-fg-muted transition-transform', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="border-t border-edge-subtle/90 px-3 pb-3 pt-2 dark:border-edge-subtle">
          <div className="ml-1 space-y-3 border-l border-edge-subtle pl-3 dark:border-edge-subtle">
            {visibleBlocks.map((b, i) => (
              <StepRow
                key={b.type === 'tool_use' ? b.id : `thinking-${i}`}
                block={b}
                toolLabels={toolLabels}
                stepLabels={stepLabels}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepRow({
  block,
  toolLabels,
  stepLabels,
}: {
  block: ThinkingContent | ToolUseContent;
  toolLabels: { input: string; output: string; noOutput: string };
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
  };
}) {
  if (block.type === 'thinking') {
    const streaming = Boolean(block.streaming);
    const text = block.text?.trim() ?? '';
    if (!text && !streaming) return null;

    return (
      <div className="flex min-w-0 gap-2.5">
        <div className="mt-0.5 shrink-0">
          {streaming ? (
            <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <span className="inline-flex rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-xs font-medium text-fg dark:bg-accent-soft/35">
            {streaming ? stepLabels.thoughtsStreaming : stepLabels.thoughts}
          </span>
          {text ? (
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-muted [overflow-wrap:anywhere]">
              {text}
            </p>
          ) : streaming ? (
            <p className="text-xs text-fg-muted">…</p>
          ) : null}
        </div>
      </div>
    );
  }

  const isStreaming = block.status === 'running';
  const isError = block.status === 'error';
  const resultMsg = !isStreaming ? stringToToolResultMessage(block.result, isError) : undefined;
  const resultText = resultMsg?.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
    .trim();

  let outputPreview = resultText ?? '';
  if (outputPreview) {
    try {
      outputPreview = JSON.stringify(JSON.parse(outputPreview), null, 2);
    } catch {
      /* keep */
    }
  }

  const title = toolStepTitle(block.name, {
    searchedWeb: stepLabels.searchedWeb,
    readFile: stepLabels.readFile,
  });
  const q = extractSearchQuery(block.input);
  const path = extractPathPreview(block.input);
  const detailLine = q || path || '';

  const paramsJson = block.input !== undefined ? formatParamsJson(block.input) : '';

  return (
    <div className="flex min-w-0 gap-2.5">
      <div className="mt-0.5 shrink-0">
        {isStreaming ? (
          <Loader2 className="h-4 w-4 animate-spin text-fg-muted" aria-hidden />
        ) : isError ? (
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="inline-flex max-w-full rounded-md bg-accent-soft/60 px-1.5 py-0.5 text-xs font-medium text-fg dark:bg-accent-soft/35">
            {title}
          </span>
          {isStreaming ? (
            <span className="text-xs text-fg-disabled">running…</span>
          ) : isError ? (
            <span className="text-xs text-red-600 dark:text-red-400">error</span>
          ) : null}
        </div>
        {detailLine ? (
          <p className="rounded-md bg-accent-soft/40 px-1.5 py-1 text-xs text-fg-muted dark:bg-accent-soft/25">
            {detailLine}
          </p>
        ) : null}
        {!isStreaming ? (
          <details className="group min-w-0 text-xs">
            <summary className="cursor-pointer select-none text-fg-subtle underline-offset-2 hover:text-fg-muted group-open:text-fg-muted">
              {stepLabels.stepDetails}
            </summary>
            <div className="mt-2 max-h-48 w-full min-w-0 max-w-full overflow-auto rounded-md bg-surface-hover/60 p-2 font-mono dark:bg-surface-hover/35">
              {paramsJson ? (
                <div className="mb-2">
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-fg-disabled">{toolLabels.input}</div>
                  <pre className="whitespace-pre-wrap break-words text-fg-muted [overflow-wrap:anywhere]">{paramsJson}</pre>
                </div>
              ) : null}
              <div>
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-fg-disabled">{toolLabels.output}</div>
                <pre className="whitespace-pre-wrap break-words text-fg-muted [overflow-wrap:anywhere]">
                  {outputPreview || toolLabels.noOutput}
                </pre>
              </div>
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
