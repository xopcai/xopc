import { measureElement, useVirtualizer } from '@tanstack/react-virtual';
import { memo, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';

import { MessageBubble } from '@/features/chat/message-bubble';
import type { Message, ProgressState } from '@/features/chat/messages.types';
import { messageRowKey } from '@/features/chat/thinking-blocks';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

/** Tailwind `gap-10` (2.5rem) between bubbles; `pb-8` (2rem) bottom padding — match pre-virtual layout. */
const MESSAGE_GAP_PX = 40;
const MESSAGE_LIST_PADDING_END_PX = 32;

export const MessageList = memo(function MessageList({
  messages: list,
  authToken,
  streaming,
  progress,
  scrollElementRef,
  executionDrawerOpen = false,
  drawerPinBottomIntentRef,
}: {
  messages: Message[];
  authToken?: string;
  streaming: boolean;
  progress: ProgressState | null;
  /** Scrollable viewport (ChatPage `chat-messages`); required whenever the list is shown. */
  scrollElementRef: RefObject<HTMLDivElement | null>;
  /** When the execution drawer toggles, column width changes and row heights remeasure — DOM scrollTop alone is not enough. */
  executionDrawerOpen?: boolean;
  /** Set `{ pin: true }` in the same render as `executionDrawerOpen` changes when the user was at the bottom. */
  drawerPinBottomIntentRef?: MutableRefObject<{ pin: boolean }>;
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

  const prevDrawerOpenRef = useRef(executionDrawerOpen);

  useLayoutEffect(() => {
    if (showWelcome || count === 0) return;
    if (prevDrawerOpenRef.current === executionDrawerOpen) return;
    prevDrawerOpenRef.current = executionDrawerOpen;
    const intent = drawerPinBottomIntentRef?.current;
    if (!intent?.pin) return;
    intent.pin = false;

    const lastIdx = count - 1;
    const pinToEnd = () => {
      virtualizer.scrollToIndex(lastIdx, { align: 'end', behavior: 'auto' });
    };

    pinToEnd();
    requestAnimationFrame(pinToEnd);
    requestAnimationFrame(() => {
      requestAnimationFrame(pinToEnd);
    });

    const scrollEl = scrollElementRef.current;
    if (!scrollEl) return;

    let resizeCalls = 0;
    const ro = new ResizeObserver(() => {
      pinToEnd();
      resizeCalls += 1;
      if (resizeCalls >= 16) ro.disconnect();
    });
    ro.observe(scrollEl);
    const t = window.setTimeout(() => ro.disconnect(), 280);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
    // virtualizer intentionally omitted: identity can change every render; scrollToIndex uses latest closure.
  }, [count, drawerPinBottomIntentRef, executionDrawerOpen, scrollElementRef, showWelcome]);

  if (showWelcome) {
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
    <div className="relative w-full min-w-0" style={{ height: totalSize }}>
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
              isStreaming={isStreamRow}
              progress={isStreamRow ? progress : null}
              messageIndex={virtualRow.index}
            />
          </div>
        );
      })}
    </div>
  );
});
