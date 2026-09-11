/**
 * View-layer helpers for web chat session isolation.
 * Product contract: docs/web/chat-session-semantics.md
 */
import type { Message } from '@/features/chat/messages/messages.types';
import {
  isViewingSession,
  resolveViewSessionKey,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
} from '@/features/chat/session/should-apply-stream-update';

export {
  isViewingSession,
  resolveViewSessionKey,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
};

/** Route param for session isolation (`new` when on `/chat/new`). */
export function parseRoutedSessionKey(
  isNewRoute: boolean,
  decodedKey: string | undefined,
): string | null {
  return isNewRoute ? 'new' : (decodedKey ?? null);
}

/** A route placeholder is never a persisted session key. */
export function decodeConcreteSessionKey(
  isNewRoute: boolean,
  sessionKeyParam: string | undefined,
): string | undefined {
  if (isNewRoute || !sessionKeyParam) return undefined;
  return decodeURIComponent(sessionKeyParam);
}

/** Messages rendered in the message list (committed + optional streaming bubble). */
export function selectDisplayMessages(params: {
  viewSessionKey: string | null;
  sessionKey: string | null;
  messages: Message[];
  streamingMsg: Message | null;
}): Message[] {
  if (!params.viewSessionKey || params.sessionKey !== params.viewSessionKey) {
    return [];
  }
  if (!params.streamingMsg) return params.messages;
  return [...params.messages, params.streamingMsg];
}

/** Extract only a persisted assistant tail that belongs to the run being resumed. */
export function extractResumeTailForRun(
  messages: Message[],
  runId: string,
): { messagesWithoutTail: Message[]; tail: Message } | null {
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant' || last.turnId !== runId) return null;
  return { messagesWithoutTail: messages.slice(0, -1), tail: last };
}

/** Reset visible React chat shell only; does not stop background agent runs. */
export function detachChatViewOnly(resetUi: () => void): void {
  resetUi();
}
