import { MessageSquarePlus, MessageSquareText, Plus, Send, ShieldCheck, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { MessageList } from '@/features/chat/messages/message-list';
import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';
import type { Message } from '@/features/chat/messages/messages.types';
import { ScrollToBottomButton } from '@/features/chat/scroll/scroll-to-bottom-button';
import { useChatScrollViewport } from '@/features/chat/scroll/use-chat-scroll-viewport';
import {
  appendTextDelta,
  appendThinkingDelta,
  appendToolStart,
  completeTool,
  finalizeStreamingThinking,
} from '@/features/chat/messages/streaming';
import { subscribeRealtimeTopic } from '@/features/gateway/gateway-realtime';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { messages as getMessages, type SideChatMessages } from '@/i18n/messages';
import {
  SIDE_CHAT_WIDTH_MAX,
  SIDE_CHAT_WIDTH_MIN,
  useSideChatStore,
} from '@/stores/side-chat-store';
import { cn } from '@/lib/cn';
import { quickCapture } from '@/features/notes/notes-api';
import {
  abortSideChat,
  answerSideChatClarification,
  createSideChat,
  deleteSideChat,
  getSideChat,
  getSideChatMessages,
  heartbeatSideChat,
  sendSideChatInput,
} from './side-chat-api';
import type { SideChatView } from './side-chat.types';

type SideChatClarifyPrompt = { requestId: string; question: string; choices?: string[] };
const SIDE_CHAT_CLOSE_CONFIRM_DISABLED_KEY = 'xopc:side-chat-close-confirm-disabled:v1';
const loadNoOlderSideChatMessages = () => {};

function isSideChatCloseConfirmDisabled(): boolean {
  try {
    return localStorage.getItem(SIDE_CHAT_CLOSE_CONFIRM_DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function disableSideChatCloseConfirm(): void {
  try {
    localStorage.setItem(SIDE_CHAT_CLOSE_CONFIRM_DISABLED_KEY, 'true');
  } catch {
    // Closing the side chat should still work when preferences cannot be persisted.
  }
}

function userMessageText(message: Message): string {
  if (message.role !== 'user') return '';
  return message.content
    .filter((block): block is Extract<Message['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function sideChatErrorMessage(cause: unknown, m: SideChatMessages): string {
  const code = (cause as { body?: { code?: unknown } } | null)?.body?.code;
  if (code === 'INVALID_REQUEST') return m.errorInvalidRequest;
  if (code === 'NOT_FOUND') return m.errorNotFound;
  if (code === 'CONFLICT') return m.errorConflict;
  if (code === 'LIMIT_REACHED') return m.errorLimitReached;
  if (code === 'INTERNAL_ERROR') return m.failed;
  return cause instanceof Error ? cause.message : String(cause);
}

function reconcilePendingUserMessages(
  loaded: Message[],
  pending: Map<string, Message>,
): Message[] {
  const next = [...loaded];
  for (const [id, optimistic] of pending) {
    const text = userMessageText(optimistic);
    const timestamp = optimistic.timestamp ?? 0;
    const confirmed = next.some((message) => (
      message.role === 'user'
      && userMessageText(message) === text
      && Math.abs((message.timestamp ?? timestamp) - timestamp) < 60_000
    ));
    if (confirmed) {
      pending.delete(id);
      continue;
    }
    const insertAt = next.findIndex((message) => (message.timestamp ?? Number.POSITIVE_INFINITY) > timestamp);
    if (insertAt < 0) next.push(optimistic);
    else next.splice(insertAt, 0, optimistic);
  }
  return next;
}

export function SideChatColumn({ parentSessionKey }: { parentSessionKey: string }) {
  const language = useLocaleStore((state) => state.language);
  const m = getMessages(language).sideChat;
  const open = useSideChatStore((state) => state.panes[parentSessionKey]?.open === true);
  const allTabs = useSideChatStore((state) => state.tabs);
  const tabs = useMemo(
    () => allTabs.filter((tab) => tab.parentSessionKey === parentSessionKey),
    [allTabs, parentSessionKey],
  );
  const activeId = useSideChatStore((state) => state.panes[parentSessionKey]?.activeId ?? null);
  const pendingCreate = useSideChatStore((state) => state.pendingCreate);
  const requestCreate = useSideChatStore((state) => state.requestCreate);
  const claimPendingCreate = useSideChatStore((state) => state.claimPendingCreate);
  const addTab = useSideChatStore((state) => state.addTab);
  const removeTab = useSideChatStore((state) => state.removeTab);
  const setActive = useSideChatStore((state) => state.setActive);
  const setOpen = useSideChatStore((state) => state.setOpen);
  const widthPx = useSideChatStore((state) => state.widthPx);
  const setWidthPx = useSideChatStore((state) => state.setWidthPx);
  const setTabRunId = useSideChatStore((state) => state.setTabRunId);
  const token = useGatewayStore((state) => state.token);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [dontAskCloseAgain, setDontAskCloseAgain] = useState(false);

  useEffect(() => {
    if (!pendingCreate || pendingCreate.parentSessionKey !== parentSessionKey) return;
    const request = claimPendingCreate(parentSessionKey, pendingCreate.requestId);
    if (!request) return;
    setCreating(true);
    setCreateError(null);
    void createSideChat(request.parentSessionKey, request.selections)
      .then((sideChat) => {
        addTab({ id: sideChat.id, parentSessionKey: sideChat.parentSessionKey, title: 'Side chat' });
      })
      .catch((error) => {
        setCreateError(sideChatErrorMessage(error, m));
      })
      .finally(() => {
        setCreating(false);
      });
  }, [addTab, claimPendingCreate, m, parentSessionKey, pendingCreate]);

  const closeTab = useCallback((id: string) => {
    removeTab(id);
    void deleteSideChat(id).catch(() => {});
  }, [removeTab]);

  const requestCloseTab = useCallback((id: string) => {
    if (isSideChatCloseConfirmDisabled()) {
      closeTab(id);
      return;
    }
    setDontAskCloseAgain(false);
    setPendingCloseId(id);
  }, [closeTab]);

  const onResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useSideChatStore.getState().widthPx;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    setResizing(true);
    const onMove = (move: PointerEvent) => {
      const next = Math.min(SIDE_CHAT_WIDTH_MAX, Math.max(SIDE_CHAT_WIDTH_MIN, startWidth + startX - move.clientX));
      document.getElementById('app-side-chat-panel')?.style.setProperty('--side-chat-panel-px', `${next}px`);
    };
    const onDone = (done: PointerEvent) => {
      const next = Math.min(SIDE_CHAT_WIDTH_MAX, Math.max(SIDE_CHAT_WIDTH_MIN, startWidth + startX - done.clientX));
      setWidthPx(next);
      setResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, [setWidthPx]);

  if (!open) return null;
  return (
    <aside
      id="app-side-chat-panel"
      aria-label={m.paneAria}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-edge bg-surface-base',
        'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-[min(92vw,34rem)] max-md:shadow-popover',
        'app-side-chat-expanded-width',
        resizing && 'side-chat-panel-resizing',
      )}
      style={{ '--side-chat-panel-px': `${widthPx}px` } as CSSProperties}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={m.resizeAria}
        onPointerDown={onResize}
        className="absolute left-0 top-0 z-20 hidden h-full w-2 cursor-col-resize touch-none md:block"
      />
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-edge px-2">
        {tabs.map((tab) => (
          <div key={tab.id} className={cn('flex h-8 shrink-0 items-center rounded-lg pl-3 text-sm', tab.id === activeId ? 'bg-surface-hover text-fg' : 'text-fg-muted')}>
            <button type="button" className="max-w-32 truncate" onClick={() => setActive(tab.id)}>{tab.title === 'Side chat' ? m.title : tab.title}</button>
            <button type="button" className="flex size-8 items-center justify-center rounded-md hover:bg-surface-active" aria-label={m.closeAria} onClick={() => requestCloseTab(tab.id)}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="size-8 shrink-0 p-0"
          aria-label={m.newAria}
          title={m.newAria}
          disabled={creating}
          onClick={() => requestCreate(parentSessionKey)}
        >
          <Plus className="size-4" />
        </Button>
        <Button type="button" variant="ghost" className="ml-auto size-8 shrink-0 p-0" aria-label={m.closePaneAria} onClick={() => setOpen(parentSessionKey, false)}>
          <X className="size-4" />
        </Button>
      </div>
      {activeTab ? (
        <SideChatConversation
          key={activeTab.id}
          sideChatId={activeTab.id}
          token={token ?? undefined}
          initialRunId={activeTab.runId}
          onRunIdChange={setTabRunId}
          onMissing={removeTab}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <MessageSquarePlus className="mb-4 size-10 text-fg-muted" strokeWidth={1.5} />
          <h2 className="text-lg font-semibold text-fg">{m.title}</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">{m.temporaryDescription}</p>
          {creating ? <p className="mt-4 text-xs text-fg-muted">{m.creating}</p> : null}
          {createError ? <p className="mt-4 text-xs text-red-600 dark:text-red-400">{createError}</p> : null}
        </div>
      )}
      <ConfirmDialog
        open={pendingCloseId !== null}
        title={m.closeConfirmTitle}
        description={m.closeConfirmDescription}
        confirmLabel={m.closeConfirmAction}
        cancelLabel={m.closeConfirmCancel}
        checkboxLabel={m.closeConfirmDontAskAgain}
        checkboxChecked={dontAskCloseAgain}
        onCheckboxCheckedChange={setDontAskCloseAgain}
        destructive
        onConfirm={() => {
          const id = pendingCloseId;
          if (!id) return;
          if (dontAskCloseAgain) disableSideChatCloseConfirm();
          setPendingCloseId(null);
          setDontAskCloseAgain(false);
          closeTab(id);
        }}
        onCancel={() => {
          setPendingCloseId(null);
          setDontAskCloseAgain(false);
        }}
      />
    </aside>
  );
}

export function SideChatConversation({
  sideChatId,
  token,
  initialRunId,
  onRunIdChange,
  onMissing,
}: {
  sideChatId: string;
  token?: string;
  initialRunId?: string;
  onRunIdChange: (id: string, runId?: string) => void;
  onMissing: (id: string) => void;
}) {
  const [view, setView] = useState<SideChatView | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(Boolean(initialRunId));
  const [runId, setRunId] = useState<string | undefined>(initialRunId);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<SideChatClarifyPrompt | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageRevisionRef = useRef(0);
  const pendingUserMessagesRef = useRef(new Map<string, Message>());
  const language = useLocaleStore((state) => state.language);
  const m = getMessages(language);
  const sideChatMessages = m.sideChat;
  const {
    scrollRef,
    atBottom,
    registerListContentRef,
    scrollToBottom,
    onScroll,
  } = useChatScrollViewport({
    hasToken: true,
    showSessionLoading: false,
    sessionKey: sideChatId,
    sending: running,
    chatMessages: messages,
    hasMore: false,
    loadingMore: false,
    loadMoreMessages: loadNoOlderSideChatMessages,
  });

  const reload = useCallback(async () => {
    const revision = messageRevisionRef.current;
    const [sideChat, wireMessages] = await Promise.all([getSideChat(sideChatId), getSideChatMessages(sideChatId)]);
    setView(sideChat);
    if (messageRevisionRef.current === revision) {
      setRunning(sideChat.status === 'running' || Boolean(initialRunId));
      setMessages(reconcilePendingUserMessages(
        normalizeAgentMessages(wireMessages),
        pendingUserMessagesRef.current,
      ));
    }
  }, [initialRunId, sideChatId]);

  useEffect(() => {
    void reload().catch((cause: unknown) => {
      if ((cause as { status?: number })?.status === 404) onMissing(sideChatId);
      else setError(sideChatErrorMessage(cause, sideChatMessages));
    });
    const timer = window.setInterval(() => heartbeatSideChat(sideChatId), 60_000);
    return () => window.clearInterval(timer);
  }, [onMissing, reload, sideChatId, sideChatMessages]);

  const clarifyVisible = Boolean(clarify);
  const previousClarifyVisibleRef = useRef(clarifyVisible);
  useLayoutEffect(() => {
    const previous = previousClarifyVisibleRef.current;
    previousClarifyVisibleRef.current = clarifyVisible;
    if (previous === clarifyVisible) return;
    scrollToBottom(false);
    const frame = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(frame);
  }, [clarifyVisible, scrollToBottom]);

  const mutateAssistant = useCallback((change: (message: Message) => void) => {
    messageRevisionRef.current += 1;
    setMessages((current) => {
      const next = structuredClone(current);
      let assistant = next.at(-1);
      if (assistant?.role !== 'assistant') {
        assistant = { role: 'assistant', content: [], timestamp: Date.now() };
        next.push(assistant);
      }
      change(assistant);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!runId) return;
    return subscribeRealtimeTopic(`run:${runId}`, {
      onEvent: (event) => {
        const envelope = event.data as { payload?: Record<string, unknown> } | undefined;
        const payload = envelope?.payload ?? {};
        if (event.event === 'assistant_message_start') mutateAssistant(() => {});
        else if (event.event === 'assistant_delta') mutateAssistant((message) => appendTextDelta(message.content, String(payload.delta ?? ''), String(payload.messageId ?? '')));
        else if (event.event === 'thinking_delta') mutateAssistant((message) => appendThinkingDelta(message.content, String(payload.delta ?? ''), true));
        else if (event.event === 'thinking_end') mutateAssistant((message) => finalizeStreamingThinking(message.content));
        else if (event.event === 'tool_start') mutateAssistant((message) => appendToolStart(message.content, String(payload.toolName ?? 'tool'), payload.args, String(payload.toolCallId ?? ''), Date.now(), payload.activity as never));
        else if (event.event === 'tool_end') mutateAssistant((message) => completeTool(message.content, String(payload.toolName ?? 'tool'), payload.status === 'error', payload.result, String(payload.toolCallId ?? ''), Date.now(), payload.activity as never));
        else if (event.event === 'clarify_request') {
          setClarify({
            requestId: String(payload.requestId ?? ''),
            question: String(payload.question ?? ''),
            choices: Array.isArray(payload.choices) ? payload.choices.filter((choice): choice is string => typeof choice === 'string') : undefined,
          });
          setClarifyError(null);
        } else if (event.event === 'error') setError(String(payload.message ?? sideChatMessages.failed));
        else if (event.event === 'run_end') {
          setRunning(false);
          setRunId(undefined);
          onRunIdChange(sideChatId, undefined);
          setClarify(null);
          void reload();
        }
      },
      onGap: () => reload(),
    });
  }, [mutateAssistant, onRunIdChange, reload, runId, sideChatId, sideChatMessages.failed]);

  const submitDraft = () => {
    const content = draft.trim();
    if (!content || running) return;
    setDraft('');
    setError(null);
    messageRevisionRef.current += 1;
    const optimisticId = crypto.randomUUID();
    const optimisticMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text: content }],
      timestamp: Date.now(),
      renderKey: `side-chat-user:${optimisticId}`,
    };
    pendingUserMessagesRef.current.set(optimisticId, optimisticMessage);
    setMessages((current) => [...current, optimisticMessage]);
    setRunning(true);
    void sendSideChatInput(sideChatId, content)
      .then((nextRunId) => {
        setRunId(nextRunId);
        onRunIdChange(sideChatId, nextRunId);
      })
      .catch((cause: unknown) => {
        pendingUserMessagesRef.current.delete(optimisticId);
        setMessages((current) => current.filter((message) => message.renderKey !== optimisticMessage.renderKey));
        setRunning(false);
        setError(sideChatErrorMessage(cause, sideChatMessages));
      });
  };

  const answerClarify = async (answer: string) => {
    if (!clarify) return;
    setClarifySubmitting(true);
    setClarifyError(null);
    try {
      await answerSideChatClarification(sideChatId, clarify.requestId, answer);
      setClarify(null);
    } catch (cause) {
      setClarifyError(sideChatErrorMessage(cause, sideChatMessages));
    } finally {
      setClarifySubmitting(false);
    }
  };

  const editUserMessage = useCallback((text: string) => {
    setDraft(text);
    requestAnimationFrame(() => {
      const composer = composerRef.current;
      composer?.focus();
      composer?.setSelectionRange(text.length, text.length);
    });
  }, []);

  const saveAssistantAsNote = useCallback(async (content: string) => {
    try {
      const note = await quickCapture(content.trim(), 'web');
      showComposerNotification('success', m.chat.messageSavedToNote, undefined, {
        href: `/notes/${encodeURIComponent(note.id)}`,
      });
    } catch (cause) {
      showComposerNotification('error', cause instanceof Error ? cause.message : m.notes.quickCaptureFailed);
      throw cause;
    }
  }, [m.chat.messageSavedToNote, m.notes.quickCaptureFailed]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-side-chat-scroll-viewport
          onScroll={onScroll}
          className="chat-messages h-full overflow-y-auto overflow-x-hidden px-5 py-4 [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]"
        >
          {messages.length ? (
            <MessageList
              messages={messages}
              authToken={token}
              sessionKey={sideChatId}
              streaming={running}
              progress={null}
              reasoningLevel="on"
              registerListContentRef={registerListContentRef}
              deleteRoundDisabled={running}
              onSaveAssistantAsNote={saveAssistantAsNote}
              onEditUserMessage={(message) => editUserMessage(userMessageText(message))}
              responseFeedbackEnabled={false}
            />
          ) : (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <MessageSquarePlus className="mb-4 size-9 text-fg-muted" strokeWidth={1.5} />
              <h2 className="text-lg font-semibold text-fg">{sideChatMessages.title}</h2>
              <p className="mt-2 text-sm text-fg-muted">{sideChatMessages.emptyDescription}</p>
            </div>
          )}
        </div>
        <ScrollToBottomButton
          visible={!atBottom}
          onClick={() => scrollToBottom(true)}
          contained
        />
      </div>
      {clarify ? (
        <div className="shrink-0 border-t border-edge px-3 pt-3">
          <ClarifyPrompt
            prompt={clarify}
            submitting={clarifySubmitting}
            submitError={clarifyError}
            labels={m.chat}
            onSubmit={answerClarify}
            onCancel={async () => {
              await abortSideChat(sideChatId, runId);
              setClarify(null);
            }}
          />
        </div>
      ) : null}
      {error ? <p className="border-t border-edge px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); submitDraft(); }} className="shrink-0 border-t border-edge p-3">
        <div className="rounded-2xl border border-edge bg-surface-panel p-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          {view?.context.selections.length ? (
            <div
              className="mb-2 inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 text-xs font-medium text-fg-muted"
              title={view.context.selections.map((selection) => selection.label || selection.text).join('\n')}
            >
              <MessageSquareText className="size-3.5 shrink-0" />
              <span className="truncate">
                {(view.context.selections.length === 1
                  ? sideChatMessages.selectionCount_one
                  : sideChatMessages.selectionCount_other
                ).replace('{{count}}', String(view.context.selections.length))}
              </span>
            </div>
          ) : null}
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              }
            }}
            rows={3}
            placeholder={m.chat.typeMessage}
            className="w-full resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-fg-muted" title={sideChatMessages.parentPermissionsHint}>
              <ShieldCheck className="size-3.5 shrink-0" />
              <span className="truncate">{sideChatMessages.parentPermissions.replace('{{model}}', view?.config.modelRef ?? '')}</span>
            </span>
            {running ? (
              <Button type="button" className="size-9 rounded-full p-0" aria-label={m.chat.abort} onClick={() => void abortSideChat(sideChatId, runId)}><Square className="size-3.5 fill-current" /></Button>
            ) : (
              <Button type="submit" className="size-9 rounded-full p-0" disabled={!draft.trim()} aria-label={m.chat.sendMessage}><Send className="size-4" /></Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
