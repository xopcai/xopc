import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Message } from '@/features/chat/messages.types';
import { ChatComposer } from '@/features/chat/chat-composer';
import { ChatHeaderBar } from '@/features/chat/chat-header-bar';
import { ChatSseStatus } from '@/features/chat/chat-sse-status';
import { MessageList } from '@/features/chat/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll-to-bottom-button';
import { getStepGroupBlocks, messageRowKey } from '@/features/chat/thinking-blocks';
import { ThinkingDrawer } from '@/features/chat/thinking-drawer';
import { useChatSession } from '@/features/chat/use-chat-session';
import { cn } from '@/lib/cn';
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

  const [thinkingDrawer, setThinkingDrawer] = useState<{ key: string; groupStart: number } | null>(
    null,
  );
  /** xl: animate rail width 0→var(--width-thinking-drawer) so the main column eases instead of snapping. */
  const [drawerRailExpanded, setDrawerRailExpanded] = useState(false);
  /** True while playing close transition (drawer still mounted until timeout). */
  const [drawerClosing, setDrawerClosing] = useState(false);
  const thinkingDrawerOpenSignatureRef = useRef<string | null>(null);
  const thinkingDrawerRef = useRef(thinkingDrawer);
  thinkingDrawerRef.current = thinkingDrawer;

  const THINKING_DRAWER_CLOSE_MS = 320;

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

  const drawerBlocks = useMemo(() => {
    if (!thinkingDrawer) return null;
    const idx = chatMessages.findIndex((m, i) => messageRowKey(m, i) === thinkingDrawer.key);
    if (idx < 0) return null;
    const msg = chatMessages[idx];
    if (msg.role !== 'assistant') return null;
    return getStepGroupBlocks(msg, thinkingDrawer.groupStart);
  }, [thinkingDrawer, chatMessages]);

  useEffect(() => {
    if (!thinkingDrawer) return;
    const idx = chatMessages.findIndex((m, i) => messageRowKey(m, i) === thinkingDrawer.key);
    if (idx < 0) {
      setThinkingDrawer(null);
      return;
    }
    if (chatMessages[idx]?.role !== 'assistant') setThinkingDrawer(null);
  }, [chatMessages, thinkingDrawer]);

  useEffect(() => {
    if (!thinkingDrawer) {
      setDrawerRailExpanded(false);
      setDrawerClosing(false);
      thinkingDrawerOpenSignatureRef.current = null;
      return;
    }
    setDrawerClosing(false);
    const signature = `${thinkingDrawer.key}-${thinkingDrawer.groupStart}`;
    if (thinkingDrawerOpenSignatureRef.current !== null) {
      thinkingDrawerOpenSignatureRef.current = signature;
      return;
    }
    thinkingDrawerOpenSignatureRef.current = signature;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDrawerRailExpanded(true);
      return;
    }
    setDrawerRailExpanded(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDrawerRailExpanded(true));
    });
    return () => cancelAnimationFrame(id);
  }, [thinkingDrawer]);

  useEffect(() => {
    if (!drawerClosing || !thinkingDrawer) return;
    const t = window.setTimeout(() => {
      setThinkingDrawer(null);
      setDrawerClosing(false);
      thinkingDrawerOpenSignatureRef.current = null;
    }, THINKING_DRAWER_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [drawerClosing, thinkingDrawer]);

  const beginDrawerClose = useCallback(() => {
    if (!thinkingDrawerRef.current) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setThinkingDrawer(null);
      thinkingDrawerOpenSignatureRef.current = null;
      setDrawerClosing(false);
      return;
    }
    setDrawerClosing(true);
    setDrawerRailExpanded(false);
  }, []);

  const onToggleThinking = useCallback((key: string, groupStart: number) => {
    setThinkingDrawer((prev) => {
      if (prev && prev.key === key && prev.groupStart === groupStart) {
        queueMicrotask(() => beginDrawerClose());
        return prev;
      }
      return { key, groupStart };
    });
  }, [beginDrawerClose]);

  const closeThinkingDrawer = useCallback(() => {
    beginDrawerClose();
  }, [beginDrawerClose]);

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

      <ChatHeaderBar chatHeadline={chatHeadline} />

      <div className="relative flex min-h-0 flex-1 flex-col xl:flex-row">
        {/* Main column: same horizontal inset + max width for messages and composer. */}
        <div className="mx-auto flex w-full min-h-0 max-w-[var(--max-width-chat)] flex-1 flex-col px-3 sm:px-5 xl:min-w-0 xl:px-6">
          <div
            ref={scrollRef}
            className="chat-messages min-h-0 flex-1 overflow-y-auto py-4 [scrollbar-gutter:stable]"
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
                  activeThinking={drawerClosing ? null : thinkingDrawer}
                  onToggleThinking={onToggleThinking}
                />
              </>
            )}
          </div>

          <div className="chat-input-container shrink-0 bg-surface-panel py-4">
            <ChatComposer
              disabled={showSessionLoading || sessionRoutePending}
              sending={sending}
              streaming={streaming}
              sessionModel={sessionModel}
              showModelSelector={Boolean(sessionKey && !sessionRoutePending)}
              onModelChange={onSessionModelChange}
              thinkingLevel={thinkingLevel}
              showThinkingSelector={modelSupportsThinking}
              onThinkingChange={setThinkingLevel}
              onSend={sendMessage}
              onAbort={abort}
            />
          </div>
        </div>

        {thinkingDrawer !== null && drawerBlocks !== null ? (
          <>
            <button
              type="button"
              className={cn(
                'fixed inset-0 z-20 bg-black/25 xl:hidden',
                !drawerClosing && 'thinking-drawer-backdrop',
                drawerClosing &&
                  'pointer-events-none opacity-0 transition-opacity duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
              )}
              aria-label={m.chat.thinkingDrawerClose}
              onClick={closeThinkingDrawer}
            />
            <div
              className={cn(
                'xl:flex xl:h-full xl:min-h-0 xl:shrink-0 xl:overflow-hidden xl:border-edge xl:transition-[width] xl:duration-[280ms] xl:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:xl:transition-none',
                drawerRailExpanded ? 'xl:w-[var(--width-thinking-drawer)] xl:border-l' : 'xl:w-0 xl:border-transparent',
              )}
            >
              <ThinkingDrawer
                blocks={drawerBlocks}
                onClose={closeThinkingDrawer}
                isExiting={drawerClosing}
              />
            </div>
          </>
        ) : null}
      </div>

      <ScrollToBottomButton
        visible={!showSessionLoading && !atBottom}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}
