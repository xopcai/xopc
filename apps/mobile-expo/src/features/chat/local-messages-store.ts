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
