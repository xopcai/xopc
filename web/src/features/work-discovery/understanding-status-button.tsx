import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import {
  correctAssertion,
  fetchUserModel,
  setAssertionStatus,
  type UserAssertion,
  type UserModelResponse,
} from '@/features/user-model/user-model-api';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import {
  fetchWorkDiscoveryRun,
  updateWorkDiscoveryProfile,
  type WorkDiscoveryProfileCandidate,
} from './api';
import { useUnderstandingActivityStore } from './understanding-activity-store';
import { UnderstandingUpdateReview } from './understanding-update-review';

export function UnderstandingStatusButton() {
  const { pathname, search } = useLocation();
  const language = useLocaleStore((state) => state.language);
  const state = useUnderstandingActivityStore();
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const onUserModelPage = pathname === '/user-model';
  const { data: userModel, mutate: mutateUserModel } = useSWR<UserModelResponse>(
    onUserModelPage ? '/api/user-model' : null,
    fetchUserModel,
  );
  const zh = language === 'zh';
  const pendingCount = userModel?.assertions.filter((item) => (
    item.scope.type === 'global'
    && ['candidate', 'needs_review', 'conflicted', 'stale'].includes(item.status)
  )).length ?? 0;

  useEffect(() => {
    if (!onUserModelPage) return;
    const params = new URLSearchParams(search);
    if (params.get('workDiscovery') !== 'review') return;
    const runId = params.get('run');
    let cancelled = false;
    void (async () => {
      if (runId && useUnderstandingActivityStore.getState().directoryRun?.id !== runId) {
        try {
          const run = await fetchWorkDiscoveryRun(runId);
          if (cancelled) return;
          useUnderstandingActivityStore.getState().updateDirectoryRun(run);
        } catch {
          return;
        }
      }
      if (!cancelled) useUnderstandingActivityStore.getState().setDrawerOpen(true);
    })();
    return () => { cancelled = true; };
  }, [onUserModelPage, search]);

  useEffect(() => {
    if (onUserModelPage && state.status !== 'running') void mutateUserModel();
  }, [mutateUserModel, onUserModelPage, state.directoryRun?.id, state.status]);

  if (!onUserModelPage) return null;

  const running = state.status === 'running';

  const reviewRunMemory = async (
    candidate: WorkDiscoveryProfileCandidate,
    status: 'accepted' | 'edited' | 'rejected',
    statement?: string,
  ) => {
    const currentRun = useUnderstandingActivityStore.getState().directoryRun;
    const runCandidate = currentRun?.result?.profileCandidates?.find((item) => (
      item.id === candidate.id
      || Boolean(item.assertionId && item.assertionId === candidate.assertionId)
    ));
    const sourceCandidate = state.memories.find((item) => (
      item.id === candidate.id
      || Boolean(item.assertionId && item.assertionId === candidate.assertionId)
    ));
    if (!runCandidate && !sourceCandidate?.assertionId) return false;
    setReviewing(true);
    setReviewError(null);
    try {
      if (currentRun && runCandidate) {
        const next = await updateWorkDiscoveryProfile(currentRun.id, [{
          id: runCandidate.id,
          status,
          ...(statement ? { statement } : {}),
        }]);
        useUnderstandingActivityStore.getState().updateDirectoryRun(next);
      }
      if (sourceCandidate?.assertionId) {
        await useUnderstandingActivityStore.getState().reviewMemory(
          sourceCandidate.assertionId,
          status === 'accepted',
          statement,
        );
      }
      await mutateUserModel();
      return true;
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setReviewing(false);
    }
  };

  const reviewGlobalAssertion = async (
    assertion: UserAssertion,
    decision: 'accepted' | 'edited' | 'rejected',
    statement?: string,
  ) => {
    const candidate = [
      ...(useUnderstandingActivityStore.getState().directoryRun?.result?.profileCandidates ?? []),
      ...useUnderstandingActivityStore.getState().memories,
    ].find((item) => item.assertionId === assertion.id);
    if (candidate) return reviewRunMemory(candidate, decision, statement);
    setReviewing(true);
    setReviewError(null);
    try {
      if (decision === 'edited' && statement) await correctAssertion(assertion.id, statement);
      else await setAssertionStatus(assertion.id, decision === 'accepted' ? 'active' : 'rejected');
      await mutateUserModel();
      return true;
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setReviewing(false);
    }
  };

  const setReviewOpen = (open: boolean) => {
    if (!open && userModel && pendingCount === 0 && state.status !== 'running') {
      state.finish();
      return;
    }
    state.setDrawerOpen(open);
  };

  const closeReview = () => {
    setReviewOpen(false);
  };

  return (
    <Dialog.Root open={state.drawerOpen} onOpenChange={setReviewOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'relative size-8 rounded-xl p-0',
            APP_CHROME_NO_DRAG_CLASS,
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
                {running ? (zh ? '正在更新用户理解' : 'Updating user understanding') : (zh ? '用户理解' : 'User understanding')}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-fg-muted">
                {running
                  ? (zh ? '关闭窗口也会在后台继续' : 'You can close this window; work continues in the background')
                  : pendingCount
                    ? (zh ? `${pendingCount} 条全局理解待确认` : `${pendingCount} global item(s) to review`)
                    : (zh ? '查看理解来自哪些渠道' : 'See which channels shaped it')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><Button variant="ghost" className="size-8 rounded-xl p-0" aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-9 sm:py-9">
            {userModel ? (
              <UnderstandingUpdateReview
                assertions={userModel.assertions}
                configuredSources={userModel.sources ?? []}
                activityRunning={running}
                language={language}
                busy={reviewing}
                error={reviewError}
                onReviewAssertion={reviewGlobalAssertion}
                onCompleted={closeReview}
              />
            ) : (
              <section className="flex min-h-full items-center justify-center" aria-label={zh ? '正在加载用户理解' : 'Loading user understanding'}>
                <Loader2 className="size-5 animate-spin text-fg-muted motion-reduce:animate-none" />
              </section>
            )}
          </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
