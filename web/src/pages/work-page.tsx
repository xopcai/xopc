import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  Clock3,
  Eye,
  FolderKanban,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SlidingSegmented } from '@/components/ui/sliding-segmented';
import { WorkbenchActivity } from '@/features/activity/workbench-activity';
import { delegateWork, fetchProjects, type Project } from '@/features/projects/api';
import {
  fetchWorkHome,
  respondToWorkDecision,
  type WorkHomeDecision,
  type WorkHomeItem,
  type WorkHomeResponse,
} from '@/features/work/work-home-api';
import { workflowBoardHref } from '@/features/workflows/workflow-page.utils';
import { messages } from '@/i18n/messages';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function formatTime(value: string | number | undefined, fallback: string): string {
  if (value == null) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return formatMediumDateTime(date);
}

function WorkHomeSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-20 rounded-2xl" />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  );
}

function WorkItemCard({
  item,
  statusLabel,
}: {
  item: WorkHomeItem;
  statusLabel: string;
}) {
  return (
    <Link
      to={`/work-items/${encodeURIComponent(item.id)}`}
      className="group block rounded-lg px-1 py-2.5 transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-fg-subtle">{item.projectName}</p>
        </div>
        <span className="shrink-0 text-xs text-fg-subtle">
          {statusLabel}
        </span>
      </div>
      {item.blockedReason || item.nextAction ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">
          {item.blockedReason || item.nextAction}
        </p>
      ) : null}
    </Link>
  );
}

function DecisionCard({
  item,
  kindLabel,
  reasonLabel,
  approveLabel,
  denyLabel,
  busy,
  onRespond,
}: {
  item: WorkHomeDecision;
  kindLabel: string;
  reasonLabel: string;
  approveLabel: string;
  denyLabel: string;
  busy: boolean;
  onRespond: (decision: 'approve' | 'deny') => void;
}) {
  return (
    <article className="rounded-xl border border-warning/35 bg-warning-soft/25 p-3.5 transition-colors hover:bg-warning-soft/40">
      <Link to={item.href} className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-fg-subtle">{item.projectName || kindLabel}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-panel/80 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
          {reasonLabel}
        </span>
      </div>
      {item.detail ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-muted">{item.detail}</p> : null}
      </Link>
      {item.response ? (
        <div className="mt-3 flex justify-end gap-2 border-t border-warning/20 pt-3">
          <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onRespond('deny')}>{denyLabel}</Button>
          <Button type="button" variant="primary" className="h-8 px-2" disabled={busy} onClick={() => onRespond('approve')}>{approveLabel}</Button>
        </div>
      ) : null}
    </article>
  );
}

function ProjectCard({ project, openLabel, noDescription }: {
  project: Project;
  openLabel: string;
  noDescription: string;
}) {
  return (
    <Link
      to={`/projects/${encodeURIComponent(project.id)}`}
      className="group flex min-h-32 flex-col rounded-xl border border-edge-subtle bg-surface-panel p-4 transition-colors hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderKanban className="size-4 shrink-0 text-accent" aria-hidden />
          <h3 className="truncate text-sm font-semibold text-fg">{project.name}</h3>
        </div>
        <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" aria-label={openLabel} />
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-fg-muted">
        {project.description || project.brief || noDescription}
      </p>
      <p className="mt-auto pt-3 text-[11px] text-fg-subtle">
        {formatTime(project.lastActiveAt ?? project.updatedAt, '')}
      </p>
    </Link>
  );
}

export function WorkPage() {
  const language = useLocaleStore((state) => state.language);
  const msg = messages(language);
  const t = msg.projectsPage;
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [home, setHome] = useState<WorkHomeResponse | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createIntent, setCreateIntent] = useState<'delegate' | 'watch'>('delegate');
  const [outcome, setOutcome] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [homeResult, projectsResult] = await Promise.all([
        fetchWorkHome(language),
        fetchProjects({ limit: 100, sortBy: 'updatedAt', sortOrder: 'desc' }),
      ]);
      setHome(homeResult);
      setProjects(projectsResult.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const active = projects.filter((project) => project.status !== 'archived');
    if (!query) return active.slice(0, 6);
    return active.filter((project) => [project.name, project.description, project.brief]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(query)));
  }, [projects, search]);

  const needsYou = useMemo(() => home?.decisions ?? [], [home]);
  const continuing = useMemo(() => home?.work.current.filter((item) => (
    item.status !== 'needs_input'
    && item.status !== 'in_review'
    && item.status !== 'blocked'
  )).slice(0, 10) ?? [], [home]);

  const submitCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = outcome.trim();
    if (!trimmed || creating) return;
    if (createIntent === 'watch') {
      const prompt = language === 'zh'
        ? `持续关注以下事项，在发生有意义的变化时通知我：\n${trimmed}`
        : `Keep watching the following and notify me when something meaningfully changes:\n${trimmed}`;
      setOutcome('');
      setCreateOpen(false);
      navigate(`/automations?draft=${encodeURIComponent(prompt)}&autogenerate=1`);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const result = await delegateWork({ outcome: trimmed, uiLocale: language });
      setOutcome('');
      setCreateOpen(false);
      navigate(`/projects/${encodeURIComponent(result.project.id)}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [createIntent, creating, language, navigate, outcome]);

  const headerEnd = useMemo(() => (
    <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => { setCreateIntent('delegate'); setCreateOpen(true); }}>
      <Plus className="size-4" aria-hidden />
      {t.workHome.newWork}
    </Button>
  ), [t.workHome.newWork]);

  const createIntentOptions = useMemo(() => [
    { value: 'delegate' as const, label: t.workHome.delegateMode, icon: Sparkles },
    { value: 'watch' as const, label: t.workHome.watchMode, icon: Eye },
  ], [t.workHome.delegateMode, t.workHome.watchMode]);

  const respondToDecision = useCallback(async (item: WorkHomeDecision, decision: 'approve' | 'deny') => {
    if (!item.response) return;
    setBusyDecisionId(item.id);
    setLoadError(null);
    try {
      await respondToWorkDecision(item.response, decision);
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyDecisionId(null);
    }
  }, [load]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="truncate text-xs text-fg-muted">{t.workHome.subtitle}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, setPageHeader, t.title, t.workHome.subtitle]);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-7 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && creating) return;
          setCreateOpen(open);
          if (!open) setCreateError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(31rem,calc(100dvh-1.5rem))] w-[min(36rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="flex shrink-0 items-start gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold text-fg">
                  {createIntent === 'watch' ? t.workHome.watchTitle : t.workHome.delegateTitle}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm leading-5 text-fg-muted">
                  {createIntent === 'watch' ? t.workHome.watchDescription : t.workHome.delegateDescription}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="-mr-2 -mt-1 size-8 shrink-0 rounded-lg p-0"
                  title={t.cancel}
                  aria-label={t.cancel}
                  disabled={creating}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <form onSubmit={submitCreate} className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
                <SlidingSegmented
                  value={createIntent}
                  onChange={(intent) => {
                    setCreateIntent(intent);
                    setCreateError(null);
                  }}
                  options={createIntentOptions}
                  aria-label={t.workHome.createModeLabel}
                  className="mb-4 shrink-0"
                  buttonClassName="h-9"
                />
                <label htmlFor="new-work-outcome" className="mb-2 shrink-0 text-sm font-medium text-fg">
                  {createIntent === 'watch' ? t.workHome.watchLabel : t.workHome.outcomeLabel}
                </label>
                <textarea
                  id="new-work-outcome"
                  className="min-h-32 w-full flex-1 resize-none rounded-xl border border-edge bg-surface-base p-3 text-sm font-normal leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={createIntent === 'watch' ? t.workHome.watchPlaceholder : t.workHome.outcomePlaceholder}
                  maxLength={12_000}
                  disabled={creating}
                  autoFocus
                />
                <div className="mt-2 flex shrink-0 items-center justify-between gap-3 text-[11px] text-fg-subtle">
                  <span>{t.workHome.submitShortcut}</span>
                  <span className="tabular-nums">
                    {outcome.length.toLocaleString()} / {(12_000).toLocaleString()}
                  </span>
                </div>
                {createError ? (
                  <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                    {createError}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col gap-3 border-t border-edge px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-5 text-fg-subtle">{createIntent === 'watch' ? t.workHome.watchSetupHint : t.workHome.autoSetupHint}</p>
                <div className="flex shrink-0 justify-end gap-2">
                  <Dialog.Close asChild><Button type="button" variant="ghost" disabled={creating}>{t.cancel}</Button></Dialog.Close>
                  <Button type="submit" variant="primary" className="min-w-32" disabled={creating || !outcome.trim()}>
                    <Sparkles className="size-4" aria-hidden />
                    {creating ? t.workHome.delegating : createIntent === 'watch' ? t.workHome.designWatch : t.workHome.delegate}
                  </Button>
                </div>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{loadError}</span>
          <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => void load()}>{t.workHome.retry}</Button>
        </div>
      ) : null}

      {loading ? <WorkHomeSkeleton /> : home ? (
        <>
          <section className="border-b border-edge-subtle pb-5">
            <p className="text-xs font-medium text-fg-subtle">{t.workHome.briefingTitle}</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg">
              {home.decisions.length > 0
                ? interpolate(t.workHome.todaySummary, {
                    attention: home.decisions.length,
                    moving: home.briefing.progress.movingCount,
                  })
                : interpolate(t.workHome.todaySummaryClear, {
                    moving: home.briefing.progress.movingCount,
                  })}
            </h2>
            {home.briefing.summary ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-fg-muted">{home.briefing.summary}</p>
            ) : null}
          </section>

          {home.work.current.length === 0
            && home.workflowRuns.active.length === 0
            && home.decisions.length === 0
            && home.upcomingAutomations.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-edge p-8 text-center">
              <MessageCircle className="mx-auto size-6 text-accent" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-fg">{t.workHome.emptyTitle}</h2>
              <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-fg-muted">{t.workHome.emptyBody}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button type="button" variant="primary" onClick={() => navigate('/chat/new')}>{t.workHome.startChat}</Button>
                <Button type="button" variant="secondary" onClick={() => { setCreateIntent('delegate'); setCreateOpen(true); }}>{t.workHome.startLongWork}</Button>
              </div>
            </section>
          ) : null}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <div className="min-w-0 space-y-6">
              {needsYou.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                  <div className="flex items-center gap-2"><CircleAlert className="size-4 text-warning" aria-hidden /><h2 className="text-base font-semibold text-fg">{t.workHome.needsYou}</h2></div>
                  <p className="mt-1 text-xs text-fg-muted">{t.workHome.needsYouHint}</p>
                  <div className="mt-4 space-y-2">
                    {needsYou.map((item) => (
                      <DecisionCard
                        key={item.id}
                        item={item}
                        kindLabel={t.workHome.decisionKinds[item.kind]}
                        reasonLabel={t.workHome.decisionReasons[item.reason]}
                        approveLabel={t.workHome.approve}
                        denyLabel={t.workHome.deny}
                        busy={busyDecisionId === item.id}
                        onRespond={(decision) => void respondToDecision(item, decision)}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <p className="flex items-center gap-2 text-sm text-fg-muted">
                  <span className="flex size-5 items-center justify-center rounded-full bg-success-soft text-xs text-success" aria-hidden>✓</span>
                  {t.workHome.nothingNeedsYou}
                </p>
              )}

              <section className="rounded-2xl bg-surface-base p-5 shadow-surface">
                <div className="flex items-center gap-2"><Clock3 className="size-4 text-fg-subtle" aria-hidden /><h2 className="text-base font-semibold text-fg">{t.workHome.continueTitle}</h2></div>
                <p className="mt-1 text-xs text-fg-muted">{t.workHome.continueHint}</p>
                <div className="mt-4 divide-y divide-edge-subtle px-1">
                  {home.workflowRuns.active.map((run) => (
                    <Link key={run.id} to={workflowBoardHref(run.id)} className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 text-sm hover:bg-surface-hover/55">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                        <span className="truncate font-medium text-fg">{run.title}</span>
                      </span>
                      <span className="shrink-0 text-xs text-fg-subtle">{t.workHome.running}</span>
                    </Link>
                  ))}
                  {continuing.map((item) => (
                    <div key={item.id} className="py-1">
                      <WorkItemCard item={item} statusLabel={msg.projectDetailPage.workItems.statuses[item.status]} />
                    </div>
                  ))}
                  {home.workflowRuns.active.length === 0 && continuing.length === 0 ? (
                    <p className="py-6 text-center text-sm text-fg-muted">{t.workHome.noCurrentWork}</p>
                  ) : null}
                </div>
              </section>
            </div>

            <aside className="min-w-0 space-y-4" aria-label={t.workHome.nowTitle}>
              <div className="px-1">
                <h2 className="text-base font-semibold text-fg">{t.workHome.nowTitle}</h2>
                <p className="mt-1 text-xs text-fg-muted">{t.workHome.nowHint}</p>
              </div>
              {home.upcomingAutomations.length > 0 ? (
                <section className="rounded-2xl bg-surface-base p-4 shadow-surface">
                  <div className="flex items-center gap-2"><CalendarClock className="size-4 text-fg-subtle" aria-hidden /><h3 className="text-sm font-semibold text-fg">{t.workHome.scheduled}</h3></div>
                  <div className="mt-2 divide-y divide-edge-subtle">{home.upcomingAutomations.slice(0, 3).map((automation) => (
                    <Link key={automation.id} to="/automations" className="flex items-center justify-between gap-3 rounded-lg px-1 py-3 text-sm hover:bg-surface-hover/55">
                      <span className="min-w-0 truncate text-fg">{automation.name || automation.action}</span>
                      <time className="shrink-0 text-xs text-fg-subtle">{formatTime(automation.nextRunAt, t.never)}</time>
                    </Link>
                  ))}</div>
                </section>
              ) : null}
              <WorkbenchActivity />
              {home.briefing.wins.length > 0 ? (
                <Link
                  to={home.briefing.wins[0].href}
                  className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm text-fg-muted hover:bg-surface-hover/55 hover:text-fg"
                >
                  <span>{interpolate(t.workHome.completedSummary, { count: home.briefing.wins.length })}</span>
                  <span className="shrink-0 text-xs font-medium text-accent">{t.workHome.viewLatestResult} →</span>
                </Link>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}

      <section className="border-t border-edge-subtle pt-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-fg">{t.workHome.spacesTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.workHome.spacesHint}</p></div>
          <Link to="/projects" className="text-xs font-medium text-accent hover:underline">{t.management.viewAll}</Link>
        </div>
        {projects.filter((project) => project.status !== 'archived').length > 6 ? <div className="mt-3 flex justify-end">
          <label className="relative block min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input className="h-9 w-52 rounded-lg border border-edge bg-surface-panel pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
          </label>
        </div> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} openLabel={t.workHome.openSpace} noDescription={t.noDescription} />)}
        </div>
        {!loading && visibleProjects.length === 0 ? <p className="py-8 text-center text-sm text-fg-muted">{t.workHome.noSpaces}</p> : null}
      </section>
    </main>
  );
}
