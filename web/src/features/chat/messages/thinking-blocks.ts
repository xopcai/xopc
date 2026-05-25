import type { Message } from '@/features/chat/messages/messages.types';

export function messageRowKey(msg: Message, index: number): string {
  return `${msg.timestamp ?? 'n'}-${index}`;
}
