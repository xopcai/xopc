import { Menu, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { HeaderPreferencesPopover } from '@/components/shell/header-preferences-popover';
import { LanguageToggle } from '@/components/shell/language-toggle';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { ChatComposer } from '@/features/chat/chat-composer';
import { ChatSseStatus } from '@/features/chat/chat-sse-status';
import { MessageList } from '@/features/chat/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll-to-bottom-button';
import { useChatSession } from '@/features/chat/use-chat-session';
import { messages } from '@/i18n/messages';
import { useAppShellStore } from '@/stores/app-shell-store';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSidebarStore } from '@/stores/sidebar-store';

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

  const mobileNavOpen = useAppShellStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAppShellStore((s) => s.setMobileNavOpen);
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);

  const chatHeadline = useMemo(() => {
    const titleKey = sessionRoutePending && decodedKey ? decodedKey : sessionKey;
    if (!titleKey) return m.nav.chat;
    if (sessionRoutePending && decodedKey) return decodedKey;
    return sessionName?.trim() || titleKey;
  }, [sessionKey, sessionName, sessionRoutePending, decodedKey, m.nav.chat]);

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

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-16 text-center text-sm leading-relaxed text-fg-muted sm:px-8">
        {m.chat.needToken}
      </div>
    );
  }

  return (
    <div className="chat-shell flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      <ChatSseStatus />

      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-edge-subtle px-4 py-3 sm:gap-3 sm:px-8 dark:border-edge',
          sidebarCollapsed && 'lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-3',
        )}
      >
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className={cn('size-8 shrink-0 rounded-xl p-0 lg:hidden', mobileNavOpen && 'hidden')}
            aria-expanded={mobileNavOpen}
            aria-controls="app-sidebar"
            aria-label={m.openMenu}
            title={m.openMenu}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-4" strokeWidth={1.5} aria-hidden />
          </Button>
          {sidebarCollapsed ? (
            <Link
              to="/chat/new"
              className={cn(
                'hidden shrink-0 items-center gap-2 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm font-medium leading-5 text-fg transition-colors hover:bg-surface-hover dark:border-edge',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                'lg:inline-flex',
              )}
              title={m.sidebar.newTask}
            >
              <Plus className="size-4 shrink-0 text-accent-fg" strokeWidth={2} aria-hidden />
              <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{m.sidebar.newTask}</span>
            </Link>
          ) : null}
        </div>
        <h1
          className={cn(
            'min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-fg',
            sidebarCollapsed ? 'text-left lg:text-center' : 'text-left',
          )}
          title={chatHeadline}
        >
          {chatHeadline}
        </h1>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:justify-self-end">
          <div className="hidden items-center gap-1.5 sm:gap-2 lg:flex">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <div className="lg:hidden">
            <HeaderPreferencesPopover />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Single main column: same horizontal inset + max width for messages and composer (no duplicate wrappers). */}
        <div className="mx-auto flex w-full min-h-0 max-w-app-main flex-1 flex-col px-4 sm:px-8">
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
                />
              </>
            )}
          </div>

          <div className="chat-input-container shrink-0 bg-surface-panel py-4">
            <ChatComposer
              disabled={showSessionLoading || sessionRoutePending}
              sending={sending}
              streaming={streaming}
              progress={progress}
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
      </div>

      <ScrollToBottomButton
        visible={!showSessionLoading && !atBottom}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}
