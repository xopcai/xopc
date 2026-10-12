import { memo, type ComponentProps } from 'react';

import { MessageBubble } from '@/features/chat/messages/message-bubble';

import { useChatMessageRow } from './use-chat-render-state';

export const ConnectedMessageBubble = memo(function ConnectedMessageBubble(props: ComponentProps<typeof MessageBubble>) {
  const message = useChatMessageRow(props.conversationId, props.message.renderKey) ?? props.message;
  return <MessageBubble {...props} message={message} />;
});
