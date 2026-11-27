import * as Dialog from '@radix-ui/react-dialog';
import { Check, FolderPlus, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ABOUT_USER_MODEL_KEY,
  correctAssertion,
  deleteAssertion,
  fetchAboutUserModel,
  type UserAssertion,
} from '@/features/user-model/user-model-api';
import { cn } from '@/lib/cn';
import { loadWorkDiscoveryOverlay } from '@/lib/route-preload';
import { useLocaleStore } from '@/stores/locale-store';

import { useUnderstandingActivityStore } from './understanding-activity-store';
import { UnderstandingRefreshButton } from './understanding-refresh-controls';
import { useUnderstandingRefreshStore } from './understanding-refresh-store';
import { UnderstandingUpdateReview } from './understanding-update-review';
import { openWorkDiscoveryOverlaySearch } from './work-discovery-navigation';

export function UnderstandingStatusButton() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const state = useUnderstandingActivityStore();
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const onUserModelPage = pathname === '/user-model';
  const { data: userModel, mutate: mutateUserModel } = useSWR(
    onUserModelPage ? ABOUT_USER_MODEL_KEY : null,
    fetchAboutUserModel,
  );
  const refreshError = useUnderstandingRefreshStore((store) => store.error);
  const refreshRunning = useUnderstandingRefreshStore((store) => store.sources.some((run) => run.status === 'running' || run.status === 'queued'));
  const zh = language === 'zh';

  useEffect(() => {
    if (!onUserModelPage) return;
    const params = new URLSearchParams(search);
    if (params.get('workDiscovery') !== 'review') return;
    useUnderstandingActivityStore.getState().setDrawerOpen(true);
  }, [onUserModelPage, search]);

  const prevActivityRef = useRef<{ status: string; runId?: string }>({
    status: state.status,
    runId: state.directoryRun?.id,
  });

  useEffect(() => {
    const prev = prevActivityRef.current;
    const nextRunId = state.directoryRun?.id;
    prevActivityRef.current = { status: state.status, runId: nextRunId };
    if (!onUserModelPage || state.status === 'running') return;
    if (prev.status === 'running' || (nextRunId && nextRunId !== prev.runId)) {
      void mutateUserModel();
    }
  }, [mutateUserModel, onUserModelPage, state.directoryRun?.id, state.status]);

  if (!onUserModelPage) return null;

  const running = state.status === 'running' || refreshRunning;

  const reviewGlobalAssertion = async (
    assertion: UserAssertion,
    decision: 'edited' | 'deleted',
    statement?: string,
  ) => {
    setReviewing(true);
    setReviewError(null);
    try {
      if (decision === 'edited' && statement) await correctAssertion(assertion.id, statement);
      else if (decision === 'deleted') await deleteAssertion(assertion.id);
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
    if (!open && userModel && state.status !== 'running') {
      state.finish();
      return;
    }
    state.setDrawerOpen(open);
  };

  const closeReview = () => {
    setReviewOpen(false);
  };

  const preloadLocalDiscovery = () => {
    void loadWorkDiscoveryOverlay();
  };

  const openLocalDiscovery = () => {
    closeReview();
    navigate({ pathname, search: openWorkDiscoveryOverlaySearch(search) });
  };

  const openConnectors = () => {
    closeReview();
    navigate('/connectors');
  };

  return (
    <Dialog.Root open={state.drawerOpen} onOpenChange={setReviewOpen}>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-work-discovery-trigger
          className={cn(
            'relative size-8 rounded-xl p-0',
            APP_CHROME_NO_DRAG_CLASS,
          )}
          title={zh ? '查看 xopc 对你的理解' : 'Review what xopc understands'}
          aria-label={zh ? '查看 xopc 对你的理解' : 'Review what xopc understands'}
        >
          {running ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Sparkles className="size-4 text-accent-fg" />}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
        <div className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center p-3 sm:p-6">
          <Dialog.Content className="xopc-understanding-center pointer-events-auto flex h-[min(46rem,calc(100dvh-1.5rem))] w-[min(48rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float outline-none sm:h-[min(46rem,calc(100dvh-3rem))] sm:w-[min(48rem,calc(100vw-3rem))]">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge-subtle px-5 py-3.5 sm:px-6">
              <div className="min-w-0">
                <Dialog.Title className="truncate text-sm font-semibold text-fg">
                  {running ? (zh ? '正在更新用户理解' : 'Updating user understanding') : (zh ? '用户理解' : 'User understanding')}
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 truncate text-xs text-fg-muted">
                  {running
                    ? (zh ? '关闭窗口也会在后台继续更新' : 'You can close this window; updates continue in the background')
                    : (zh ? 'xopc 如何形成对你的理解 · 自动整理，随时可改可删' : 'How xopc forms its understanding of you · Edit or delete anytime')}
                </Dialog.Description>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <UnderstandingRefreshButton disabled={!userModel?.sources?.length} />
                <Dialog.Close asChild>
                  <Button variant="ghost" className="size-8 rounded-xl p-0" aria-label={zh ? '关闭' : 'Close'}>
                    <X className="size-4" />
                  </Button>
                </Dialog.Close>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base/40 px-5 py-5 sm:px-6 sm:py-6">
              {userModel ? (
                <UnderstandingUpdateReview
                  assertions={userModel.assertions}
                  configuredSources={userModel.sources ?? []}
                  activityRunning={running}
                  language={language}
                  busy={reviewing}
                  error={reviewError ?? refreshError ?? null}
                  onReviewAssertion={reviewGlobalAssertion}
                  onAddLocalSources={openLocalDiscovery}
                  onPreloadLocalSources={preloadLocalDiscovery}
                  onOpenConnectors={openConnectors}
                />
              ) : (
                <section className="space-y-4" aria-label={zh ? '正在加载用户理解' : 'Loading user understanding'}>
                  <div className="grid grid-cols-3 gap-2.5">
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </div>
                  <Skeleton className="h-32 w-full rounded-xl" />
                  <Skeleton className="h-44 w-full rounded-xl" />
                </section>
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge-subtle bg-surface-overlay px-5 py-3.5 sm:px-6">
              <Button
                type="button"
                variant="secondary"
                className="h-9 gap-1.5 px-3 text-xs"
                onPointerEnter={preloadLocalDiscovery}
                onPointerDown={preloadLocalDiscovery}
                onFocus={preloadLocalDiscovery}
                onClick={openLocalDiscovery}
              >
                <FolderPlus className="size-3.5" aria-hidden />
                {zh ? '扫描本地资料' : 'Scan local sources'}
              </Button>
              <Button variant="primary" className="h-9 gap-1.5 px-4 text-xs" disabled={reviewing} onClick={closeReview}>
                <Check className="size-3.5" aria-hidden />
                {zh ? '完成' : 'Done'}
              </Button>
            </footer>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
