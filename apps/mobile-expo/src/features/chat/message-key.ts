import type { Message } from './messages.types';

/** Generate a stable key for each virtualized chat row. */
export function messageKey(msg: Message, index: number): string {
  if (msg.renderKey) return msg.renderKey;
  if (msg.id) return msg.id;
  if (msg.timestamp) return `${msg.role}-${msg.timestamp}`;
  return `${msg.role}-${index}`;
}
