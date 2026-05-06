import type { Message, ProgressState } from '@/features/chat/messages.types';
import { cloneMessageForRender, ensureAssistantMessage } from '@/features/chat/streaming';

export type LiveSessionUiSnapshot = {
  messages: Message[];
  streamingMsg: Message | null;
  progress: ProgressState | null;
  sending: boolean;
  streaming: boolean;
};

const store = new Map<string, LiveSessionUiSnapshot>();

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((m) => cloneMessageForRender(m));
}

/** Start or replace the live snapshot for an in-flight webchat turn (send or resume). */
export function initLiveSessionCache(sessionKey: string, snapshot: LiveSessionUiSnapshot): void {
  store.set(sessionKey, {
    messages: cloneMessages(snapshot.messages),
    streamingMsg: snapshot.streamingMsg ? cloneMessageForRender(snapshot.streamingMsg) : null,
    progress: snapshot.progress,
    sending: snapshot.sending,
    streaming: snapshot.streaming,
  });
}

export function clearLiveSessionCache(sessionKey: string): void {
  store.delete(sessionKey);
}

export function getLiveSessionCache(sessionKey: string): LiveSessionUiSnapshot | undefined {
  const e = store.get(sessionKey);
  if (!e) return undefined;
  return {
    messages: cloneMessages(e.messages),
    streamingMsg: e.streamingMsg ? cloneMessageForRender(e.streamingMsg) : null,
    progress: e.progress,
    sending: e.sending,
    streaming: e.streaming,
  };
}

/** If no cache yet (e.g. resume), seed from the current committed message list. */
export function seedLiveSessionCacheIfEmpty(sessionKey: string, messages: Message[], sending: boolean, streaming: boolean): void {
  if (store.has(sessionKey)) return;
  initLiveSessionCache(sessionKey, {
    messages,
    streamingMsg: null,
    progress: null,
    sending,
    streaming,
  });
}

export function liveSessionCacheSetFlags(
  sessionKey: string,
  partial: Partial<Pick<LiveSessionUiSnapshot, 'sending' | 'streaming'>>,
): void {
  const e = store.get(sessionKey);
  if (!e) return;
  if (partial.sending !== undefined) e.sending = partial.sending;
  if (partial.streaming !== undefined) e.streaming = partial.streaming;
}

export function liveSessionCacheSetProgress(sessionKey: string, progress: ProgressState | null): void {
  const e = store.get(sessionKey);
  if (!e) return;
  e.progress = progress;
}

/**
 * Mutate the in-progress assistant bubble in the cache (authoritative while the tab shows another chat).
 * `mutator` receives a fresh assistant shell from {@link ensureAssistantMessage}.
 */
export function liveSessionCacheMutateStreaming(
  sessionKey: string,
  mutator: (msg: Message) => void,
  timestamp = Date.now(),
): void {
  const e = store.get(sessionKey);
  if (!e) return;
  const shell = ensureAssistantMessage(e.streamingMsg, timestamp);
  mutator(shell);
  e.streamingMsg = cloneMessageForRender(shell);
  e.streaming = true;
}

/** After resume hydration: committed rows + tail assistant live in cache. */
export function liveSessionCacheApplyHydratedTail(
  sessionKey: string,
  messagesWithoutTail: Message[],
  tail: Message | null,
): void {
  const e = store.get(sessionKey);
  if (!e) return;
  e.messages = cloneMessages(messagesWithoutTail);
  e.streamingMsg = tail ? cloneMessageForRender(tail) : null;
  e.streaming = true;
  e.sending = true;
}
