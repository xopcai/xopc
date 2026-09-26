import { create } from 'zustand';

import type { Message } from './messages.types';

const EMPTY_MESSAGES: Message[] = [];

/** Ephemeral UI projection. Durable pending submissions live in message-outbox. */
export const useLocalMessagesStore = create<{
  sessions: Record<string, Message[]>;
  update: (scope: string, update: (messages: Message[]) => Message[]) => void;
}>((set) => ({
  sessions: {},
  update: (scope, update) => set(state => ({
    sessions: { ...state.sessions, [scope]: update(state.sessions[scope] ?? EMPTY_MESSAGES) },
  })),
}));

export function localMessageScope(gatewayId: string | null, conversationId: string): string {
  return JSON.stringify([gatewayId, conversationId]);
}

export function readLocalMessages(scope: string): Message[] {
  return useLocalMessagesStore.getState().sessions[scope] ?? EMPTY_MESSAGES;
}

export function setLocalMessageDeliveryState(
  messages: Message[],
  messageId: string,
  deliveryState: Message['deliveryState'],
): Message[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== messageId || message.deliveryState === deliveryState) return message;
    changed = true;
    return { ...message, deliveryState };
  });
  return changed ? next : messages;
}

/** Do not overwrite a stronger realtime acknowledgement with an ambiguous HTTP failure. */
export function failLocalMessageIfSending(messages: Message[], messageId: string): Message[] {
  const message = messages.find(row => row.id === messageId);
  return message?.deliveryState === 'sending'
    ? setLocalMessageDeliveryState(messages, messageId, 'failed')
    : messages;
}

export function confirmLocalMessages(messages: Message[], clientMessageIds: Iterable<string>): Message[] {
  const confirmed = new Set(clientMessageIds);
  if (confirmed.size === 0) return messages;
  const next = messages.filter(message => !message.clientMessageId || !confirmed.has(message.clientMessageId));
  return next.length === messages.length ? messages : next;
}

/** A session input-state event is an authoritative acknowledgement from the gateway. */
export function acknowledgeLocalSessionInputs(
  messages: Message[],
  inputs: unknown,
): Message[] {
  if (!Array.isArray(inputs)) return messages;
  const queuedIds = new Set(inputs.filter(input => input && typeof input === 'object' && ['queued', 'cancelled'].includes(input.status)).map(input => input.clientMessageId));
  const acceptedIds = new Set(inputs.flatMap((input) => {
    if (!input || typeof input !== 'object') return [];
    const clientMessageId = (input as { clientMessageId?: unknown }).clientMessageId;
    return typeof clientMessageId === 'string' && clientMessageId ? [clientMessageId] : [];
  }));
  if (acceptedIds.size === 0) return messages;

  let changed = false;
  const next = messages.filter(message => {
    if (!queuedIds.has(message.id)) return true;
    changed = true;
    return false;
  }).map((message) => {
    if (!message.id || !acceptedIds.has(message.id) || message.deliveryState === 'sent') return message;
    changed = true;
    return { ...message, deliveryState: 'confirming' as const };
  });
  return changed ? next : messages;
}
