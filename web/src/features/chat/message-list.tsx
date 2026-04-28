import { measureElement, useVirtualizer } from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';

import { ChatWelcomeSpotlight } from '@/features/chat/chat-welcome-spotlight';
import { MessageBubble } from '@/features/chat/message-bubble';
import type { Message, ProgressState, ReasoningLevel } from '@/features/chat/messages.types';
import { messageRowKey } from '@/features/chat/thinking-blocks';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

/** Tailwind `gap-10` (2.5rem) between bubbles; `pb-8` (2rem) bottom padding — match pre-virtual layout. */
const MESSAGE_GAP_PX = 40;
const MESSAGE_LIST_PADDING_END_PX = 32;

export const MessageList = memo(function MessageList({
  messages: list,
  authToken,
  sessionKey,
  streaming,
  progress,
  reasoningLevel,
  scrollElementRef,
  pinToBottom,
  onPickWelcomePrompt,
  welcomeOverlay,
  onDeleteRound,
  deleteRoundDisabled,
}: {
  messages: Message[];
  authToken?: string;
  sessionKey?: string | null;
  streaming: boolean;
  progress: ProgressState | null;
  reasoningLevel: ReasoningLevel;
  /** Scrollable viewport (ChatPage `chat-messages`); required whenever the list is shown. */
  scrollElementRef: RefObject<HTMLDivElement | null>;
  /** When true, keep the last row aligned to the bottom as virtual row heights are measured. */
  pinToBottom: boolean;
  /** Empty-state quick prompts — fills the composer when chosen. */
  onPickWelcomePrompt?: (text: string) => void;
  /** When set (e.g. inline onboarding), replaces default welcome / spotlight. */
  welcomeOverlay?: ReactNode;
  /** Delete a user message round (user + assistant) by message index. */
  onDeleteRound?: (messageIndex: number) => void;
  /** Omit delete-round control while sending/streaming. */
  deleteRoundDisabled?: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);

  const showWelcome = list.length === 0 && !streaming;
  const count = showWelcome ? 0 : list.length;

  const virtualizer = useVirtualizer({
    count,
    enabled: !showWelcome,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 200,
    gap: MESSAGE_GAP_PX,
    paddingEnd: MESSAGE_LIST_PADDING_END_PX,
    overscan: 8,
    getItemKey: (index) => messageRowKey(list[index], index),
    measureElement,
  });

  const contentRef = useRef<HTMLDivElement>(null);
  const pinToBottomRef = useRef(pinToBottom);
  pinToBottomRef.current = pinToBottom;

  const scrollLastToEnd = useCallback(() => {
    const c = virtualizer.options.count;
    if (c === 0) return;
    virtualizer.scrollToIndex(c - 1, { align: 'end', behavior: 'auto' });
  }, [virtualizer]);

  /** User clicked “scroll to bottom” or list length changed while pinned — height may not change. */
  useLayoutEffect(() => {
    if (!pinToBottom || list.length === 0) return;
    scrollLastToEnd();
  }, [pinToBottom, list.length, scrollLastToEnd]);

  /** Virtual row heights grow after first paint; keep pinned without waiting for `chatMessages` identity changes. */
  useEffect(() => {
    if (!pinToBottom || list.length === 0) return;
    const el = contentRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (!pinToBottomRef.current) return;
        scrollLastToEnd();
      });
    });
    ro.observe(el);
    requestAnimationFrame(() => {
      if (!pinToBottomRef.current) return;
      scrollLastToEnd();
    });
    return () => ro.disconnect();
  }, [pinToBottom, list.length, scrollLastToEnd]);

  if (showWelcome) {
    if (welcomeOverlay) {
      return <div className="flex w-full flex-col items-center pb-6 pt-4">{welcomeOverlay}</div>;
    }
    if (onPickWelcomePrompt && m.chat.welcomeSpotlight) {
      return (
        <div className="pb-1.5">
          <ChatWelcomeSpotlight chat={m.chat} onPickPrompt={onPickWelcomePrompt} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-10 pb-8">
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="text-4xl" aria-hidden>
            🤖
          </div>
          <div className="text-xl font-semibold tracking-tight text-fg">{m.chat.welcomeTitle}</div>
          <div className="max-w-sm text-sm leading-relaxed text-fg-muted">{m.chat.welcomeDescription}</div>
        </div>
      </div>
    );
  }

  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={contentRef} className="relative w-full min-w-0" style={{ height: totalSize }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const msg = list[virtualRow.index];
        if (!msg) return null;
        const isLast = virtualRow.index === list.length - 1;
        const isStreamRow = Boolean(streaming && isLast && msg.role === 'assistant');
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full min-w-0"
            style={{
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <MessageBubble
              message={msg}
              authToken={authToken}
              sessionKey={sessionKey}
              isStreaming={isStreamRow}
              progress={isStreamRow ? progress : null}
              reasoningLevel={reasoningLevel}
              messageIndex={virtualRow.index}
              onDeleteRound={onDeleteRound}
              deleteRoundDisabled={deleteRoundDisabled}
            />
          </div>
        );
      })}
    </div>
  );
});
