import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { findChatMessages, type ChatFindMatch } from '@/features/chat/find/chat-find-api';
import {
  clearChatFindHighlights,
  collectChatFindMatches,
  renderChatFindHighlights,
  scrollChatFindMatchIntoView,
  type ChatFindDomMatch,
} from '@/features/chat/find/chat-find-dom';
import type { Message } from '@/features/chat/messages/messages.types';

function wraps(index: number, count: number): number {
  if (count === 0) return 0;
  return (index + count) % count;
}

function matchKey(match: ChatFindMatch): string {
  return `${match.displayIndex}:${match.occurrence}`;
}

function sameDomMatches(left: readonly ChatFindDomMatch[], right: readonly ChatFindDomMatch[]): boolean {
  return left.length === right.length && left.every((match, index) => {
    const candidate = right[index];
    return candidate?.messageIndex === match.messageIndex
      && candidate.occurrence === match.occurrence
      && candidate.range.startContainer === match.range.startContainer
      && candidate.range.startOffset === match.range.startOffset
      && candidate.range.endContainer === match.range.endContainer
      && candidate.range.endOffset === match.range.endOffset;
  });
}

export function useChatFind({
  conversationId,
  taskId,
  messages,
  displayOffset,
  viewportRef,
  onRevealDisplayIndex,
}: {
  conversationId: string | null;
  taskId?: string | null;
  messages: Message[];
  displayOffset: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  onRevealDisplayIndex: (displayIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [domMatches, setDomMatches] = useState<ChatFindDomMatch[]>([]);
  const [remoteMatches, setRemoteMatches] = useState<ChatFindMatch[]>([]);
  const [remoteTruncated, setRemoteTruncated] = useState(false);
  const [limitedToLoaded, setLimitedToLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousConversationRef = useRef(conversationId);
  const deferredQuery = useDeferredValue(query);

  const combinedMatches = useMemo(() => {
    const byKey = new Map(remoteMatches.map((match) => [matchKey(match), match]));
    for (const match of domMatches) {
      const projected = {
        displayIndex: displayOffset + match.messageIndex,
        occurrence: match.occurrence,
      };
      byKey.set(matchKey(projected), projected);
    }
    return [...byKey.values()].sort((a, b) =>
      a.displayIndex - b.displayIndex || a.occurrence - b.occurrence);
  }, [displayOffset, domMatches, remoteMatches]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const show = useCallback(() => {
    if (!open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
      return;
    }
    focusInput();
  }, [focusInput, open]);

  useLayoutEffect(() => {
    if (open) focusInput();
  }, [focusInput, open]);

  const close = useCallback(() => {
    setOpen(false);
    setQueryState('');
    setDomMatches([]);
    setRemoteMatches([]);
    setRemoteTruncated(false);
    setLimitedToLoaded(false);
    setSearching(false);
    setActiveIndex(0);
    clearChatFindHighlights();
    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
  }, []);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setActiveIndex(0);
  }, []);

  const move = useCallback((delta: number) => {
    setActiveIndex((current) => wraps(current + delta, combinedMatches.length));
  }, [combinedMatches.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (commandKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return;
        event.preventDefault();
        show();
        return;
      }
      if (!open) return;
      if (commandKey && !event.altKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        move(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, move, open, show]);

  useLayoutEffect(() => {
    const root = viewportRef.current;
    if (!open || !root || !deferredQuery.trim()) {
      setDomMatches((current) => current.length === 0 ? current : []);
      clearChatFindHighlights();
      return;
    }
    const next = collectChatFindMatches(root, deferredQuery);
    setDomMatches((current) => sameDomMatches(current, next) ? current : next);
  }, [deferredQuery, messages, open, viewportRef]);

  useEffect(() => {
    const normalized = deferredQuery.trim();
    if (!open || !conversationId || !normalized) {
      setRemoteMatches([]);
      setRemoteTruncated(false);
      setLimitedToLoaded(false);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setRemoteMatches([]);
    setRemoteTruncated(false);
    setLimitedToLoaded(false);
    setSearching(true);
    const timer = window.setTimeout(() => {
      void findChatMessages(conversationId, normalized, { taskId, signal: controller.signal })
        .then((result) => {
          setRemoteMatches(result.matches);
          setRemoteTruncated(result.truncated);
        })
        .catch((error) => {
          if ((error as { name?: unknown })?.name === 'AbortError') return;
          setRemoteMatches([]);
          setRemoteTruncated(false);
          setLimitedToLoaded(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [conversationId, deferredQuery, open, taskId]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, combinedMatches.length - 1)));
  }, [combinedMatches.length]);

  useLayoutEffect(() => {
    const target = combinedMatches[activeIndex];
    const root = viewportRef.current;
    if (!root || !target) {
      renderChatFindHighlights(domMatches, -1);
      return;
    }
    const localMessageIndex = target.displayIndex - displayOffset;
    const domActiveIndex = domMatches.findIndex((match) =>
      match.messageIndex === localMessageIndex && match.occurrence === target.occurrence);
    renderChatFindHighlights(domMatches, domActiveIndex);
    if (domActiveIndex >= 0) {
      scrollChatFindMatchIntoView(root, domMatches[domActiveIndex]);
    } else {
      onRevealDisplayIndex(target.displayIndex);
    }
  }, [activeIndex, combinedMatches, displayOffset, domMatches, onRevealDisplayIndex, viewportRef]);

  useEffect(() => () => clearChatFindHighlights(), []);

  useEffect(() => {
    if (previousConversationRef.current === conversationId) return;
    previousConversationRef.current = conversationId;
    if (open) close();
  }, [close, conversationId, open]);

  return {
    open,
    query,
    inputRef,
    activeIndex,
    resultCount: combinedMatches.length,
    truncated: remoteTruncated,
    limitedToLoaded,
    searching,
    setQuery,
    show,
    close,
    previous: () => move(-1),
    next: () => move(1),
  };
}
