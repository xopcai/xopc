import {
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
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
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

function linkHref(link: NonNullable<WorkItem['links']>[number]): string {
  if (link.kind === 'chat') return `/chat/${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'goal') return `/goals/${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'workflow_run') return `/workflows?run=${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'automation') return `/automations?automationId=${encodeURIComponent(link.targetId)}`;
  if (link.kind === 'note') return `/notes/${encodeURIComponent(link.targetId)}`;
  return '#';
}

function MetaRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-fg">{value || '-'}</dd>
    </div>
  );
}

function ActivityList({ events, t }: { events: WorkItemEvent[]; t: WorkItemsMessages }) {
  if (!events.length) {
    return (
      <div className="rounded-lg bg-surface-panel px-4 py-8 text-center text-sm text-fg-muted shadow-surface">
        {t.detail.noActivity}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      {events.map((event) => (
        <article key={event.id} className="rounded-lg bg-surface-panel px-4 py-3 shadow-surface">
          <div className="flex items-center justify-between gap-3">
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
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).projectDetailPage.workItems;
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
      navigate(`/goals/${encodeURIComponent(res.goal.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [item, navigate]);

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
    <>
      <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => void load()}>
        <RefreshCw className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">{t.refreshShort}</span>
      </Button>
      {item ? (
        <>
          <Button type="button" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs" disabled={busy} onClick={handleStartChat}>
            <MessageSquarePlus className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{t.detail.startChat}</span>
          </Button>
          <Button type="button" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs" disabled={busy} onClick={handleCreateGoal}>
            <Target className="size-3.5" aria-hidden />
            <span className="hidden md:inline">{t.detail.createGoal}</span>
          </Button>
        </>
      ) : null}
    </>
  ), [busy, handleCreateGoal, handleStartChat, item, load, t.detail.createGoal, t.detail.startChat, t.refreshShort]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: (
        <Link
          to={projectHref}
          className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg"
          aria-label={project?.name ? t.detail.backToProject.replace('{{name}}', project.name) : t.detail.backToProjects}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      ),
      main: (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <BriefcaseBusiness className="size-3.5 shrink-0 text-accent-fg" aria-hidden />
            <h1 className="truncate text-base font-semibold tracking-tight text-fg">
              {item?.title ?? (loading ? t.detail.loading : t.detail.notFound)}
            </h1>
          </div>
          {item ? (
            <p className="truncate text-xs text-fg-muted">
              {t.statuses[item.status]} · {t.priorities[item.priority]} · {project?.name || item.projectId} · {t.updated}: {formatTime(item.updatedAt)}
            </p>
          ) : null}
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, headerEnd, item, loading, project?.name, projectHref, setPageHeader, t, project]);

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-[var(--max-width-app-main)] flex-1 flex-col px-3 py-6 sm:px-5 xl:px-6" aria-busy>
        <div className="h-8 w-40 animate-pulse rounded-md bg-surface-hover" />
        <div className="mt-5 h-44 animate-pulse rounded-xl bg-surface-hover" />
      </main>
    );
  }

  if (error || !item) {
    return (
      <main className="mx-auto flex w-full max-w-[var(--max-width-app-main)] flex-1 flex-col px-3 py-6 sm:px-5 xl:px-6">
        <Link to="/projects" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-fg">
          <ArrowLeft className="size-4" aria-hidden />
          {t.detail.backToProjects}
        </Link>
        <div className="mt-5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error || t.detail.notFound}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[var(--max-width-app-main)] flex-1 flex-col px-3 py-5 sm:px-5 xl:px-6">
      <section className="rounded-lg bg-surface-panel p-4 shadow-surface sm:px-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <BriefcaseBusiness className="size-4 shrink-0 text-accent-fg" aria-hidden />
              <h1 className="min-w-0 break-words text-lg font-semibold leading-7 text-fg">{item.title}</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={cn('rounded-full px-2 py-0.5 font-medium', statusTone(item.status))}>
                {t.statuses[item.status]}
              </span>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-fg-muted">
                {t.priorities[item.priority]}
              </span>
              {item.archivedAt ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-fg-muted">{t.detail.archived}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs" disabled={busy} onClick={handleStartChat}>
              <MessageSquarePlus className="size-3.5" aria-hidden />
              {t.detail.startChat}
            </Button>
            <Button type="button" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs" disabled={busy} onClick={handleCreateGoal}>
              <Target className="size-3.5" aria-hidden />
              {t.detail.createGoal}
            </Button>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-edge pt-4 sm:grid-cols-2">
          <MetaRow label={t.create.descriptionLabel} value={item.description || t.detail.noDescription} />
          <MetaRow label={t.nextAction} value={item.nextAction || t.noNextAction} />
          <MetaRow label={t.blockedReason} value={item.blockedReason || t.detail.noBlockedReason} />
          <MetaRow label={t.updated} value={formatTime(item.updatedAt)} />
        </dl>
      </section>

      <div className="mt-4 grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <FileText className="size-4 text-fg-muted" aria-hidden />
            <h2 className="text-sm font-semibold text-fg">{t.detail.activity}</h2>
          </div>
          <ActivityList events={events} t={t} />
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg bg-surface-panel px-4 py-3 shadow-surface">
            <div className="flex items-center justify-between gap-3">
              <h2 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
                <GitBranch className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="truncate">{t.detail.workflowTitle}</span>
              </h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-fg-muted">{t.detail.workflowHint}</p>
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-xs font-medium text-fg-subtle">
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
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-fg-subtle">{t.detail.recommendedWorkflows}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {recommendedWorkflowDefinitions.map((definition) => (
                      <button
                        key={definition.id}
                        type="button"
                        className={cn(
                          'min-w-0 rounded-md border px-2 py-1 text-left text-xs transition-colors',
                          selectedWorkflowId === definition.id
                            ? 'border-accent bg-accent-soft text-accent-fg'
                            : 'border-edge bg-surface-base text-fg-muted hover:bg-surface-hover hover:text-fg',
                        )}
                        disabled={busy}
                        onClick={() => setSelectedWorkflowId(definition.id)}
                      >
                        <span className="block max-w-48 truncate">{definition.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="grid gap-1 text-xs font-medium text-fg-subtle">
                {t.detail.workflowGoal}
                <textarea
                  className="min-h-20 resize-y rounded-md border border-edge bg-surface-base p-2 text-sm font-normal text-fg outline-none focus:border-accent"
                  value={workflowGoal}
                  disabled={busy}
                  onChange={(event) => setWorkflowGoal(event.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="primary"
                className="h-9 rounded-lg px-3 text-xs"
                disabled={busy || !selectedWorkflowId}
                onClick={handleStartWorkflow}
              >
                <Rocket className="size-3.5" aria-hidden />
                {t.detail.startWorkflow}
              </Button>
              {!workflowDefinitions.length ? <p className="text-xs text-fg-muted">{t.detail.noWorkflowTemplates}</p> : null}
            </div>
          </section>
          <section className="rounded-lg bg-surface-panel px-4 py-3 shadow-surface">
            <div className="flex items-center justify-between gap-3">
              <h2 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-fg">
                <Paperclip className="size-4 shrink-0 text-fg-muted" aria-hidden />
                <span className="truncate">{t.attachments.title}</span>
              </h2>
              <Button type="button" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs" disabled={busy} onClick={() => attachmentInputRef.current?.click()}>
                <Plus className="size-3.5" aria-hidden />
                {t.attachments.add}
              </Button>
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
                <div key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-md border border-edge bg-surface-base p-2 text-sm">
                  <FileText className="size-4 shrink-0 text-fg-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-fg">{attachment.fileName}</div>
                    <div className="truncate text-xs text-fg-subtle">{attachment.mimeType} · {formatFileSize(attachment.size)}</div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
                    title={t.attachments.download}
                    aria-label={t.attachments.download}
                    disabled={busy}
                    onClick={() => void handleDownloadAttachment(attachment)}
                  >
                    <Download className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-danger"
                    title={t.attachments.remove}
                    aria-label={t.attachments.remove}
                    disabled={busy}
                    onClick={() => void handleRemoveAttachment(attachment)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              )) : <p className="text-sm text-fg-muted">{t.attachments.empty}</p>}
            </div>
          </section>
          <section className="rounded-lg bg-surface-panel px-4 py-3 shadow-surface">
            <h2 className="text-sm font-semibold text-fg">{t.detail.links}</h2>
            <div className="mt-3 grid gap-1 text-sm">
              {item.links?.length ? item.links.map((link) => (
                <Link key={link.id} to={linkHref(link)} className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover">
                  <span className="min-w-0 truncate text-fg">{link.title || link.targetId}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                    {t.linkKinds[link.kind]}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </span>
                </Link>
              )) : <p className="text-sm text-fg-muted">{t.detail.noLinks}</p>}
            </div>
          </section>
          <section className="rounded-lg bg-surface-panel px-4 py-3 shadow-surface">
            <h2 className="text-sm font-semibold text-fg">{t.detail.project}</h2>
            <Link to={projectHref} className="mt-2 inline-flex min-w-0 items-center gap-2 text-sm font-medium text-accent hover:text-accent-fg">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{project?.name || item.projectId}</span>
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}
