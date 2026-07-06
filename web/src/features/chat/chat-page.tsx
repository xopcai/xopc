import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { fetchCommandsCached } from '@/features/chat/palette/command-palette-api';
import { ChatComposer } from '@/features/chat/composer/chat-composer';
import { ChatGoalBanner } from '@/features/chat/goals/chat-goal-banner';
import { ChatPageHeaderRegistration } from '@/features/chat/chat-page-header-registration';
import { ChatSseStatus } from '@/features/chat/agent-selection/chat-sse-status';
import { MessageList } from '@/features/chat/messages/message-list';
import { ScrollToBottomButton } from '@/features/chat/scroll/scroll-to-bottom-button';
import { useChatScrollViewport } from '@/features/chat/scroll/use-chat-scroll-viewport';
import { useChatSession } from '@/features/chat/session/use-chat-session';
import { ChatTimelineRail } from '@/features/chat/timeline/chat-timeline-rail';
import { ClarifyPrompt } from '@/features/chat/composer/clarify-prompt';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { isValidSkillWireId } from '@/features/chat/palette/skill-wire-pattern';
import { wireTextForSlashCommandEntry } from '@/features/chat/palette/slash-command-wire-text';
import { WorkflowRunLinkCard } from '@/features/chat/workflow/workflow-run-link-card';
import { WorkflowSessionBanner } from '@/features/chat/workflow/workflow-session-banner';
import { ProductAutomationFeedback } from '@/features/automations/product-automation-feedback';
import { ACTIVE_RUN_STATUSES } from '@/features/workflows/workflow-page.constants';
import { useSessionWorkflowRunLinks } from '@/features/workflows/use-session-workflow-run-links';
import { useWorkflowRunLive } from '@/features/workflows/use-workflow-run-live';
import { useWorkflowSessionMetadata } from '@/features/workflows/use-workflow-session-metadata';
import { appendNoteContent, createTaskNote, getNote } from '@/features/notes/notes-api';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';
import { AgentRunErrorBanner } from '@/features/chat/messages/agent-run-error-banner';
import { agentsAppDetailPath } from '@/features/settings/agents/agents-app-path';
import { showToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';

type PendingSourceNoteSave = {
  sourceNoteId: string;
  resolve: () => void;
  reject: () => void;
};

type SourceNoteSaveDraft = {
  heading: string;
  content: string;
};

export function ChatPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const token = useGatewayStore((s) => s.token);
  const navigate = useNavigate();
  const location = useLocation();
  const { pathname } = location;
  const [searchParams] = useSearchParams();
  /** Dedupe applying the same `?skill=` / `?slash=` seed for a session (StrictMode-safe). */
  const routeComposerSeedMarkerRef = useRef<string | null>(null);

  const welcomeDraftSeq = useRef(0);
  const pendingSourceNoteSaveRef = useRef<PendingSourceNoteSave | null>(null);
  const [welcomeDraftSeed, setWelcomeDraftSeed] = useState<{ id: number; text: string } | null>(null);
  const [sourceNoteLoadedTitle, setSourceNoteLoadedTitle] = useState<string | null>(null);
  const [sourceNoteSaveDraft, setSourceNoteSaveDraft] = useState<SourceNoteSaveDraft | null>(null);
  const [sourceNoteSaveSubmitting, setSourceNoteSaveSubmitting] = useState(false);

  const { auth, session, messages: msgSlice, timeline, stream, followUp, clarify, agents } = useChatSession();

  const skillQuery = searchParams.get('skill')?.trim() ?? '';
  const slashQuery = searchParams.get('slash')?.trim() ?? '';
  const draftQuery = searchParams.get('draft') ?? '';
  const chatSessionKey = session.decodedKey ?? session.sessionKey;
  const { data: workflowMeta } = useWorkflowSessionMetadata(chatSessionKey);
  const workflowRunId = workflowMeta?.workflowRunId ?? null;
  const { view: workflowRunView } = useWorkflowRunLive(workflowRunId);
  const { data: workflowRunLinks = [], mutate: refreshWorkflowRunLinks } =
    useSessionWorkflowRunLinks(chatSessionKey);
  const showWorkflowLiveBanner = Boolean(
    workflowRunId &&
      workflowRunView &&
      ACTIVE_RUN_STATUSES.has(workflowRunView.run.status),
  );

  useEffect(() => {
    if (!chatSessionKey) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; sessionKey?: string }>).detail;
      const updatedKey = detail?.key ?? detail?.sessionKey;
      if (updatedKey === chatSessionKey) {
        void refreshWorkflowRunLinks();
      }
    };
    window.addEventListener('session-transcript-updated', handler);
    window.addEventListener('workflow-run-started-from-chat', handler);
    return () => {
      window.removeEventListener('session-transcript-updated', handler);
      window.removeEventListener('workflow-run-started-from-chat', handler);
    };
  }, [chatSessionKey, refreshWorkflowRunLinks]);

  useEffect(() => {
    routeComposerSeedMarkerRef.current = null;
  }, [session.sessionKey]);

  useEffect(() => {
    if (!auth.hasToken) return;
    if (!skillQuery && !slashQuery && !draftQuery) return;
    if (session.showSessionLoading || session.sessionRoutePending) return;
    if (!session.sessionKey) return;

    const stripRouteComposerParams = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('skill');
      next.delete('slash');
      next.delete('draft');
      const qs = next.toString();
      navigate({ pathname, search: qs ? `?${qs}` : '' }, { replace: true });
    };

    /** After session + clear effect; same idea as `fillChatComposerWithNavigate` (rAF / microtask). */
    const applyWireSeed = (text: string, marker: string) => {
      if (routeComposerSeedMarkerRef.current === marker) return;
      routeComposerSeedMarkerRef.current = marker;
      queueMicrotask(() => {
        welcomeDraftSeq.current += 1;
        setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text });
        stripRouteComposerParams();
      });
    };

    if (skillQuery) {
      if (!isValidSkillWireId(skillQuery)) {
        stripRouteComposerParams();
        return;
      }
      const marker = `${session.sessionKey}:skill:${skillQuery}`;
      applyWireSeed(`/skill:${skillQuery} `, marker);
      return;
    }

    const trimmedDraftQuery = draftQuery.trim();
    if (trimmedDraftQuery) {
      const marker = `${session.sessionKey}:draft:${trimmedDraftQuery}`;
      applyWireSeed(trimmedDraftQuery, marker);
      return;
    }

    const slashNameRe = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (!slashNameRe.test(slashQuery)) {
      stripRouteComposerParams();
      return;
    }
    const marker = `${session.sessionKey}:slash:${slashQuery}`;
    if (routeComposerSeedMarkerRef.current === marker) return;
    queueMicrotask(() => {
      void (async () => {
        try {
          const cmds = await fetchCommandsCached();
          const needle = slashQuery.toLowerCase();
          const c = cmds.find(
            (x) =>
              x.name.toLowerCase() === needle ||
              (Array.isArray(x.aliases) && x.aliases.some((a) => a.toLowerCase() === needle)),
          );
          if (c) {
            if (routeComposerSeedMarkerRef.current === marker) return;
            routeComposerSeedMarkerRef.current = marker;
            welcomeDraftSeq.current += 1;
            setWelcomeDraftSeed({ id: welcomeDraftSeq.current, text: wireTextForSlashCommandEntry(c) });
          }
        } finally {
          stripRouteComposerParams();
        }
      })();
    });
  }, [
    auth.hasToken,
    skillQuery,
    slashQuery,
    draftQuery,
    searchParams,
    session.showSessionLoading,
    session.sessionRoutePending,
    session.sessionKey,
    navigate,
    pathname,
  ]);

  const {
    scrollRef,
    atBottom,
    registerListContentRef,
    scrollToBottom,
    onScroll: onChatViewportScroll,
  } = useChatScrollViewport({
    hasToken: auth.hasToken,
    showSessionLoading: session.showSessionLoading,
    sessionKey: session.sessionKey,
    sending: stream.sending,
    chatMessages: msgSlice.items,
    hasMore: session.hasMore,
    loadingMore: session.loadingMore,
    loadMoreMessages: session.loadMoreMessages,
  });

  const [activeMessageIndex, setActiveMessageIndex] = useState(0);
  const timelineRafRef = useRef<number | null>(null);
  const pendingTimelineDisplayIndexRef = useRef<number | null>(null);
  const timelineDisplayOffset = useMemo(() => {
    let maxDisplayIndex = -1;
    for (const item of timeline.items) {
      if (typeof item.displayIndex === 'number' && Number.isFinite(item.displayIndex)) {
        maxDisplayIndex = Math.max(maxDisplayIndex, item.displayIndex);
      }
    }
    if (maxDisplayIndex < 0) return 0;
    return Math.max(0, maxDisplayIndex + 1 - msgSlice.items.length);
  }, [msgSlice.items.length, timeline.items]);

  const scrollToLocalMessageIndex = useCallback(
    (localMessageIndex: number) => {
      const root = scrollRef.current;
      if (!root) return false;
      const target = root.querySelector<HTMLElement>(
        `[data-chat-message-index="${localMessageIndex}"]`,
      );
      if (!target) return false;
      setActiveMessageIndex(localMessageIndex);
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const scrollTop = root.scrollTop + targetRect.top - rootRect.top - 16;
      root.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      return true;
    },
    [scrollRef],
  );

  const updateActiveMessageIndex = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-message-index]'));
    if (rows.length === 0) {
      setActiveMessageIndex(0);
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const anchorY = rootRect.top + Math.min(180, rootRect.height * 0.35);
    let best = rows[0];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.top <= anchorY) {
        best = row;
        continue;
      }
      break;
    }
    const raw = best.dataset.chatMessageIndex;
    const next = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(next)) {
      setActiveMessageIndex((prev) => (prev === next ? prev : next));
    }
  }, [scrollRef]);

  const scheduleTimelineActiveUpdate = useCallback(() => {
    if (timelineRafRef.current != null) {
      cancelAnimationFrame(timelineRafRef.current);
    }
    timelineRafRef.current = requestAnimationFrame(() => {
      timelineRafRef.current = null;
      updateActiveMessageIndex();
    });
  }, [updateActiveMessageIndex]);

  const handleChatScroll = useCallback(() => {
    onChatViewportScroll();
    scheduleTimelineActiveUpdate();
  }, [onChatViewportScroll, scheduleTimelineActiveUpdate]);

  const handleTimelineSelect = useCallback(
    (messageIndex: number) => {
      const localMessageIndex = messageIndex - timelineDisplayOffset;
      if (localMessageIndex < 0 || localMessageIndex >= msgSlice.items.length) {
        if (localMessageIndex < 0 && session.hasMore && !session.loadingMore) {
          pendingTimelineDisplayIndexRef.current = messageIndex;
          void session.loadMoreMessages();
        }
        return;
      }
      pendingTimelineDisplayIndexRef.current = null;
      scrollToLocalMessageIndex(localMessageIndex);
    },
    [
      msgSlice.items.length,
      scrollToLocalMessageIndex,
      session.hasMore,
      session.loadMoreMessages,
      session.loadingMore,
      timelineDisplayOffset,
    ],
  );

  useEffect(() => {
    const pending = pendingTimelineDisplayIndexRef.current;
    if (pending == null) return;
    const localMessageIndex = pending - timelineDisplayOffset;
    if (localMessageIndex >= 0 && localMessageIndex < msgSlice.items.length) {
      pendingTimelineDisplayIndexRef.current = null;
      requestAnimationFrame(() => scrollToLocalMessageIndex(localMessageIndex));
      return;
    }
    if (localMessageIndex < 0 && session.hasMore && !session.loadingMore) {
      void session.loadMoreMessages();
      return;
    }
    if (localMessageIndex >= msgSlice.items.length || !session.hasMore) {
      pendingTimelineDisplayIndexRef.current = null;
    }
  }, [
    msgSlice.items.length,
    scrollToLocalMessageIndex,
    session.hasMore,
    session.loadMoreMessages,
    session.loadingMore,
    timelineDisplayOffset,
  ]);

  useEffect(() => {
    scheduleTimelineActiveUpdate();
  }, [msgSlice.items.length, scheduleTimelineActiveUpdate, session.sessionKey, timelineDisplayOffset]);

  useEffect(() => {
    return () => {
      if (timelineRafRef.current != null) {
        cancelAnimationFrame(timelineRafRef.current);
      }
    };
  }, []);

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
      !session.workingDirectoryLocked &&
      msgSlice.items.length === 0,
    [
      session.sessionKey,
      session.showSessionLoading,
      session.sessionRoutePending,
      session.workingDirectoryLocked,
      msgSlice.items.length,
    ],
  );

  const setWorkspaceEditorAgentId = useWorkspaceEditorAgentStore((s) => s.setAgentId);

  useEffect(() => {
    if (!auth.hasToken) return;
    setWorkspaceEditorAgentId(agents.displayAgentId);
    return () => setWorkspaceEditorAgentId('');
  }, [auth.hasToken, agents.displayAgentId, setWorkspaceEditorAgentId]);

  /** Match `MessageList` empty welcome: tighter vertical padding so the first screen fits without scrolling. */
  const compactWelcomeLayout =
    !session.showSessionLoading && msgSlice.items.length === 0 && !stream.streaming;
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

  const sourceNoteId = workflowMeta?.sourceNoteId ?? null;
  useEffect(() => {
    let cancelled = false;
    setSourceNoteLoadedTitle(null);
    if (!sourceNoteId) return undefined;
    void getNote(sourceNoteId)
      .then((note) => {
        if (cancelled) return;
        setSourceNoteLoadedTitle(note?.title?.trim() || null);
      })
      .catch(() => {
        if (!cancelled) setSourceNoteLoadedTitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceNoteId]);

  const sourceNoteTitle =
    sourceNoteLoadedTitle || workflowMeta?.sourceNoteTitle || m.chat.sourceNoteFallbackTitle;
  const closeSourceNoteSaveDialog = useCallback(() => {
    pendingSourceNoteSaveRef.current?.reject();
    pendingSourceNoteSaveRef.current = null;
    setSourceNoteSaveDraft(null);
    setSourceNoteSaveSubmitting(false);
  }, []);

  useEffect(() => {
    closeSourceNoteSaveDialog();
  }, [closeSourceNoteSaveDialog, sourceNoteId]);

  const timelineLabels = useMemo(
    () => ({
      title: m.chat.timelineTitle,
      turn: m.chat.timelineTurn,
      messageFallback: m.chat.timelineMessageFallback,
      toolCount_one: m.chat.timelineToolCount_one,
      toolCount_other: m.chat.timelineToolCount_other,
      searchedWeb: m.chat.stepSearchedWeb,
      readFile: m.chat.stepReadFile,
      runCommand: m.chat.stepRunCommand,
      listDirectory: m.chat.stepListDirectory,
      writeFile: m.chat.stepWriteFile,
      editFile: m.chat.stepEditFile,
      openUrl: m.chat.stepOpenUrl,
      fetchUrl: m.chat.stepFetchUrl,
      unknownTool: m.chat.stepUnknownTool,
    }),
    [
      m.chat.timelineTitle,
      m.chat.timelineTurn,
      m.chat.timelineMessageFallback,
      m.chat.timelineToolCount_one,
      m.chat.timelineToolCount_other,
      m.chat.stepSearchedWeb,
      m.chat.stepReadFile,
      m.chat.stepRunCommand,
      m.chat.stepListDirectory,
      m.chat.stepWriteFile,
      m.chat.stepEditFile,
      m.chat.stepOpenUrl,
      m.chat.stepFetchUrl,
      m.chat.stepUnknownTool,
    ],
  );

  const handleSaveAssistantToSourceNote = useCallback(
    async (content: string) => {
      if (!sourceNoteId) return;
      pendingSourceNoteSaveRef.current?.reject();
      setSourceNoteSaveSubmitting(false);
      const sourceLine = m.chat.sourceNoteAppendSourceLine.replace(
        '{{time}}',
        new Date().toLocaleString(language),
      );
      setSourceNoteSaveDraft({
        heading: m.chat.sourceNoteAppendHeading,
        content: `${sourceLine}\n\n${content.trim()}`,
      });
      return new Promise<void>((resolve, reject) => {
        pendingSourceNoteSaveRef.current = {
          sourceNoteId,
          resolve,
          reject,
        };
      });
    },
    [language, m.chat.sourceNoteAppendHeading, m.chat.sourceNoteAppendSourceLine, sourceNoteId],
  );

  const handleConfirmSourceNoteSave = useCallback(async () => {
    const pending = pendingSourceNoteSaveRef.current;
    if (!pending || !sourceNoteSaveDraft) return;
    const heading = sourceNoteSaveDraft.heading.trim() || m.chat.sourceNoteAppendHeading;
    const content = sourceNoteSaveDraft.content.trim();
    if (!content) return;

    setSourceNoteSaveSubmitting(true);
    try {
      await appendNoteContent(pending.sourceNoteId, content, heading);
      showToast({ type: 'success', title: m.chat.sourceNoteSaveSuccess });
      window.dispatchEvent(
        new CustomEvent('note-updated', {
          detail: {
            noteId: pending.sourceNoteId,
            source: 'chat',
            sessionKey: chatSessionKey,
          },
        }),
      );
      pending.resolve();
      pendingSourceNoteSaveRef.current = null;
      setSourceNoteSaveDraft(null);
    } catch (err) {
      showToast({
        type: 'error',
        title: m.chat.sourceNoteSaveFailed,
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSourceNoteSaveSubmitting(false);
    }
  }, [
    chatSessionKey,
    m.chat.sourceNoteAppendHeading,
    m.chat.sourceNoteSaveFailed,
    m.chat.sourceNoteSaveSuccess,
    sourceNoteSaveDraft,
  ]);

  const handleExtractAssistantTask = useCallback(
    async (content: string) => {
      if (!sourceNoteId) return;
      const title = content.trim().split(/\n+/)[0]?.replace(/^[-#*>\s]+/, '').trim() || m.chat.sourceNoteTaskFallbackTitle;
      try {
        await createTaskNote(title.slice(0, 120), {
          sourceNoteId,
          sourceSessionKey: chatSessionKey,
        });
        showToast({ type: 'success', title: m.chat.sourceNoteTaskSuccess });
      } catch (err) {
        showToast({
          type: 'error',
          title: m.chat.sourceNoteTaskFailed,
          message: err instanceof Error ? err.message : undefined,
        });
        throw err;
      }
    },
    [
      chatSessionKey,
      m.chat.sourceNoteTaskFailed,
      m.chat.sourceNoteTaskFallbackTitle,
      m.chat.sourceNoteTaskSuccess,
      sourceNoteId,
    ],
  );

  const handleDraftSourceNoteDigest = useCallback(() => {
    if (!sourceNoteId) return;
    const prompt = m.chat.sourceNoteDigestPrompt.replace('{{title}}', sourceNoteTitle);
    if (stream.streaming || stream.sending) {
      void followUp.addPendingFollowUp(prompt);
      showToast({ type: 'info', title: m.chat.sourceNoteDigestQueued });
      return;
    }
    void stream.sendMessage(prompt);
  }, [
    followUp,
    m.chat.sourceNoteDigestPrompt,
    m.chat.sourceNoteDigestQueued,
    sourceNoteId,
    sourceNoteTitle,
    stream,
  ]);

  if (!auth.hasToken) {
    return (
      <div className="mx-auto w-full max-w-[var(--max-width-chat)] px-3 py-16 text-center text-sm leading-relaxed text-fg-muted sm:px-5">
        {m.chat.needToken}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface-panel">
      <ChatSseStatus />

      <ChatPageHeaderRegistration
        chatHeadline={chatHeadline}
        chatAgents={agents.chatAgents?.items ?? []}
        showChatAgentSelector={agents.showChatAgentSelector}
        chatAgentId={agents.displayAgentId}
        onChatAgentChange={agents.onChatAgentChange}
        chatAgentDisabled={session.showSessionLoading || session.sessionRoutePending}
      />

      <div className="relative mx-auto flex min-h-0 w-full max-w-[calc(var(--max-width-chat)+8rem)] flex-1 flex-col">
        {(location.state as { fromAgentEditor?: boolean } | null)?.fromAgentEditor &&
        agents.displayAgentId ? (
          <div className="shrink-0 border-b border-edge-subtle bg-surface-panel/80 px-3 py-1.5 sm:px-5 xl:px-6">
            <Link
              to={agentsAppDetailPath(agents.displayAgentId)}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-fg"
            >
              <span aria-hidden>←</span>
              {m.agentsSettings.backToEditor}
            </Link>
          </div>
        ) : null}
        {sourceNoteId ? (
          <div className="shrink-0 border-b border-edge-subtle bg-surface-panel/80 px-3 py-1.5 sm:px-5 xl:px-6">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span className="min-w-0 truncate">
                {m.chat.sourceNoteBanner.replace('{{title}}', sourceNoteTitle)}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-edge-subtle px-2 font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  onClick={handleDraftSourceNoteDigest}
                >
                  <FileText className="size-3.5" strokeWidth={1.75} aria-hidden />
                  <span>{m.chat.sourceNoteDigestAction}</span>
                </button>
                <Link
                  to={`/notes/${encodeURIComponent(sourceNoteId)}`}
                  className="font-medium text-accent transition-colors hover:text-accent-fg"
                >
                  {m.chat.sourceNoteOpen}
                </Link>
              </div>
            </div>
          </div>
        ) : null}
        {session.sessionKey && !session.showSessionLoading && !session.sessionRoutePending ? (
          <ChatGoalBanner
            sessionKey={session.sessionKey}
            streaming={stream.streaming}
            sending={stream.sending}
          />
        ) : null}
        <div className="relative flex min-h-0 min-w-0 flex-1 px-3 sm:px-5 xl:px-6">
          <div className="absolute inset-y-0 right-0 hidden xl:block">
            <ChatTimelineRail
              items={timeline.items}
              activeMessageIndex={activeMessageIndex + timelineDisplayOffset}
              labels={timelineLabels}
              onSelectMessage={handleTimelineSelect}
            />
          </div>
          <div className="mx-auto flex min-h-0 min-w-0 flex-1 flex-col xl:max-w-[58rem]">
            <div
              ref={scrollRef}
              className={cn(
                'chat-messages min-h-0 flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]',
                compactWelcomeLayout ? 'chat-messages--compact-welcome pt-5 pb-2' : 'py-4',
              )}
              onScroll={handleChatScroll}
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
                    <AgentRunErrorBanner errorText={stream.error} />
                  ) : null}
                  {workflowRunLinks.length > 0 ? (
                    <div className="mb-6 flex flex-col gap-3">
                      {workflowRunLinks.map((link) => (
                        <WorkflowRunLinkCard key={link.id} link={link} />
                      ))}
                    </div>
                  ) : null}
                  {showWorkflowLiveBanner && workflowRunView ? (
                    <WorkflowSessionBanner
                      view={workflowRunView}
                      sessionKey={chatSessionKey}
                      onAbortCurrentTurn={stream.abort}
                      onSendUserMessage={(text) => {
                        if (stream.streaming || stream.sending) {
                          void followUp.addPendingFollowUp(text);
                        } else {
                          void stream.sendMessage(text);
                        }
                      }}
                    />
                  ) : null}
                  {chatSessionKey ? (
                    <ProductAutomationFeedback
                      eventType="session.transcript.updated"
                      source="sessions"
                      payloadKey="sessionKey"
                      payloadValue={chatSessionKey}
                      className="mb-6"
                    />
                  ) : null}
                  <MessageList
                    key={session.decodedKey ?? 'new'}
                    messages={msgSlice.items}
                    authToken={token ?? undefined}
                    sessionKey={session.decodedKey ?? session.sessionKey}
                    streaming={stream.streaming}
                    progress={stream.progress}
                    reasoningLevel={session.reasoningLevel}
                    registerListContentRef={registerListContentRef}
                    onPickWelcomePrompt={onPickWelcomePrompt}
                    onDeleteRound={stream.deleteMessageRound}
                    onRetryUserMessageRound={stream.retryUserMessageRound}
                    deleteRoundDisabled={stream.streaming || stream.sending}
                    onAbortCurrentTurn={stream.abort}
                    onSendUserMessage={(text) => {
                      // stream.sendMessage silently no-ops when the assistant
                      // is still streaming/sending — so chat-card actions like
                      // "save workflow" would vanish if the user clicked while
                      // the post-tool synthesis was still being written. Route
                      // through the pending-follow-up queue in that case; it
                      // auto-flushes after the current turn settles.
                      if (stream.streaming || stream.sending) {
                        void followUp.addPendingFollowUp(text);
                      } else {
                        void stream.sendMessage(text);
                      }
                    }}
                    onSaveAssistantToSourceNote={sourceNoteId ? handleSaveAssistantToSourceNote : undefined}
                    onExtractAssistantTask={sourceNoteId ? handleExtractAssistantTask : undefined}
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
                submitError={clarify.clarifySubmitError}
                labels={m.chat}
                onSubmit={clarify.submitClarifyAnswer}
                onCancel={clarify.cancelClarifyAnswer}
              />
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
                onThinkingChange={session.onSessionThinkingLevelChange}
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
                contextUsageMessages={msgSlice.items}
                onChatAgentChange={
                  agents.showChatAgentSelector ? agents.onChatAgentChange : undefined
                }
                currentAgentId={agents.displayAgentId}
              />
            </div>
          </div>
        </div>
      </div>

      <Dialog.Root
        open={sourceNoteSaveDraft !== null}
        onOpenChange={(open) => {
          if (!open && !sourceNoteSaveSubmitting) closeSourceNoteSaveDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(82vh,42rem)] w-[min(100%-2rem,44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-popover outline-none">
            <div className="shrink-0 border-b border-edge-subtle px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">
                {m.chat.sourceNoteSaveDialogTitle}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">
                {m.chat.sourceNoteSaveDialogDescription.replace('{{title}}', sourceNoteTitle)}
              </Dialog.Description>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                <span>{m.chat.sourceNoteSaveDialogHeadingLabel}</span>
                <input
                  value={sourceNoteSaveDraft?.heading ?? ''}
                  onChange={(event) =>
                    setSourceNoteSaveDraft((draft) =>
                      draft ? { ...draft, heading: event.target.value } : draft,
                    )
                  }
                  className="h-10 rounded-lg border border-edge bg-surface-base px-3 text-sm font-normal text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                  disabled={sourceNoteSaveSubmitting}
                />
              </label>
              <label className="flex min-h-0 flex-1 flex-col gap-1.5 text-sm font-medium text-fg">
                <span>{m.chat.sourceNoteSaveDialogContentLabel}</span>
                <textarea
                  value={sourceNoteSaveDraft?.content ?? ''}
                  onChange={(event) =>
                    setSourceNoteSaveDraft((draft) =>
                      draft ? { ...draft, content: event.target.value } : draft,
                    )
                  }
                  className="min-h-[18rem] flex-1 resize-none rounded-lg border border-edge bg-surface-base px-3 py-2 font-mono text-xs leading-relaxed text-fg outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
                  disabled={sourceNoteSaveSubmitting}
                />
              </label>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={closeSourceNoteSaveDialog}
                disabled={sourceNoteSaveSubmitting}
              >
                {m.chat.sourceNoteSaveDialogCancel}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleConfirmSourceNoteSave()}
                disabled={sourceNoteSaveSubmitting || !sourceNoteSaveDraft?.content.trim()}
              >
                {sourceNoteSaveSubmitting
                  ? m.chat.sourceNoteSaveDialogSaving
                  : m.chat.sourceNoteSaveDialogConfirm}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ScrollToBottomButton
        visible={!session.showSessionLoading && !atBottom}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}
