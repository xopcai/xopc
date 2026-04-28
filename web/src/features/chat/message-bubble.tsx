import { type ReactNode, memo, useCallback, useMemo, useState } from 'react';
import { Check, Copy, FileCode2, Trash2 } from 'lucide-react';
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
import { ToolResultFileLinks } from '@/features/chat/tool-result-file-links';
import {
  collectAssistantWorkspaceOutputPaths,
  imageBlockToMessageAttachment,
  imageContentBlocksToAttachments,
} from '@/features/chat/assistant-message-artifacts';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function stripEnvelopeTimestampPrefix(text: string): string {
  // xopc envelope timestamp: `[YYYY-MM-DD HH:MM ...] ` (kept for model context, hidden in UI)
  return text.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\]\s+/, '');
}

/** User bubble: inline image opens {@link AttachmentPreviewDialog} (shared `file-preview` UI). */
function imageContentToPreviewAttachment(block: ImageContent, index: number): MessageAttachment | null {
  return imageBlockToMessageAttachment(block, index);
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
      const displayText = stripEnvelopeTimestampPrefix(block.text ?? '');
      return (
        <div key={key} className="min-w-0 w-full">
          <UserMessageSegments text={displayText} />
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
    runCommand: string;
    listDirectory: string;
    writeFile: string;
    editFile: string;
    openUrl: string;
    fetchUrl: string;
    unknownTool: string;
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
  messageIndex,
  onDeleteRound,
  deleteRoundDisabled = false,
}: {
  message: Message;
  authToken?: string;
  sessionKey?: string | null;
  isStreaming: boolean;
  progress: ProgressState | null;
  reasoningLevel?: ReasoningLevel;
  /** Index of this message in the messages array (needed for delete). */
  messageIndex?: number;
  /** Delete this user message and the following assistant response. */
  onDeleteRound?: (messageIndex: number) => void;
  /** When true, omit delete control (e.g. while sending or streaming). */
  deleteRoundDisabled?: boolean;
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
      runCommand: m.chat.stepRunCommand,
      listDirectory: m.chat.stepListDirectory,
      writeFile: m.chat.stepWriteFile,
      editFile: m.chat.stepEditFile,
      openUrl: m.chat.stepOpenUrl,
      fetchUrl: m.chat.stepFetchUrl,
      unknownTool: m.chat.stepUnknownTool,
    }),
    [
      m.chat.thoughts,
      m.chat.thoughtsStreaming,
      m.chat.viewSteps_one,
      m.chat.viewSteps_other,
      m.chat.stepSearchedWeb,
      m.chat.stepReadFile,
      m.chat.stepDetails,
      m.chat.stepRunCommand,
      m.chat.stepListDirectory,
      m.chat.stepWriteFile,
      m.chat.stepEditFile,
      m.chat.stepOpenUrl,
      m.chat.stepFetchUrl,
      m.chat.stepUnknownTool,
    ],
  );

  const reasoningHidden = reasoningLevel === 'off';

  const displayContent = useMemo(() => {
    if (!reasoningHidden) return message.content ?? [];
    return (message.content ?? []).filter((b) => b.type !== 'thinking');
  }, [message.content, reasoningHidden]);

  /** Assistant model images: show in the “Message output” strip below, not in the main column. */
  const displayForFlow = useMemo(() => {
    if (!isAssistant) {
      return displayContent;
    }
    return (displayContent ?? []).filter((b) => b.type !== 'image');
  }, [isAssistant, displayContent]);

  const assistantWorkspacePaths = useMemo(
    () => (isAssistant ? collectAssistantWorkspaceOutputPaths(message.content) : []),
    [isAssistant, message.content],
  );

  const assistantImageBlocks = useMemo(
    () =>
      isAssistant
        ? (message.content ?? []).filter((b): b is ImageContent => b.type === 'image' && Boolean(b.source?.data))
        : [],
    [isAssistant, message.content],
  );

  const assistantImageAttachments = useMemo(
    () => (isAssistant ? imageContentBlocksToAttachments(assistantImageBlocks) : []),
    [isAssistant, assistantImageBlocks],
  );

  const showAssistantArtifacts =
    isAssistant &&
    (assistantWorkspacePaths.length > 0 || assistantImageAttachments.length > 0);

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
  const userCopyText = useMemo(() => {
    if (!isUser) return '';
    return (message.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && Boolean(b.text))
      .map((b) => stripEnvelopeTimestampPrefix(b.text))
      .join('\n\n')
      .trim();
  }, [isUser, message.content]);
  const [copyFeedback, setCopyFeedback] = useState<'plain' | 'markdown' | 'user' | null>(null);
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

  const handleCopyUserMessage = useCallback(async () => {
    if (!userCopyText) return;
    try {
      await navigator.clipboard.writeText(userCopyText);
      setCopyFeedback('user');
      window.setTimeout(() => setCopyFeedback((f) => (f === 'user' ? null : f)), 2000);
    } catch {
      /* clipboard denied or unavailable */
    }
  }, [userCopyText]);

  const handleDeleteRound = useCallback(() => {
    if (messageIndex == null || !onDeleteRound) return;
    const confirmed = window.confirm(m.chat.userMessageDeleteConfirm);
    if (confirmed) {
      onDeleteRound(messageIndex);
    }
  }, [messageIndex, onDeleteRound, m.chat.userMessageDeleteConfirm]);

  const stepBlocksForSources = useMemo(() => {
    const blocks = collectAssistantStepBlocks(message);
    if (reasoningHidden) return blocks.filter((b) => b.type !== 'thinking');
    return blocks;
  }, [message, reasoningHidden]);

  return (
    <article className={cn('group/msg flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      {isUser && !isStreaming ? (
        <div className="mr-1.5 flex shrink-0 items-center gap-0.5 self-start pt-1 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100">
          <button
            type="button"
            className={messageActionIconButton}
            onClick={() => void handleCopyUserMessage()}
            disabled={!userCopyText}
            title={copyFeedback === 'user' ? m.chat.messageCopied : m.chat.userMessageCopy}
            aria-label={copyFeedback === 'user' ? m.chat.messageCopied : m.chat.userMessageCopy}
          >
            {copyFeedback === 'user' ? (
              <Check className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            )}
          </button>
          {onDeleteRound && messageIndex != null && !deleteRoundDisabled ? (
            <button
              type="button"
              className={cn(messageActionIconButton, 'hover:text-red-500')}
              onClick={handleDeleteRound}
              title={m.chat.userMessageDelete}
              aria-label={m.chat.userMessageDelete}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

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
              'w-fit max-w-[min(85%,var(--max-width-chat))] rounded-xl bg-accent-soft/55 px-4 py-3 text-left dark:bg-accent-soft/35',
          )}
        >
          <div className="flex min-w-0 flex-col gap-2">
            {(displayForFlow?.length ?? 0) > 0 ? (
              <>
                {renderChunkedContent(
                  displayForFlow,
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

            {showAssistantArtifacts ? (
              <div
                className="rounded-lg border border-edge-subtle/60 bg-surface-elevated/20 px-3 py-2.5"
                role="group"
                aria-label={m.chat.messageArtifactsHeading}
              >
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                  {m.chat.messageArtifactsHeading}
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  {assistantWorkspacePaths.length > 0 ? (
                    <ToolResultFileLinks paths={assistantWorkspacePaths} sessionKey={sessionKey} />
                  ) : null}
                  {assistantImageAttachments.length > 0 ? (
                    <AttachmentRenderer
                      attachments={assistantImageAttachments}
                      authToken={authToken}
                      sessionKey={sessionKey}
                      layout="assistant"
                    />
                  ) : null}
                </div>
              </div>
            ) : null}

            {message.attachments?.length ? (
              isUser ? (
                <AttachmentRenderer
                  attachments={message.attachments}
                  authToken={authToken}
                  sessionKey={sessionKey}
                  layout="user"
                  centerUserVoiceRow={userCopyText.length === 0}
                />
              ) : (
                <AttachmentRenderer
                  attachments={message.attachments}
                  authToken={authToken}
                  sessionKey={sessionKey}
                  layout="assistant"
                />
              )
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
