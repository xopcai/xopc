import type { Message } from './messages.types';

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function messageContentKey(message: Message): string {
  try {
    return JSON.stringify(message.content ?? []);
  } catch {
    return '';
  }
}

/** Generate a stable key for each virtualized chat row. */
export function messageKey(msg: Message, index: number): string {
  if (msg.renderKey) return msg.renderKey;
  if (msg.id) return msg.id;
  if (msg.turnId) return `${msg.role}-turn-${msg.turnId}`;
  if (msg.timestamp) return `${msg.role}-${msg.timestamp}`;
  const contentKey = messageContentKey(msg);
  if (contentKey) return `${msg.role}-content-${stableHash(contentKey)}`;
  return `${msg.role}-${index}`;
}
