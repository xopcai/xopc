import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Message } from '@/features/chat/messages.types';
import { ChatComposer } from '@/features/chat/chat-composer';
import { ChatFollowUpChips } from '@/features/chat/chat-follow-up-chips';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { ChatSseStatus } from '@/features/chat/chat-sse-status';
import { MessageList } from '@/features/chat/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll-to-bottom-button';
import { useChatSession } from '@/features/chat/use-chat-session';
import { ClarifyPrompt } from '@/features/chat/clarify-prompt';
import { OnboardingCard, useNeedsModelSetup } from '@/features/onboarding';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';

export function ChatPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const token = useGatewayStore((s) => s.token);

  const modelSetup = useNeedsModelSetup(Boolean(token));

  const scrollRef = useRef<HTMLDivElement>(null);
  const welcomeDraftSeq = useRef(0);
  const [welcomeDraftSeed, setWelcomeDraftSeed] = useState<{ id: number; text: string } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastClientHeightRef = useRef(0);
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
    reasoningLevel,
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
    addPendingFollowUp,
    pendingFollowUps,
    editingFollowUpId,
    beginEditFollowUp,
    cancelEditFollowUp,
    commitEditFollowUp,
    removePendingFollowUp,
    movePendingFollowUp,
    reorderPendingFollowUp,
    steerPendingFollowUp,
    steeringFollowUpId,
    interruptAndSend,
    abort,
    deleteMessageRound,
    followUpSuggestions,
    pickFollowUpSuggestion,
    clarifyPrompt,
    clarifySubmitting,
    submitClarifyAnswer,
    hasToken,
    chatAgents,
    displayAgentId,
    showChatAgentSelector,
    onChatAgentChange,
    sessionManager,
  } = useChatSession();

  useEffect(() => {
    setWelcomeDraftSeed(null);
  }, [sessionKey]);

  const onPickWelcomePrompt = useCallback((text: string) => {
    welcomeDraftSeq.current += 1;
    setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text });
  }, []);

  const canSelectWorkingDirectory = useMemo(
    () =>
      Boolean(sessionKey) &&
      !showSessionLoading &&
      !sessionRoutePending &&
      chatMessages.length === 0,
    [sessionKey, showSessionLoading, sessionRoutePending, chatMessages.length],
  );

  const setWorkspaceEditorAgentId = useWorkspaceEditorAgentStore((s) => s.setAgentId);

  useEffect(() => {
    if (!hasToken) return;
    setWorkspaceEditorAgentId(displayAgentId);
    return () => setWorkspaceEditorAgentId('');
  }, [hasToken, displayAgentId, setWorkspaceEditorAgentId]);

  const showInlineOnboarding =
    Boolean(token) &&
    modelSetup.ready &&
    modelSetup.needsSetup &&
    !modelSetup.guideDismissed &&
    !showSessionLoading &&
    !streaming;

  /** Match `MessageList` empty welcome: tighter vertical padding so the first screen fits without scrolling. */
  const compactWelcomeLayout =
    !showSessionLoading && chatMessages.length === 0 && !streaming && !showInlineOnboarding;

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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      <ChatSseStatus />

      <ChatPageHeaderRegistration
        chatHeadline={chatHeadline}
        sessionModel={sessionModel}
        showModelSelector={Boolean(sessionKey && !sessionRoutePending)}
        onModelChange={onSessionModelChange}
        modelDisabled={showSessionLoading || sessionRoutePending || streaming}
        chatAgents={chatAgents?.items ?? []}
        showChatAgentSelector={showChatAgentSelector}
        chatAgentId={displayAgentId}
        onChatAgentChange={onChatAgentChange}
        chatAgentDisabled={showSessionLoading || sessionRoutePending || streaming}
      />

      <div className="mx-auto flex min-h-0 w-full max-w-[var(--max-width-chat)] flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 sm:px-5 xl:px-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              className={cn(
                'chat-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]',
                compactWelcomeLayout ? 'pt-5 pb-2' : 'py-4',
              )}
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
                    sessionKey={sessionKey}
                    streaming={streaming}
                    progress={progress}
                    reasoningLevel={reasoningLevel}
                    scrollElementRef={scrollRef}
                    pinToBottom={atBottom}
                    onPickWelcomePrompt={onPickWelcomePrompt}
                    welcomeOverlay={
                      showInlineOnboarding ? (
                        <OnboardingCard
                          onComplete={() => void modelSetup.refresh()}
                          onDismiss={modelSetup.dismissPermanently}
                        />
                      ) : undefined
                    }
                    onDeleteRound={deleteMessageRound}
                    deleteRoundDisabled={streaming || sending}
                  />
                </>
              )}
            </div>

            <div
              className={cn(
                'sticky bottom-0 z-10 shrink-0 bg-surface-panel',
                compactWelcomeLayout ? 'py-2.5' : 'py-4',
              )}
            >
              <ClarifyPrompt
                prompt={clarifyPrompt}
                submitting={clarifySubmitting}
                onSubmit={submitClarifyAnswer}
              />
              <div className="mx-auto w-full max-w-[var(--max-width-chat)] px-3 sm:px-5 xl:px-6">
                <ChatFollowUpChips
                  suggestions={followUpSuggestions}
                  disabled={showSessionLoading || sessionRoutePending || Boolean(clarifyPrompt)}
                  onPick={pickFollowUpSuggestion}
                />
              </div>
              <ChatComposer
                disabled={showSessionLoading || sessionRoutePending || Boolean(clarifyPrompt)}
                sending={sending}
                streaming={streaming}
                sessionKey={sessionKey}
                sessionManager={sessionManager}
                welcomeDraftSeed={welcomeDraftSeed}
                canSelectWorkingDirectory={canSelectWorkingDirectory}
                thinkingLevel={thinkingLevel}
                showThinkingSelector={modelSupportsThinking}
                onThinkingChange={setThinkingLevel}
                onSend={sendMessage}
                onAbort={abort}
                onAddPendingFollowUp={(text, atts) => void addPendingFollowUp(text, atts)}
                onSteeringInterrupt={(text, atts) => void interruptAndSend(text, atts)}
                pendingFollowUps={pendingFollowUps}
                editingFollowUpId={editingFollowUpId}
                onBeginEditFollowUp={beginEditFollowUp}
                onCancelEditFollowUp={cancelEditFollowUp}
                onCommitEditFollowUp={(id, text, atts, level) => void commitEditFollowUp(id, text, atts, level)}
                onPendingFollowUpRemove={removePendingFollowUp}
                onPendingFollowUpMove={movePendingFollowUp}
                onPendingFollowUpReorder={reorderPendingFollowUp}
                onPendingFollowUpSteer={(id) => void steerPendingFollowUp(id)}
                steeringFollowUpId={steeringFollowUpId}
              />
            </div>
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
