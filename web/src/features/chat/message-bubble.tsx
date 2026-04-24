import { type ReactNode, memo, useCallback, useMemo, useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import { marked } from 'marked';

import type {
  ImageContent,
  Message,
  MessageAttachment,
  MessageContent,
  ProgressState,
  ReasoningLevel,
  ThinkingContent,
  ToolUseContent,
} from '@/features/chat/messages.types';
import { AssistantStepsBlock, collectAssistantStepBlocks } from '@/features/chat/assistant-steps-block';
import { AttachmentPreviewDialog } from '@/features/chat/attachment-preview-dialog';
import { AttachmentRenderer } from '@/features/chat/attachment-renderer';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { SearchSourceList } from '@/features/chat/search-source-list';
import { UserMessageSegments } from '@/features/chat/user-message-segments';
import { UsageBadge } from '@/features/chat/usage-badge';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Build attachment payload for {@link AttachmentPreviewDialog} from an inline content image block. */
function imageContentToPreviewAttachment(block: ImageContent, index: number): MessageAttachment | null {
  const raw = block.source?.data?.trim();
  if (!raw) return null;
  const m = raw.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (m?.[1] && m[2]) {
    const b64 = m[2].replace(/\s/g, '');
    return {
      name: `image-${index + 1}`,
      mimeType: m[1],
      type: 'image',
      content: b64,
      data: b64,
    };
  }
  if (raw.startsWith('data:')) {
    return {
      name: `image-${index + 1}`,
      mimeType: 'image/png',
      type: 'image',
      content: raw,
      data: raw,
    };
  }
  const compact = raw.replace(/\s/g, '');
  return {
    name: `image-${index + 1}`,
    mimeType: 'image/png',
    type: 'image',
    content: compact,
    data: compact,
  };
}

function renderTextOrImageBlock(
  block: MessageContent,
  key: string,
  isUser: boolean,
  imagePreviewLabel: string,
  onImagePreview?: (block: ImageContent, index: number) => void,
  contentIndex?: number,
) {
  if (block.type === 'text') {
    if (isUser) {
      return (
        <div key={key} className="min-w-0 w-full">
          <UserMessageSegments text={block.text} />
        </div>
      );
    }
    return (
      <div key={key} className="markdown-content min-w-0">
        <MarkdownView content={block.text} compact />
      </div>
    );
  }
  if (block.type === 'image' && block.source?.data) {
    const idx = contentIndex ?? 0;
    if (onImagePreview) {
      return (
        <button
          key={key}
          type="button"
          className={cn(
            'inline-block max-w-full rounded-lg p-0 text-left',
            interaction.press,
            interaction.focusRingPanel,
            'cursor-pointer',
          )}
          onClick={() => onImagePreview(block, idx)}
          title={imagePreviewLabel}
          aria-label={imagePreviewLabel}
        >
          <img
            src={block.source.data}
            className="max-h-96 max-w-full rounded-lg align-top"
            alt=""
          />
        </button>
      );
    }
    return (
      <img key={key} src={block.source.data} className="max-h-96 max-w-full rounded-lg" alt="" />
    );
  }
  return null;
}

function renderChunkedContent(
  content: MessageContent[],
  isUser: boolean,
  toolLabels: { input: string; output: string; noOutput: string },
  stepLabels: {
    thoughts: string;
    thoughtsStreaming: string;
    viewSteps_one: string;
    viewSteps_other: string;
    searchedWeb: string;
    readFile: string;
    stepDetails: string;
    stepsRoundComplete: string;
  },
  imagePreviewLabel: string,
  onImagePreview: ((block: ImageContent, index: number) => void) | undefined,
  sessionKey: string | null | undefined,
) {
  const nodes: ReactNode[] = [];
  let i = 0;
  let imageOrdinal = 0;
  while (i < content.length) {
    const b = content[i];
    if (b.type === 'thinking' || b.type === 'tool_use') {
      const start = i;
      while (i < content.length && (content[i].type === 'thinking' || content[i].type === 'tool_use')) {
        i++;
      }
      const slice = content.slice(start, i) as Array<ThinkingContent | ToolUseContent>;
      if (slice.length > 0) {
        nodes.push(
          <AssistantStepsBlock
            key={`steps-${start}`}
            blocks={slice}
            toolLabels={toolLabels}
            stepLabels={stepLabels}
            sessionKey={sessionKey}
          />,
        );
      }
    } else {
      const imgIdx = b.type === 'image' ? imageOrdinal++ : 0;
      const el = renderTextOrImageBlock(
        b,
        `block-${i}`,
        isUser,
        imagePreviewLabel,
        onImagePreview,
        b.type === 'image' ? imgIdx : i,
      );
      if (el) nodes.push(el);
      i++;
    }
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
  sessionKey,
  isStreaming,
  progress,
  reasoningLevel = 'off',
}: {
  message: Message;
  authToken?: string;
  sessionKey?: string | null;
  isStreaming: boolean;
  progress: ProgressState | null;
  reasoningLevel?: ReasoningLevel;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const isUser = message.role === 'user' || message.role === 'user-with-attachments';
  const isAssistant = message.role === 'assistant';
  const roleLabel = isUser ? m.chat.you : isAssistant ? m.chat.assistant : m.chat.tool;

  const toolLabels = useMemo(
    () => ({ input: m.chat.toolInput, output: m.chat.toolOutput, noOutput: m.chat.noOutput }),
    [m.chat.toolInput, m.chat.toolOutput, m.chat.noOutput],
  );
  const stepLabels = useMemo(
    () => ({
      thoughts: m.chat.thoughts,
      thoughtsStreaming: m.chat.thoughtsStreaming,
      viewSteps_one: m.chat.viewSteps_one,
      viewSteps_other: m.chat.viewSteps_other,
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      stepDetails: m.chat.stepDetails,
      stepsRoundComplete: m.chat.stepsRoundComplete,
    }),
    [
      m.chat.thoughts,
      m.chat.thoughtsStreaming,
      m.chat.viewSteps_one,
      m.chat.viewSteps_other,
      m.chat.stepSearchedWeb,
      m.chat.stepReadFile,
      m.chat.stepDetails,
      m.chat.stepsRoundComplete,
    ],
  );

  const reasoningHidden = reasoningLevel === 'off';

  const displayContent = useMemo(() => {
    if (!reasoningHidden) return message.content ?? [];
    return (message.content ?? []).filter((b) => b.type !== 'thinking');
  }, [message.content, reasoningHidden]);

  const progressForMeta =
    reasoningHidden && progress?.stage === 'thinking' ? null : progress;

  const streamingThinking = reasoningHidden
    ? false
    : Boolean(message.content?.some((b) => b.type === 'thinking' && b.streaming));

  const showMeta =
    Boolean(message.timestamp) ||
    Boolean(progressForMeta?.message) ||
    (isStreaming && !streamingThinking);

  const copyMarkdown = useMemo(
    () => (isAssistant ? getAssistantCopyMarkdown(message.content ?? []) : ''),
    [isAssistant, message.content],
  );
  const copyPlainText = useMemo(
    () => (isAssistant && copyMarkdown ? getAssistantCopyPlainText(message.content ?? []) : ''),
    [isAssistant, copyMarkdown, message.content],
  );
  const [copyFeedback, setCopyFeedback] = useState<'plain' | 'markdown' | null>(null);
  const [inlineImagePreview, setInlineImagePreview] = useState<MessageAttachment | null>(null);
  const openInlineImagePreview = useCallback((block: ImageContent, index: number) => {
    const att = imageContentToPreviewAttachment(block, index);
    if (att) {
      setInlineImagePreview(att);
    }
  }, []);
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

  const stepBlocksForSources = useMemo(() => {
    const blocks = collectAssistantStepBlocks(message);
    if (reasoningHidden) return blocks.filter((b) => b.type !== 'thinking');
    return blocks;
  }, [message, reasoningHidden]);

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
            {progressForMeta?.message ? (
              <span className="text-fg-subtle" title={progressForMeta.detail ?? ''}>
                {progressForMeta.message}
              </span>
            ) : null}
            {isStreaming && !streamingThinking && !progressForMeta?.message ? (
              <span className="text-fg-subtle">{m.chat.thinkingLabel}</span>
            ) : null}
          </div>
        ) : null}

        <div
          dir={isUser ? 'ltr' : undefined}
          className={cn(
            'min-w-0 text-sm leading-relaxed text-fg',
            isUser &&
              'rounded-xl bg-accent-soft/55 px-4 py-3 text-left dark:bg-accent-soft/35',
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
            {(displayContent?.length ?? 0) > 0 ? (
              <>
                {renderChunkedContent(
                  displayContent,
                  isUser,
                  toolLabels,
                  stepLabels,
                  m.chat.attachmentPreviewImage,
                  openInlineImagePreview,
                  sessionKey,
                )}
                {isStreaming ? (
                  <span className="inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" />
                ) : null}
              </>
            ) : isStreaming ? (
              <span className="inline-block h-3 w-0.5 animate-pulse bg-accent" />
            ) : null}

            {isAssistant && stepBlocksForSources.length > 0 ? (
              <SearchSourceList blocks={stepBlocksForSources} />
            ) : null}

            {message.attachments?.length ? (
              <AttachmentRenderer
                attachments={message.attachments}
                authToken={authToken}
                sessionKey={sessionKey}
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

      <AttachmentPreviewDialog
        open={inlineImagePreview !== null}
        attachment={inlineImagePreview}
        authToken={authToken}
        sessionKey={sessionKey}
        onClose={() => setInlineImagePreview(null)}
      />
    </article>
  );
});
