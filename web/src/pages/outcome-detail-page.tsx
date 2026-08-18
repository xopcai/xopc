import { ArrowLeft, CircleCheck, ChevronDown, ShieldCheck } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  actOnOutcome,
  fetchOutcome,
  submitOutcomeFeedback,
  type OutcomeDetail,
} from '@/features/work/work-home-api';
import { workCopy } from '@/features/work/work-copy';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

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

export function OutcomeDetailPage() {
  const { outcomeId = '' } = useParams();
  const language = useLocaleStore((state) => state.language);
  const copy = useMemo(() => workCopy(language), [language]);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [detail, setDetail] = useState<OutcomeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correction, setCorrection] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const reload = async () => {
    setDetail(await fetchOutcome(outcomeId));
  };

  useEffect(() => {
    let active = true;
    setError(null);
    void fetchOutcome(outcomeId)
      .then((result) => { if (active) setDetail(result); })
      .catch(() => { if (active) setError(copy.outcomeNotFound); });
    return () => { active = false; };
  }, [copy.outcomeNotFound, outcomeId]);

  const performAction = async (action: 'run' | 'pause' | 'resume' | 'cancel') => {
    setActionBusy(true);
    setError(null);
    try {
      await actOnOutcome(outcomeId, action);
      await reload();
    } catch {
      setError(copy.actionFailed);
    } finally {
      setActionBusy(false);
    }
  };

  const submitFeedback = async (outcome: 'helpful' | 'not_helpful') => {
    const latest = detail?.receipts[0];
    if (!latest) return;
    if (outcome === 'not_helpful' && !showCorrection) {
      setShowCorrection(true);
      return;
    }
    setFeedbackBusy(true);
    setError(null);
    try {
      await submitOutcomeFeedback(latest.runId, outcome, correction);
      setFeedbackMessage(outcome === 'helpful' ? copy.feedbackThanks : copy.correctionStarted);
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
        <Link to="/work" className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={copy.backToWork}>
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: detail ? (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{detail.outcome.objective}</h1>
          <p className="text-xs text-fg-muted">{copy.outcomeStatuses[detail.outcome.userStatus]}</p>
        </div>
      ) : null,
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, copy.backToWork, copy.outcomeStatuses, detail, setPageHeader]);

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
                <p className="text-xs font-medium text-fg-subtle">{copy.outcomeStatuses[detail.outcome.userStatus]}</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-fg">{detail.outcome.objective}</h2>
              </div>
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">
                {copy.outcomeStatuses[detail.outcome.userStatus]}
              </span>
            </div>
            {detail.outcome.internalStatus !== 'completed' && detail.outcome.internalStatus !== 'cancelled' ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-edge-subtle pt-4">
                {detail.outcome.internalStatus === 'paused' ? (
                  <Button type="button" variant="primary" disabled={actionBusy} onClick={() => void performAction('resume')}>
                    {copy.resumeOutcome}
                  </Button>
                ) : detail.outcome.internalStatus === 'captured' ? (
                  <Button type="button" variant="primary" disabled={actionBusy} onClick={() => void performAction('run')}>
                    {copy.runOutcome}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled={actionBusy} onClick={() => void performAction('pause')}>
                    {copy.pauseOutcome}
                  </Button>
                )}
                <Button type="button" variant="ghost" disabled={actionBusy} onClick={() => void performAction('cancel')}>
                  {copy.cancelOutcome}
                </Button>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              <h2 className="text-base font-semibold text-fg">{copy.successDefinition}</h2>
            </div>
            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.successDefinition}</h3>
                <TextList items={detail.outcome.contract?.acceptanceCriteria ?? []} empty={copy.noDefinition} />
              </div>
              <div>
                <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.deliverables}</h3>
                <TextList items={detail.outcome.contract?.deliverables ?? []} empty={copy.noDefinition} />
              </div>
              {(detail.outcome.contract?.constraints.length ?? 0) > 0 ? (
                <div>
                  <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.constraints}</h3>
                  <TextList items={detail.outcome.contract?.constraints ?? []} empty={copy.noDefinition} />
                </div>
              ) : null}
              {(detail.outcome.contract?.approvalRequired.length ?? 0) > 0 ? (
                <div>
                  <h3 className="mb-3 text-xs font-medium text-fg-subtle">{copy.approvalRequired}</h3>
                  <TextList items={detail.outcome.contract?.approvalRequired ?? []} empty={copy.noDefinition} />
                </div>
              ) : null}
            </div>
          </section>

          <details className="group rounded-2xl border border-edge-subtle bg-surface-panel p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-fg">
              <span>{copy.evidenceDetails}</span>
              <ChevronDown className="size-4 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
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
                          {receipt.completedAt ? formatMediumDateTime(new Date(receipt.completedAt)) : copy.outcomeStatuses.running}
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
