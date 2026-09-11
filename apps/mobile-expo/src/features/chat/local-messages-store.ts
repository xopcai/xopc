import { create } from 'zustand';

import type { Message } from './messages.types';

const EMPTY_MESSAGES: Message[] = [];

/** In-memory message UI state; nothing is sent on reconnect or app startup. */
export const useLocalMessagesStore = create<{
  sessions: Record<string, Message[]>;
  update: (scope: string, update: (messages: Message[]) => Message[]) => void;
}>((set) => ({
  sessions: {},
  update: (scope, update) => set(state => ({
    sessions: { ...state.sessions, [scope]: update(state.sessions[scope] ?? EMPTY_MESSAGES) },
  })),
}));

export function localMessageScope(gatewayId: string | null, sessionKey: string): string {
  return JSON.stringify([gatewayId, sessionKey]);
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

/** A session input-state event is an authoritative acknowledgement from the gateway. */
export function acknowledgeLocalSessionInputs(
  messages: Message[],
  inputs: unknown,
): Message[] {
  if (!Array.isArray(inputs)) return messages;
  const acceptedIds = new Set(inputs.flatMap((input) => {
    if (!input || typeof input !== 'object') return [];
    const clientMessageId = (input as { clientMessageId?: unknown }).clientMessageId;
    return typeof clientMessageId === 'string' && clientMessageId ? [clientMessageId] : [];
  }));
  if (acceptedIds.size === 0) return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (!message.id || !acceptedIds.has(message.id) || message.deliveryState === 'sent') return message;
    changed = true;
    return { ...message, deliveryState: 'sent' as const };
  });
  return changed ? next : messages;
}
