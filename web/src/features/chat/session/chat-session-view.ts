/**
 * View-layer helpers for web chat session isolation.
 * Product contract: docs/web/chat-session-semantics.md
 */
import type { Message } from '@/features/chat/messages/messages.types';
import { mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import {
  isViewingSession,
  resolveViewConversationId,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
} from '@/features/chat/session/should-apply-stream-update';

export {
  isViewingSession,
  resolveViewConversationId,
  shouldApplyStreamUpdateToView,
  shouldRestoreLiveCacheToView,
};

/** Route param for session isolation (`new` when on `/chat/new`). */
export function parseRoutedConversationId(
  isNewRoute: boolean,
  decodedKey: string | undefined,
): string | null {
  return isNewRoute ? 'new' : (decodedKey ?? null);
}

/** A route placeholder is never a persisted session key. */
export function decodeConcreteConversationId(
  isNewRoute: boolean,
  conversationIdParam: string | undefined,
): string | undefined {
  if (isNewRoute || !conversationIdParam) return undefined;
  return decodeURIComponent(conversationIdParam);
}

/** Messages rendered in the message list (committed + optional streaming bubble). */
export function selectDisplayMessages(params: {
  viewConversationId: string | null;
  conversationId: string | null;
  messages: Message[];
  streamingMsg: Message | null;
}): Message[] {
  if (!params.viewConversationId || params.conversationId !== params.viewConversationId) {
    return [];
  }
  if (!params.streamingMsg) return params.messages;
  const boundary = params.messages.findLastIndex(message => !message.pendingSteer) + 1;
  const pending = params.messages.slice(boundary);
  const last = params.messages[boundary - 1];
  if (pending.length && !params.streamingMsg.content.length && !params.streamingMsg.attachments?.length) {
    return [...params.messages, params.streamingMsg];
  }
  if (last?.role === 'assistant' && params.streamingMsg.role === 'assistant') {
    const mergedTail = mergeConsecutiveAssistantMessages([last, params.streamingMsg]);
    return [...params.messages.slice(0, boundary - 1), ...mergedTail, ...pending];
  }
  return [...params.messages.slice(0, boundary), params.streamingMsg, ...pending];
}

/** Extract only a persisted assistant tail that belongs to the run being resumed. */
export function extractResumeTailForRun(
  messages: Message[],
  runId: string,
): { messagesWithoutTail: Message[]; tail: Message } | null {
  const index = messages.findLastIndex(message => !message.pendingSteer);
  const last = messages[index];
  if (last?.role !== 'assistant' || last.turnId !== runId) return null;
  return { messagesWithoutTail: [...messages.slice(0, index), ...messages.slice(index + 1)], tail: last };
}

/** Reset visible React chat shell only; does not stop background agent runs. */
export function detachChatViewOnly(resetUi: () => void): void {
  resetUi();
}
