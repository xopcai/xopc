import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, ChevronUp, CircleHelp, Copy, FileCode2, FilePlus2, FileText, GitFork, ListTodo, MoreHorizontal, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import type {
  ImageContent,
  Message,
  MessageAttachment,
  ProgressState,
  ReasoningLevel,
} from '@/features/chat/messages/messages.types';
import { AttachmentPreviewDialog } from '@/features/chat/attachments/attachment-preview-dialog';
import { AttachmentRenderer } from '@/features/chat/attachments/attachment-renderer';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import {
  extractUserMessagePlainText,
  messageAttachmentsToWire,
} from '@/features/chat/messages/user-message-plain-text';
import { imageBlockToMessageAttachment } from '@/features/chat/messages/assistant-message-images';
import {
  getAssistantCopyMarkdown,
  getAssistantCopyPlainText,
} from '@/features/chat/messages/assistant-copy-utils';
import { ChunkedContent } from '@/features/chat/messages/message-content-renderer';
import { formatChatMessageTime } from '@/features/chat/messages/message-time';
import { workflowCardLabels } from '@/features/chat/workflow/workflow-card-labels';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { fetchJson } from '@/lib/fetch';
import { interaction } from '@/lib/interaction';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { ReadAloudButton } from '@/features/voice/read-aloud-button';
import { buildSpeakableText, detectSpeechLanguage } from '@/features/voice/read-aloud-text';
import { buildAssistantTurnViewModel } from '@/features/chat/messages/assistant-turn-view-model';
import { useChatSessionStore } from '@/features/chat/session/chat-session-store';
import {
  AssistantAttachmentList,
  AssistantTurnTasks,
} from '@/features/chat/messages/assistant-turn-tasks';
import { MessageNoteAttachments } from '@/features/chat/messages/message-note-attachments';
import { withDetailReturnTo } from '@/lib/navigation-return';

const messageActionIconButton = cn(
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
  'text-fg-muted transition-colors transition-transform duration-150 ease-out',
  'hover:bg-surface-hover hover:text-fg active:scale-95',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
  interaction.disabled,
);

const RESPONSE_FEEDBACK_REASONS = [
  'misunderstood_intent',
  'incorrect',
  'did_not_act',
  'tone_mismatch',
  'too_verbose',
  'other',
] as const;

type ResponseFeedbackReason = (typeof RESPONSE_FEEDBACK_REASONS)[number];

type ResponsePersonalContext = {
  id: string;
  statement: string;
  origin: 'told_by_user' | 'observed' | 'inferred' | 'connected_source';
  sourceName: string;
};

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
  projectId,
  isStreaming,
  progress,
  reasoningLevel = 'on',
  messageIndex,
  onDeleteRound,
  onRetryUserMessageRound,
  userMessageCanRetry = false,
  deleteRoundDisabled = false,
  onSaveAssistantAsNote,
  onSaveAssistantToSourceNote,
  onExtractAssistantTask,
  onForkAssistantTurn,
  readonly = false,
  density = 'normal',
  suppressAssistantActions = false,
  onEditUserMessage,
  userMessageCanEdit = true,
  responseFeedbackEnabled = true,
}: {
  message: Message;
  authToken?: string;
  sessionKey?: string | null;
  projectId?: string | null;
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
  /** Create a new Note from this assistant reply. */
  onSaveAssistantAsNote?: (content: string) => Promise<void> | void;
  /** Append this assistant reply back to the source Note for note-bound chat threads. */
  onSaveAssistantToSourceNote?: (content: string) => Promise<void> | void;
  /** Create a task Note from this assistant reply for note-bound chat threads. */
  onExtractAssistantTask?: (content: string) => Promise<void> | void;
  /** Create a new conversation containing history through this assistant turn. */
  onForkAssistantTurn?: (turnId: string) => Promise<void> | void;
  readonly?: boolean;
  density?: 'normal' | 'compact';
  /** Hide assistant footer actions while the session is receiving live run updates. */
  suppressAssistantActions?: boolean;
  onEditUserMessage?: (message: Message, messageIndex: number) => void;
  userMessageCanEdit?: boolean;
  responseFeedbackEnabled?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const navigate = useNavigate();
  const location = useLocation();

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const roleLabel = isUser ? m.chat.you : isAssistant ? m.chat.assistant : m.chat.tool;
  const openReferencedNote = useCallback((sourceId: string) => {
    const returnTo = `${location.pathname}${location.search}`;
    navigate(withDetailReturnTo(`/notes/${encodeURIComponent(sourceId)}`, returnTo));
  }, [location.pathname, location.search, navigate]);

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
      searchedMemory: m.chat.stepSearchedMemory,
      searchedCode: m.chat.stepSearchedCode,
      searched: m.chat.stepSearched,
      readFile: m.chat.stepReadFile,
      stepDetails: m.chat.stepDetails,
      runCommand: m.chat.stepRunCommand,
      listDirectory: m.chat.stepListDirectory,
      writeFile: m.chat.stepWriteFile,
      editFile: m.chat.stepEditFile,
      openUrl: m.chat.stepOpenUrl,
      fetchUrl: m.chat.stepFetchUrl,
      unknownTool: m.chat.stepUnknownTool,
      activityCompleted: m.chat.activityCompleted,
      activityPartial: m.chat.activityPartial,
      activityFailedCount: m.chat.activityFailedCount,
      activityAnalysisComplete: m.chat.activityAnalysisComplete,
      toolFailedImpact: m.chat.toolFailedImpact,
      rawThinking: m.chat.rawThinking,
      toolRunning: m.chat.toolRunning,
      toolError: m.chat.toolError,
      memoryActivity: m.chat.memoryActivity,
    }),
    [
      m.chat.thoughts,
      m.chat.thoughtsStreaming,
      m.chat.viewSteps_one,
      m.chat.viewSteps_other,
      m.chat.stepSearchedWeb,
      m.chat.stepSearchedMemory,
      m.chat.stepSearchedCode,
      m.chat.stepSearched,
      m.chat.stepReadFile,
      m.chat.stepDetails,
      m.chat.stepRunCommand,
      m.chat.stepListDirectory,
      m.chat.stepWriteFile,
      m.chat.stepEditFile,
      m.chat.stepOpenUrl,
      m.chat.stepFetchUrl,
      m.chat.stepUnknownTool,
      m.chat.activityCompleted,
      m.chat.activityPartial,
      m.chat.activityFailedCount,
      m.chat.activityAnalysisComplete,
      m.chat.toolFailedImpact,
      m.chat.rawThinking,
      m.chat.toolRunning,
      m.chat.toolError,
      m.chat.memoryActivity,
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
  const assistantTurnView = useMemo(
    () =>
      isAssistant
        ? buildAssistantTurnViewModel({ message, isStreaming, reasoningLevel })
        : null,
    [isAssistant, isStreaming, message, reasoningLevel],
  );
  const displayContent = assistantTurnView?.displayContent ?? message.content ?? [];

  /** User/assistant images: grid via AttachmentRenderer, not stacked inline blocks in the text column. */
  const displayForFlow = useMemo(
    () =>
      assistantTurnView?.flowContent ??
      (isUser ? displayContent.filter((block) => block.type !== 'image') : displayContent),
    [assistantTurnView, displayContent, isUser],
  );

  const attachmentsForBubble = useMemo(() => {
    if (assistantTurnView) return assistantTurnView.attachments;
    return message.attachments;
  }, [assistantTurnView, message.attachments]);

  const hasAssistantActivity = Boolean(assistantTurnView?.activity.blocks.length);
  const progressForMeta =
    reasoningHidden ||
    (isAssistant && hasAssistantActivity)
      ? null
      : progress;

  const streamingThinking = reasoningHidden
    ? false
    : Boolean(message.content?.some((b) => b.type === 'thinking' && b.streaming));
  const showStreamingCursor = isAssistant
    ? Boolean(assistantTurnView?.answer.showStreamingCursor)
    : isStreaming;

  const showMeta =
    Boolean(message.timestamp) ||
    Boolean(progressForMeta?.message) ||
    (isStreaming && !streamingThinking);

  const assistantActionsVisible = isAssistant && !readonly && !isStreaming && !suppressAssistantActions;
  const copyMarkdown = useMemo(
    () => (assistantActionsVisible ? getAssistantCopyMarkdown(message.content ?? []) : ''),
    [assistantActionsVisible, message.content],
  );
  const copyPlainText = useMemo(
    () => (assistantActionsVisible && copyMarkdown ? getAssistantCopyPlainText(message.content ?? []) : ''),
    [assistantActionsVisible, copyMarkdown, message.content],
  );
  const speakableText = useMemo(
    () => (assistantActionsVisible && copyMarkdown ? buildSpeakableText(copyMarkdown) : ''),
    [assistantActionsVisible, copyMarkdown],
  );
  const readAloudInput = useMemo(() => ({
    source: {
      type: 'chat-message' as const,
      id: `${sessionKey ?? 'chat'}:${message.timestamp ?? messageIndex ?? copyMarkdown.length}`,
      title: m.chat.messageReadAloudTitle,
    },
    text: speakableText,
    language: detectSpeechLanguage(speakableText, language),
  }), [copyMarkdown.length, language, m.chat.messageReadAloudTitle, message.timestamp, messageIndex, sessionKey, speakableText]);
  const userCopyText = useMemo(() => {
    if (!isUser) return '';
    return extractUserMessagePlainText(message.content);
  }, [isUser, message.content]);
  const [copyFeedback, setCopyFeedback] = useState<'plain' | 'markdown' | 'user' | null>(null);
  const [assistantActionFeedback, setAssistantActionFeedback] = useState<'create-note' | 'save-source-note' | 'extract-task' | null>(null);
  const [assistantActionBusy, setAssistantActionBusy] = useState<'create-note' | 'save-source-note' | 'extract-task' | null>(null);
  const [forkBusy, setForkBusy] = useState(false);
  const [responseFeedback, setResponseFeedback] = useState<'helpful' | 'not_helpful' | null>(null);
  const [responseFeedbackLoaded, setResponseFeedbackLoaded] = useState(false);
  const [responseFeedbackBusy, setResponseFeedbackBusy] = useState(false);
  const [responseFeedbackError, setResponseFeedbackError] = useState(false);
  const [responseFeedbackPromptOpen, setResponseFeedbackPromptOpen] = useState(false);
  const [responseFeedbackReason, setResponseFeedbackReason] = useState<ResponseFeedbackReason | null>(null);
  const [responsePersonalContext, setResponsePersonalContext] = useState<ResponsePersonalContext[]>([]);
  const [responseContextOpen, setResponseContextOpen] = useState(false);
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
  const completeProgressiveRender = useCallback(() => {
    if (!sessionKey || !message.renderKey) return;
    useChatSessionStore.getState().completeProgressiveRender(sessionKey, message.renderKey);
  }, [message.renderKey, sessionKey]);
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

  const handleSaveAssistantAsNote = useCallback(() => {
    if (!copyMarkdown || !onSaveAssistantAsNote || assistantActionBusy) return;
    setAssistantActionBusy('create-note');
    void Promise.resolve(onSaveAssistantAsNote(copyMarkdown))
      .then(() => {
        setAssistantActionFeedback('create-note');
        window.setTimeout(
          () => setAssistantActionFeedback((f) => (f === 'create-note' ? null : f)),
          2000,
        );
      })
      .catch(() => undefined)
      .finally(() => setAssistantActionBusy(null));
  }, [assistantActionBusy, copyMarkdown, onSaveAssistantAsNote]);

  const handleSaveAssistantToSourceNote = useCallback(() => {
    if (!copyMarkdown || !onSaveAssistantToSourceNote || assistantActionBusy) return;
    setAssistantActionBusy('save-source-note');
    void Promise.resolve(onSaveAssistantToSourceNote(copyMarkdown))
      .then(() => {
        setAssistantActionFeedback('save-source-note');
        window.setTimeout(
          () => setAssistantActionFeedback((f) => (f === 'save-source-note' ? null : f)),
          2000,
        );
      })
      .catch(() => undefined)
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
      .catch(() => undefined)
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

  const handleForkAssistantTurn = useCallback(() => {
    if (!message.turnId || !onForkAssistantTurn || forkBusy) return;
    setForkBusy(true);
    void Promise.resolve(onForkAssistantTurn(message.turnId))
      .catch(() => undefined)
      .finally(() => setForkBusy(false));
  }, [forkBusy, message.turnId, onForkAssistantTurn]);

  const handleResponseFeedback = useCallback((
    rating: 'helpful' | 'not_helpful',
    reason?: ResponseFeedbackReason,
  ) => {
    if (!message.turnId || responseFeedbackBusy) return;
    setResponseFeedbackBusy(true);
    setResponseFeedbackLoaded(true);
    setResponseFeedbackError(false);
    void fetchJson<{ ok: true }>(apiUrl(`/api/you/turns/${encodeURIComponent(message.turnId)}/feedback`), {
      method: 'POST',
      body: JSON.stringify({
        rating: rating === 'helpful' ? 'helpful' : 'irrelevant',
        reason,
      }),
    })
      .then(() => {
        setResponseFeedback(rating);
        setResponseFeedbackReason(reason ?? null);
        setResponseFeedbackPromptOpen(false);
      })
      .catch(() => setResponseFeedbackError(true))
      .finally(() => setResponseFeedbackBusy(false));
  }, [message.turnId, responseFeedbackBusy]);

  const repairResponseFeedback = useCallback(() => {
    if (!responseFeedbackReason) return;
    dispatchFillChatComposer(m.chat.messageFeedbackRepairPrompts[responseFeedbackReason]);
  }, [m.chat.messageFeedbackRepairPrompts, responseFeedbackReason]);

  const loadResponseFeedback = useCallback(() => {
    if (!message.turnId || responseFeedbackLoaded || responseFeedbackBusy) return;
    setResponseFeedbackBusy(true);
    void fetchJson<{ personalization: { items: Array<{ objectType: string; objectId: string; decision: string; content: string; sourceLabel: string; origin: ResponsePersonalContext['origin'] }> } }>(
      apiUrl(`/api/you/turns/${encodeURIComponent(message.turnId)}/personalization`),
    )
      .then((result) => {
        setResponsePersonalContext(result.personalization.items
          .filter((item) => (item.objectType === 'understanding' || item.objectType === 'focus') && item.decision === 'selected')
          .map((item) => ({ id: `${item.objectType}:${item.objectId}`, statement: item.content, origin: item.origin, sourceName: item.sourceLabel })));
      })
      .catch(() => undefined)
      .finally(() => {
        setResponseFeedbackLoaded(true);
        setResponseFeedbackBusy(false);
      });
  }, [message.turnId, responseFeedbackBusy, responseFeedbackLoaded]);

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
          'min-w-0',
          isUser
            ? 'flex w-full max-w-[min(78%,var(--max-width-chat-user))] flex-col items-end'
            : 'w-full max-w-[var(--max-width-chat-reading)]',
          readonly && 'max-w-full',
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
                {formatChatMessageTime(message.timestamp)}
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
                {formatChatMessageTime(message.timestamp)}
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
            'min-w-0 text-fg',
            isUser && 'chat-user-message',
            density === 'compact'
              ? 'text-sm leading-relaxed'
              : isUser
                ? 'text-[0.9375rem] leading-[1.6667]'
                : 'text-base leading-[1.6875]',
            isUser &&
              'w-fit max-w-full rounded-2xl bg-surface-hover/80 px-4 py-3 text-left dark:bg-surface-hover/50',
          )}
        >
          <div className="flex min-w-0 flex-col gap-2">
            {isUser && message.contextRefs?.length ? (
              <MessageNoteAttachments
                refs={message.contextRefs}
                groupLabel={m.chat.commandPalette.noteContextLabel}
                noteLabel={m.chat.commandPalette.notesSection}
                truncatedLabel={m.chat.commandPalette.contextTruncated}
                onOpen={(ref) => openReferencedNote(ref.sourceId)}
              />
            ) : null}
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
                  <ChunkedContent
                    content={displayForFlow}
                    isUser={isUser}
                    isAssistantMessageStreaming={isAssistant && isStreaming}
                    toolLabels={toolLabels}
                    stepLabels={stepLabels}
                    clusterLabels={clusterLabels}
                    cardLabels={cardLabels}
                    imagePreviewLabel={m.chat.attachmentPreviewImage}
                    onImagePreview={openInlineImagePreview}
                    sessionKey={sessionKey}
                    projectId={projectId}
                    workflowOptions={{
                      labels: workflowCardLabels(language),
                    }}
                    assistantActivity={assistantTurnView?.activity}
                    progressiveRender={Boolean(message.progressiveRender)}
                    onProgressiveRenderComplete={completeProgressiveRender}
                  />
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
                {showStreamingCursor ? (
                  <span className="inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" />
                ) : null}
              </>
            ) : showStreamingCursor ? (
              <span className="inline-block h-3 w-0.5 animate-pulse bg-accent" />
            ) : null}

            {assistantTurnView ? (
              <AssistantTurnTasks
                view={assistantTurnView}
                authToken={authToken}
                sessionKey={sessionKey}
                sourcesLabel={m.chat.searchSourcesHeading.replace(
                  '{{count}}',
                  String(assistantTurnView.sources.length),
                )}
              />
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
                <AssistantAttachmentList
                  attachments={attachmentsForBubble}
                  authToken={authToken}
                  sessionKey={sessionKey}
                />
              )
            ) : null}
          </div>
        </div>

        {isUser && !isStreaming && !readonly ? (
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
                onClick={() => {
                  if (onEditUserMessage && messageIndex != null) {
                    onEditUserMessage(message, messageIndex);
                    return;
                  }
                  dispatchFillChatComposer(userCopyText, messageAttachmentsToWire(message.attachments));
                }}
                disabled={(!userCopyText && !message.attachments?.length) || !userMessageCanEdit}
                title={userMessageCanEdit ? m.chat.userMessageEdit : m.chat.userMessageEditDisabledHint}
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

        {assistantActionsVisible && copyMarkdown ? (
          <div
            className="mt-2 flex shrink-0 flex-wrap items-center gap-2 overflow-visible"
            onPointerEnter={loadResponseFeedback}
            onFocusCapture={loadResponseFeedback}
          >
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
            <ReadAloudButton
              input={readAloudInput}
              labels={{
                read: m.chat.messageReadAloud,
                preparing: m.chat.messageReadAloudPreparing,
                pause: m.chat.messageReadAloudPause,
                resume: m.chat.messageReadAloudResume,
                retry: m.chat.messageReadAloudRetry,
              }}
            />
            {onForkAssistantTurn && message.turnId ? (
              <button
                type="button"
                className={messageActionIconButton}
                onClick={handleForkAssistantTurn}
                disabled={forkBusy}
                title={forkBusy ? m.chat.messageForkCreating : m.chat.messageForkFromHere}
                aria-label={forkBusy ? m.chat.messageForkCreating : m.chat.messageForkFromHere}
              >
                <GitFork className="size-4" strokeWidth={1.75} aria-hidden />
              </button>
            ) : null}
            {onSaveAssistantAsNote ? (
              <button
                type="button"
                className={messageActionIconButton}
                onClick={handleSaveAssistantAsNote}
                disabled={assistantActionBusy !== null}
                title={assistantActionFeedback === 'create-note' ? m.chat.messageSavedToNote : m.chat.messageSaveToNote}
                aria-label={assistantActionFeedback === 'create-note' ? m.chat.messageSavedToNote : m.chat.messageSaveToNote}
              >
                {assistantActionFeedback === 'create-note' ? (
                  <Check className="size-4 text-fg-muted" strokeWidth={1.75} aria-hidden />
                ) : (
                  <FilePlus2 className="size-4" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            ) : null}
            {responseFeedbackEnabled && sessionKey && message.timestamp ? (
              <>
                <button
                  type="button"
                  className={cn(
                    messageActionIconButton,
                    responseFeedback === 'helpful' && 'bg-surface-active text-fg',
                  )}
                  onClick={() => handleResponseFeedback('helpful')}
                  disabled={responseFeedbackBusy}
                  title={m.chat.messageHelpful}
                  aria-label={m.chat.messageHelpful}
                  aria-pressed={responseFeedback === 'helpful'}
                >
                  <ThumbsUp className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
                <button
                  type="button"
                  className={cn(
                    messageActionIconButton,
                    responseFeedback === 'not_helpful' && 'bg-surface-active text-fg',
                  )}
                  onClick={() => setResponseFeedbackPromptOpen((open) => !open)}
                  disabled={responseFeedbackBusy}
                  title={m.chat.messageNotHelpful}
                  aria-label={m.chat.messageNotHelpful}
                  aria-pressed={responseFeedback === 'not_helpful'}
                >
                  <ThumbsDown className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
                {responseFeedbackError ? (
                  <span className="text-xs text-danger" role="status">{m.chat.messageFeedbackUnavailable}</span>
                ) : null}
              </>
            ) : null}
            <Popover.Root>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className={messageActionIconButton}
                  title={m.chat.messageMoreActions}
                  aria-label={m.chat.messageMoreActions}
                >
                  <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  className="z-[70] w-56 rounded-xl border border-edge bg-surface-panel p-1.5 shadow-popover outline-none"
                >
                  <Popover.Close asChild>
                    <button
                      type="button"
                      className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
                      onClick={handleCopyMd}
                    >
                      {copyFeedback === 'markdown' ? (
                        <Check className="size-4" strokeWidth={1.75} aria-hidden />
                      ) : (
                        <FileCode2 className="size-4" strokeWidth={1.75} aria-hidden />
                      )}
                      {copyFeedback === 'markdown' ? m.chat.messageCopied : m.chat.messageCopyMarkdown}
                    </button>
                  </Popover.Close>
                  {responsePersonalContext.length > 0 ? (
                    <Popover.Close asChild>
                      <button
                        type="button"
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
                        onClick={() => setResponseContextOpen((open) => !open)}
                      >
                        <CircleHelp className="size-4" strokeWidth={1.75} aria-hidden />
                        {m.chat.messageWhyThisAnswer}
                      </button>
                    </Popover.Close>
                  ) : null}
                  {onSaveAssistantToSourceNote ? (
                    <Popover.Close asChild>
                      <button
                        type="button"
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                        onClick={handleSaveAssistantToSourceNote}
                        disabled={!copyMarkdown || assistantActionBusy !== null}
                      >
                        {assistantActionFeedback === 'save-source-note' ? (
                          <Check className="size-4" strokeWidth={1.75} aria-hidden />
                        ) : (
                          <FileText className="size-4" strokeWidth={1.75} aria-hidden />
                        )}
                        {assistantActionFeedback === 'save-source-note'
                          ? m.chat.messageSavedToSourceNote
                          : m.chat.messageSaveToSourceNote}
                      </button>
                    </Popover.Close>
                  ) : null}
                  {onExtractAssistantTask ? (
                    <Popover.Close asChild>
                      <button
                        type="button"
                        className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                        onClick={handleExtractAssistantTask}
                        disabled={(!copyPlainText && !copyMarkdown) || assistantActionBusy !== null}
                      >
                        {assistantActionFeedback === 'extract-task' ? (
                          <Check className="size-4" strokeWidth={1.75} aria-hidden />
                        ) : (
                          <ListTodo className="size-4" strokeWidth={1.75} aria-hidden />
                        )}
                        {assistantActionFeedback === 'extract-task'
                          ? m.chat.messageTaskExtracted
                          : m.chat.messageExtractTask}
                      </button>
                    </Popover.Close>
                  ) : null}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        ) : null}

        {assistantActionsVisible && responseContextOpen && responsePersonalContext.length > 0 ? (
          <div className="mt-2 w-full max-w-xl rounded-xl border border-edge-subtle bg-surface-elevated p-3">
            <p className="text-sm font-medium text-fg">{m.chat.messageWhyThisAnswer}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{m.chat.messageWhyThisAnswerHint}</p>
            <div className="mt-2 space-y-2">
              {responsePersonalContext.map((context) => (
                <div key={context.id} className="rounded-lg bg-surface-panel px-3 py-2">
                  <p className="text-xs leading-5 text-fg">{context.statement}</p>
                  <p className="mt-1 text-[11px] text-fg-subtle">
                    {context.origin === 'connected_source'
                      ? m.chat.messageContextOrigins.connected_source.replace('{{source}}', context.sourceName)
                      : m.chat.messageContextOrigins[context.origin]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {assistantActionsVisible && responseFeedbackPromptOpen ? (
          <div className="mt-2 w-full max-w-xl rounded-xl border border-edge-subtle bg-surface-elevated p-3">
            <p className="text-sm font-medium text-fg">{m.chat.messageFeedbackReasonTitle}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{m.chat.messageFeedbackReasonHint}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {RESPONSE_FEEDBACK_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  className="rounded-lg border border-edge bg-surface-panel px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  disabled={responseFeedbackBusy}
                  onClick={() => handleResponseFeedback('not_helpful', reason)}
                >
                  {m.chat.messageFeedbackReasons[reason]}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {assistantActionsVisible && responseFeedback === 'not_helpful' && responseFeedbackReason ? (
          <button
            type="button"
            className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-soft/80"
            onClick={repairResponseFeedback}
          >
            <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden />
            {m.chat.messageFeedbackRepair}
          </button>
        ) : null}

      </div>

      {isUser && onDeleteRound && messageIndex != null && !readonly ? (
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
