import { ProactiveToday } from '@/features/proactive/proactive-today';
import * as Dialog from '@radix-ui/react-dialog';
import type { HomeAction, HomeWorkbenchItem } from '@xopcai/gateway-contract';
import { CalendarClock, ChevronRight, CircleAlert, Plus, X } from 'lucide-react';
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { proactiveGet, type ProactiveOverview } from '@/features/proactive/api';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MAX_CHAT_ATTACHMENTS } from '@/features/chat/attachments/attachment-utils';
import {
  ACCEPT,
  collectClipboardFiles,
  isComposerAcceptableFile,
} from '@/features/chat/composer/composer-clipboard';
import { appendTranscriptToDraft } from '@/features/chat/composer/append-transcript-to-draft';
import { showComposerNotification } from '@/features/chat/composer/composer-notifications';
import { createComposerPayloadHandoff } from '@/features/chat/composer/composer-payload-handoff';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { useRealtimeVoice } from '@/features/voice/realtime/use-realtime-voice';
import { newChatAutoSendHref } from '@/features/chat/session/composer-handoff-params';
import {
  acknowledgeWorkAttention,
  fetchHome,
  respondToWorkDecision,
  retryWorkAttention,
  type HomeResponse,
} from '@/features/tasks/home-api';
import { HomeQuickComposer } from '@/features/tasks/home-quick-composer';
import { taskCopy } from '@/features/tasks/task-copy';
import {
  type VoiceInputShortcutTarget,
  VOICE_INPUT_CANCEL_EVENT,
  VOICE_INPUT_TOGGLE_EVENT,
} from '@/features/voice/voice-input-shortcut-events';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function HomeSkeleton() {
  return (
    <div className="space-y-8" aria-busy>
      <div className="space-y-3">
        <Skeleton className="h-10 w-3/5 rounded-xl" />
        <Skeleton className="h-5 w-4/5 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}

type HomeActionRunner = (action: HomeAction, itemId: string) => void;

function DecisionCard({
  item,
  busy,
  recommendationLabel,
  dueLabel,
  failureLabel,
  locale,
  onAction,
}: {
  item: HomeWorkbenchItem;
  busy: boolean;
  recommendationLabel: string;
  dueLabel: string;
  failureLabel: string;
  locale: 'en' | 'zh';
  onAction: HomeActionRunner;
}) {
  const due = item.dueAt ? `${dueLabel} ${formatMediumDateTime(new Date(item.dueAt), locale)}` : null;
  const kicker = item.kind === 'failure' ? failureLabel : due;
  return (
    <article className="px-5 py-5 sm:px-6 sm:py-6">
      {kicker ? (
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-warning">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden />
          <span>{kicker}</span>
        </div>
      ) : null}
      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-accent"
        disabled={!item.openAction}
        onClick={() => item.openAction && onAction(item.openAction, item.id)}
      >
        <span className="block text-lg font-semibold leading-7 tracking-tight text-fg">{item.title}</span>
        <span className="mt-1.5 block text-sm leading-6 text-fg-muted">{item.summary}</span>
      </button>
      {item.recommendation ? (
        <p className="mt-3 text-sm leading-6 text-fg-muted">
          <span className="font-semibold text-fg">{recommendationLabel}：</span>
          {item.recommendation}
        </p>
      ) : null}
      {item.primaryAction || item.secondaryActions.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {item.primaryAction ? (
            <Button
              type="button"
              variant="primary"
              className="h-9 rounded-lg px-3.5 text-xs"
              disabled={busy}
              onClick={() => onAction(item.primaryAction!, item.id)}
            >
              {item.primaryAction.label}
            </Button>
          ) : null}
          {item.secondaryActions.map((action) => (
            <Button
              key={`${action.type}:${action.label}`}
              type="button"
              variant="secondary"
              className="h-9 rounded-lg px-3.5 text-xs shadow-none"
              disabled={busy}
              onClick={() => onAction(action, item.id)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function BackgroundRow({ item, onAction }: { item: HomeWorkbenchItem; onAction: HomeActionRunner }) {
  const icon = item.kind === 'scheduled'
    ? <CalendarClock className="size-4" aria-hidden />
    : <span className="size-1.5 rounded-full bg-success" aria-hidden />;
  return (
    <button
      type="button"
      className="flex min-h-16 w-full items-center gap-3 py-3 text-left outline-none hover:text-fg focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-accent"
      disabled={!item.openAction}
      onClick={() => item.openAction && onAction(item.openAction, item.id)}
    >
      <span className="flex size-7 shrink-0 items-center justify-center text-fg-subtle">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
        <span className="mt-0.5 block truncate text-xs text-fg-muted">{item.summary}</span>
      </span>
      {item.statusLabel ? <span className="shrink-0 text-xs text-fg-subtle">{item.statusLabel}</span> : null}
      {item.openAction ? <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden /> : null}
    </button>
  );
}

export function HomePage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const copy = taskCopy(language);
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const attachments = useComposerAttachments({ chat: msg.chat });
  const intentInputRef = useRef<HTMLTextAreaElement>(null);
  const voice = useRealtimeVoice({
    disabled: attachmentBusy,
    chat: msg.chat,
    onTranscript: (transcript) => {
      setIntent((current) => appendTranscriptToDraft(current, transcript));
      window.setTimeout(() => intentInputRef.current?.focus(), 0);
    },
  });
  const {
    phase: voicePhase,
    voiceActive,
    startVoiceInput,
    cancelVoiceInput: cancelVoiceCapture,
    confirmVoiceInput,
    retryVoiceInput,
  } = voice;

  const load = useCallback(async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true);
    setLoadError(null);
    try {
      const snapshot = await fetchHome(language);
      setHome({ ...snapshot, needsUser: snapshot.needsUser.filter(item => item.primaryAction?.type !== 'review_judgment' && item.openAction?.type !== 'review_judgment'), background: snapshot.background.filter(item => item.primaryAction?.type !== 'review_judgment' && item.openAction?.type !== 'review_judgment') });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleRefresh = (delayMs: number) => {
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        void load();
      }, delayMs);
    };
    const refreshSoon = () => scheduleRefresh(100);
    const refreshAfterSessionSettles = () => scheduleRefresh(750);
    const immediateEvents = ['session-created', 'agent-run-started', 'agent-run-ended', 'automation-run-completed', 'workflow-run-updated', 'workflow-run-error'];
    const noisySessionEvents = ['session-updated', 'session-transcript-updated'];
    immediateEvents.forEach((name) => window.addEventListener(name, refreshSoon));
    noisySessionEvents.forEach((name) => window.addEventListener(name, refreshAfterSessionSettles));
    return () => {
      immediateEvents.forEach((name) => window.removeEventListener(name, refreshSoon));
      noisySessionEvents.forEach((name) => window.removeEventListener(name, refreshAfterSessionSettles));
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [load]);

  const processAttachmentFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || attachmentBusy) return;
    setAttachmentBusy(true);
    try {
      await attachments.processFiles(files);
    } finally {
      setAttachmentBusy(false);
    }
  }, [attachmentBusy, attachments.processFiles]);

  const handleAttachmentPaste = useCallback(async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const collected = collectClipboardFiles(event.clipboardData);
    if (collected.length === 0) return;
    event.preventDefault();
    const accepted = collected.filter(isComposerAcceptableFile);
    if (accepted.length === 0) {
      showComposerNotification('warning', msg.chat.clipboardFileTypeUnsupported);
      return;
    }
    await processAttachmentFiles(accepted);
  }, [msg.chat.clipboardFileTypeUnsupported, processAttachmentFiles]);

  const handleAttachmentDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    attachments.setIsDragging(true);
  }, [attachments.setIsDragging]);

  const handleAttachmentDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      attachments.setIsDragging(false);
    }
  }, [attachments.setIsDragging]);

  const handleAttachmentDrop = useCallback(async (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    attachments.setIsDragging(false);
    await processAttachmentFiles(Array.from(event.dataTransfer.files));
  }, [attachments.setIsDragging, processAttachmentFiles]);

  const startConversation = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const wireAttachments = attachments.wireAttachmentsPayload();
    const attachmentsHandoff = wireAttachments.length > 0
      ? createComposerPayloadHandoff(wireAttachments)
      : undefined;
    const href = newChatAutoSendHref(intent, attachmentsHandoff, { projectScope: 'none' });
    if (!href) return;
    setConversationOpen(false);
    setIntent('');
    attachments.clearAttachments();
    navigate(href);
  }, [attachments.clearAttachments, attachments.wireAttachmentsPayload, intent, navigate]);

  const attachmentsFull = attachments.attachments.length >= MAX_CHAT_ATTACHMENTS;
  const attachTitle = attachmentsFull
    ? interpolate(msg.chat.maxAttachmentsReached, { max: MAX_CHAT_ATTACHMENTS })
    : `${msg.chat.attachFile} (${attachments.attachments.length}/${MAX_CHAT_ATTACHMENTS})`;
  const quickComposerLabels = {
    attachTitle,
    dropFiles: msg.chat.dropFiles,
    intentLabel: copy.intentLabel,
    intentPlaceholder: copy.intentPlaceholder,
    intentSuggestion: copy.intentSuggestion,
    shortcut: t.home.submitShortcut,
    submit: copy.newWork,
  };

  const proactive = useSWR<ProactiveOverview>('/api/proactive/overview', proactiveGet, { refreshInterval: 15000 });
  const hasProactiveWork = Boolean(proactive.data && (proactive.data.needsDecision.length
    || proactive.data.prepared.length || proactive.data.updates.length || proactive.data.delegations.some(sub => sub.effectiveEnabled)));
  const isIdle = Boolean(home && home.needsUser.length === 0 && home.backgroundCount === 0 && proactive.data && !hasProactiveWork);
  const composerVisible = isIdle || conversationOpen;

  useEffect(() => {
    if (!composerVisible && voiceActive) cancelVoiceCapture();
  }, [cancelVoiceCapture, composerVisible, voiceActive]);

  useEffect(() => {
    const toggleVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if ((target && target !== 'chat') || !composerVisible || attachmentBusy) return;
      event.preventDefault();
      if (voicePhase === 'recording') {
        confirmVoiceInput();
      } else if (voicePhase === 'idle') {
        intentInputRef.current?.focus();
        void startVoiceInput();
      } else if (voicePhase === 'error') {
        retryVoiceInput();
      }
    };
    const handleCancelVoiceInput = (event: Event) => {
      const target = (event as CustomEvent<{ target?: VoiceInputShortcutTarget }>).detail?.target;
      if ((target && target !== 'chat') || !composerVisible || !voiceActive) return;
      event.preventDefault();
      cancelVoiceCapture();
      intentInputRef.current?.focus();
    };

    window.addEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
    window.addEventListener(VOICE_INPUT_CANCEL_EVENT, handleCancelVoiceInput);
    return () => {
      window.removeEventListener(VOICE_INPUT_TOGGLE_EVENT, toggleVoiceInput);
      window.removeEventListener(VOICE_INPUT_CANCEL_EVENT, handleCancelVoiceInput);
    };
  }, [
    attachmentBusy,
    cancelVoiceCapture,
    composerVisible,
    confirmVoiceInput,
    retryVoiceInput,
    startVoiceInput,
    voiceActive,
    voicePhase,
  ]);

  const handleConversationOpenChange = useCallback((open: boolean) => {
    if (!open) cancelVoiceCapture();
    setConversationOpen(open);
  }, [cancelVoiceCapture]);

  const headerEnd = useMemo(() => isIdle ? null : (
    <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => setConversationOpen(true)}>
      <Plus className="size-4" aria-hidden />
      {copy.newWork}
    </Button>
  ), [copy.newWork, isIdle]);

  const runAction = useCallback<HomeActionRunner>((action, itemId) => {
    if (action.type === 'open') {
      navigate(action.href);
      return;
    }
    if (action.type === 'review_judgment') {
      navigate(`/proactive?item=${encodeURIComponent(action.itemId)}`);
      return;
    }
    setBusyItemId(itemId);
    setLoadError(null);
    void (async () => {
      try {
        if (action.type === 'connector_decision') {
          await respondToWorkDecision({ kind: 'connector_approval', approvalId: action.approvalId }, action.decision);
        } else if (action.type === 'retry_run') {
          await retryWorkAttention({ kind: action.subjectKind, runId: action.runId });
        } else if (action.type === 'acknowledge_run') {
          await acknowledgeWorkAttention({ kind: action.subjectKind, runId: action.runId });
        }
        await load();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusyItemId(null);
      }
    })();
  }, [load, navigate]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>,
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title]);

  const needsUserCount = home?.needsUser.length ?? 0;
  const backgroundCount = home?.backgroundCount ?? 0;
  const headline = needsUserCount > 0
    ? interpolate(t.home.attentionTitle, { count: needsUserCount })
    : backgroundCount > 0
      ? t.home.clearTitle
      : hasProactiveWork ? (language === 'zh' ? '助理在跟进你交代的事' : 'Your assistant is following through')
        : proactive.data ? t.home.idleTitle : (language === 'zh' ? '今天的工作' : 'Your work today');
  const intro = needsUserCount > 0
    ? backgroundCount > 0
      ? interpolate(t.home.attentionIntroWithBackground, { count: backgroundCount })
      : t.home.attentionIntro
    : backgroundCount > 0
      ? interpolate(t.home.clearIntro, { count: backgroundCount })
      : hasProactiveWork ? (language === 'zh' ? '准备好的成果和需要你决定的事项都在这里。' : 'Prepared work and decisions that need you appear here.')
        : proactive.data ? t.home.idleIntro : (language === 'zh' ? '正在核对已交代的事项。' : 'Checking your delegated work.');

  return (
    <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <input
        ref={attachments.fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          if (files) void processAttachmentFiles(Array.from(files));
          event.target.value = '';
        }}
      />
      <Dialog.Root
        open={conversationOpen}
        onOpenChange={handleConversationOpenChange}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] flex h-[min(31rem,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="flex shrink-0 items-start gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-fg">{copy.dialogTitle}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-fg-muted">{copy.dialogDescription}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" className="-mr-2 -mt-1 size-8 shrink-0 rounded-lg p-0" title={t.cancel} aria-label={t.cancel}>
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <HomeQuickComposer
              variant="dialog"
              inputId="new-conversation-intent"
              inputRef={intentInputRef}
              intent={intent}
              labels={{ ...quickComposerLabels, submit: copy.submit }}
              attachments={attachments.attachments}
              isDragging={attachments.isDragging}
              attachmentBusy={attachmentBusy}
              attachmentsFull={attachmentsFull}
              voice={voice}
              chat={msg.chat}
              cancelAction={(
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost">{t.cancel}</Button>
                </Dialog.Close>
              )}
              onIntentChange={setIntent}
              onPickFiles={() => attachments.fileInputRef.current?.click()}
              onRemoveAttachment={attachments.removeAttachment}
              onPaste={(event) => void handleAttachmentPaste(event)}
              onDragOver={handleAttachmentDragOver}
              onDragLeave={handleAttachmentDragLeave}
              onDrop={(event) => void handleAttachmentDrop(event)}
              onSubmit={startConversation}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {loadError ? (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.home.retry}</Button>
        </div>
      ) : null}

      {loading ? <HomeSkeleton /> : home ? (
        <div>
          <section className={isIdle ? 'w-full max-w-2xl text-center' : 'max-w-3xl'}>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-[2.5rem] sm:leading-[1.12]">{headline}</h2>
            <p className={isIdle
              ? 'mx-auto mt-3 max-w-xl text-sm leading-6 text-fg-muted sm:text-base sm:leading-7'
              : 'mt-3 max-w-2xl text-sm leading-6 text-fg-muted sm:text-base sm:leading-7'}>
              {intro}
            </p>
            {isIdle ? (
              <HomeQuickComposer
                variant="inline"
                inputId="idle-conversation-intent"
                inputRef={intentInputRef}
                intent={intent}
                labels={quickComposerLabels}
                attachments={attachments.attachments}
                isDragging={attachments.isDragging}
                attachmentBusy={attachmentBusy}
                attachmentsFull={attachmentsFull}
                voice={voice}
                chat={msg.chat}
                onIntentChange={setIntent}
                onPickFiles={() => attachments.fileInputRef.current?.click()}
                onRemoveAttachment={attachments.removeAttachment}
                onPaste={(event) => void handleAttachmentPaste(event)}
                onDragOver={handleAttachmentDragOver}
                onDragLeave={handleAttachmentDragLeave}
                onDrop={(event) => void handleAttachmentDrop(event)}
                onSubmit={startConversation}
              />
            ) : null}
          </section>

          <section className="mt-8"><ProactiveToday compact /></section>

          {home.needsUser.length > 0 ? (
            <section className="mt-10" aria-labelledby="home-needs-user-title">
              <div className="mb-3 flex items-center gap-2 px-1">
                <CircleAlert className="size-4 text-warning" aria-hidden />
                <h2 id="home-needs-user-title" className="text-sm font-semibold text-fg">{t.home.needsUserTitle}</h2>
              </div>
              <div className="divide-y divide-edge-subtle overflow-hidden rounded-2xl border border-edge-subtle bg-surface-base">
                {home.needsUser.map((item) => (
                  <DecisionCard
                    key={item.id}
                    item={item}
                    busy={busyItemId === item.id}
                    recommendationLabel={t.home.recommendationLabel}
                    dueLabel={t.home.dueLabel}
                    failureLabel={copy.runAttention}
                    locale={language}
                    onAction={runAction}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {home.background.length > 0 ? (
            <section className="mt-10" aria-labelledby="home-background-title">
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 id="home-background-title" className="text-sm font-semibold text-fg">{t.home.backgroundTitle}</h2>
                <span className="text-xs text-fg-subtle">{interpolate(t.home.backgroundCount, { count: home.backgroundCount })}</span>
              </div>
              <div className="mt-2 divide-y divide-edge-subtle border-y border-edge-subtle">
                {home.background.map((item) => <BackgroundRow key={item.id} item={item} onAction={runAction} />)}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
