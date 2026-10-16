import type { Message } from '@/features/chat/messages/messages.types';

/** A notification keeps one visible marker across delivery attempts and history reloads. */
export function dedupeTaskTriggerMessages(messages: Message[]): Message[] {
  const latest = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.role === 'task' && message.taskTrigger) latest.set(message.taskTrigger.entryId, index);
  });
  return messages.filter((message, index) => {
    if (message.role !== 'task' || !message.taskTrigger) return true;
    return latest.get(message.taskTrigger.entryId) === index;
  });
}
