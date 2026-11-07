import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import type { ComposerDispatchReceipt, ComposerDraft } from '@/features/chat/composer/composer.types';
import type { Message } from '@/features/chat/messages/messages.types';

type Point = { left: number; top: number; right: number; bottom: number };
type PendingSend = { id: string; source: Point; timeout: number };

function visibleWithin(rect: Point, viewport: Point): boolean {
  return rect.bottom > viewport.top && rect.top < viewport.bottom
    && rect.right > viewport.left && rect.left < viewport.right;
}

function animateSend(source: Point, bubble: HTMLElement, viewport: HTMLElement): () => void {
  const viewportRect = viewport.getBoundingClientRect();
  const target = bubble.getBoundingClientRect();
  if (!visibleWithin(source, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })
    || !visibleWithin(target, viewportRect)) return () => {};

  if (typeof bubble.animate !== 'function') return () => {};
  const article = bubble.closest<HTMLElement>('article');
  if (article) article.style.animation = 'none';
  // Keep the real bubble in the transcript so reconciliation cannot strand a
  // hidden row. The full displacement preserves continuity with the composer.
  const settledTarget = bubble.getBoundingClientRect();
  const dx = source.left - settledTarget.left;
  const dy = source.top - settledTarget.top;
  const duration = 360;
  let animation: Animation;
  try {
    animation = bubble.animate([
      { transform: `translate3d(${dx}px, ${dy}px, 0)` },
      { transform: 'translate3d(0, 0, 0)' },
    ], { duration, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' });
  } catch {
    return () => {};
  }

  let finished = false;
  let restoreTimer: number | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    viewport.removeEventListener('scroll', onScroll);
    viewport.removeEventListener('wheel', finish);
    viewport.removeEventListener('touchstart', finish);
    window.removeEventListener('resize', finish);
    animation.cancel();
  };
  const onScroll = () => {
    // The bubble's own animated rect moves every frame. Check its layout row
    // instead, allowing automatic tail scrolling to accompany the flight.
    const row = bubble.closest<HTMLElement>('[data-chat-message-row]');
    if (!bubble.isConnected || (row && !visibleWithin(row.getBoundingClientRect(), viewport.getBoundingClientRect()))) finish();
  };
  viewport.addEventListener('scroll', onScroll, { passive: true });
  viewport.addEventListener('wheel', finish, { passive: true });
  viewport.addEventListener('touchstart', finish, { passive: true });
  window.addEventListener('resize', finish);
  // Settle interrupted animations promptly, including background tabs.
  restoreTimer = window.setTimeout(finish, duration + 150);
  void animation.finished.then(finish, finish);
  return finish;
}

/** Visual-only handoff from the Personal AI composer to its optimistic user bubble. */
export function usePersonalSendTransition({
  enabled,
  conversationId,
  messages,
  viewportRef,
}: {
  enabled: boolean;
  conversationId: string | null;
  messages: Message[];
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const pendingRef = useRef<PendingSend | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const previousConversationRef = useRef(conversationId);

  const clear = useCallback(() => {
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timeout);
    pendingRef.current = null;
    finishRef.current?.();
    finishRef.current = null;
  }, []);

  const onDispatched = useCallback((receipt: ComposerDispatchReceipt, source: DOMRect, draft: ComposerDraft) => {
    clear();
    if (!enabled || draft.attachments.length > 0 || draft.contextRefs.length > 0
      || !draft.text.trim()
      || document.visibilityState === 'hidden'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const pending: PendingSend = {
      id: receipt.clientSubmissionId,
      source: { left: source.left, top: source.top, right: source.right, bottom: source.bottom },
      timeout: window.setTimeout(() => {
        if (pendingRef.current === pending) pendingRef.current = null;
      }, 500),
    };
    pendingRef.current = pending;
  }, [clear, enabled]);

  useLayoutEffect(() => {
    const previous = previousConversationRef.current;
    previousConversationRef.current = conversationId;
    // Creating the first conversation must not cancel its accepted send.
    if (previous !== null && previous !== conversationId) clear();
  }, [clear, conversationId]);

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const viewport = viewportRef.current;
    if (!pending || !viewport || !messages.some((message) => message.clientSubmissionId === pending.id)) return;
    window.clearTimeout(pending.timeout);
    pendingRef.current = null;
    const row = viewport.querySelector<HTMLElement>(`[data-client-submission-id="${pending.id}"]`);
    const bubble = row?.querySelector<HTMLElement>('.chat-user-message');
    if (bubble) finishRef.current = animateSend(pending.source, bubble, viewport);
  }, [messages, viewportRef]);

  useEffect(() => clear, [clear, enabled]);

  return onDispatched;
}
