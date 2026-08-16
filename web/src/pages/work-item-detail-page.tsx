import {
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  MessageSquarePlus,
  Paperclip,
  Plus,
  RefreshCw,
  Rocket,
  Target,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchProject, type ProjectWithDetails } from '@/features/projects/api';
import {
  createWorkItemGoal,
  deleteWorkItemAttachment,
  downloadWorkItemAttachment,
  fetchWorkItem,
  fetchWorkItemEvents,
  startWorkItemChat,
  startWorkItemWorkflowRun,
  uploadWorkItemAttachments,
  type WorkItem,
  type WorkItemAttachment,
  type WorkItemEvent,
  type WorkItemStatus,
} from '@/features/work-items/api';
import { listWorkflowDefinitions, type WorkflowDefinition } from '@/features/workflows/workflow-api';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { safeInternalReturnPath, withReturnTo } from '@/lib/navigation-return';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

type WorkItemsMessages = ReturnType<typeof messages>['projectDetailPage']['workItems'];

function statusTone(status: WorkItemStatus): string {
  if (status === 'done' || status === 'in_review') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'blocked' || status === 'needs_input') return 'bg-red-500/10 text-red-700 dark:text-red-300';
  if (status === 'in_progress') return 'bg-accent-soft text-accent-fg';
  if (status === 'backlog' || status === 'todo') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-surface-muted text-fg-subtle';
}

function formatTime(value?: number | string): string {
  if (!value) return '';
  return formatMediumDateTime(new Date(value));
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function linkHref(link: NonNullable<WorkItem['links']>[number], returnTo: string): string {
  if (link.kind === 'chat') return `/chat/${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'goal') return withReturnTo(`/goals/${encodeURIComponent(link.targetId)}`, returnTo);
  if (link.kind === 'workflow_run') return `/workflows?run=${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'automation') return `/automations?automationId=${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'note') return `/notes/${encodeURIComponent(link.targetId)}`;
  return '#';
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-xs leading-5 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 overflow-hidden break-words text-sm leading-5 text-fg">{children}</dd>
    </div>
  );
}

function ActivityList({ events, t }: { events: WorkItemEvent[]; t: WorkItemsMessages }) {
  if (!events.length) {
    return (
      <div className="rounded-lg border border-edge-subtle bg-surface-panel px-4 py-8 text-center text-sm text-fg-muted">
        {t.detail.noActivity}
      </div>
    );
  }
  return (
    <div className="relative grid gap-0 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-edge">
      {events.map((event) => (
        <article key={event.id} className="relative grid grid-cols-[0.75rem_minmax(0,1fr)] gap-3 py-3 first:pt-1">
          <span className="relative z-10 mt-1.5 size-3 rounded-full border-2 border-surface-base bg-fg-disabled" aria-hidden />
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <h3 className="text-sm font-medium text-fg">{t.eventTypes[event.type] ?? event.type}</h3>
            <time className="shrink-0 text-xs text-fg-subtle">{formatTime(event.createdAt)}</time>
          </div>
        </article>
      ))}
    </div>
  );
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length >= 2));
}

function workflowRecommendationScore(item: WorkItem, project: ProjectWithDetails | null, definition: WorkflowDefinition): number {
  const projectKind = (project as { projectKind?: string } | null)?.projectKind;
  const workText = [
    item.title,
    item.description,
    item.nextAction,
    item.blockedReason,
    item.status,
    item.priority,
    project?.name,
    project?.description,
    projectKind,
  ].filter(Boolean).join(' ');
  const definitionText = [
    definition.title,
    definition.description,
    definition.metadata.whenToUse,
    ...(definition.metadata.tags ?? []),
  ].filter(Boolean).join(' ');
  const workTokens = tokenize(workText);
  let score = 0;
  for (const token of tokenize(definitionText)) {
    if (workTokens.has(token)) score += 3;
  }
  const lowerDefinition = definitionText.toLowerCase();
  if ((item.status === 'blocked' || item.status === 'needs_input') && /debug|diagnos|review|audit|fix|检查|排查|修复/.test(lowerDefinition)) score += 8;
  if (item.status === 'in_review' && /review|audit|check|验收|评审|检查/.test(lowerDefinition)) score += 6;
  if (item.attachments?.length && /analy|extract|summar|review|整理|分析|总结/.test(lowerDefinition)) score += 5;
  if (projectKind === 'coding' && /code|repo|test|pr|review|代码|仓库|测试/.test(lowerDefinition)) score += 5;
  return score;
}

function rankWorkflowDefinitionsForWorkItem(
  item: WorkItem,
  project: ProjectWithDetails | null,
  definitions: WorkflowDefinition[],
): WorkflowDefinition[] {
  return [...definitions].sort((a, b) => (
    workflowRecommendationScore(item, project, b) - workflowRecommendationScore(item, project, a)
    || a.title.localeCompare(b.title)
  ));
}

export function WorkItemDetailPage() {
  const { workItemId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const language = useLocaleStore((s) => s.language);
  const msg = messages(language);
  const t = msg.projectDetailPage.workItems;
  const [item, setItem] = useState<WorkItem | null>(null);
  const [project, setProject] = useState<ProjectWithDetails | null>(null);
  const [events, setEvents] = useState<WorkItemEvent[]>([]);
  const [workflowDefinitions, setWorkflowDefinitions] = useState<WorkflowDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [workflowGoal, setWorkflowGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);

  const projectHref = useMemo(() => (
    item ? `/projects/${encodeURIComponent(item.projectId)}/work-items` : '/projects'
  ), [item]);
  const backPath = useMemo(() => safeInternalReturnPath(
    searchParams.get('returnTo'),
    projectHref,
    ['/projects', '/chat'],
  ), [projectHref, searchParams]);
  const detailPath = useMemo(() => withReturnTo(
    `/work-items/${encodeURIComponent(workItemId)}`,
    backPath,
  ), [backPath, workItemId]);

  const load = useCallback(async () => {
    if (!workItemId) return;
    setLoading(true);
    setError(null);
    try {
      const [itemRes, eventsRes] = await Promise.all([
        fetchWorkItem(workItemId),
        fetchWorkItemEvents(workItemId).catch(() => ({ events: [] })),
      ]);
      setItem(itemRes.item);
      setWorkflowGoal(itemRes.item.nextAction || itemRes.item.title);
      setEvents(eventsRes.events);
      const [loadedProject, definitions] = await Promise.all([
        fetchProject(itemRes.item.projectId).catch(() => null),
        listWorkflowDefinitions().catch(() => []),
      ]);
      const rankedDefinitions = rankWorkflowDefinitionsForWorkItem(itemRes.item, loadedProject, definitions);
      setProject(loadedProject);
      setWorkflowDefinitions(rankedDefinitions);
      setSelectedWorkflowId((current) => current || rankedDefinitions[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStartChat = useCallback(async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startWorkItemChat(item.id);
      setItem(res.item);
      navigate(`/chat/${encodeURIComponent(res.session.key)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [item, navigate]);

  const handleCreateGoal = useCallback(async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createWorkItemGoal(item.id);
      setItem(res.item);
      navigate(withReturnTo(`/goals/${encodeURIComponent(res.goal.id)}`, detailPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [detailPath, item, navigate]);

  const refreshEvents = useCallback(async (id: string) => {
    const nextEvents = await fetchWorkItemEvents(id).catch(() => ({ events: [] }));
    setEvents(nextEvents.events);
  }, []);

  const handleStartWorkflow = useCallback(async () => {
    if (!item || !selectedWorkflowId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startWorkItemWorkflowRun(item.id, {
        definitionId: selectedWorkflowId,
        goal: workflowGoal.trim() || item.nextAction || item.title,
      });
      setItem(res.item);
      await refreshEvents(res.item.id);
      navigate(`/workflows?run=${encodeURIComponent(res.runId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [item, navigate, refreshEvents, selectedWorkflowId, workflowGoal]);

  const handleAddAttachments = useCallback(async (files: File[]) => {
    if (!item || !files.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadWorkItemAttachments(item.id, files);
      setItem(res.item);
      await refreshEvents(res.item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [item, refreshEvents]);

  const handleRemoveAttachment = useCallback(async (attachment: WorkItemAttachment) => {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteWorkItemAttachment(item.id, attachment.id);
      setItem(res.item);
      await refreshEvents(res.item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [item, refreshEvents]);

  const handleDownloadAttachment = useCallback(async (attachment: WorkItemAttachment) => {
    if (!item) return;
    setError(null);
    try {
      await downloadWorkItemAttachment(item.id, attachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [item]);

  const recommendedWorkflowDefinitions = useMemo(() => (
    item
      ? workflowDefinitions
        .filter((definition) => workflowRecommendationScore(item, project, definition) > 0)
        .slice(0, 3)
      : []
  ), [item, project, workflowDefinitions]);

  const headerEnd = useMemo(() => (
    <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => void load()}>
      <RefreshCw className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{t.refreshShort}</span>
    </Button>
  ), [load, t.refreshShort]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: (
        <Link
          to={backPath}
          className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label={backPath.startsWith('/chat')
            ? msg.sidebar.back
            : project?.name
              ? t.detail.backToProject.replace('{{name}}', project.name)
              : t.detail.backToProjects}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <BriefcaseBusiness className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
            <span className="truncate text-sm font-medium text-fg">{project?.name || item?.projectId || t.detail.loading}</span>
          </div>
          <p className="truncate text-xs text-fg-muted">{t.detail.description}</p>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [backPath, clearPageHeader, headerEnd, item?.projectId, loading, msg.sidebar.back, project?.name, setPageHeader, t]);

  if (loading) {
    return (
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:px-8" aria-busy>
        <div className="grid content-start gap-5">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <Skeleton className="hidden h-72 w-full lg:block" />
      </main>
    );
  }

  if (!item) {
    return (
      <main className="mx-auto flex w-full max-w-[var(--max-width-app-main)] flex-1 flex-col px-3 py-6 sm:px-5 xl:px-6">
        <Link to={backPath} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-fg">
          <ArrowLeft className="size-4" aria-hidden />
          {backPath.startsWith('/chat') ? msg.sidebar.back : t.detail.backToProjects}
        </Link>
        <div className="mt-5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error || t.detail.notFound}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:px-8 lg:py-8">
      <article className="min-w-0 rounded-lg border border-edge-subtle bg-surface-panel p-5 shadow-surface sm:p-7 lg:col-start-1 lg:row-start-1">
        {error ? (
          <div className="mb-5 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>
        ) : null}

        <h1 className="break-words text-xl font-semibold tracking-tight text-fg">{item.title}</h1>

        <section className="mt-7">
          <h2 className="text-xs font-medium text-fg-subtle">{t.create.descriptionLabel}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
            {item.description || t.detail.noDescription}
          </p>
        </section>

        {item.blockedReason ? (
          <section className="mt-7 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-4 py-3.5">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <h2>{t.blockedReason}</h2>
            </div>
            <p className="mt-2 pl-6 text-sm leading-relaxed text-fg">{item.blockedReason}</p>
          </section>
        ) : null}

        <section className="mt-7 border-t border-edge-subtle pt-6">
          <h2 className="text-sm font-semibold text-fg">{t.nextAction}</h2>
          <p className="mt-2 text-base leading-relaxed text-fg">{item.nextAction || t.noNextAction}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="primary" className="h-9 rounded-lg px-3 text-sm" disabled={busy} onClick={handleStartChat}>
              <MessageSquarePlus className="size-4" aria-hidden />
              {t.detail.startChat}
            </Button>
            <Button type="button" variant="secondary" className="h-9 rounded-lg px-3 text-sm" disabled={busy} onClick={handleCreateGoal}>
              <Target className="size-4" aria-hidden />
              {t.detail.createGoal}
            </Button>
          </div>
        </section>

        <details className="group mt-6 border-t border-edge-subtle pt-5">
          <summary className="flex cursor-pointer list-none items-start gap-3 rounded-md px-1 py-1 text-left hover:text-fg [&::-webkit-details-marker]:hidden">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-fg">{t.detail.workflowTitle}</span>
              <span className="mt-0.5 block text-xs leading-5 text-fg-muted">{t.detail.workflowHint}</span>
            </span>
            <span className="mt-0.5 text-xs text-fg-subtle transition-transform group-open:rotate-180" aria-hidden>⌄</span>
          </summary>
          <div className="ml-7 mt-4 grid max-w-xl gap-3">
            <label className="grid gap-1.5 text-xs font-medium text-fg-subtle">
              {t.detail.workflowTemplate}
              <Select
                className="h-9 rounded-md border border-edge bg-surface-base px-2 text-sm font-normal text-fg outline-none focus:border-accent"
                value={selectedWorkflowId}
                disabled={busy || workflowDefinitions.length === 0}
                onChange={(event) => setSelectedWorkflowId(event.target.value)}
              >
                {workflowDefinitions.length === 0 ? <SelectOption value="">{t.detail.noWorkflowTemplates}</SelectOption> : null}
                {workflowDefinitions.map((definition) => (
                  <SelectOption key={definition.id} value={definition.id}>{definition.title}</SelectOption>
                ))}
              </Select>
            </label>
            {recommendedWorkflowDefinitions.length ? (
              <p className="text-xs text-fg-muted">
                {t.detail.recommendedWorkflows}: {recommendedWorkflowDefinitions.map((definition) => definition.title).join(' · ')}
              </p>
            ) : null}
            <label className="grid gap-1.5 text-xs font-medium text-fg-subtle">
              {t.detail.workflowGoal}
              <textarea
                className="min-h-20 resize-y rounded-md border border-edge bg-surface-base p-2.5 text-sm font-normal leading-relaxed text-fg outline-none focus:border-accent"
                value={workflowGoal}
                disabled={busy}
                onChange={(event) => setWorkflowGoal(event.target.value)}
              />
            </label>
            <div>
              <Button type="button" variant="secondary" className="h-9 rounded-lg px-3 text-sm" disabled={busy || !selectedWorkflowId} onClick={handleStartWorkflow}>
                <Rocket className="size-4" aria-hidden />
                {t.detail.startWorkflow}
              </Button>
            </div>
            {!workflowDefinitions.length ? <p className="text-xs text-fg-muted">{t.detail.noWorkflowTemplates}</p> : null}
          </div>
        </details>
      </article>

      <aside className="min-w-0 self-start rounded-lg border border-edge-subtle bg-surface-panel px-4 py-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{t.detail.properties}</h2>
          <dl className="mt-3 divide-y divide-edge-subtle">
            <PropertyRow label={t.detail.status}>
              <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', statusTone(item.status))}>{t.statuses[item.status]}</span>
            </PropertyRow>
            <PropertyRow label={t.create.priorityLabel}>{t.priorities[item.priority]}</PropertyRow>
            <PropertyRow label={t.detail.project}>
              <Link to={projectHref} className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden font-medium text-accent hover:text-accent-fg">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                <span className="block min-w-0 flex-1 truncate">{project?.name || item.projectId}</span>
              </Link>
            </PropertyRow>
            <PropertyRow label={t.updated}>{formatTime(item.updatedAt)}</PropertyRow>
            {item.archivedAt ? <PropertyRow label={t.detail.archived}>{formatTime(item.archivedAt)}</PropertyRow> : null}
          </dl>
        </section>

        <section className="mt-5 border-t border-edge-subtle pt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
              <Paperclip className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <span className="truncate">{t.attachments.title}</span>
              {item.attachments?.length ? <span className="text-xs font-normal text-fg-subtle">{item.attachments.length}</span> : null}
            </h2>
            <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg" disabled={busy} title={t.attachments.add} aria-label={t.attachments.add} onClick={() => attachmentInputRef.current?.click()}>
              <Plus className="size-4" aria-hidden />
            </button>
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleAddAttachments(Array.from(event.target.files ?? []));
                event.currentTarget.value = '';
              }}
            />
          </div>
          <div className="mt-3 grid gap-2">
            {item.attachments?.length ? item.attachments.map((attachment) => (
              <div key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-md bg-surface-base px-2 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-fg">{attachment.fileName}</div>
                  <div className="truncate text-xs text-fg-subtle">{formatFileSize(attachment.size)}</div>
                </div>
                <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg" title={t.attachments.download} aria-label={t.attachments.download} disabled={busy} onClick={() => void handleDownloadAttachment(attachment)}>
                  <Download className="size-3.5" aria-hidden />
                </button>
                <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-danger" title={t.attachments.remove} aria-label={t.attachments.remove} disabled={busy} onClick={() => void handleRemoveAttachment(attachment)}>
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            )) : <p className="text-xs leading-5 text-fg-muted">{t.attachments.empty}</p>}
          </div>
        </section>

        <section className="mt-5 border-t border-edge-subtle pt-4">
          <h2 className="text-sm font-semibold text-fg">{t.detail.links}</h2>
          <div className="mt-2 grid gap-1 text-sm">
            {item.links?.length ? item.links.map((link) => (
              <Link key={link.id} to={linkHref(link, detailPath)} className="flex min-w-0 items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-surface-hover">
                <span className="min-w-0 truncate text-fg">{link.title || link.targetId}</span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                  {t.linkKinds[link.kind]}
                  <ExternalLink className="size-3.5" aria-hidden />
                </span>
              </Link>
            )) : <p className="text-xs leading-5 text-fg-muted">{t.detail.noLinks}</p>}
          </div>
        </section>
      </aside>

      <section className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="size-4 text-fg-muted" aria-hidden />
          <h2 className="text-sm font-semibold text-fg">{t.detail.activity}</h2>
        </div>
        <ActivityList events={events} t={t} />
      </section>
    </main>
  );
}
