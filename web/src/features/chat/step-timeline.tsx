import { CheckCircle2, Loader2 } from 'lucide-react';

import type { ThinkingContent, ToolUseContent } from '@/features/chat/messages.types';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

interface StepTimelineProps {
  blocks: Array<ThinkingContent | ToolUseContent>;
}

export function StepTimeline({ blocks }: StepTimelineProps) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const visibleBlocks = blocks.filter(
    (b) => b.type !== 'thinking' || Boolean(b.text?.trim()) || Boolean(b.streaming),
  );

  if (visibleBlocks.length === 0) return null;

  return (
    <div className="space-y-4">
      {visibleBlocks.map((block, index) => (
        <StepTimelineRow
          key={block.type === 'tool_use' ? block.id : `thinking-${index}`}
          block={block}
          labels={m.chat}
        />
      ))}
    </div>
  );
}

function StepTimelineRow({
  block,
  labels,
}: {
  block: ThinkingContent | ToolUseContent;
  labels: {
    stepTimelineThinkingStreaming: string;
    stepTimelineThinkingDone: string;
    stepTimelineToolSearchRunning: string;
    stepTimelineToolSearchComplete: string;
    stepTimelineToolSearchError: string;
    stepTimelineToolGenericRunning: string;
    stepTimelineToolGenericComplete: string;
    stepTimelineToolGenericError: string;
  };
}) {
  if (block.type === 'thinking') {
    const isStreaming = Boolean(block.streaming);
    const text = block.text?.trim() ?? '';
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;

    return (
      <div className="flex gap-3">
        <div className="mt-0.5 shrink-0">
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent-fg" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium text-fg', isStreaming && 'animate-pulse')}>
            {isStreaming ? labels.stepTimelineThinkingStreaming : labels.stepTimelineThinkingDone}
          </p>
          {preview ? (
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{preview}</p>
          ) : null}
        </div>
      </div>
    );
  }

  const isRunning = block.status === 'running';
  const isError = block.status === 'error';
  const isSearch = block.name.toLowerCase().includes('search');

  let statusLine: string;
  if (isSearch) {
    if (isRunning) statusLine = labels.stepTimelineToolSearchRunning;
    else if (isError) statusLine = labels.stepTimelineToolSearchError;
    else statusLine = labels.stepTimelineToolSearchComplete;
  } else if (isRunning) {
    statusLine = labels.stepTimelineToolGenericRunning.replace('{{name}}', block.name);
  } else if (isError) {
    statusLine = labels.stepTimelineToolGenericError.replace('{{name}}', block.name);
  } else {
    statusLine = labels.stepTimelineToolGenericComplete.replace('{{name}}', block.name);
  }

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        {isRunning ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent-fg" />
        ) : isError ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
            !
          </span>
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{statusLine}</p>
        {!isSearch ? <p className="mt-0.5 text-xs text-fg-muted">{block.name}</p> : null}
      </div>
    </div>
  );
}
