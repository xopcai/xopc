import * as Dialog from '@radix-ui/react-dialog';
import type { HomeOpportunityHistoryItem } from '@xopcai/gateway-contract';
import { ChevronDown, Clock3, ExternalLink, History, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchHomeAdvisorHistory } from '@/features/tasks/home-api';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

type HistoryFilter = 'all' | 'adopted' | 'other';

const adoptedStatuses = new Set<HomeOpportunityHistoryItem['status']>([
  'started',
  'discussing',
  'completed',
]);

function HistorySkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      {[0, 1, 2].map((item) => (
        <div key={item} className="space-y-2 rounded-xl border border-edge-subtle p-4">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-5 w-4/5 rounded" />
          <Skeleton className="h-4 w-3/5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function HomeAdvisorHistoryDialog({
  open,
  refreshKey,
  onOpenChange,
  onReevaluate,
}: {
  open: boolean;
  refreshKey: number;
  onOpenChange(open: boolean): void;
  onReevaluate(): void;
}) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).projectsPage.home;
  const navigate = useNavigate();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [items, setItems] = useState<HomeOpportunityHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    void fetchHomeAdvisorHistory()
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open, refreshKey]);

  const visibleItems = useMemo(() => items.filter((item) => filter === 'all'
    || (filter === 'adopted' ? adoptedStatuses.has(item.status) : !adoptedStatuses.has(item.status))), [filter, items]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
  }), [language]);
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }), [language]);
  const groups = useMemo(() => {
    const grouped = new Map<string, HomeOpportunityHistoryItem[]>();
    for (const item of visibleItems) {
      const key = dateFormatter.format(new Date(item.updatedAt));
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [dateFormatter, visibleItems]);

  const statusLabel = (item: HomeOpportunityHistoryItem): string => {
    if (item.feedbackKind === 'already_done') return copy.advisorHistoryStatusCompleted;
    if (item.feedbackKind === 'irrelevant') return copy.advisorHistoryStatusIrrelevant;
    if (item.feedbackKind === 'source_incorrect') return copy.advisorHistoryStatusSourceIncorrect;
    if (item.feedbackKind === 'less_like_this') return copy.advisorHistoryStatusLessLikeThis;
    return {
      available: copy.advisorHistoryStatusAvailable,
      started: copy.advisorHistoryStatusStarted,
      discussing: copy.advisorHistoryStatusDiscussing,
      completed: copy.advisorHistoryStatusCompleted,
      snoozed: copy.advisorHistoryStatusSnoozed,
      dismissed: copy.advisorHistoryStatusDismissed,
      expired: copy.advisorHistoryStatusExpired,
      superseded: copy.advisorHistoryStatusSuperseded,
    }[item.status];
  };

  const openItem = (item: HomeOpportunityHistoryItem) => {
    if (item.href) {
      onOpenChange(false);
      navigate(item.href);
      return;
    }
    if (item.status === 'discussing') {
      onOpenChange(false);
      navigate(`/chat/new?${new URLSearchParams({ draft: item.opportunity.actionPrompt }).toString()}`);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim" />
        <Dialog.Content
          className="xopc-drawer-right fixed right-0 top-0 z-[90] flex size-full max-w-lg flex-col overflow-hidden border-l border-edge bg-surface-overlay shadow-popover outline-none"
          aria-describedby="home-advisor-history-description"
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-edge px-5 py-4">
            <History className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-fg">{copy.advisorHistoryTitle}</Dialog.Title>
              <Dialog.Description id="home-advisor-history-description" className="mt-1 text-xs leading-5 text-fg-muted">
                {copy.advisorHistoryDescription}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="-mr-2 size-9 shrink-0 p-0" aria-label={copy.advisorHistoryClose}>
                <X className="size-4" aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div className="shrink-0 border-b border-edge-subtle px-5 py-3">
            <div className="inline-flex rounded-lg bg-surface-inset p-1" role="group" aria-label={copy.advisorHistoryFilterLabel}>
              {([
                ['all', copy.advisorHistoryFilterAll],
                ['adopted', copy.advisorHistoryFilterAdopted],
                ['other', copy.advisorHistoryFilterOther],
              ] as Array<[HistoryFilter, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors duration-150 ${filter === value ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg'}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? <HistorySkeleton /> : error ? (
              <div className="rounded-xl border border-danger/25 bg-danger-soft p-4 text-sm text-danger">
                <p>{copy.advisorHistoryLoadFailed}</p>
                <Button type="button" variant="ghost" className="mt-2" onClick={() => onOpenChange(false)}>{copy.advisorHistoryClose}</Button>
              </div>
            ) : groups.length === 0 ? (
              <div className="py-16 text-center">
                <History className="mx-auto size-6 text-fg-subtle" aria-hidden />
                <p className="mt-3 text-sm font-medium text-fg">{copy.advisorHistoryEmpty}</p>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{copy.advisorHistoryEmptyHint}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {groups.map(([date, entries]) => (
                  <section key={date} aria-label={date}>
                    <h3 className="mb-2 text-xs font-medium text-fg-subtle">{date}</h3>
                    <div className="space-y-2">
                      {entries.map((item) => {
                        const canOpen = Boolean(item.href) || item.status === 'discussing';
                        const canReevaluate = ['snoozed', 'dismissed', 'expired', 'superseded'].includes(item.status);
                        return (
                          <article key={item.opportunity.id} className="rounded-xl border border-edge-subtle bg-surface-base p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-accent">{statusLabel(item)}</p>
                                <h4 className="mt-1.5 text-sm font-semibold leading-5 text-fg">{item.opportunity.title}</h4>
                                <p className="mt-1 text-xs leading-5 text-fg-muted">{item.opportunity.outcome}</p>
                              </div>
                              <time className="shrink-0 text-[11px] text-fg-subtle" dateTime={new Date(item.updatedAt).toISOString()}>
                                {dateTimeFormatter.format(new Date(item.updatedAt))}
                              </time>
                            </div>
                            {item.snoozedUntil ? (
                              <p className="mt-2 inline-flex items-center gap-1 text-xs text-fg-muted">
                                <Clock3 className="size-3.5" aria-hidden />
                                {copy.advisorHistoryReturnsAt} {dateTimeFormatter.format(new Date(item.snoozedUntil))}
                              </p>
                            ) : null}
                            <details className="group mt-3">
                              <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
                                {copy.advisorHistoryEvidence}
                                <ChevronDown className="size-3.5 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                              </summary>
                              <ul className="mt-2 space-y-1.5 border-l border-edge pl-3 text-xs leading-5 text-fg-muted">
                                {item.opportunity.evidence.map((evidence) => <li key={evidence.id}>{evidence.observation}</li>)}
                              </ul>
                            </details>
                            {canOpen || canReevaluate ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {canOpen ? (
                                  <Button type="button" variant="secondary" className="min-h-9 text-xs" onClick={() => openItem(item)}>
                                    <ExternalLink className="size-3.5" aria-hidden />
                                    {item.status === 'discussing' ? copy.advisorHistoryContinueDiscussion : copy.advisorHistoryViewProgress}
                                  </Button>
                                ) : null}
                                {canReevaluate ? (
                                  <Button type="button" variant="ghost" className="min-h-9 text-xs" onClick={() => {
                                    onOpenChange(false);
                                    onReevaluate();
                                  }}>
                                    <RefreshCw className="size-3.5" aria-hidden />{copy.advisorHistoryReevaluate}
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
