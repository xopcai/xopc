import { type ReactNode, memo, useCallback, useMemo, useState } from 'react';
import { Check, ChevronRight, Copy, FileCode2 } from 'lucide-react';
import { marked } from 'marked';

import type { Message, MessageContent, ProgressState } from '@/features/chat/messages.types';
import {
  collectAssistantStepBlocks,
  describeCurrentExecutionStep,
  stepBlocksActive,
} from '@/features/chat/assistant-steps-block';
import { formatExecutionElapsedMs } from '@/features/chat/format-execution-elapsed';
import { useExecutionElapsedMs } from '@/features/chat/use-execution-elapsed-ms';
import { AttachmentRenderer } from '@/features/chat/attachment-renderer';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { UsageBadge } from '@/features/chat/usage-badge';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useChatExecutionDrawerStore } from '@/stores/chat-execution-drawer-store';
import { useLocaleStore } from '@/stores/locale-store';

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderTextOrImageBlock(block: MessageContent, key: string) {
  if (block.type === 'text') {
    return (
      <div key={key} className="markdown-content min-w-0">
        <MarkdownView content={block.text} compact />
      </div>
    );
  }
  if (block.type === 'image' && block.source?.data) {
    return (
      <img key={key} src={block.source.data} className="max-h-96 max-w-full rounded-lg" alt="" />
    );
  }
  return null;
}

/** Renders only user-visible assistant content (text / image); thinking & tools live in the side drawer. */
function renderVisibleContent(content: MessageContent[]) {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < content.length) {
    const b = content[i];
    if (b.type === 'thinking' || b.type === 'tool_use') {
      i++;
      continue;
    }
    const el = renderTextOrImageBlock(b, `block-${i}`);
    if (el) nodes.push(el);
    i++;
  }
  return nodes;
}

/** Markdown source for clipboard: visible text blocks + `[image]` placeholders; skips thinking/tools. */
function getAssistantCopyMarkdown(content: MessageContent[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'thinking' || b.type === 'tool_use') continue;
    if (b.type === 'text') {
      parts.push(b.text);
    } else if (b.type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n\n').trim();
}

function markdownToPlainText(md: string): string {
  if (!md.trim()) return '';
  const html = marked.parse(md, { gfm: true, breaks: false }) as string;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return doc.body.textContent?.trim() ?? '';
}

/** Plain text for clipboard: rendered text per block + `[image]` placeholders. */
function getAssistantCopyPlainText(content: MessageContent[]): string {
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'thinking' || b.type === 'tool_use') continue;
    if (b.type === 'text') {
      parts.push(markdownToPlainText(b.text));
    } else if (b.type === 'image') {
      parts.push('[image]');
    }
  }
  return parts.join('\n\n').trim();
}

/** Toolbar icon buttons: non-shrinking hit targets; inset focus ring so parent overflow-x-hidden does not clip. */
const messageActionIconButton = cn(
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
  'text-fg-muted transition-colors transition-transform duration-150 ease-out',
  'hover:bg-surface-hover hover:text-fg active:scale-95',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
  interaction.disabled,
);

export const MessageBubble = memo(function MessageBubble({
  message,
  authToken,
  isStreaming,
  progress,
  messageIndex,
}: {
  message: Message;
  authToken?: string;
  /** True only for the assistant row currently receiving the SSE stream (progress + live steps). */
  isStreaming: boolean;
  progress: ProgressState | null;
  messageIndex: number;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const isUser = message.role === 'user' || message.role === 'user-with-attachments';
  const isAssistant = message.role === 'assistant';
  const roleLabel = isUser ? m.chat.you : isAssistant ? m.chat.assistant : m.chat.tool;

  const stepBlocks = useMemo(() => collectAssistantStepBlocks(message), [message]);
  const hasSteps = stepBlocks.length > 0;
  const stepsRunning = stepBlocksActive(stepBlocks);
  const executionElapsedMs = useExecutionElapsedMs(stepsRunning);

  const executionStepLabels = useMemo(
    () => ({
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      thoughtsStreaming: m.chat.thoughtsStreaming,
      composerRunningTool: m.chat.composerRunningTool,
      composerStageThinking: m.chat.composerStageThinking,
      composerStageSearching: m.chat.composerStageSearching,
      composerStageReading: m.chat.composerStageReading,
      composerStageWriting: m.chat.composerStageWriting,
      composerStageExecuting: m.chat.composerStageExecuting,
      composerStageAnalyzing: m.chat.composerStageAnalyzing,
      fallback: m.chat.executionProgressRunning,
    }),
    [
      m.chat.stepSearchedWeb,
      m.chat.stepReadFile,
      m.chat.thoughtsStreaming,
      m.chat.composerRunningTool,
      m.chat.composerStageThinking,
      m.chat.composerStageSearching,
      m.chat.composerStageReading,
      m.chat.composerStageWriting,
      m.chat.composerStageExecuting,
      m.chat.composerStageAnalyzing,
      m.chat.executionProgressRunning,
    ],
  );

  const runningProgressText = useMemo(() => {
    if (!stepsRunning) return '';
    return describeCurrentExecutionStep(
      stepBlocks,
      isStreaming ? progress : null,
      isStreaming,
      executionStepLabels,
    );
  }, [stepsRunning, stepBlocks, isStreaming, progress, executionStepLabels]);

  const drawerOpenForThis = useChatExecutionDrawerStore(
    (s) => s.open && s.focusedMessageIndex === messageIndex,
  );
  const toggleExecutionDrawer = useChatExecutionDrawerStore((s) => s.toggleForMessage);

  const copyMarkdown = useMemo(
    () => (isAssistant ? getAssistantCopyMarkdown(message.content ?? []) : ''),
    [isAssistant, message.content],
  );
  const copyPlainText = useMemo(
    () => (isAssistant && copyMarkdown ? getAssistantCopyPlainText(message.content ?? []) : ''),
    [isAssistant, copyMarkdown, message.content],
  );
  const [copyFeedback, setCopyFeedback] = useState<'plain' | 'markdown' | null>(null);
  const handleCopyPlain = useCallback(async () => {
    if (!copyPlainText) return;
    try {
      await navigator.clipboard.writeText(copyPlainText);
      setCopyFeedback('plain');
      window.setTimeout(() => setCopyFeedback((f) => (f === 'plain' ? null : f)), 2000);
    } catch {
      /* clipboard denied or unavailable */
    }
  }, [copyPlainText]);
  const handleCopyMd = useCallback(async () => {
    if (!copyMarkdown) return;
    try {
      await navigator.clipboard.writeText(copyMarkdown);
      setCopyFeedback('markdown');
      window.setTimeout(() => setCopyFeedback((f) => (f === 'markdown' ? null : f)), 2000);
    } catch {
      /* clipboard denied or unavailable */
    }
  }, [copyMarkdown]);

  const streamingThinking =
    message.thinkingStreaming ||
    message.content?.some((b) => b.type === 'thinking' && b.streaming);

  /** Assistant: never show gateway progress / "thinking…" in the meta row — use the execution line + drawer only. */
  const showMeta =
    Boolean(message.timestamp) ||
    (!isAssistant && Boolean(progress?.message)) ||
    (!isAssistant && isStreaming && !streamingThinking);

  const elapsedText =
    stepsRunning && executionElapsedMs >= 0
      ? formatExecutionElapsedMs(executionElapsedMs, language)
      : '';

  const progressLine =
    isAssistant && hasSteps ? (
      <button
        type="button"
        onClick={() => toggleExecutionDrawer(messageIndex)}
        className={cn(
          'mb-2 flex w-full max-w-full items-center gap-2 text-left text-sm text-fg-subtle',
          interaction.transition,
          interaction.press,
          'hover:text-fg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
          drawerOpenForThis && 'text-accent-fg',
        )}
        aria-expanded={drawerOpenForThis}
        aria-controls="chat-execution-drawer"
      >
        <span className="min-w-0 flex-1 truncate">
          {stepsRunning ? runningProgressText : m.chat.executionProgressDone}
        </span>
        {stepsRunning && elapsedText ? (
          <span className="shrink-0 tabular-nums text-xs text-fg-disabled" title={m.chat.executionElapsedTitle}>
            {elapsedText}
          </span>
        ) : null}
        <ChevronRight
          className={cn('h-4 w-4 shrink-0 transition-transform', drawerOpenForThis && 'rotate-90')}
          aria-hidden
        />
      </button>
    ) : null;

  return (
    <article className={cn('flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[min(85%,var(--max-width-chat))]',
          isUser ? 'w-max' : 'w-full',
        )}
      >
        <span className="sr-only">{roleLabel}</span>

        {showMeta ? (
          <div
            className={cn(
              'mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-fg-disabled',
              isUser && 'justify-end',
            )}
          >
            {message.timestamp ? (
              <time className="tabular-nums" dateTime={new Date(message.timestamp).toISOString()}>
                {formatTime(message.timestamp)}
              </time>
            ) : null}
            {!isAssistant && progress?.message ? (
              <span className="text-fg-subtle" title={progress.detail ?? ''}>
                {progress.message}
              </span>
            ) : null}
            {!isAssistant && isStreaming && !streamingThinking ? (
              <span className="text-fg-subtle">{m.chat.thinkingLabel}</span>
            ) : null}
          </div>
        ) : null}

        {progressLine}

        <div
          className={cn(
            'min-w-0 text-sm leading-relaxed text-fg',
            isUser &&
              'rounded-xl bg-accent-soft/55 px-4 py-3 text-right dark:bg-accent-soft/35',
            isUser && message.attachments?.length
              ? 'min-w-[min(16rem,90vw)] max-w-[min(85%,var(--max-width-chat))]'
              : '',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-col gap-2',
              isUser && message.attachments?.length ? 'items-end' : '',
            )}
          >
            {message.content?.length ? (
              <>
                {renderVisibleContent(message.content)}
                {isStreaming ? (
                  <span className="inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" />
                ) : null}
              </>
            ) : isStreaming ? (
              <span className="inline-block h-3 w-0.5 animate-pulse bg-accent" />
            ) : null}

            {message.attachments?.length ? (
              <AttachmentRenderer
                attachments={message.attachments}
                authToken={authToken}
                layout={isUser ? 'user' : 'assistant'}
              />
            ) : null}
          </div>
        </div>

        {isAssistant && copyMarkdown ? (
          <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 overflow-visible">
            <button
              type="button"
              className={messageActionIconButton}
              onClick={() => void handleCopyPlain()}
              disabled={!copyPlainText}
              title={copyFeedback === 'plain' ? m.chat.messageCopied : m.chat.messageCopyPlainText}
              aria-label={copyFeedback === 'plain' ? m.chat.messageCopied : m.chat.messageCopyPlainText}
            >
              {copyFeedback === 'plain' ? (
                <Check className="h-4 w-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
            <button
              type="button"
              className={messageActionIconButton}
              onClick={() => void handleCopyMd()}
              title={copyFeedback === 'markdown' ? m.chat.messageCopied : m.chat.messageCopyMarkdown}
              aria-label={copyFeedback === 'markdown' ? m.chat.messageCopied : m.chat.messageCopyMarkdown}
            >
              {copyFeedback === 'markdown' ? (
                <Check className="h-4 w-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              ) : (
                <FileCode2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          </div>
        ) : null}

        {isAssistant && message.usage ? (
          <div className="mt-3">
            <UsageBadge usage={message.usage} />
          </div>
        ) : null}
      </div>
    </article>
  );
});
