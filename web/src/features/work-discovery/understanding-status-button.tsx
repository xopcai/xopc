import * as Dialog from '@radix-ui/react-dialog';
import { Check, FileText, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { loadWorkDiscoveryOverlay, preloadRouteForPath } from '@/lib/route-preload';
import { useLocaleStore } from '@/stores/locale-store';

import {
  submitWorkDiscoveryRecognitionFeedback,
  updateWorkDiscoveryProfile,
  type WorkDiscoveryProfileCandidate,
} from './api';
import { useUnderstandingActivityStore } from './understanding-activity-store';
import { UnderstandingReveal } from './understanding-reveal';
import { openWorkDiscoveryOverlaySearch } from './work-discovery-navigation';

export function UnderstandingStatusButton({
  floating = false,
  persistent = false,
}: {
  floating?: boolean;
  persistent?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const state = useUnderstandingActivityStore();
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const zh = language === 'zh';
  const pendingCount = state.memories.filter((memory) => memory.status === 'pending').length
    + state.focuses.filter((focus) => focus.status === 'candidate').length
    + (state.directoryRun?.status === 'completed' && !state.directoryRun.feedback?.recognitionDecision ? 1 : 0);

  useEffect(() => {
    if (pathname !== '/you' || !state.drawerOpen || state.status === 'running' || pendingCount > 0) return;
    const timer = window.setTimeout(state.finish, 800);
    return () => window.clearTimeout(timer);
  }, [pathname, pendingCount, state.drawerOpen, state.finish, state.status]);

  if (pathname !== '/you') return null;

  const preloadWorkDiscovery = () => {
    if (persistent) void loadWorkDiscoveryOverlay();
    else preloadRouteForPath('/onboarding/workspace');
  };
  const openWorkDiscovery = () => {
    if (!persistent) {
      navigate('/onboarding/workspace?new=1');
      return;
    }
    navigate({ pathname, search: openWorkDiscoveryOverlaySearch(search) });
  };

  if (state.status === 'idle') {
    if (!persistent) return null;
    const label = messages(language).you.relearn;
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'relative size-8 rounded-xl p-0',
          APP_CHROME_NO_DRAG_CLASS,
          floating && 'fixed right-4 top-3 z-40 bg-surface-panel shadow-surface',
        )}
        title={label}
        aria-label={label}
        data-work-discovery-trigger
        onPointerEnter={preloadWorkDiscovery}
        onPointerDown={preloadWorkDiscovery}
        onFocus={preloadWorkDiscovery}
        onClick={openWorkDiscovery}
      >
        <Sparkles className="size-4 text-accent-fg" aria-hidden />
      </Button>
    );
  }

  const running = state.status === 'running';
  const pendingMemory = state.memories.find((memory) => memory.status === 'pending' && memory.understandingId);
  const pendingFocus = state.focuses.find((focus) => focus.status === 'candidate');
  const directoryReady = state.directoryRun?.status === 'completed'
    && state.directoryRun.result != null
    && !state.directoryRun.feedback?.recognitionDecision;
  const sourceStatuses = Object.values(state.sources);
  const completeSources = sourceStatuses.filter((status) => status === 'completed').length;
  const unavailableSources = sourceStatuses.filter((status) => status === 'failed' || status === 'denied' || status === 'partial').length;

  const reviewMemory = async (accepted: boolean) => {
    if (!pendingMemory?.understandingId) return;
    setReviewing(true);
    await state.reviewMemory(pendingMemory.understandingId, accepted);
    setReviewing(false);
  };

  const reviewFocus = async (accepted: boolean) => {
    if (!pendingFocus) return;
    setReviewing(true);
    await state.reviewFocus(pendingFocus.id, accepted);
    setReviewing(false);
  };

  const reviewRunMemory = async (
    candidate: WorkDiscoveryProfileCandidate,
    status: 'accepted' | 'edited' | 'rejected',
    statement?: string,
  ) => {
    const currentRun = useUnderstandingActivityStore.getState().directoryRun;
    if (!currentRun) return false;
    setReviewing(true);
    setReviewError(null);
    try {
      const runCandidate = currentRun.result?.profileCandidates?.find((item) => (
        item.id === candidate.id
        || Boolean(item.understandingId && item.understandingId === candidate.understandingId)
      ));
      const sourceCandidate = state.memories.find((item) => (
        item.id === candidate.id
        || Boolean(item.understandingId && item.understandingId === candidate.understandingId)
      ));
      if (runCandidate) {
        const next = await updateWorkDiscoveryProfile(currentRun.id, [{
          id: runCandidate.id,
          status,
          ...(statement ? { statement } : {}),
        }]);
        useUnderstandingActivityStore.getState().updateDirectoryRun(next);
      }
      if (sourceCandidate?.understandingId) {
        await useUnderstandingActivityStore.getState().reviewMemory(
          sourceCandidate.understandingId,
          status === 'accepted',
          statement,
        );
      }
      return true;
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setReviewing(false);
    }
  };

  const reviewRunFocus = async (focusId: string, accepted: boolean) => {
    setReviewing(true);
    setReviewError(null);
    try {
      await useUnderstandingActivityStore.getState().reviewFocus(focusId, accepted);
      return true;
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setReviewing(false);
    }
  };

  const finishRunReview = async (decision: 'confirmed' | 'corrected', correctedIntent?: string) => {
    const currentRun = useUnderstandingActivityStore.getState().directoryRun;
    if (!currentRun) return false;
    setReviewing(true);
    setReviewError(null);
    try {
      const next = await submitWorkDiscoveryRecognitionFeedback(currentRun.id, decision, correctedIntent);
      useUnderstandingActivityStore.getState().updateDirectoryRun(next);
      return true;
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setReviewing(false);
    }
  };

  const startRunConversation = async (starter: string, decision: 'confirmed' | 'corrected') => {
    const currentRun = useUnderstandingActivityStore.getState().directoryRun;
    if (!currentRun) return false;
    const completed = await finishRunReview(
      decision,
      decision === 'corrected' ? starter : undefined,
    );
    if (!completed) return false;
    const params = new URLSearchParams({ draft: starter, autoSend: '1' });
    state.setDrawerOpen(false);
    navigate(`/chat/${encodeURIComponent(currentRun.sessionKey)}?${params.toString()}`);
    return true;
  };

  return (
    <Dialog.Root open={state.drawerOpen} onOpenChange={state.setDrawerOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'relative size-8 rounded-xl p-0',
            APP_CHROME_NO_DRAG_CLASS,
            floating && 'fixed right-4 top-3 z-40 bg-surface-panel shadow-surface',
          )}
          title={zh ? '查看 xopc 对你的理解' : 'Review what xopc understands'}
          aria-label={zh ? '查看 xopc 对你的理解' : 'Review what xopc understands'}
        >
          {running ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-4 text-accent-fg" />}
          {pendingCount ? <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-accent ring-2 ring-surface-panel" /> : null}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:backdrop-blur-none" />
        <div className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center p-3 sm:p-6">
          <Dialog.Content className="xopc-understanding-center pointer-events-auto flex h-[min(42rem,calc(100dvh-1.5rem))] w-[min(44rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.75rem] border border-edge bg-surface-panel shadow-float outline-none sm:h-[min(42rem,calc(100dvh-3rem))] sm:w-[min(44rem,calc(100vw-3rem))]">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-edge-subtle px-5 sm:px-6">
            <div>
              <Dialog.Title className="text-sm font-semibold text-fg">
                {running ? (zh ? '正在理解' : 'Understanding') : pendingCount ? (zh ? '需要你确认' : 'Ready for review') : (zh ? '理解已更新' : 'Understanding updated')}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-fg-muted">
                {running
                  ? (zh ? '关闭窗口也会在后台继续' : 'You can close this window; work continues in the background')
                  : pendingCount
                    ? (zh ? `${pendingCount} 项待确认` : `${pendingCount} item(s) to review`)
                    : (zh ? '已保存你的选择' : 'Your choices have been saved')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><Button variant="ghost" className="size-8 rounded-xl p-0" aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-9 sm:py-9">
            {running ? (
              <section className="flex min-h-full flex-col items-center justify-center text-center" aria-live="polite">
                <UnderstandingActivityVisual />
                <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{zh ? '正在建立默契' : 'Building shared context'}</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{zh ? '我正在把这些线索连接起来。' : 'I am connecting the signals.'}</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-fg-muted">
                  {zh ? '内容只用于形成候选理解，未经你确认，不会成为长期记忆。' : 'Content only shapes candidates. Nothing becomes lasting memory until you confirm it.'}
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-2 text-xs text-fg-muted">
                  <span className="rounded-full border border-edge bg-surface-base px-3 py-1.5">{state.directoryStatus === 'completed' ? (zh ? '工作目录已理解' : 'Work folder understood') : (zh ? '正在理解工作目录' : 'Understanding work folder')}</span>
                  {sourceStatuses.length ? <span className="rounded-full border border-edge bg-surface-base px-3 py-1.5">{zh ? `${completeSources}/${sourceStatuses.length} 个来源已完成` : `${completeSources}/${sourceStatuses.length} sources complete`}</span> : null}
                </div>
              </section>
            ) : directoryReady && state.directoryRun?.result ? (
              <UnderstandingReveal
                run={state.directoryRun}
                sourceMemories={state.memories}
                focuses={[...(state.directoryRun.result.focusCandidates ?? []), ...state.focuses]}
                activityRunning={false}
                language={language}
                busy={reviewing}
                error={reviewError}
                onReviewMemory={reviewRunMemory}
                onReviewFocus={(focus, accepted) => reviewRunFocus(focus.id, accepted)}
                onFinish={finishRunReview}
                onStartConversation={startRunConversation}
              />
            ) : pendingMemory ? (
              <section className="xopc-reveal-scene mx-auto flex min-h-full max-w-xl flex-col justify-center text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{zh ? '长期理解' : 'Lasting understanding'}</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{zh ? '这件事值得我以后记住吗？' : 'Should I remember this for later?'}</h2>
                <article className="mt-7 rounded-[1.5rem] border border-edge/80 bg-surface-base/80 p-6 text-left shadow-surface">
                  <div className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg"><Sparkles className="size-5" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-medium leading-8 text-fg">{pendingMemory.statement}</p>
                      {pendingMemory.evidence.length ? <p className="mt-4 text-xs leading-5 text-fg-muted"><span className="font-medium text-fg">{zh ? '理解依据：' : 'Based on: '}</span>{pendingMemory.evidence[0]}</p> : null}
                    </div>
                  </div>
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
                    <Button variant="primary" disabled={reviewing} onClick={() => void reviewMemory(true)}>{reviewing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{zh ? '记住' : 'Remember it'}</Button>
                    <Button variant="secondary" disabled={reviewing} onClick={() => void reviewMemory(false)}>{zh ? '只用于这次' : 'This time only'}</Button>
                  </div>
                </article>
              </section>
            ) : pendingFocus ? (
              <section className="xopc-reveal-scene mx-auto flex min-h-full max-w-xl flex-col justify-center text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{zh ? '当前关注' : 'Current focus'}</p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{zh ? '要让我持续关注这个方向吗？' : 'Should I keep this direction in focus?'}</h2>
                <article className="mt-7 rounded-[1.5rem] border border-edge/80 bg-surface-base/80 p-6 text-left shadow-surface">
                  <div className="flex items-start gap-4">
                    <span className="mt-2 size-3 shrink-0 rounded-full bg-accent" />
                    <div><p className="text-lg font-semibold text-fg">{pendingFocus.title}</p><p className="mt-2 text-sm leading-6 text-fg-muted">{pendingFocus.summary}</p></div>
                  </div>
                  <p className="mt-5 flex gap-2 rounded-xl bg-surface-muted px-3 py-2.5 text-xs leading-5 text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />{zh ? '关注只影响优先级和提醒，不代表执行授权。' : 'Focus affects priority and reminders, never authorization to act.'}</p>
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse">
                    <Button variant="primary" disabled={reviewing} onClick={() => void reviewFocus(true)}>{reviewing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{zh ? '加入关注' : 'Add to focus'}</Button>
                    <Button variant="secondary" disabled={reviewing} onClick={() => void reviewFocus(false)}>{zh ? '暂时不用' : 'Not now'}</Button>
                  </div>
                </article>
              </section>
            ) : (
              <section className="xopc-reveal-scene flex min-h-full flex-col items-center justify-center text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-fg"><Check className="size-6" /></div>
                <h2 className="mt-4 text-lg font-semibold tracking-tight text-fg">{zh ? '理解已更新' : 'Understanding updated'}</h2>
                {state.status === 'partial' || unavailableSources ? <p className="mt-5 text-xs leading-5 text-fg-muted">{zh ? `${unavailableSources || 1} 个来源未完成，其余理解仍然可用。` : `${unavailableSources || 1} sources were unavailable; the rest of the understanding remains usable.`}</p> : null}
                {state.error ? <p className="mt-3 text-sm text-danger">{state.error}</p> : null}
              </section>
            )}
          </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UnderstandingActivityVisual() {
  return (
    <div className="xopc-understanding-constellation relative size-40" aria-hidden>
      <span className="xopc-constellation-orbit absolute inset-[10%] rounded-full border border-accent/15" />
      <span className="xopc-constellation-orbit xopc-constellation-orbit-delayed absolute inset-[27%] rounded-full border border-accent/20" />
      <span className="xopc-constellation-core absolute left-[44%] top-[44%] size-[12%] rounded-full bg-accent" />
      <span className="xopc-constellation-node absolute left-[10%] top-[34%] flex size-8 items-center justify-center rounded-full border border-edge bg-surface-panel text-fg-muted shadow-surface"><FileText className="size-3.5" /></span>
      <span className="xopc-constellation-node xopc-constellation-node-two absolute right-[8%] top-[20%] size-3 rounded-full bg-accent/55" />
      <span className="xopc-constellation-node xopc-constellation-node-three absolute bottom-[10%] right-[25%] size-3 rounded-full bg-accent/55" />
    </div>
  );
}
