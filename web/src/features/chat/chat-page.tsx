import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChatComposer } from '@/features/chat/chat-composer';
import { ChatFollowUpChips } from '@/features/chat/chat-follow-up-chips';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { ChatSseStatus } from '@/features/chat/chat-sse-status';
import { MessageList } from '@/features/chat/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll-to-bottom-button';
import { useChatScrollViewport } from '@/features/chat/use-chat-scroll-viewport';
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

  const welcomeDraftSeq = useRef(0);
  const [welcomeDraftSeed, setWelcomeDraftSeed] = useState<{ id: number; text: string } | null>(null);

  const { auth, session, messages: msgSlice, stream, followUp, clarify, agents } = useChatSession();

  const { scrollRef, atBottom, scrollToBottom, onScroll } = useChatScrollViewport({
    hasToken: auth.hasToken,
    showSessionLoading: session.showSessionLoading,
    sending: stream.sending,
    chatMessages: msgSlice.items,
    hasMore: session.hasMore,
    loadingMore: session.loadingMore,
    loadMoreMessages: session.loadMoreMessages,
  });

  useEffect(() => {
    setWelcomeDraftSeed(null);
  }, [session.sessionKey]);

  const onPickWelcomePrompt = useCallback((text: string) => {
    welcomeDraftSeq.current += 1;
    setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text });
  }, []);

  const canSelectWorkingDirectory = useMemo(
    () =>
      Boolean(session.sessionKey) &&
      !session.showSessionLoading &&
      !session.sessionRoutePending &&
      msgSlice.items.length === 0,
    [session.sessionKey, session.showSessionLoading, session.sessionRoutePending, msgSlice.items.length],
  );

  const setWorkspaceEditorAgentId = useWorkspaceEditorAgentStore((s) => s.setAgentId);

  useEffect(() => {
    if (!auth.hasToken) return;
    setWorkspaceEditorAgentId(agents.displayAgentId);
    return () => setWorkspaceEditorAgentId('');
  }, [auth.hasToken, agents.displayAgentId, setWorkspaceEditorAgentId]);

  const showInlineOnboarding =
    Boolean(token) &&
    modelSetup.ready &&
    modelSetup.needsSetup &&
    !modelSetup.guideDismissed &&
    !session.showSessionLoading &&
    !stream.streaming;

  /** Match `MessageList` empty welcome: tighter vertical padding so the first screen fits without scrolling. */
  const compactWelcomeLayout =
    !session.showSessionLoading &&
    msgSlice.items.length === 0 &&
    !stream.streaming &&
    !showInlineOnboarding;

  const chatHeadline = useMemo(() => {
    const titleKey =
      session.sessionRoutePending && session.decodedKey ? session.decodedKey : session.sessionKey;
    if (!titleKey) return m.nav.chat;
    return session.sessionName?.trim() || m.chat.newSession;
  }, [
    session.sessionKey,
    session.sessionName,
    session.sessionRoutePending,
    session.decodedKey,
    m.nav.chat,
    m.chat.newSession,
  ]);

  if (!auth.hasToken) {
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
        chatAgents={agents.chatAgents?.items ?? []}
        showChatAgentSelector={agents.showChatAgentSelector}
        chatAgentId={agents.displayAgentId}
        onChatAgentChange={agents.onChatAgentChange}
        chatAgentDisabled={session.showSessionLoading || session.sessionRoutePending || stream.streaming}
      />

      <div className="mx-auto flex min-h-0 w-full max-w-[var(--max-width-chat)] flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 sm:px-5 xl:px-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              className={cn(
                'chat-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable_both-edges]',
                compactWelcomeLayout ? 'pt-5 pb-2' : 'py-4',
              )}
              onScroll={onScroll}
            >
              {session.showSessionLoading ? (
                <div className="flex min-h-[min(40vh,20rem)] flex-col items-center justify-center gap-3 py-12 text-center text-sm text-fg-muted">
                  {m.chat.loading}
                </div>
              ) : (
                <>
                  {session.loadingMore ? (
                    <div className="mb-3 text-center text-xs text-fg-muted">{m.chat.loadOlder}</div>
                  ) : null}
                  {stream.error ? (
                    <div className="mb-4 rounded-md border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300">
                      {stream.error}
                    </div>
                  ) : null}
                  <MessageList
                    messages={msgSlice.items}
                    authToken={token ?? undefined}
                    sessionKey={session.sessionKey}
                    streaming={stream.streaming}
                    progress={stream.progress}
                    reasoningLevel={session.reasoningLevel}
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
                    onDeleteRound={stream.deleteMessageRound}
                    deleteRoundDisabled={stream.streaming || stream.sending}
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
                prompt={clarify.clarifyPrompt}
                submitting={clarify.clarifySubmitting}
                onSubmit={clarify.submitClarifyAnswer}
              />
              <div className="mx-auto w-full max-w-[var(--max-width-chat)] px-3 sm:px-5 xl:px-6">
                <ChatFollowUpChips
                  suggestions={followUp.followUpSuggestions}
                  disabled={
                    session.showSessionLoading ||
                    session.sessionRoutePending ||
                    Boolean(clarify.clarifyPrompt)
                  }
                  onPick={followUp.pickFollowUpSuggestion}
                />
              </div>
              <ChatComposer
                disabled={
                  session.showSessionLoading ||
                  session.sessionRoutePending ||
                  Boolean(clarify.clarifyPrompt)
                }
                sending={stream.sending}
                streaming={stream.streaming}
                sessionKey={session.sessionKey}
                sessionManager={session.sessionManager}
                welcomeDraftSeed={welcomeDraftSeed}
                canSelectWorkingDirectory={canSelectWorkingDirectory}
                thinkingLevel={session.thinkingLevel}
                showThinkingSelector={session.modelSupportsThinking}
                onThinkingChange={session.setThinkingLevel}
                onSend={stream.sendMessage}
                onAbort={stream.abort}
                onAddPendingFollowUp={(text, atts) => void followUp.addPendingFollowUp(text, atts)}
                onSteeringInterrupt={(text, atts) => void stream.interruptAndSend(text, atts)}
                pendingFollowUps={followUp.pendingFollowUps}
                editingFollowUpId={followUp.editingFollowUpId}
                onBeginEditFollowUp={followUp.beginEditFollowUp}
                onCancelEditFollowUp={followUp.cancelEditFollowUp}
                onCommitEditFollowUp={(id, text, atts, level) =>
                  void followUp.commitEditFollowUp(id, text, atts, level)
                }
                onPendingFollowUpRemove={followUp.removePendingFollowUp}
                onPendingFollowUpMove={followUp.movePendingFollowUp}
                onPendingFollowUpReorder={followUp.reorderPendingFollowUp}
                onPendingFollowUpSteer={(id) => void followUp.steerPendingFollowUp(id)}
                steeringFollowUpId={followUp.steeringFollowUpId}
                sessionModel={session.sessionModel}
                showModelSelector={Boolean(session.sessionKey && !session.sessionRoutePending)}
                onModelChange={session.onSessionModelChange}
                modelDisabled={
                  session.showSessionLoading || session.sessionRoutePending || stream.streaming
                }
              />
            </div>
          </div>
        </div>
      </div>

      <ScrollToBottomButton
        visible={!session.showSessionLoading && !atBottom}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}
