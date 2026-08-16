import { ArrowLeft, CircleCheck, FileCheck2, ShieldCheck } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { actOnOutcome, fetchOutcome, type OutcomeDetail } from '@/features/work/work-home-api';
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

          <section className="rounded-2xl border border-edge-subtle bg-surface-panel p-5">
            <div className="flex items-center gap-2">
              <FileCheck2 className="size-4 text-success" aria-hidden />
              <h2 className="text-base font-semibold text-fg">{copy.executionReceipts}</h2>
            </div>
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
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
