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

  const ghost = bubble.cloneNode(true) as HTMLElement;
  if (typeof ghost.animate !== 'function') return () => {};
  const article = bubble.closest<HTMLElement>('article');
  if (article) article.style.animation = 'none';
  const settledTarget = bubble.getBoundingClientRect();
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('data-personal-send-ghost', '');
  ghost.inert = true;
  ghost.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${settledTarget.left}px`,
    top: `${settledTarget.top}px`,
    width: `${settledTarget.width}px`,
    maxWidth: 'none',
    margin: '0',
    zIndex: '100',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  });
  const previousVisibility = bubble.style.visibility;
  bubble.style.visibility = 'hidden';
  document.body.appendChild(ghost);

  const dx = source.left - settledTarget.left;
  const dy = source.top - settledTarget.top;
  let animation: Animation;
  try {
    animation = ghost.animate([
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.96)`, opacity: 0.55 },
      { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
    ], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
  } catch {
    bubble.style.visibility = previousVisibility;
    ghost.remove();
    return () => {};
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    bubble.style.visibility = previousVisibility;
    ghost.remove();
    viewport.removeEventListener('wheel', finish);
    viewport.removeEventListener('touchstart', finish);
    window.removeEventListener('resize', finish);
    animation.cancel();
  };
  viewport.addEventListener('wheel', finish, { passive: true });
  viewport.addEventListener('touchstart', finish, { passive: true });
  window.addEventListener('resize', finish);
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

  const clear = useCallback(() => {
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timeout);
    pendingRef.current = null;
    finishRef.current?.();
    finishRef.current = null;
  }, []);

  const onDispatched = useCallback((receipt: ComposerDispatchReceipt, source: DOMRect, draft: ComposerDraft) => {
    clear();
    if (!enabled || !conversationId || draft.attachments.length > 0 || draft.contextRefs.length > 0
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
  }, [clear, conversationId, enabled]);

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

  useEffect(() => clear, [clear, conversationId, enabled]);

  return onDispatched;
}
