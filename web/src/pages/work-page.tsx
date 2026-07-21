import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  FolderKanban,
  ListChecks,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function formatTime(value: string | number | undefined, fallback: string): string {
  if (value == null) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function WorkHomeSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <Skeleton className="h-32 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <Skeleton className="h-44 rounded-2xl" />
    </div>
  );
}

function WorkItemCard({
  item,
  statusLabel,
  needsAttention = false,
}: {
  item: WorkHomeItem;
  statusLabel: string;
  needsAttention?: boolean;
}) {
  return (
    <Link
      to={`/work-items/${encodeURIComponent(item.id)}`}
      className={cn(
        'group block rounded-xl border p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        needsAttention
          ? 'border-warning/35 bg-warning-soft/25 hover:bg-warning-soft/40'
          : 'border-edge-subtle bg-surface-panel hover:bg-surface-hover/55',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-fg-subtle">{item.projectName}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
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
    if (!query) return active.slice(0, 12);
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
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" className="h-9 rounded-lg" onClick={() => { setCreateIntent('watch'); setCreateOpen(true); }}>
        <Eye className="size-4" aria-hidden />
        {t.workHome.watch}
      </Button>
      <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => { setCreateIntent('delegate'); setCreateOpen(true); }}>
        <Plus className="size-4" aria-hidden />
        {t.workHome.delegate}
      </Button>
    </div>
  ), [t.workHome.delegate, t.workHome.watch]);

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
    <main className="flex w-full flex-1 flex-col gap-5 px-3 py-6 sm:px-5 xl:px-6">
      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(26rem,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{createIntent === 'watch' ? t.workHome.watchTitle : t.workHome.delegateTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-fg-muted">{createIntent === 'watch' ? t.workHome.watchDescription : t.workHome.delegateDescription}</Dialog.Description>
            </div>
            <form onSubmit={submitCreate} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 px-5 py-4">
                <label className="grid gap-2 text-sm font-medium text-fg">
                  {createIntent === 'watch' ? t.workHome.watchLabel : t.workHome.outcomeLabel}
                  <textarea
                    className="min-h-40 w-full resize-none rounded-xl border border-edge bg-surface-base px-3 py-3 text-sm font-normal leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value)}
                    placeholder={createIntent === 'watch' ? t.workHome.watchPlaceholder : t.workHome.outcomePlaceholder}
                    maxLength={12_000}
                    autoFocus
                    disabled={creating}
                  />
                </label>
                {createError ? (
                  <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
                    {createError}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-edge px-5 py-4">
                <p className="text-xs text-fg-subtle">{createIntent === 'watch' ? t.workHome.watchSetupHint : t.workHome.autoSetupHint}</p>
                <div className="flex shrink-0 gap-2">
                  <Dialog.Close asChild><Button type="button" variant="ghost">{t.cancel}</Button></Dialog.Close>
                  <Button type="submit" variant="primary" disabled={creating || !outcome.trim()}>
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
          <section className="relative overflow-hidden rounded-2xl border border-accent/15 bg-gradient-to-br from-accent-soft/70 via-surface-panel to-surface-panel p-5 sm:p-6">
            <div className="absolute -right-8 -top-12 size-40 rounded-full bg-accent/10 blur-3xl" aria-hidden />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent text-white"><ListChecks className="size-5" aria-hidden /></div>
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">{t.workHome.briefingTitle}</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-fg">{t.workHome.heroTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{home.briefing.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-surface-panel/80 px-3 py-1.5 text-fg-muted">{interpolate(t.workHome.activeCount, { count: home.briefing.progress.movingCount })}</span>
                {home.decisions.length > 0 ? <span className="rounded-full bg-warning-soft px-3 py-1.5 text-fg">{interpolate(t.workHome.attentionCount, { count: home.decisions.length })}</span> : null}
              </div>
            </div>
          </section>

          {home.work.current.length === 0 && home.workflowRuns.active.length === 0 ? (
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

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-center gap-2"><CircleAlert className="size-4 text-warning" aria-hidden /><h2 className="text-sm font-semibold text-fg">{t.workHome.needsYou}</h2></div>
              <p className="mt-1 text-xs text-fg-muted">{t.workHome.needsYouHint}</p>
              <div className="mt-4 space-y-2">
                {needsYou.length ? needsYou.map((item) => (
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
                )) : <p className="rounded-xl bg-surface-panel px-4 py-6 text-center text-sm text-fg-muted">{t.workHome.nothingNeedsYou}</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-center gap-2"><Clock3 className="size-4 text-accent" aria-hidden /><h2 className="text-sm font-semibold text-fg">{t.workHome.continueTitle}</h2></div>
              <p className="mt-1 text-xs text-fg-muted">{t.workHome.continueHint}</p>
              <div className="mt-4 space-y-2">
                {continuing.length ? continuing.map((item) => (
                  <WorkItemCard key={item.id} item={item} statusLabel={msg.projectDetailPage.workItems.statuses[item.status]} />
                )) : <p className="rounded-xl bg-surface-panel px-4 py-6 text-center text-sm text-fg-muted">{t.workHome.noCurrentWork}</p>}
              </div>
            </section>
          </div>

          {(home.workflowRuns.active.length > 0 || home.upcomingAutomations.length > 0) ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
                <div className="flex items-center gap-2"><Sparkles className="size-4 text-accent" aria-hidden /><h2 className="text-sm font-semibold text-fg">{t.workHome.processing}</h2></div>
                <div className="mt-3 space-y-2">{home.workflowRuns.active.map((run) => (
                  <Link key={run.id} to={workflowBoardHref(run.id)} className="flex items-center justify-between gap-3 rounded-xl bg-surface-panel px-3 py-3 text-sm hover:bg-surface-hover">
                    <span className="min-w-0 truncate text-fg">{run.title}</span><span className="shrink-0 text-xs text-fg-subtle">{t.workHome.running}</span>
                  </Link>
                ))}{home.workflowRuns.active.length === 0 ? <p className="text-sm text-fg-muted">{t.workHome.nothingRunning}</p> : null}</div>
              </section>
              <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
                <div className="flex items-center gap-2"><CalendarClock className="size-4 text-accent" aria-hidden /><h2 className="text-sm font-semibold text-fg">{t.workHome.scheduled}</h2></div>
                <div className="mt-3 space-y-2">{home.upcomingAutomations.map((automation) => (
                  <Link key={automation.id} to="/automations" className="flex items-center justify-between gap-3 rounded-xl bg-surface-panel px-3 py-3 text-sm hover:bg-surface-hover">
                    <span className="min-w-0 truncate text-fg">{automation.name || automation.action}</span><time className="shrink-0 text-xs text-fg-subtle">{formatTime(automation.nextRunAt, t.never)}</time>
                  </Link>
                ))}{home.upcomingAutomations.length === 0 ? <p className="text-sm text-fg-muted">{t.workHome.noScheduled}</p> : null}</div>
              </section>
            </div>
          ) : null}

          {home.briefing.wins.length > 0 ? (
            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" aria-hidden /><h2 className="text-sm font-semibold text-fg">{t.workHome.completed}</h2></div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{home.briefing.wins.map((item) => (
                <Link key={item.id} to={item.href} className="rounded-xl border border-edge-subtle bg-surface-panel p-3.5 transition-colors hover:bg-surface-hover/55">
                  <p className="truncate text-sm font-medium text-fg">{item.title}</p>
                  <p className="mt-1 text-xs text-fg-subtle">{t.workHome.winKinds[item.kind]}</p>
                </Link>
              ))}</div>
            </section>
          ) : null}

          <WorkbenchActivity />
        </>
      ) : null}

      <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-fg">{t.workHome.spacesTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.workHome.spacesHint}</p></div>
          <Link to="/projects" className="text-xs font-medium text-accent hover:underline">{t.management.viewAll}</Link>
        </div>
        <div className="mt-3 flex justify-end">
          <label className="relative block min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <input className="h-9 w-52 rounded-lg border border-edge bg-surface-panel pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-muted focus:border-accent" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder} />
          </label>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} openLabel={t.workHome.openSpace} noDescription={t.noDescription} />)}
        </div>
        {!loading && visibleProjects.length === 0 ? <p className="py-8 text-center text-sm text-fg-muted">{t.workHome.noSpaces}</p> : null}
      </section>
    </main>
  );
}
