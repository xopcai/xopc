import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, FileCode2, FileText, ListTodo, Pencil, RefreshCw, Trash2 } from 'lucide-react';

import type {
  ImageContent,
  Message,
  MessageAttachment,
  ProgressState,
  ReasoningLevel,
} from '@/features/chat/messages/messages.types';
import { collectAssistantStepBlocks } from '@/features/chat/messages/assistant-step-blocks';
import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import { SearchSourceList } from '@/features/chat/tool-results/search-source-list';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { extractUserMessagePlainText } from '@/features/chat/messages/user-message-plain-text';
import { ToolResultFileLinks } from '@/features/chat/tool-results/tool-result-file-links';
import {
  collectAssistantWorkspaceOutputPaths,
  filterAssistantAttachmentsDedupedAgainstWorkspacePaths,
  imageBlockToMessageAttachment,
  imageContentBlocksToAttachments,
} from '@/features/chat/messages/assistant-message-artifacts';
import {
  getAssistantCopyMarkdown,
  getAssistantCopyPlainText,
} from '@/features/chat/messages/assistant-copy-utils';
import { renderChunkedContent } from '@/features/chat/messages/message-content-renderer';
import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { interaction } from '@/lib/interaction';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const messageActionIconButton = cn(
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
  'text-fg-muted transition-colors transition-transform duration-150 ease-out',
  'hover:bg-surface-hover hover:text-fg active:scale-95',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
  interaction.disabled,
);

const userMessageFooterAction = cn(
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs text-fg-muted transition-colors',
  'hover:bg-surface-hover hover:text-fg active:scale-[0.98]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
  interaction.disabled,
);

export const MessageBubble = memo(function MessageBubble({
  message,
  authToken,
  sessionKey,
  isStreaming,
  progress,
  reasoningLevel = 'stream',
  messageIndex,
  onDeleteRound,
  onRetryUserMessageRound,
  userMessageCanRetry = false,
  deleteRoundDisabled = false,
  onAbortCurrentTurn,
  onSendUserMessage,
  onSaveAssistantToSourceNote,
  onExtractAssistantTask,
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
  /** Remove this user turn and send the same text again (only for the latest user message). */
  onRetryUserMessageRound?: (messageIndex: number) => void;
  /** True when this row is the most recent user message in the thread (retry allowed). */
  userMessageCanRetry?: boolean;
  /** When true, omit delete control (e.g. while sending or streaming). */
  deleteRoundDisabled?: boolean;
  /** Cancel the in-flight assistant turn — wires WorkflowCard's cancel button. */
  onAbortCurrentTurn?: () => void;
  /** Send a synthetic user message — wires WorkflowCard's "Save as…" entry. */
  onSendUserMessage?: (text: string) => void;
  /** Append this assistant reply back to the source Note for note-bound chat threads. */
  onSaveAssistantToSourceNote?: (content: string) => Promise<void> | void;
  /** Create a task Note from this assistant reply for note-bound chat threads. */
  onExtractAssistantTask?: (content: string) => Promise<void> | void;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const isUser = message.role === 'user';
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

  const clusterLabels = useMemo(
    () => ({
      done: m.chat.stepsClusterDone,
      ing: m.chat.stepsClusterIng,
      join: {
        join: m.chat.stepsClusterJoin,
        joinFinal: m.chat.stepsClusterJoinFinal,
        moreSuffix: m.chat.stepsClusterMoreSuffix,
      },
    }),
    [
      m.chat.stepsClusterDone,
      m.chat.stepsClusterIng,
      m.chat.stepsClusterJoin,
      m.chat.stepsClusterJoinFinal,
      m.chat.stepsClusterMoreSuffix,
    ],
  );

  const cardLabels = useMemo(() => m.chat.toolCard, [m.chat.toolCard]);

  const reasoningHidden = reasoningLevel === 'off';

  const displayContent = useMemo(() => {
    if (!reasoningHidden) return message.content ?? [];
    return (message.content ?? []).filter((b) => b.type !== 'thinking');
  }, [message.content, reasoningHidden]);

  /** User/assistant images: grid via AttachmentRenderer, not stacked inline blocks in the text column. */
  const displayForFlow = useMemo(() => {
    if (!isUser && !isAssistant) {
      return displayContent;
    }
    return (displayContent ?? []).filter((b) => b.type !== 'image');
  }, [isUser, isAssistant, displayContent]);

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

  const attachmentsForBubble = useMemo(() => {
    if (isAssistant) {
      return filterAssistantAttachmentsDedupedAgainstWorkspacePaths(
        message.attachments,
        assistantWorkspacePaths,
      );
    }
    return message.attachments;
  }, [isAssistant, message.attachments, assistantWorkspacePaths]);

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
    return extractUserMessagePlainText(message.content);
  }, [isUser, message.content]);
  const [copyFeedback, setCopyFeedback] = useState<'plain' | 'markdown' | 'user' | null>(null);
  const [assistantActionFeedback, setAssistantActionFeedback] = useState<'save-note' | 'extract-task' | null>(null);
  const [assistantActionBusy, setAssistantActionBusy] = useState<'save-note' | 'extract-task' | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [inlineImagePreview, setInlineImagePreview] = useState<MessageAttachment | null>(null);
  const [userMessageExpanded, setUserMessageExpanded] = useState(false);
  const [userMessageCanExpand, setUserMessageCanExpand] = useState(false);
  const userMessageContentRef = useRef<HTMLDivElement | null>(null);
  const openInlineImagePreview = useCallback((block: ImageContent, index: number) => {
    const att = imageBlockToMessageAttachment(block, index);
    if (att) {
      setInlineImagePreview(att);
    }
  }, []);
  const handleCopyPlain = useCallback(() => {
    if (!copyPlainText) return;
    void copyTextToClipboard(copyPlainText).then((ok) => {
      if (!ok) return;
      setCopyFeedback('plain');
      window.setTimeout(() => setCopyFeedback((f) => (f === 'plain' ? null : f)), 2000);
    });
  }, [copyPlainText]);
  const handleCopyMd = useCallback(() => {
    if (!copyMarkdown) return;
    void copyTextToClipboard(copyMarkdown).then((ok) => {
      if (!ok) return;
      setCopyFeedback('markdown');
      window.setTimeout(() => setCopyFeedback((f) => (f === 'markdown' ? null : f)), 2000);
    });
  }, [copyMarkdown]);

  const handleSaveAssistantToSourceNote = useCallback(() => {
    if (!copyMarkdown || !onSaveAssistantToSourceNote || assistantActionBusy) return;
    setAssistantActionBusy('save-note');
    void Promise.resolve(onSaveAssistantToSourceNote(copyMarkdown))
      .then(() => {
        setAssistantActionFeedback('save-note');
        window.setTimeout(
          () => setAssistantActionFeedback((f) => (f === 'save-note' ? null : f)),
          2000,
        );
      })
      .finally(() => setAssistantActionBusy(null));
  }, [assistantActionBusy, copyMarkdown, onSaveAssistantToSourceNote]);

  const handleExtractAssistantTask = useCallback(() => {
    if (!copyPlainText && !copyMarkdown) return;
    if (!onExtractAssistantTask || assistantActionBusy) return;
    setAssistantActionBusy('extract-task');
    void Promise.resolve(onExtractAssistantTask(copyPlainText || copyMarkdown))
      .then(() => {
        setAssistantActionFeedback('extract-task');
        window.setTimeout(
          () => setAssistantActionFeedback((f) => (f === 'extract-task' ? null : f)),
          2000,
        );
      })
      .finally(() => setAssistantActionBusy(null));
  }, [assistantActionBusy, copyMarkdown, copyPlainText, onExtractAssistantTask]);

  const handleCopyUserMessage = useCallback(() => {
    if (!userCopyText) return;
    void copyTextToClipboard(userCopyText).then((ok) => {
      if (!ok) return;
      setCopyFeedback('user');
      window.setTimeout(() => setCopyFeedback((f) => (f === 'user' ? null : f)), 2000);
    });
  }, [userCopyText]);

  const openDeleteConfirm = useCallback(() => {
    if (messageIndex == null || !onDeleteRound) return;
    setDeleteConfirmOpen(true);
  }, [messageIndex, onDeleteRound]);

  const confirmDeleteRound = useCallback(() => {
    if (messageIndex == null || !onDeleteRound) return;
    onDeleteRound(messageIndex);
    setDeleteConfirmOpen(false);
  }, [messageIndex, onDeleteRound]);

  const cancelDeleteRound = useCallback(() => {
    setDeleteConfirmOpen(false);
  }, []);

  const stepBlocksForSources = useMemo(() => {
    const blocks = collectAssistantStepBlocks(message);
    if (reasoningHidden) return blocks.filter((b) => b.type !== 'thinking');
    return blocks;
  }, [message, reasoningHidden]);

  useLayoutEffect(() => {
    if (!isUser) return;
    const el = userMessageContentRef.current;
    if (!el) return;

    const measure = () => {
      const style = window.getComputedStyle(el);
      const lineHeightRaw = Number.parseFloat(style.lineHeight);
      const fontSize = Number.parseFloat(style.fontSize) || 14;
      const lineHeight = Number.isFinite(lineHeightRaw) ? lineHeightRaw : fontSize * 1.625;
      setUserMessageCanExpand(el.scrollHeight > lineHeight * 10 + 1);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [isUser, displayForFlow, userCopyText]);

  useLayoutEffect(() => {
    setUserMessageExpanded(false);
  }, [isUser, userCopyText]);

  const retryDisabled = deleteRoundDisabled || !userMessageCanRetry;

  return (
    <article className={cn('group/msg flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[min(85%,var(--max-width-chat))]',
          isUser ? 'flex w-full flex-col items-end' : 'w-full',
        )}
      >
        <span className="sr-only">{roleLabel}</span>

        {isUser && showMeta ? (
          <div className="mb-2 flex w-full min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-xs">
            {message.timestamp ? (
              <time
                suppressHydrationWarning
                className="shrink-0 tabular-nums text-fg-disabled"
                dateTime={new Date(message.timestamp).toISOString()}
              >
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

        {!isUser && showMeta ? (
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-fg-disabled">
            {message.timestamp ? (
              <time
                suppressHydrationWarning
                className="tabular-nums"
                dateTime={new Date(message.timestamp).toISOString()}
              >
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
              'w-fit max-w-full rounded-xl border border-edge-subtle/70 bg-surface-hover/90 px-4 py-3 text-left shadow-sm dark:border-edge-subtle dark:bg-surface-hover/50',
          )}
        >
          <div className="flex min-w-0 flex-col gap-2">
            {(displayForFlow?.length ?? 0) > 0 ? (
              <>
                <div
                  ref={isUser ? userMessageContentRef : undefined}
                  className={cn(
                    'min-w-0',
                    isUser && 'flex flex-col gap-2',
                    isUser && !userMessageExpanded && 'overflow-hidden',
                  )}
                  style={isUser && !userMessageExpanded ? { maxHeight: 'calc(10lh)' } : undefined}
                >
                  {renderChunkedContent(
                    displayForFlow,
                    isUser,
                    isAssistant && isStreaming,
                    toolLabels,
                    stepLabels,
                    clusterLabels,
                    cardLabels,
                    m.chat.attachmentPreviewImage,
                    openInlineImagePreview,
                    sessionKey,
                    {
                      labels: workflowCardLabels(language),
                      // Only the streaming row owns the abort handler — for
                      // completed/historical rows it would point at an unrelated
                      // turn, so we leave it undefined and the cancel button
                      // stays hidden.
                      onAbort: isAssistant && isStreaming ? onAbortCurrentTurn : undefined,
                      onSendChatMessage: onSendUserMessage,
                    },
                  )}
                </div>
                {isUser && userMessageCanExpand ? (
                  <button
                    type="button"
                    className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    onClick={() => setUserMessageExpanded((expanded) => !expanded)}
                    aria-expanded={userMessageExpanded}
                  >
                    {userMessageExpanded ? (
                      <ChevronUp className="size-3.5" strokeWidth={1.75} aria-hidden />
                    ) : (
                      <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
                    )}
                    <span>{userMessageExpanded ? m.chat.userMessageCollapse : m.chat.userMessageExpand}</span>
                  </button>
                ) : null}
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

            {attachmentsForBubble?.length ? (
              isUser ? (
                <AttachmentRenderer
                  attachments={attachmentsForBubble}
                  authToken={authToken}
                  sessionKey={sessionKey}
                  layout="user"
                  centerUserVoiceRow={userCopyText.length === 0}
                />
              ) : (
                <AttachmentRenderer
                  attachments={attachmentsForBubble}
                  authToken={authToken}
                  sessionKey={sessionKey}
                  layout="assistant"
                />
              )
            ) : null}
          </div>
        </div>

        {isUser && !isStreaming ? (
          <div className="mt-1.5 flex h-8 w-full min-w-0 shrink-0 justify-end">
            <div
              className={cn(
                'flex h-full max-w-full items-center justify-end gap-0.5 sm:gap-2',
                'pointer-events-none opacity-0 transition-opacity duration-150 ease-out',
                'group-hover/msg:pointer-events-auto group-hover/msg:opacity-100',
                'group-focus-within/msg:pointer-events-auto group-focus-within/msg:opacity-100',
                '[@media(hover:none)_and_(pointer:coarse)]:pointer-events-auto [@media(hover:none)_and_(pointer:coarse)]:opacity-100',
              )}
            >
              {onRetryUserMessageRound && messageIndex != null ? (
                <button
                  type="button"
                  className={cn(userMessageFooterAction, retryDisabled && 'opacity-40')}
                  onClick={() => onRetryUserMessageRound(messageIndex)}
                  disabled={retryDisabled}
                  title={
                    deleteRoundDisabled
                      ? m.chat.userMessageActionsWait
                      : !userMessageCanRetry
                        ? m.chat.userMessageRetryDisabledHint
                        : m.chat.userMessageRetry
                  }
                  aria-label={m.chat.userMessageRetry}
                >
                  <RefreshCw className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="max-w-[4.5rem] truncate sm:max-w-none">{m.chat.userMessageRetry}</span>
                </button>
              ) : null}
              <button
                type="button"
                className={cn(userMessageFooterAction, 'size-8 px-0')}
                onClick={() => dispatchFillChatComposer(userCopyText)}
                disabled={!userCopyText}
                title={m.chat.userMessageEdit}
                aria-label={m.chat.userMessageEdit}
              >
                <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
              <button
                type="button"
                className={cn(userMessageFooterAction, 'size-8 px-0')}
                onClick={handleCopyUserMessage}
                disabled={!userCopyText}
                title={copyFeedback === 'user' ? m.chat.messageCopied : m.chat.userMessageCopy}
                aria-label={copyFeedback === 'user' ? m.chat.messageCopied : m.chat.userMessageCopy}
              >
                {copyFeedback === 'user' ? (
                  <Check className="size-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
                ) : (
                  <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
                )}
              </button>
              {onDeleteRound && messageIndex != null && !deleteRoundDisabled ? (
                <button
                  type="button"
                  className={cn(userMessageFooterAction, 'size-8 px-0 hover:text-red-500 dark:hover:text-red-400')}
                  onClick={openDeleteConfirm}
                  title={m.chat.userMessageDelete}
                  aria-label={m.chat.userMessageDelete}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {isAssistant && copyMarkdown ? (
          <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 overflow-visible">
            <button
              type="button"
              className={messageActionIconButton}
              onClick={handleCopyPlain}
              disabled={!copyPlainText}
              title={copyFeedback === 'plain' ? m.chat.messageCopied : m.chat.messageCopyPlainText}
              aria-label={copyFeedback === 'plain' ? m.chat.messageCopied : m.chat.messageCopyPlainText}
            >
              {copyFeedback === 'plain' ? (
                <Check className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              ) : (
                <Copy className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
            <button
              type="button"
              className={messageActionIconButton}
              onClick={handleCopyMd}
              title={copyFeedback === 'markdown' ? m.chat.messageCopied : m.chat.messageCopyMarkdown}
              aria-label={copyFeedback === 'markdown' ? m.chat.messageCopied : m.chat.messageCopyMarkdown}
            >
              {copyFeedback === 'markdown' ? (
                <Check className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
              ) : (
                <FileCode2 className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
            {onSaveAssistantToSourceNote ? (
              <button
                type="button"
                className={messageActionIconButton}
                onClick={handleSaveAssistantToSourceNote}
                disabled={!copyMarkdown || assistantActionBusy !== null}
                title={assistantActionFeedback === 'save-note' ? m.chat.messageSavedToNote : m.chat.messageSaveToNote}
                aria-label={assistantActionFeedback === 'save-note' ? m.chat.messageSavedToNote : m.chat.messageSaveToNote}
              >
                {assistantActionFeedback === 'save-note' ? (
                  <Check className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
                ) : (
                  <FileText className="size-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            ) : null}
            {onExtractAssistantTask ? (
              <button
                type="button"
                className={messageActionIconButton}
                onClick={handleExtractAssistantTask}
                disabled={(!copyPlainText && !copyMarkdown) || assistantActionBusy !== null}
                title={assistantActionFeedback === 'extract-task' ? m.chat.messageTaskExtracted : m.chat.messageExtractTask}
                aria-label={assistantActionFeedback === 'extract-task' ? m.chat.messageTaskExtracted : m.chat.messageExtractTask}
              >
                {assistantActionFeedback === 'extract-task' ? (
                  <Check className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
                ) : (
                  <ListTodo className="size-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            ) : null}
          </div>
        ) : null}

      </div>

      {isUser && onDeleteRound && messageIndex != null ? (
        <ConfirmDialog
          open={deleteConfirmOpen}
          title={m.chat.userMessageDeleteConfirmTitle}
          description={m.chat.userMessageDeleteConfirm}
          confirmLabel={m.chat.userMessageDeleteOk}
          cancelLabel={m.chat.userMessageDeleteCancel}
          destructive
          onConfirm={confirmDeleteRound}
          onCancel={cancelDeleteRound}
        />
      ) : null}

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
