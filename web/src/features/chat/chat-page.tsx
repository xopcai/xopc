import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChatComposer } from '@/features/chat/chat-composer';
import { ChatHeader } from '@/features/chat/chat-header';
import { ChatSseStatus } from '@/features/chat/chat-sse-status';
import { MessageList } from '@/features/chat/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll-to-bottom-button';
import { useChatSession } from '@/features/chat/use-chat-session';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

export function ChatPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const token = useGatewayStore((s) => s.token);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastClientHeightRef = useRef(0);
  /** Tracks loading→idle so we scroll to bottom once after refresh / session load. */
  const prevLoadingRef = useRef(true);

  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  const {
    messages: chatMessages,
    sessionKey,
    sessionName,
    sessionModel,
    thinkingLevel,
    setThinkingLevel,
    modelSupportsThinking,
    hasMore,
    loadingMore,
    loadMoreMessages,
    onSessionModelChange,
    createNewSession,
    loading,
    error,
    streaming,
    sending,
    progress,
    sendMessage,
    abort,
    hasToken,
  } = useChatSession();

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      const before = el.scrollHeight;
      requestAnimationFrame(() => {
        if (scrollRef.current && scrollRef.current.scrollHeight > before) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
          });
        }
      });
    });
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const fromBottom = scrollHeight - scrollTop - clientHeight;

    if (clientHeight < lastClientHeightRef.current) {
      lastClientHeightRef.current = clientHeight;
      return;
    }
    if (scrollTop !== 0 && scrollTop < lastScrollTopRef.current && fromBottom > 50) {
      setAtBottom(false);
    } else if (fromBottom < 10) {
      setAtBottom(true);
    }
    lastScrollTopRef.current = scrollTop;
    lastClientHeightRef.current = clientHeight;

    if (scrollTop < 100 && !atBottomRef.current && hasMore && !loadingMore) {
      void loadMoreMessages();
    }
  }, [hasMore, loadingMore, loadMoreMessages]);

  useLayoutEffect(() => {
    if (!hasToken) return;
    if (loading) {
      prevLoadingRef.current = true;
      return;
    }
    if (prevLoadingRef.current !== true) return;
    prevLoadingRef.current = false;
    setAtBottom(true);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    requestAnimationFrame(() => {
      scrollToBottom(false);
      requestAnimationFrame(() => scrollToBottom(false));
    });
  }, [loading, hasToken, scrollToBottom]);

  // Follow the bottom whenever message content updates (not just length): streaming updates
  // the same assistant bubble without changing length.
  useEffect(() => {
    if (!atBottom) return;
    scrollToBottom(false);
  }, [chatMessages, atBottom, scrollToBottom]);

  if (!hasToken) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm leading-relaxed text-fg-muted sm:px-8">
        {m.chat.needToken}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm text-fg-muted sm:px-8">
        {m.chat.loading}
      </div>
    );
  }

  return (
    <div className="chat-shell flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      <ChatSseStatus />
      <ChatHeader
        sessionKey={sessionKey}
        sessionName={sessionName}
        sessionModel={sessionModel}
        streaming={streaming}
        onModelChange={onSessionModelChange}
        onNewSession={() => void createNewSession()}
      />

      <div
        ref={scrollRef}
        className="chat-messages min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
        onScroll={onScroll}
      >
        <div className="chat-messages-inner mx-auto max-w-4xl px-4 py-6 sm:px-8">
          {loadingMore ? (
            <div className="mb-3 text-center text-xs text-fg-muted">{m.chat.loadOlder}</div>
          ) : null}
          {error ? (
            <div className="mb-4 rounded-md border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}
          <MessageList
            messages={chatMessages}
            authToken={token ?? undefined}
            streaming={streaming}
            progress={progress}
          />
        </div>
      </div>

      <ScrollToBottomButton visible={!atBottom} onClick={() => scrollToBottom(true)} />

      <div className="chat-input-container shrink-0">
        <ChatComposer
          disabled={false}
          sending={sending}
          streaming={streaming}
          thinkingLevel={thinkingLevel}
          showThinkingSelector={modelSupportsThinking}
          onThinkingChange={setThinkingLevel}
          onSend={sendMessage}
          onAbort={abort}
        />
      </div>
    </div>
  );
}
