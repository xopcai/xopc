import { memo, type ReactNode } from 'react';

import { ChatWelcomeSpotlight } from '@/features/chat/chat-welcome-spotlight';
import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { TaskTriggerCard } from '@/features/chat/messages/task-trigger-card';
import { InlinePreviewSchedulerProvider } from '@/features/chat/product-delivery/inline-preview-scheduler';
import type { Message, ProgressState, ReasoningLevel } from '@/features/chat/messages/messages.types';
import { isLastUserMessageInThread } from '@/features/chat/messages/user-message-plain-text';
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

const ignoreWelcomePrompt = (_selection: WelcomeSuggestionSelection): void => {};

export const MessageList = memo(function MessageList({
  messages: list,
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
  trailingContent,
}: {
  messages: Message[];
  authToken?: string;
  conversationId?: string | null;
  /** Persistent session whose workspace backs file links in this message list. */
  workspaceConversationId?: string | null;
  projectId?: string | null;
  streaming: boolean;
  sending?: boolean;
  progress: ProgressState | null;
  reasoningLevel: ReasoningLevel;
  /** Plain column root — observed by scroll viewport for tail-follow (Cursor-style, non-virtual). */
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
  /** Ephemeral UI rendered after the latest transcript message; never persisted as a message. */
  trailingContent?: ReactNode;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const showWelcome = list.length === 0 && !streaming && !sending;

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

  return (
    <InlinePreviewSchedulerProvider>
      <div ref={registerListContentRef} className="flex w-full min-w-0 flex-col gap-8 pb-8">
        {list.map((msg, index) => {
        const isLast = index === list.length - 1;
        const isStreamRow = Boolean((streaming || sending || msg.pendingResponseStatus) && isLast && msg.role === 'assistant');
        const isLastUserRow = isLastUserMessageInThread(list, index);
        const precedingTask = list[index - 1];
        const followUpTrigger = msg.role === 'assistant'
          && precedingTask?.role === 'task'
          && Boolean(msg.turnId)
          && precedingTask.turnId === msg.turnId
          ? precedingTask.taskTrigger : undefined;
        if (msg.role === 'task' && msg.taskTrigger
          && list[index + 1]?.role === 'assistant'
          && Boolean(msg.turnId)
          && list[index + 1]?.turnId === msg.turnId) return null;
        const key = messageRowKey(msg, index);
        const rowTimestamp = followUpTrigger ? precedingTask?.timestamp ?? msg.timestamp : msg.timestamp;
        const showTimeSeparator = shouldShowChatTimeSeparator(
          rowTimestamp,
          followUpTrigger ? list[index - 2]?.timestamp : precedingTask?.timestamp,
        );
        return (
          <div
            key={key}
            id={`chat-message-${index}`}
            className={cn('scroll-mt-4', index > 0
              && (list[index - 1]?.role === 'user' || list[index - 1]?.role === 'task')
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
            {msg.role === 'task' && msg.taskTrigger ? <TaskTriggerCard trigger={msg.taskTrigger} /> : <MessageBubble
              message={msg}
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
              // Do not unmount action footers from every prior assistant message
              // when a new reply starts; only the live row has no actions.
              suppressAssistantActions={isStreamRow}
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
        })}
        {trailingContent}
      </div>
    </InlinePreviewSchedulerProvider>
  );
});
