import { replaceEqualDeep } from '@tanstack/react-query';

import { messageKey } from './message-key';
import type { Message } from './messages.types';

function identities(message: Message): string[] {
  return [
    message.id && `id:${message.id}`,
    message.persistedId && `id:${message.persistedId}`,
    message.turnId && `turn:${message.turnId}`,
    message.renderKey && `render:${message.renderKey}`,
    !message.id && message.timestamp != null && `timestamp:${message.timestamp}`,
  ].filter((key): key is string => Boolean(key));
}

/** Reuse unchanged rows and keep native views mounted when live ids become durable ids. */
export function reconcileMessageRows(previous: Message[], next: Message[]): Message[] {
  const byIdentity = new Map<string, Message>();
  previous.forEach((message) => {
    identities(message).forEach((key) => byIdentity.set(`${message.role}:${key}`, message));
  });
  const used = new Set<Message>();
  return next.map((message, index) => {
    const prior = identities(message)
      .map((key) => byIdentity.get(`${message.role}:${key}`))
      .find((candidate) => candidate && !used.has(candidate));
    if (!prior) return { ...message, renderKey: messageKey(message, index) };
    used.add(prior);
    return replaceEqualDeep(prior, { ...message, renderKey: messageKey(prior, index) });
  });
}
