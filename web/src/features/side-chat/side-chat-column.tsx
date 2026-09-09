import { ChevronRight, MessageSquarePlus, MessageSquareText, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { ChatComposerInput, type ComposerKbdContext } from '@/features/chat/composer/chat-composer-input';
import { ACCEPT } from '@/features/chat/composer/composer-clipboard';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import { ComposerFrame } from '@/features/chat/composer/composer-frame';
import { ComposerAttachButton, ComposerRunControl, ComposerToolbarRow } from '@/features/chat/composer/composer-toolbar';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { useComposerEditor } from '@/features/chat/composer/use-composer-editor';
import { ComposerModelConfigControl } from '@/features/chat/model/composer-model-config-control';
import { MAX_CHAT_ATTACHMENTS, type Attachment } from '@/features/chat/attachments/attachment-utils';
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
  extendSideChat,
  getSideChatClientInstanceId,
  sendSideChatInput,
  updateSideChatConfig,
} from './side-chat-api';
import type { SideChatTab, SideChatView } from './side-chat.types';
import { buildSideChatReading, limitSideChatDraft, SIDE_CHAT_DRAFT_BYTES, textBytes } from './side-chat-reading';

type SideChatClarifyPrompt = {
  requestId: string;
  kind: 'input' | 'approval';
  question: string;
  choices?: string[];
  suggestedAnswer?: string;
};
const SIDE_CHAT_CLOSE_CONFIRM_DISABLED_KEY = 'xopc:side-chat-close-confirm-disabled:v1';
const loadNoOlderSideChatMessages = () => {};
const EMPTY_SIDE_CHAT_ATTACHMENTS: Attachment[] = [];

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

function attachmentNames(message: Message): string {
  return (message.attachments ?? []).map((attachment) => attachment.name ?? '').filter(Boolean).join('\n');
}

function sideChatErrorMessage(cause: unknown, m: SideChatMessages): string {
  const code = (cause as { body?: { code?: unknown } } | null)?.body?.code;
  if (code === 'INVALID_REQUEST') return m.errorInvalidRequest;
  if (code === 'NOT_FOUND') return m.errorNotFound;
  if (code === 'CONFLICT') return m.errorConflict;
  if (code === 'LIMIT_REACHED') return m.errorLimitReached;
  if (code === 'CAPACITY_REACHED') return m.errorCapacity;
  if (code === 'PARENT_NOT_FOUND') return m.parentMissing;
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
    const names = attachmentNames(optimistic);
    const timestamp = optimistic.timestamp ?? 0;
    const confirmed = next.some((message) => (
      message.role === 'user'
      && userMessageText(message) === text
      && attachmentNames(message) === names
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
    const gateway = useGatewayStore.getState();
    void createSideChat(request.parentSessionKey, request.selections)
      .then((sideChat) => {
        if (useGatewayStore.getState().token !== gateway.token || useGatewayStore.getState().baseUrl !== gateway.baseUrl) return;
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
    const state = useSideChatStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === id);
    const reading = state.readings[id];
    const sideDraft = state.drafts[id];
    const empty = reading && !reading.messages.length && !reading.truncated
      && !sideDraft?.text.trim() && !sideDraft?.attachments.length && !tab?.runId;
    if (empty || isSideChatCloseConfirmDisabled()) {
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
            <button type="button" className="max-w-40 truncate" onClick={() => setActive(tab.id)}>{tab.title === 'Side chat' ? m.title : tab.title}{tab.ended ? ` · ${m.endedLabel}` : ''}</button>
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
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {createError && activeTab ? <div className="shrink-0 border-b border-edge px-4 py-2 text-xs text-fg-muted" role="status">
        <p>{createError}</p>
        {allTabs.filter((tab) => !tab.ended).map((tab) => <button key={tab.id} type="button" className="mr-2 mt-1 rounded border border-edge px-2 py-1" onClick={() => {
          setActive(tab.id);
          window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: { sessionKey: tab.parentSessionKey } }));
        }}>{tab.title === 'Side chat' ? m.title : tab.title}</button>)}
      </div> : null}
      {activeTab ? (
        <SideChatConversation
          key={`${activeTab.id}:${token ?? ''}`}
          sideChatId={activeTab.id}
          token={token ?? undefined}
          initialRunId={activeTab.runId}
          onRunIdChange={setTabRunId}
          parentSessionKey={parentSessionKey}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <MessageSquarePlus className="mb-4 size-10 text-fg-muted" strokeWidth={1.5} />
          <h2 className="text-lg font-semibold text-fg">{m.title}</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">{m.temporaryDescription}</p>
          {creating ? <Skeleton className="mt-4 h-4 w-32" /> : null}
          {createError ? <p className="mt-4 text-xs text-red-600 dark:text-red-400">{createError}</p> : null}
        </div>
      )}
      <ConfirmDialog
        open={pendingCloseId !== null}
        title={tabs.find((tab) => tab.id === pendingCloseId)?.runId ? m.stopCloseTitle : m.closeConfirmTitle}
        description={tabs.find((tab) => tab.id === pendingCloseId)?.runId ? m.stopCloseDescription : m.closeConfirmDescription}
        confirmLabel={tabs.find((tab) => tab.id === pendingCloseId)?.runId ? m.stopCloseAction : m.closeConfirmAction}
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
  parentSessionKey,
}: {
  sideChatId: string;
  token?: string;
  initialRunId?: string;
  onRunIdChange: (id: string, runId?: string) => void;
  parentSessionKey?: string;
}) {
  const [view, setView] = useState<SideChatView | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => useSideChatStore.getState().readings[sideChatId]?.messages ?? []);
  const draftText = useSideChatStore((state) => state.drafts[sideChatId]?.text ?? '');
  const draftAttachments = useSideChatStore((state) => state.drafts[sideChatId]?.attachments ?? EMPTY_SIDE_CHAT_ATTACHMENTS);
  const setDraftText = useCallback((text: string) => useSideChatStore.getState().setDraftText(sideChatId, text), [sideChatId]);
  const setDraftAttachments = useCallback((next: Attachment[]) => {
    useSideChatStore.getState().setDraftAttachments(sideChatId, next);
  }, [sideChatId]);
  const [ended, setEnded] = useState<SideChatTab['ended']>(() => useSideChatStore.getState().tabs.find((tab) => tab.id === sideChatId)?.ended);
  const [loading, setLoading] = useState(!ended);
  const [connectionLost, setConnectionLost] = useState(false);
  const [extending, setExtending] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [parentMissing, setParentMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const [clockOffset, setClockOffset] = useState(0);
  const fresh = useSideChatStore((state) => state.tabs.find((tab) => tab.id === sideChatId)?.fresh);
  const truncated = useSideChatStore((state) => state.readings[sideChatId]?.truncated ?? false);
  const activeRef = useRef(true);
  const endedRef = useRef(ended);
  const gatewayIdentity = useRef(useGatewayStore.getState());
  const sameGateway = useCallback(() => gatewayIdentity.current.token === useGatewayStore.getState().token
    && gatewayIdentity.current.baseUrl === useGatewayStore.getState().baseUrl, []);
  const isCurrent = useCallback(() => activeRef.current && sameGateway(), [sameGateway]);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const [running, setRunning] = useState(Boolean(initialRunId));
  const [runId, setRunId] = useState<string | undefined>(initialRunId);
  const [error, setError] = useState<string | null>(null);
  const [clarify, setClarify] = useState<SideChatClarifyPrompt | null>(null);
  const [clarifySubmitting, setClarifySubmitting] = useState(false);
  const [clarifyError, setClarifyError] = useState<string | null>(null);
  const shouldSyncSelectionRef = useRef(false);
  const messageRevisionRef = useRef(0);
  const lastViewAt = useRef(0);
  const submittingRef = useRef(false);
  const pendingUserMessagesRef = useRef(new Map<string, Message>());
  const language = useLocaleStore((state) => state.language);
  const m = getMessages(language);
  const sideChatMessages = m.sideChat;
  const attachments = useComposerAttachments({
    chat: m.chat,
    initialAttachments: draftAttachments,
    onAttachmentsChange: setDraftAttachments,
  });
  const editor = useComposerEditor({
    disabled: Boolean(ended) || connectionLost,
    initialValue: draftText,
    onValueChange: setDraftText,
    autoFocusKey: sideChatId,
    shouldSyncSelectionRef,
  });
  const kbdRef = useRef({} as ComposerKbdContext);
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

  useEffect(() => {
    if (isCurrent() && (messages.length || !loading)) useSideChatStore.getState().rememberMessages(sideChatId, messages);
  }, [messages, loading, sideChatId, isCurrent]);

  const finish = useCallback((reason: NonNullable<SideChatTab['ended']>) => {
    if (!isCurrent() || endedRef.current) return;
    endedRef.current = reason;
    messageRevisionRef.current += 1;
    setEnded(reason);
    setRunning(false);
    setRunId(undefined);
    setClarify(null);
    setView(null);
    setNotice('');
    setError(null);
    setConnectionLost(false);
    setLoading(false);
    setMessages((current) => buildSideChatReading(current).messages);
    useSideChatStore.getState().markEnded(sideChatId, reason);
  }, [isCurrent, sideChatId]);

  const handleFailure = useCallback((cause: unknown) => {
    if (!isCurrent()) return;
    const failure = cause as { status?: number; body?: { code?: string; reason?: string } };
    if (failure.body?.code === 'EXPIRED' || failure.status === 410) {
      finish(failure.body?.reason === 'waiting' ? 'waiting' : 'idle');
    } else if (failure.status === 404 || failure.body?.code === 'NOT_FOUND') {
      finish('unavailable');
    } else {
      setConnectionLost(true);
    }
    setLoading(false);
  }, [finish, isCurrent]);

  const applyView = useCallback((sideChat: SideChatView) => {
    if (!isCurrent() || endedRef.current) return;
    const receivedAt = sideChat.serverNow ? Date.parse(sideChat.serverNow) : 0;
    if (receivedAt && receivedAt < lastViewAt.current) return;
    lastViewAt.current = receivedAt;
    setView(sideChat);
    setConnectionLost(false);
    if (sideChat.serverNow) setClockOffset(Date.parse(sideChat.serverNow) - Date.now());
    setNow(Date.now());
    setRunning(sideChat.status !== 'idle');
    setRunId(sideChat.runId);
    onRunIdChange(sideChatId, sideChat.runId);
    setClarify(sideChat.clarification ?? null);
  }, [isCurrent, onRunIdChange, sideChatId]);

  const reload = useCallback(async () => {
    const revision = messageRevisionRef.current;
    try {
      const [sideChat, wireMessages] = await Promise.all([getSideChat(sideChatId), getSideChatMessages(sideChatId)]);
      if (!isCurrent() || endedRef.current) return;
      if (messageRevisionRef.current === revision) {
        applyView(sideChat);
        setMessages(reconcilePendingUserMessages(normalizeAgentMessages(wireMessages), pendingUserMessagesRef.current));
      }
      setLoading(false);
    } catch (cause) { handleFailure(cause); }
  }, [applyView, handleFailure, isCurrent, sideChatId]);

  useEffect(() => {
    if (ended) return;
    void reload();
    let polling = false;
    const sync = async () => {
      if (polling || endedRef.current) return;
      polling = true;
      const revision = messageRevisionRef.current;
      try {
        const sideChat = await heartbeatSideChat(sideChatId);
        if (sideChat && revision === messageRevisionRef.current) applyView(sideChat);
      } catch (cause) { handleFailure(cause); }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => { setNow(Date.now()); void sync(); }, 30_000);
    const resume = () => { if (document.visibilityState !== 'hidden') void reload(); };
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [ended, reload, applyView, handleFailure, sideChatId]);

  useEffect(() => {
    if (ended) return;
    return subscribeRealtimeTopic(`side-chat:${getSideChatClientInstanceId()}:${sideChatId}`, {
      onEvent: (event) => { if (event.event === 'expired') finish((event.data as { reason?: string })?.reason === 'waiting' ? 'waiting' : 'idle'); },
      onGap: () => reload(),
    });
  }, [ended, finish, reload, sideChatId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const remainingMs = view?.expiresAt ? Date.parse(view.expiresAt) - (now + clockOffset) : Infinity;
  const warning = !ended && !connectionLost && remainingMs <= 5 * 60_000;
  const extend = async () => {
    if (extending || endedRef.current) return;
    setExtending(true);
    try {
      const sideChat = await extendSideChat(sideChatId);
      if (!isCurrent() || endedRef.current) return;
      applyView(sideChat);
      setError(null);
      setNotice(sideChatMessages.extended);
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 404 || status === 410) handleFailure(cause);
      if (!endedRef.current) setError(sideChatMessages.extendFailed);
    } finally { setExtending(false); }
  };

  const recreate = async () => {
    const parent = parentSessionKey ?? useSideChatStore.getState().tabs.find((tab) => tab.id === sideChatId)?.parentSessionKey;
    if (!parent || recreating) return;
    setRecreating(true);
    setError(null);
    try {
      const next = await createSideChat(parent, []);
      if (!sameGateway()) return;
      useSideChatStore.getState().replaceTab(sideChatId, { id: next.id, parentSessionKey: parent, title: 'Side chat' });
    } catch (cause) {
      if (!isCurrent()) return;
      if ((cause as { body?: { code?: string } }).body?.code === 'PARENT_NOT_FOUND') setParentMissing(true);
      setError(sideChatErrorMessage(cause, sideChatMessages));
    } finally { setRecreating(false); }
  };

  const clarifyVisible = Boolean(clarify);
  const previousClarifyVisibleRef = useRef(clarifyVisible);
  useLayoutEffect(() => {
    const previous = previousClarifyVisibleRef.current;
    previousClarifyVisibleRef.current = clarifyVisible;
    if (ended || previous === clarifyVisible) return;
    scrollToBottom(false);
    const frame = requestAnimationFrame(() => scrollToBottom(false));
    return () => cancelAnimationFrame(frame);
  }, [clarifyVisible, scrollToBottom, ended]);

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
    if (!runId || ended) return;
    return subscribeRealtimeTopic(`run:${runId}`, {
      onEvent: (event) => {
        if (!isCurrent() || endedRef.current) return;
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
            kind: payload.kind === 'approval' ? 'approval' : 'input',
            question: String(payload.question ?? ''),
            choices: Array.isArray(payload.choices) ? payload.choices.filter((choice): choice is string => typeof choice === 'string') : undefined,
            suggestedAnswer: typeof payload.suggestedAnswer === 'string' ? payload.suggestedAnswer : undefined,
          });
          setClarifyError(null);
          void reload();
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
  }, [ended, isCurrent, mutateAssistant, onRunIdChange, reload, runId, sideChatId, sideChatMessages.failed]);

  const submitDraft = () => {
    const content = draftText.trim();
    const wireAttachments = attachments.wireAttachmentsPayload();
    if ((!content && wireAttachments.length === 0) || running || submittingRef.current || endedRef.current || connectionLost) return;
    if (textBytes(content) > SIDE_CHAT_DRAFT_BYTES) { setError(sideChatMessages.draftTooLong); return; }
    const sentDraft = {
      text: draftText,
      attachments: [...attachments.attachmentsRef.current],
    };
    submittingRef.current = true;
    editor.resetEditor();
    attachments.clearAttachments();
    setError(null);
    messageRevisionRef.current += 1;
    const optimisticId = crypto.randomUUID();
    const optimisticMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text: content }],
      attachments: sentDraft.attachments,
      timestamp: Date.now(),
      renderKey: `side-chat-user:${optimisticId}`,
    };
    pendingUserMessagesRef.current.set(optimisticId, optimisticMessage);
    setMessages((current) => [...current, optimisticMessage]);
    setRunning(true);
    void sendSideChatInput(sideChatId, content, wireAttachments)
      .then((nextRunId) => {
        if (!sameGateway() || endedRef.current) return;
        useSideChatStore.getState().setTabRunId(sideChatId, nextRunId);
        if (!isCurrent()) return;
        setRunId(nextRunId);
        onRunIdChange(sideChatId, nextRunId);
      })
      .catch((cause: unknown) => {
        if (!sameGateway()) return;
        const state = useSideChatStore.getState();
        if (!isCurrent() && !state.tabs.some((tab) => tab.id === sideChatId)) return;
        const currentDraft = useSideChatStore.getState().drafts[sideChatId] ?? { text: '', attachments: [] };
        const restoredDraft = {
          text: currentDraft.text ? `${sentDraft.text}\n${currentDraft.text}` : sentDraft.text,
          attachments: [...sentDraft.attachments, ...currentDraft.attachments],
        };
        if (isCurrent()) {
          editor.resetEditor({ nextText: restoredDraft.text });
          attachments.setAttachments(restoredDraft.attachments);
        } else {
          setDraftText(restoredDraft.text);
          setDraftAttachments(restoredDraft.attachments);
        }
        pendingUserMessagesRef.current.delete(optimisticId);
        const reading = state.readings[sideChatId];
        if (reading) state.rememberMessages(sideChatId, reading.messages.filter((message) => message.renderKey !== optimisticMessage.renderKey));
        if (!isCurrent()) return;
        setMessages((current) => current.filter((message) => message.renderKey !== optimisticMessage.renderKey));
        setRunning(false);
        const status = (cause as { status?: number }).status;
        if (status === 404 || status === 410) handleFailure(cause);
        else setError(sideChatErrorMessage(cause, sideChatMessages));
      }).finally(() => { submittingRef.current = false; });
  };

  const answerClarify = async (answer: string) => {
    if (!clarify || endedRef.current) return;
    setClarifySubmitting(true);
    setClarifyError(null);
    try {
      await answerSideChatClarification(sideChatId, clarify.requestId, answer);
      setClarify(null);
      void reload();
    } catch (cause) {
      if ((cause as { status?: number }).status === 410) handleFailure(cause);
      else setClarifyError(sideChatErrorMessage(cause, sideChatMessages));
    } finally {
      setClarifySubmitting(false);
    }
  };

  const stopRun = async () => {
    try {
      await abortSideChat(sideChatId, runId);
      if (isCurrent()) setClarify(null);
    } catch (cause) {
      if (!isCurrent()) return;
      const status = (cause as { status?: number }).status;
      if (status === 404 || status === 410) handleFailure(cause);
      else setError(sideChatErrorMessage(cause, sideChatMessages));
    }
  };

  const editUserMessage = useCallback((text: string) => {
    editor.resetEditor({ nextText: text, focus: true });
  }, [editor.resetEditor]);

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

  const saveModelConfig = useCallback(async (patch: { modelRef?: string; thinkingLevel?: string }) => {
    const next = await updateSideChatConfig(sideChatId, patch);
    if (isCurrent() && !endedRef.current) setView(next);
  }, [isCurrent, sideChatId]);

  kbdRef.current = {
    adapters: [],
    send: submitDraft,
    runBusy: running,
    pendingFollowUpsCount: 0,
    editingFollowUpId: null,
    onCancelEditFollowUp: () => {},
    attachmentsLen: attachments.attachments.length,
    isComposing: editor.isComposing,
    valueRef: editor.valueRef,
    adjustHeight: editor.adjustHeight,
    editorRef: editor.editorRef,
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-side-chat-scroll-viewport
          onScroll={onScroll}
          className="chat-messages h-full overflow-y-auto overflow-x-hidden px-5 py-4 [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]"
        >
          {loading && !messages.length ? (
            <div className="space-y-5" aria-busy="true" aria-label={sideChatMessages.creating}>
              <Skeleton className="ml-auto h-12 w-3/4" />
              <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" />
            </div>
          ) : messages.length ? (
            <MessageList
              messages={messages}
              authToken={token}
              sessionKey={sideChatId}
              streaming={running}
              progress={null}
              reasoningLevel="on"
              registerListContentRef={registerListContentRef}
              deleteRoundDisabled={running || Boolean(ended)}
              onSaveAssistantAsNote={saveAssistantAsNote}
              onEditUserMessage={ended ? undefined : (message) => editUserMessage(userMessageText(message))}
              responseFeedbackEnabled={false}
            />
          ) : !ended ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <MessageSquarePlus className="mb-4 size-9 text-fg-muted" strokeWidth={1.5} />
              <h2 className="text-lg font-semibold text-fg">{sideChatMessages.title}</h2>
              <p className="mt-2 text-sm text-fg-muted">{fresh ? sideChatMessages.freshContext : sideChatMessages.emptyDescription}</p>
            </div>
          ) : null}
          {truncated && ended ? <p className="mt-3 text-xs text-fg-muted">{sideChatMessages.partialReading}</p> : null}
        </div>
        <ScrollToBottomButton
          visible={!atBottom}
          onClick={() => scrollToBottom(true)}
          contained
        />
      </div>
      {connectionLost && !ended ? <p role="status" className="shrink-0 px-4 py-2 text-xs text-fg-muted">{sideChatMessages.connectionLost}</p> : null}
      {notice ? <p role="status" className="shrink-0 px-4 py-2 text-xs text-fg-muted">{notice}</p> : null}
      {warning ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-edge px-4 py-2 text-xs text-fg-muted">
          <span>{remainingMs <= 0 ? sideChatMessages.verifying : sideChatMessages.expiring.replace('{{minutes}}', String(Math.max(1, Math.ceil(remainingMs / 60_000))))}</span>
          <Button type="button" variant="ghost" className="ml-auto h-8 text-xs" disabled={extending || remainingMs <= 0} onClick={() => void extend()}>{sideChatMessages.keepAlive}</Button>
        </div>
      ) : null}
      {clarify && !ended ? (
        <div className="shrink-0 border-t border-edge px-3 pt-3">
          <ClarifyPrompt
            prompt={clarify}
            submitting={clarifySubmitting}
            submitError={clarifyError}
            labels={m.chat}
            onSubmit={answerClarify}
            onAgentDecide={() => answerClarify('Use your best judgment and continue without additional user input.')}
            onCancel={stopRun}
          />
        </div>
      ) : null}
      {error ? <p className="border-t border-edge px-4 py-2 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {ended ? (
        <div className="shrink-0 border-t border-edge p-3">
          <div className="rounded-xl border border-edge bg-surface-panel p-4">
            <h2 className="text-base font-semibold" aria-live="polite">{ended === 'unavailable' ? sideChatMessages.unavailableTitle : sideChatMessages.expiredTitle}</h2>
            <p className="mt-2 text-sm text-fg-muted">{parentMissing ? sideChatMessages.parentMissing : ended === 'waiting' ? sideChatMessages.waitExpired : messages.length ? sideChatMessages.expiredDescription : sideChatMessages.unavailableDescription}</p>
            {draftText || draftAttachments.length ? <div className="mt-3"><label htmlFor={`side-chat-draft-${sideChatId}`} className="text-xs text-fg-muted">{sideChatMessages.unsentDraft}</label><ComposerAttachmentChips attachments={draftAttachments} topPadded={false} onRemove={attachments.removeAttachment} className="mt-1 rounded-t-lg" />{draftText ? <textarea id={`side-chat-draft-${sideChatId}`} value={draftText} onChange={(event) => setDraftText(limitSideChatDraft(event.target.value))} rows={3} className="mt-1 w-full resize-y rounded-lg border border-edge bg-surface-base p-2 text-sm" /> : null}</div> : null}
            <Button type="button" variant="primary" className="mt-4" disabled={recreating} onClick={() => {
              if (parentMissing) { if (parentSessionKey) useSideChatStore.getState().setOpen(parentSessionKey, false); }
              else void recreate();
            }}>{parentMissing ? sideChatMessages.closePaneAria : recreating ? sideChatMessages.creating : draftText.trim() || draftAttachments.length ? sideChatMessages.newWithDraft : sideChatMessages.newAria}</Button>
            {messages.length && !parentMissing ? <p className="mt-2 text-xs text-fg-muted">{sideChatMessages.replaceHint}</p> : null}
          </div>
        </div>
      ) : <form onSubmit={(event) => { event.preventDefault(); submitDraft(); }} className="shrink-0 border-t border-edge p-3">
        <ComposerFrame
          dragging={attachments.isDragging}
          onDragOver={(event) => {
            if (!event.dataTransfer?.types.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            attachments.setIsDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.relatedTarget === null) attachments.setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            attachments.setIsDragging(false);
            const files = event.dataTransfer?.files;
            if (files?.length) void attachments.processFiles(Array.from(files));
          }}
        >
          <input
            ref={attachments.fileInputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files) void attachments.processFiles(Array.from(files));
              event.target.value = '';
            }}
          />
          <ComposerAttachmentChips
            attachments={attachments.attachments}
            topPadded={false}
            onRemove={attachments.removeAttachment}
          />
          {view?.context.selections.length ? (
            <div
              className="mx-3 mt-3 inline-flex h-8 max-w-[calc(100%-1.5rem)] self-start items-center gap-1.5 rounded-lg border border-edge bg-surface-base px-2.5 text-xs font-medium text-fg-muted sm:mx-4"
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
          <div className={view?.context.selections.length ? 'px-3 sm:px-4' : 'px-3 pt-1 sm:px-4'}>
            <ChatComposerInput
              editorRef={editor.editorRef}
              disabled={connectionLost}
              placeholder={m.chat.typeMessage}
              onWireInput={(wire, caret) => {
                const next = limitSideChatDraft(wire);
                if (textBytes(wire) > SIDE_CHAT_DRAFT_BYTES) setError(sideChatMessages.draftTooLong);
                editor.onWireInput(next, Math.min(caret, next.length));
              }}
              adjustHeight={editor.adjustHeight}
              processFiles={attachments.processFiles}
              processPastedText={attachments.processPastedText}
              setIsComposing={editor.setIsComposing}
              kbdRef={kbdRef}
              chatMessages={m.chat}
            />
          </div>
          <ComposerToolbarRow>
            <ComposerAttachButton
              disabled={connectionLost}
              runBusy={running}
              attachmentCount={attachments.attachments.length}
              maxAttachments={MAX_CHAT_ATTACHMENTS}
              chat={m.chat}
              onPickFiles={() => attachments.fileInputRef.current?.click()}
            />
            <div className="ml-auto min-w-0">
              {view ? (
                <ComposerModelConfigControl
                  chat={m.chat}
                  sessionModel={view.config.modelRef}
                  modelDisabled={running || connectionLost}
                  onModelChange={(modelRef, thinkingLevel) => saveModelConfig({ modelRef, thinkingLevel })}
                  thinkingLevel={view.config.thinkingLevel}
                  thinkingDisabled={running || connectionLost}
                  onThinkingChange={(thinkingLevel) => saveModelConfig({ thinkingLevel })}
                />
              ) : null}
            </div>
            <ComposerRunControl
              disabled={connectionLost || textBytes(draftText) > SIDE_CHAT_DRAFT_BYTES}
              voiceActive={false}
              runBusy={running}
              hasDraft={Boolean(draftText.trim()) || attachments.attachments.length > 0}
              showSteeringInterrupt={false}
              chat={m.chat}
              onSend={submitDraft}
              onAbort={() => void stopRun()}
            />
          </ComposerToolbarRow>
        </ComposerFrame>
      </form>}
    </div>
  );
}
