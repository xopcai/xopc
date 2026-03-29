import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Message } from '@/features/chat/messages.types';
import { ChatComposer } from '@/features/chat/chat-composer';
import { ChatHeaderBar } from '@/features/chat/chat-header-bar';
import { ChatSseStatus } from '@/features/chat/chat-sse-status';
import { ExecutionProcessDrawer } from '@/features/chat/execution-process-drawer';
import { MessageList } from '@/features/chat/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll-to-bottom-button';
import { useChatSession } from '@/features/chat/use-chat-session';
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useChatExecutionDrawerStore } from '@/stores/chat-execution-drawer-store';
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
  /** While true, ignore scroll events (layout from drawer toggle can fire scroll before we re-pin to bottom). */
  const suppressScrollPinRef = useRef(false);
  /** Virtual list must use `scrollToIndex`; set `pin` when drawer toggles and user was at bottom. */
  const drawerPinIntentRef = useRef({ pin: false });
  /** Tracks loading→idle so we scroll to bottom once after refresh / session load. */
  const prevLoadingRef = useRef(true);

  /** After prepending older messages, preserve viewport (virtual + non-virtual lists). */
  const listScrollMetricsRef = useRef<{
    first: Message | undefined;
    len: number;
    scrollHeight: number;
  }>({ first: undefined, len: 0, scrollHeight: 0 });

  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  const {
    messages: chatMessages,
    sessionKey,
    sessionName,
    decodedKey,
    sessionRoutePending,
    showSessionLoading,
    sessionModel,
    thinkingLevel,
    setThinkingLevel,
    modelSupportsThinking,
    hasMore,
    loadingMore,
    loadMoreMessages,
    onSessionModelChange,
    error,
    streaming,
    sending,
    progress,
    sendMessage,
    abort,
    hasToken,
  } = useChatSession();

  const closeExecutionDrawer = useChatExecutionDrawerStore((s) => s.closeDrawer);
  const executionDrawerOpen = useChatExecutionDrawerStore((s) => s.open);
  const prevDrawerOpenForPinRef = useRef(executionDrawerOpen);

  if (prevDrawerOpenForPinRef.current !== executionDrawerOpen) {
    prevDrawerOpenForPinRef.current = executionDrawerOpen;
    if (!showSessionLoading) {
      const pin = atBottomRef.current;
      drawerPinIntentRef.current = { pin };
      suppressScrollPinRef.current = pin;
    }
  }

  const prevFirstMessageRef = useRef<Message | undefined>(undefined);
  useEffect(() => {
    const first = chatMessages[0];
    const prev = prevFirstMessageRef.current;
    if (prev !== undefined && first !== undefined && first !== prev) {
      closeExecutionDrawer();
    }
    prevFirstMessageRef.current = first;
  }, [chatMessages, closeExecutionDrawer]);

  useEffect(() => {
    closeExecutionDrawer();
  }, [sessionKey, closeExecutionDrawer]);

  const chatHeadline = useMemo(() => {
    const titleKey = sessionRoutePending && decodedKey ? decodedKey : sessionKey;
    if (!titleKey) return m.nav.chat;
    return sessionName?.trim() || m.chat.newSession;
  }, [sessionKey, sessionName, sessionRoutePending, decodedKey, m.nav.chat, m.chat.newSession]);

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

  // Clear suppress after virtualizer + ResizeObserver pin (MessageList); until then ignore spurious onScroll.
  useLayoutEffect(() => {
    if (showSessionLoading) {
      suppressScrollPinRef.current = false;
      return;
    }
    if (!suppressScrollPinRef.current) return;
    const t = window.setTimeout(() => {
      suppressScrollPinRef.current = false;
    }, 340);
    return () => window.clearTimeout(t);
  }, [executionDrawerOpen, showSessionLoading]);

  const onScroll = useCallback(() => {
    if (suppressScrollPinRef.current) return;
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
    if (showSessionLoading) {
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
  }, [showSessionLoading, hasToken, scrollToBottom]);

  // User scrolled up then sent: re-enable follow mode and scroll to the new message.
  useEffect(() => {
    if (!sending) return;
    if (showSessionLoading) return;
    setAtBottom(true);
    scrollToBottom(true);
  }, [sending, showSessionLoading, scrollToBottom]);

  // Follow the bottom whenever message content updates (not just length): streaming updates
  // the same assistant bubble without changing length.
  useEffect(() => {
    if (showSessionLoading) return;
    if (!atBottom) return;
    scrollToBottom(false);
  }, [chatMessages, atBottom, scrollToBottom, showSessionLoading]);

  const isNewChat =
    !showSessionLoading &&
    !sessionRoutePending &&
    chatMessages.length === 0 &&
    !sending &&
    !streaming;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || showSessionLoading) return;

    const prev = listScrollMetricsRef.current;
    const first = chatMessages[0];
    const len = chatMessages.length;
    const newHeight = el.scrollHeight;

    const prepended = len > prev.len && prev.len > 0 && first !== undefined && first !== prev.first;

    if (prepended && prev.scrollHeight > 0) {
      el.scrollTop += newHeight - prev.scrollHeight;
    }

    listScrollMetricsRef.current = { first, len, scrollHeight: newHeight };
  }, [chatMessages, showSessionLoading]);

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-[var(--max-width-chat)] px-3 py-16 text-center text-sm leading-relaxed text-fg-muted sm:px-5">
        {m.chat.needToken}
      </div>
    );
  }

  return (
    <div className="chat-shell flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      <ChatSseStatus />

      {/* Drawer closed: single centered column. Drawer open (lg): grid animates column widths (no abrupt flex jump). */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          /* No transition on grid-template-columns: animating fr widths reflows wrapped text every frame → visible flicker. */
          'lg:grid lg:min-h-0 lg:grid-rows-1',
          executionDrawerOpen
            ? 'lg:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)]'
            : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0fr)]',
        )}
      >
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            executionDrawerOpen ? 'lg:min-w-0' : 'mx-auto w-full max-w-[var(--max-width-chat)]',
          )}
        >
          <ChatHeaderBar
            chatHeadline={chatHeadline}
            sessionModel={sessionModel}
            showModelSelector={Boolean(sessionKey && !sessionRoutePending)}
            onModelChange={onSessionModelChange}
            modelDisabled={showSessionLoading || sessionRoutePending || streaming}
          />

          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col px-3 sm:px-5 xl:px-6',
              executionDrawerOpen && 'mx-auto w-full max-w-[var(--max-width-chat)]',
            )}
          >
            {isNewChat ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-1 pb-10 pt-4 sm:px-2">
                <div className="flex w-full max-w-2xl flex-col items-center -translate-y-[min(10vh,7rem)] sm:-translate-y-[min(12vh,8rem)]">
                  <h1 className="mb-6 max-w-2xl text-center text-2xl font-semibold tracking-tight text-fg">
                    {m.chat.newChatHeadline}
                  </h1>
                  <div className="w-full max-w-2xl">
                    <ChatComposer
                      centerMode
                      disabled={showSessionLoading || sessionRoutePending}
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
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div
                  ref={scrollRef}
                  className="chat-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-4 [scrollbar-gutter:stable]"
                  onScroll={onScroll}
                >
                  {showSessionLoading ? (
                    <div className="flex min-h-[min(40vh,20rem)] flex-col items-center justify-center gap-3 py-12 text-center text-sm text-fg-muted">
                      {m.chat.loading}
                    </div>
                  ) : (
                    <>
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
                        scrollElementRef={scrollRef}
                        executionDrawerOpen={executionDrawerOpen}
                        drawerPinBottomIntentRef={drawerPinIntentRef}
                      />
                    </>
                  )}
                </div>

                <div className="chat-input-container shrink-0 bg-surface-panel py-4">
                  <ChatComposer
                    disabled={showSessionLoading || sessionRoutePending}
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
            )}
          </div>
        </div>

        <div className="relative h-0 w-0 min-w-0 shrink-0 self-stretch overflow-visible lg:h-auto lg:min-h-0 lg:w-auto lg:min-w-0">
          {executionDrawerOpen ? <ExecutionProcessDrawer messages={chatMessages} /> : null}
        </div>
      </div>

      <ScrollToBottomButton
        visible={!showSessionLoading && !atBottom}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}
