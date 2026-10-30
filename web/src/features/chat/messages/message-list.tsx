import { memo, useState, type ReactNode, type RefObject } from 'react';

import { ChatWelcomeSpotlight } from '@/features/chat/chat-welcome-spotlight';
import { ConnectedMessageBubble } from '@/features/chat/rendering/connected-message-bubble';
import { TaskTriggerCard } from '@/features/chat/messages/task-trigger-card';
import { InlinePreviewSchedulerProvider } from '@/features/chat/product-delivery/inline-preview-scheduler';
import type { Message, ProgressState, ReasoningLevel } from '@/features/chat/messages/messages.types';
import { messageRowKey } from '@/features/chat/messages/thinking-blocks';
import {
  formatChatTimeSeparator,
  shouldShowChatTimeSeparator,
} from '@/features/chat/messages/message-time';
import type {
  WelcomeSpotlightModel,
  WelcomeSuggestionSelection,
} from '@/features/chat/welcome/welcome-suggestions';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { VirtualMessageRows, type MessageRowDescriptor } from './virtual-message-rows';
import { hasVisibleMessageRow } from './message-row-visibility';
import { ComputerActivityCard } from '@/features/chat/computer/computer-activity-card';

export interface ChatTimelineEntry { id: string; timestamp: number; content: ReactNode }

const ignoreWelcomePrompt = (_selection: WelcomeSuggestionSelection): void => {};

export const MessageList = memo(function MessageList({
  messages: list,
  timelineEntries = [],
  personal = false,
  authToken,
  conversationId,
  workspaceConversationId,
  projectId,
  streaming,
  sending = false,
  progress,
  reasoningLevel,
  registerListContentRef,
  onPickWelcomePrompt,
  welcomeSpotlight,
  welcomeOverlay,
  compactWelcome = false,
  onDeleteRound,
  onRetryUserMessageRound,
  deleteRoundDisabled,
  onSaveAssistantAsNote,
  onSaveAssistantToSourceNote,
  onExtractAssistantTask,
  onForkAssistantTurn,
  onEditUserMessage,
  editLatestUserOnly = false,
  editRequiresTurnId = false,
  responseFeedbackEnabled,
  showAssistantWorkLog = true,
  hideAssistantActions = false,
  trailingContent,
  replySpaceRef,
  scrollRef,
}: {
  messages: Message[];
  timelineEntries?: ChatTimelineEntry[];
  personal?: boolean;
  authToken?: string;
  conversationId?: string | null;
  /** Persistent session whose workspace backs file links in this message list. */
  workspaceConversationId?: string | null;
  projectId?: string | null;
  streaming: boolean;
  sending?: boolean;
  progress: ProgressState | null;
  reasoningLevel: ReasoningLevel;
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Measured transcript root in the shared scroll viewport. */
  registerListContentRef: (el: HTMLDivElement | null) => void;
  onPickWelcomePrompt?: (selection: WelcomeSuggestionSelection) => void;
  welcomeSpotlight?: WelcomeSpotlightModel;
  welcomeOverlay?: ReactNode;
  compactWelcome?: boolean;
  onDeleteRound?: (messageIndex: number) => void;
  onRetryUserMessageRound?: (messageIndex: number) => void;
  deleteRoundDisabled?: boolean;
  onSaveAssistantAsNote?: (content: string) => Promise<void> | void;
  onSaveAssistantToSourceNote?: (content: string) => Promise<void> | void;
  onExtractAssistantTask?: (content: string) => Promise<void> | void;
  onForkAssistantTurn?: (turnId: string) => Promise<void> | void;
  onEditUserMessage?: (message: Message, messageIndex: number) => void;
  editLatestUserOnly?: boolean;
  editRequiresTurnId?: boolean;
  responseFeedbackEnabled?: boolean;
  /** Whether to show the assistant's reasoning and tool activity disclosure. */
  showAssistantWorkLog?: boolean;
  /** Hide footer controls under assistant messages in focused conversation views. */
  hideAssistantActions?: boolean;
  /** Ephemeral UI rendered after the latest transcript message; never persisted as a message. */
  trailingContent?: ReactNode;
  replySpaceRef?: RefObject<HTMLDivElement | null>;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const [virtualized] = useState(Boolean(scrollRef && list.length >= 300));

  const showWelcome = list.length === 0 && timelineEntries.length === 0 && !streaming && !sending;

  if (showWelcome) {
    if (welcomeOverlay) {
      return <div className="pb-1.5">{welcomeOverlay}</div>;
    }
    return (
      <div className="pb-1.5">
        <ChatWelcomeSpotlight
          spotlight={welcomeSpotlight ?? {
            headline: m.chat.welcomeSpotlight.headline,
            contextKind: 'empty',
            contextStatus: 'ready',
          }}
          onPickPrompt={onPickWelcomePrompt ?? ignoreWelcomePrompt}
          compact={compactWelcome}
        />
      </div>
    );
  }

  const now = Date.now();
  const lastUserIndex = list.findLastIndex((message) => message.role === 'user');

  const isStreamingRow = (msg: Message, index: number) => Boolean(
    (streaming || sending || msg.pendingResponseStatus) && index === list.length - 1 && msg.role === 'assistant',
  );
  const followUpTriggerFor = (msg: Message, index: number) => msg.role === 'assistant'
    && Boolean(msg.turnId) && list[index - 1]?.role === 'task' && list[index - 1]?.turnId === msg.turnId
    ? list[index - 1].taskTrigger : undefined;

  const rows: MessageRowDescriptor[] = list.flatMap((msg, index) => {
    if (!hasVisibleMessageRow(msg, { personal, isStreaming: isStreamingRow(msg, index), reasoningLevel,
      showAssistantWorkLog, followUpTrigger: followUpTriggerFor(msg, index) })) return [];
    if (msg.role === 'task' && msg.taskTrigger && msg.turnId
      && list[index + 1]?.role === 'assistant' && list[index + 1]?.turnId === msg.turnId) return [];
    return [{ key: messageRowKey(msg, index), index, aliases: msg.role === 'assistant'
      && list[index - 1]?.role === 'task' && msg.turnId === list[index - 1]?.turnId ? [index - 1] : [] }];
  });
  rows.push(...timelineEntries.map((entry, offset) => ({ key: entry.id, index: list.length + offset, aliases: [] })));
  let lastTranscriptTime = 0;
  const transcriptTimes = list.map(message => {
    lastTranscriptTime = message.timestamp ?? lastTranscriptTime;
    return lastTranscriptTime;
  });
  if (timelineEntries.length) rows.sort((a, b) => {
    const time = (index: number) => index < list.length ? transcriptTimes[index] : timelineEntries[index - list.length].timestamp;
    return time(a.index) - time(b.index) || a.index - b.index;
  });
  const previousVisibleIndex = new Map(rows.map((row, offset) => [row.index, rows[offset - 1]?.index]));
  const renderRow = (index: number) => {
    if (index >= list.length) {
      const entry = timelineEntries[index - list.length];
      return <div key={entry.id} data-chat-timeline-entry={entry.id}>{entry.content}</div>;
    }
    const msg = list[index];
    const isStreamRow = isStreamingRow(msg, index);
    const isLastUserRow = index === lastUserIndex;
    const precedingTask = list[index - 1];
    const followUpTrigger = followUpTriggerFor(msg, index);
    const previousIndex = previousVisibleIndex.get(index);
    const previousMessage = previousIndex === undefined ? undefined : list[previousIndex];
    const previousTimestamp = previousMessage && previousIndex !== undefined
      ? (followUpTriggerFor(previousMessage, previousIndex)
        ? list[previousIndex - 1]?.timestamp ?? previousMessage.timestamp : previousMessage.timestamp)
      : undefined;
    const key = messageRowKey(msg, index);
    const rowTimestamp = followUpTrigger ? precedingTask?.timestamp ?? msg.timestamp : msg.timestamp;
    const showTimeSeparator = shouldShowChatTimeSeparator(
      rowTimestamp,
      previousTimestamp,
    );
    return (
      <div
        key={key}
        id={`chat-message-${index}`}
        className={cn('scroll-mt-4', previousMessage
          && (previousMessage.role === 'user' || previousMessage.role === 'task')
          && !followUpTrigger && !showTimeSeparator && '-mt-5')}
        data-chat-message-index={index}
        data-chat-message-row
        data-client-submission-id={msg.clientSubmissionId}
        data-message-render-key={msg.renderKey}
      >
        {followUpTrigger ? <span id={`chat-message-${index - 1}`} className="block h-0 scroll-mt-4" aria-hidden /> : null}
        {showTimeSeparator && rowTimestamp ? (
          <div className="mb-8 flex justify-center" data-chat-time-separator>
            <time
              suppressHydrationWarning
              className="rounded-md px-2 py-1 text-xs tabular-nums text-fg-disabled"
              dateTime={new Date(rowTimestamp).toISOString()}
            >
              {formatChatTimeSeparator(rowTimestamp, now, language)}
            </time>
          </div>
        ) : null}
        {msg.role === 'task' && msg.taskTrigger ? <TaskTriggerCard trigger={msg.taskTrigger} /> : <ConnectedMessageBubble
          message={msg}
          personal={personal}
          followUpTrigger={followUpTrigger}
          authToken={authToken}
          conversationId={conversationId}
          workspaceConversationId={workspaceConversationId}
          projectId={projectId}
          isStreaming={isStreamRow}
          progress={isStreamRow ? progress : null}
          reasoningLevel={reasoningLevel}
          messageIndex={index}
          onDeleteRound={onDeleteRound}
          onRetryUserMessageRound={onRetryUserMessageRound}
          userMessageCanRetry={Boolean(onRetryUserMessageRound) && isLastUserRow}
          // Streaming is only relevant to the active user round. Passing this
          // session-wide flag to every historical row defeats MessageBubble's memo.
          deleteRoundDisabled={Boolean(deleteRoundDisabled && isLastUserRow)}
          onSaveAssistantAsNote={onSaveAssistantAsNote}
          onSaveAssistantToSourceNote={onSaveAssistantToSourceNote}
          onExtractAssistantTask={onExtractAssistantTask}
          onForkAssistantTurn={onForkAssistantTurn}
          // The bubble hides live actions and reserves their eventual height.
          suppressAssistantActions={hideAssistantActions}
          onEditUserMessage={onEditUserMessage}
          userMessageCanEdit={
            (!editLatestUserOnly || isLastUserRow)
            && (!editRequiresTurnId || Boolean(msg.turnId))
            && msg.deliveryStatus !== 'sending'
          }
          responseFeedbackEnabled={responseFeedbackEnabled}
          showAssistantWorkLog={showAssistantWorkLog}
        />}
      </div>
    );
  };
  const footer = (
    <div className={cn(virtualized ? 'pt-8' : 'contents')}>
      {trailingContent}
      <ComputerActivityCard conversationId={conversationId} />
      {/* Reduced-motion duration overrides must not animate the spacer's height. */}
      {replySpaceRef && <div ref={replySpaceRef} className={cn(!virtualized && '-mt-8', 'shrink-0 transition-none')}
        aria-hidden data-chat-reply-space />}
    </div>
  );
  return (
    <InlinePreviewSchedulerProvider>
      <div ref={registerListContentRef} className={cn('w-full min-w-0 pb-8', !virtualized && 'flex flex-col gap-8')}
        data-chat-virtualized={virtualized || undefined}>
        {virtualized && scrollRef ? <VirtualMessageRows rows={rows} scrollRef={scrollRef}
          renderRow={renderRow} footer={footer} /> : <>{rows.map(row => renderRow(row.index))}{footer}</>}
      </div>
    </InlinePreviewSchedulerProvider>
  );
});
