import { ArrowLeft, CircleCheck, ChevronDown, ShieldCheck } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  actOnTask,
  fetchTask,
  submitTaskFeedback,
  type TaskDetail,
} from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled']);
const RESUMABLE_TASK_STATUSES = new Set(['paused', 'needs_user', 'blocked']);

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-28 rounded-2xl" />
      <Skeleton className="h-52 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}

function TextList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm leading-6 text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-6 text-fg">
          <CircleCheck className="mt-1 size-4 shrink-0 text-success" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  const language = useLocaleStore((state) => state.language);
  const copy = useMemo(() => taskCopy(language), [language]);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const reload = async () => {
    setDetail(await fetchTask(taskId));
  };

  useEffect(() => {
    let active = true;
    setError(null);
    void fetchTask(taskId)
      .then((result) => { if (active) setDetail(result); })
      .catch(() => { if (active) setError(copy.taskNotFound); });
    return () => { active = false; };
  }, [copy.taskNotFound, taskId]);

  const performAction = async (action: 'run' | 'pause' | 'resume' | 'cancel') => {
    setActionBusy(true);
    setError(null);
    try {
      await actOnTask(
        taskId,
        action,
        detail?.task.updatedAt ?? 0,
        action === 'run' || action === 'resume'
          ? detail?.task.contract?.approvalRequired
          : undefined,
      );
      await reload();
    } catch {
      setError(copy.actionFailed);
    } finally {
      setActionBusy(false);
    }
  };

  const submitFeedback = async (rating: 'helpful' | 'not_helpful') => {
    const latest = detail?.receipts[0];
    if (!latest) return;
    if (rating === 'not_helpful' && !showCorrection) {
      setShowCorrection(true);
      return;
    }
    setFeedbackBusy(true);
    setError(null);
    try {
      await submitTaskFeedback(latest.runId, rating, correction);
      setFeedbackMessage(rating === 'helpful' ? copy.feedbackThanks : copy.correctionStarted);
      setShowCorrection(false);
      setCorrection('');
      await reload();
    } catch {
      setError(copy.actionFailed);
    } finally {
      setFeedbackBusy(false);
    }
  };

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: (
        <Link to="/" className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={copy.backToWork}>
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: detail ? (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{detail.task.objective}</h1>
          <p className="text-xs text-fg-muted">{copy.taskStatuses[detail.task.status]}</p>
        </div>
      ) : null,
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, copy.backToWork, copy.taskStatuses, detail, setPageHeader]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-7 sm:px-6 lg:py-9">
      {error ? (
        <div className="rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      ) : !detail ? <DetailSkeleton /> : (
        <>
          {detail.receipts[0] ? (
            <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
              <p className="text-xs font-medium text-fg-subtle">{copy.latestResult}</p>
              <h2 className="mt-2 text-base font-semibold text-fg">{detail.receipts[0].summary}</h2>
              {detail.receipts[0].judgment ? (
                <div className="mt-4 rounded-xl border border-accent/20 bg-accent-soft/15 p-4">
                  <p className="text-xs font-medium text-accent-fg">{copy.recommendation}</p>
                  <p className="mt-1 text-sm font-medium leading-6 text-fg">
                    {detail.receipts[0].judgment.recommendation}
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-fg-subtle">{copy.judgmentReasons}</p>
                      <TextList items={detail.receipts[0].judgment.reasons} empty="" />
                    </div>
                    {detail.receipts[0].judgment.rejectedAlternatives.length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-fg-subtle">{copy.rejectedAlternatives}</p>
                        <TextList
                          items={detail.receipts[0].judgment.rejectedAlternatives.map((item) => `${item.option}: ${item.reason}`)}
                          empty=""
                        />
                      </div>
                    ) : null}
                  </div>
                  {detail.receipts[0].judgment.uncertainty ? (
                    <p className="mt-3 text-xs leading-5 text-fg-muted">
                      {copy.uncertainty}: {detail.receipts[0].judgment.uncertainty}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-medium text-fg-subtle">{copy.remainingWork}</h3>
                  <TextList items={detail.receipts[0].remainingWork} empty={copy.noRemainingWork} />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-fg-subtle">
                    {detail.receipts[0].needsUser ? copy.yourDecision : copy.nextAction}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-fg">
                    {detail.receipts[0].nextAction || copy.noDecisionNeeded}
                  </p>
                </div>
              </div>

              {detail.receipts[0].status !== 'running' ? (
                <div className="mt-5 border-t border-edge-subtle pt-4">
                  <p className="text-sm font-medium text-fg">{copy.resultFeedback}</p>
                  {feedbackMessage ? (
                    <p className="mt-2 text-sm text-success">{feedbackMessage}</p>
                  ) : (
                    <>
                      <div className="mt-3 flex gap-2">
                        <Button type="button" variant="secondary" disabled={feedbackBusy} onClick={() => void submitFeedback('helpful')}>
                          {copy.doneWell}
                        </Button>
                        <Button type="button" variant="ghost" disabled={feedbackBusy} onClick={() => void submitFeedback('not_helpful')}>
                          {copy.needsFix}
                        </Button>
                      </div>
                      {showCorrection ? (
                        <div className="mt-3 space-y-3">
                          <textarea
                            value={correction}
                            onChange={(event) => setCorrection(event.target.value)}
                            placeholder={copy.correctionPlaceholder}
                            className="min-h-24 w-full resize-y rounded-xl border border-edge bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                          />
                          <Button type="button" variant="primary" disabled={feedbackBusy || !correction.trim()} onClick={() => void submitFeedback('not_helpful')}>
                            {copy.submitCorrection}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg-subtle">{copy.taskStatuses[detail.task.status]}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-fg">{detail.task.objective}</h2>
              </div>
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">
                {copy.taskStatuses[detail.task.status]}
              </span>
            </div>
            {!TERMINAL_TASK_STATUSES.has(detail.task.status) ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-edge-subtle pt-4">
                {RESUMABLE_TASK_STATUSES.has(detail.task.status) ? (
                  <Button type="button" variant="primary" disabled={actionBusy} onClick={() => void performAction('resume')}>
                    {copy.resumeTask}
                  </Button>
                ) : detail.task.status === 'pending' ? (
                  <Button type="button" variant="primary" disabled={actionBusy} onClick={() => void performAction('run')}>
                    {copy.runTask}
                  </Button>
                ) : detail.task.status !== 'waiting_dependency' ? (
                  <Button type="button" variant="secondary" disabled={actionBusy} onClick={() => void performAction('pause')}>
                    {copy.pauseTask}
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" disabled={actionBusy} onClick={() => void performAction('cancel')}>
                  {copy.cancelTask}
                </Button>
              </div>
            ) : null}
            {detail.nextCheckAt ? (
              <p className="mt-4 text-xs text-accent-fg">
                {copy.nextCheck}: {formatMediumDateTime(new Date(detail.nextCheckAt))}
              </p>
            ) : null}
          </section>

          {detail.dependencies.length > 0 || detail.dependents.length > 0 ? (
            <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
              <h2 className="text-base font-semibold text-fg">{copy.taskRelations}</h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-medium text-fg-subtle">{copy.dependencies}</h3>
                  {detail.dependencies.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {detail.dependencies.map((dependency) => (
                        <li key={dependency.id}>
                          <Link className="text-sm text-accent hover:underline" to={`/tasks/${encodeURIComponent(dependency.id)}`}>
                            {dependency.objective} · {copy.taskStatuses[dependency.status]}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-sm text-fg-muted">{copy.noDependencies}</p>}
                </div>
                <div>
                  <h3 className="text-xs font-medium text-fg-subtle">{copy.dependents}</h3>
                  {detail.dependents.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {detail.dependents.map((dependent) => (
                        <li key={dependent.id}>
                          <Link className="text-sm text-accent hover:underline" to={`/tasks/${encodeURIComponent(dependent.id)}`}>
                            {dependent.objective} · {copy.taskStatuses[dependent.status]}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-sm text-fg-muted">{copy.noDependents}</p>}
                </div>
              </div>
            </section>
          ) : null}

          {detail.progress ? (
            <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-fg">{copy.currentPlan}</h2>
                <span className="text-xs tabular-nums text-fg-muted">
                  {detail.progress.completed}/{detail.progress.total}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-base">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round((detail.progress.completed / detail.progress.total) * 100)}%` }}
                />
              </div>
              <ol className="mt-4 space-y-2">
                {detail.progress.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm leading-6">
                    <span className={item.status === 'completed' ? 'text-success' : item.status === 'in_progress' ? 'text-accent' : 'text-fg-subtle'}>
                      {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : '○'}
                    </span>
                    <span className={item.status === 'completed' ? 'text-fg-muted line-through' : 'text-fg'}>{item.title}</span>
                  </li>
                ))}
              </ol>
              {detail.attention ? (
                <p className="mt-4 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{detail.attention.summary}</p>
              ) : null}
            </section>
          ) : detail.attention ? (
            <section className="rounded-2xl border border-warning/25 bg-warning-soft p-5 text-sm text-warning">
              {detail.attention.summary}
            </section>
          ) : null}

          <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              <h2 className="text-base font-semibold text-fg">{copy.successDefinition}</h2>
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.successDefinition}</h3>
                <TextList items={detail.task.contract?.acceptanceCriteria ?? []} empty={copy.noDefinition} />
              </div>
              <div>
                <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.expectedOutputs}</h3>
                <TextList items={detail.task.contract?.expectedOutputs ?? []} empty={copy.noDefinition} />
              </div>
              {(detail.task.contract?.constraints.length ?? 0) > 0 ? (
                <div>
                  <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.constraints}</h3>
                  <TextList items={detail.task.contract?.constraints ?? []} empty={copy.noDefinition} />
                </div>
              ) : null}
              {(detail.task.contract?.approvalRequired.length ?? 0) > 0 ? (
                <div>
                  <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.approvalRequired}</h3>
                  <TextList items={detail.task.contract?.approvalRequired ?? []} empty={copy.noDefinition} />
                </div>
              ) : null}
            </div>
          </section>

          <details className="group rounded-2xl border border-edge-subtle bg-surface-panel p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-fg">
              <span>{copy.evidenceDetails}</span>
              <ChevronDown className="size-4 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            {detail.contextManifest ? (
              <section className="mt-4 rounded-xl border border-edge-subtle bg-surface-base p-4">
                <h3 className="text-sm font-medium text-fg">{copy.contextUsed}</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium text-fg-subtle">{copy.contextSources}</p>
                    <TextList items={detail.contextManifest.sources.map((source) => source.description)} empty="" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-fg-subtle">{copy.contextAssumptions}</p>
                    <TextList items={detail.contextManifest.assumptions} empty="—" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-fg-subtle">{copy.unresolvedCriteria}</p>
                    <TextList items={detail.contextManifest.unresolvedCriteria} empty={copy.noRemainingWork} />
                  </div>
                </div>
              </section>
            ) : null}
            {detail.receipts.length === 0 ? (
              <p className="mt-4 text-sm text-fg-muted">{copy.noReceipts}</p>
            ) : (
              <div className="mt-4 divide-y divide-edge-subtle">
                {detail.receipts.map((receipt) => (
                  <article key={receipt.runId} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium text-fg">{receipt.summary}</h3>
                        <p className="mt-1 text-xs text-fg-muted">
                          {receipt.completedAt ? formatMediumDateTime(new Date(receipt.completedAt)) : copy.taskStatuses.running}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-fg-subtle">
                        {copy.verificationStatuses[receipt.verification.status]}
                      </span>
                    </div>
                    {receipt.evidence.length > 0 ? (
                      <ul className="mt-3 space-y-2">
                        {receipt.evidence.map((evidence, index) => (
                          <li key={`${evidence.title}-${index}`} className="text-xs leading-5 text-fg-muted">
                            <span className="font-medium text-fg-subtle">{evidence.title}:</span> {evidence.summary}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </details>
        </>
      )}
    </main>
  );
}
