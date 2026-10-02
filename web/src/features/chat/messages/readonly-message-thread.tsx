import { memo } from 'react';

import { MessageBubble } from '@/features/chat/messages/message-bubble';
import { TaskTriggerCard } from '@/features/chat/messages/task-trigger-card';
import type { Message, ReasoningLevel } from '@/features/chat/messages/messages.types';
import { messageRowKey } from '@/features/chat/messages/thinking-blocks';

export const ReadonlyMessageThread = memo(function ReadonlyMessageThread({
  messages,
  authToken,
  conversationId,
  reasoningLevel = 'on',
  compact = true,
}: {
  messages: Message[];
  authToken?: string;
  conversationId?: string | null;
  reasoningLevel?: ReasoningLevel;
  compact?: boolean;
}) {
  if (messages.length === 0) return null;

  return (
    <div className={compact ? 'flex w-full min-w-0 flex-col gap-5' : 'flex w-full min-w-0 flex-col gap-10'}>
      {messages.map((message, index) => {
        const precedingTask = messages[index - 1];
        const followUpTrigger = message.role === 'assistant'
          && precedingTask?.role === 'task'
          && Boolean(message.turnId)
          && precedingTask.turnId === message.turnId
          ? precedingTask.taskTrigger : undefined;
        if (message.role === 'task' && message.taskTrigger
          && messages[index + 1]?.role === 'assistant'
          && Boolean(message.turnId)
          && messages[index + 1]?.turnId === message.turnId) return null;
        if (message.role === 'task' && message.taskTrigger) {
          return <TaskTriggerCard key={messageRowKey(message, index)} trigger={message.taskTrigger} />;
        }
        return <MessageBubble
          key={messageRowKey(message, index)}
          message={message}
          followUpTrigger={followUpTrigger}
          authToken={authToken}
          conversationId={conversationId}
          isStreaming={false}
          progress={null}
          reasoningLevel={reasoningLevel}
          messageIndex={index}
          deleteRoundDisabled
          readonly
          density={compact ? 'compact' : 'normal'}
        />;
      })}
    </div>
  );
});
