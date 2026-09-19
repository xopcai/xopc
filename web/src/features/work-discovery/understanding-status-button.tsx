import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { APP_CHROME_NO_DRAG_CLASS } from '@/components/shell/app-chrome';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  correctAssertion,
  fetchUserModel,
  deleteAssertion,
  type UserAssertion,
  type UserModelResponse,
} from '@/features/user-model/user-model-api';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { useUnderstandingActivityStore } from './understanding-activity-store';
import { UnderstandingRefreshButton } from './understanding-refresh-controls';
import { useUnderstandingRefreshStore } from './understanding-refresh-store';
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
  const refreshError = useUnderstandingRefreshStore((state) => state.error);
  const refreshRunning = useUnderstandingRefreshStore((state) => state.sources.some((run) => run.status === 'running' || run.status === 'queued'));
  const zh = language === 'zh';
  useEffect(() => {
    if (!onUserModelPage) return;
    const params = new URLSearchParams(search);
    if (params.get('workDiscovery') !== 'review') return;
    useUnderstandingActivityStore.getState().setDrawerOpen(true);
  }, [onUserModelPage, search]);

  useEffect(() => {
    if (onUserModelPage && state.status !== 'running') void mutateUserModel();
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
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in motion-reduce:backdrop-blur-none" />
        <div className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center p-3 sm:p-6">
          <Dialog.Content className="xopc-understanding-center pointer-events-auto flex h-[min(42rem,calc(100dvh-1.5rem))] w-[min(44rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float outline-none sm:h-[min(42rem,calc(100dvh-3rem))] sm:w-[min(44rem,calc(100vw-3rem))]">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-edge-subtle px-5 sm:px-6">
            <div>
              <Dialog.Title className="text-sm font-semibold text-fg">
                {running ? (zh ? '正在更新用户理解' : 'Updating user understanding') : (zh ? '用户理解' : 'User understanding')}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-fg-muted">
                {running
                  ? (zh ? '关闭窗口也会在后台继续' : 'You can close this window; work continues in the background')
                  : (zh ? '自动更新，可随时修改或删除' : 'Updated automatically. Edit or delete anytime')}
              </Dialog.Description>
            </div>
            <UnderstandingRefreshButton disabled={!userModel?.sources?.length} />
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
                error={reviewError ?? refreshError ?? null}
                onReviewAssertion={reviewGlobalAssertion}
                onCompleted={closeReview}
              />
            ) : (
              <section className="space-y-4" aria-label={zh ? '正在加载用户理解' : 'Loading user understanding'}>
                <Skeleton className="h-8 w-2/3" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" />
              </section>
            )}
          </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
