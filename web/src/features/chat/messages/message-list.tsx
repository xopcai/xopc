import { memo, type ReactNode } from 'react';

import { ChatWelcomeSpotlight } from '@/features/chat/chat-welcome-spotlight';
import { MessageBubble } from '@/features/chat/messages/message-bubble';
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
import { useLocaleStore } from '@/stores/locale-store';

export const MessageList = memo(function MessageList({
  messages: list,
  authToken,
  conversationId,
  workspaceConversationId,
  projectId,
  streaming,
  progress,
  reasoningLevel,
  registerListContentRef,
  onPickWelcomePrompt,
  welcomeSpotlight,
  onRetryWelcomeContext,
  onRefreshWelcomeExploration,
  onSelectWelcomeProject,
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
  trailingContent,
}: {
  messages: Message[];
  authToken?: string;
  conversationId?: string | null;
  /** Persistent session whose workspace backs file links in this message list. */
  workspaceConversationId?: string | null;
  projectId?: string | null;
  streaming: boolean;
  progress: ProgressState | null;
  reasoningLevel: ReasoningLevel;
  /** Plain column root — observed by scroll viewport for tail-follow (Cursor-style, non-virtual). */
  registerListContentRef: (el: HTMLDivElement | null) => void;
  onPickWelcomePrompt?: (selection: WelcomeSuggestionSelection) => void;
  welcomeSpotlight?: WelcomeSpotlightModel;
  onRetryWelcomeContext?: () => void;
  onRefreshWelcomeExploration?: () => void;
  onSelectWelcomeProject?: (projectId: string) => Promise<void> | void;
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
  /** Ephemeral UI rendered after the latest transcript message; never persisted as a message. */
  trailingContent?: ReactNode;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const showWelcome = list.length === 0 && !streaming;

  if (showWelcome) {
    if (welcomeOverlay) {
      return <div className="pb-1.5">{welcomeOverlay}</div>;
    }
    if (onPickWelcomePrompt && welcomeSpotlight) {
      return (
        <div className="pb-1.5">
          <ChatWelcomeSpotlight
            spotlight={welcomeSpotlight}
            projectId={projectId}
            onPickPrompt={onPickWelcomePrompt}
            onRetryContext={onRetryWelcomeContext}
            onRefreshExploration={onRefreshWelcomeExploration}
            onSelectProject={onSelectWelcomeProject}
            compact={compactWelcome}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-10 pb-8">
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="text-4xl" aria-hidden>
            🤖
          </div>
          <div className="text-xl font-semibold tracking-tight text-fg">{m.chat.welcomeTitle}</div>
          <div className="max-w-sm text-sm leading-relaxed text-fg-muted">{m.chat.welcomeDescription}</div>
        </div>
      </div>
    );
  }

  const now = Date.now();

  return (
    <InlinePreviewSchedulerProvider>
      <div ref={registerListContentRef} className="flex w-full min-w-0 flex-col gap-8 pb-8">
        {list.map((msg, index) => {
        const isLast = index === list.length - 1;
        const isStreamRow = Boolean(streaming && isLast && msg.role === 'assistant');
        const isLastUserRow = isLastUserMessageInThread(list, index);
        const key = messageRowKey(msg, index);
        const showTimeSeparator = shouldShowChatTimeSeparator(
          msg.timestamp,
          list[index - 1]?.timestamp,
        );
        return (
          <div
            key={key}
            id={`chat-message-${index}`}
            className="scroll-mt-4"
            data-chat-message-index={index}
            data-chat-message-row
            data-client-submission-id={msg.clientSubmissionId}
            data-message-render-key={msg.renderKey}
          >
            {showTimeSeparator && msg.timestamp ? (
              <div className="mb-8 flex justify-center" data-chat-time-separator>
                <time
                  suppressHydrationWarning
                  className="rounded-md px-2 py-1 text-xs tabular-nums text-fg-disabled"
                  dateTime={new Date(msg.timestamp).toISOString()}
                >
                  {formatChatTimeSeparator(msg.timestamp, now, language)}
                </time>
              </div>
            ) : null}
            <MessageBubble
              message={msg}
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
            />
          </div>
        );
        })}
        {trailingContent}
      </div>
    </InlinePreviewSchedulerProvider>
  );
});
