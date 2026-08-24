import type { TaskChangedEvent, TaskCommand, TaskPatchRequest, TaskPhase, TaskPriority } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Circle, CircleCheck, CircleX, ExternalLink, FolderKanban, MessageSquare, MoreHorizontal, Play, Pause, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { ChatPage } from '@/features/chat/chat-page';
import { fetchProjectOperatingView } from '@/features/projects/api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { DependencyPicker, type DependencyCandidate } from '@/features/tasks/dependency-picker';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { commandTask, submitTaskFeedback, updateTask, updateTaskDependencies, type TaskDetail } from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { hasTaskEditConflict, optimisticallyPatchTask, type TaskEditBase } from '@/features/tasks/task-detail-sync';
import { useTaskDetail } from '@/features/tasks/use-task-detail';
import { WorkspacePreviewPane } from '@/features/workspace/workspace-preview-pane';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { cn } from '@/lib/cn';
import { safeInternalReturnPath, withReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

function phaseLabel(phase: TaskPhase, language: 'en' | 'zh'): string {
  const labels = language === 'zh'
    ? { backlog: '待规划', ready: '就绪', active: '进行中', review: '待验收', closed: '已完成' }
    : { backlog: 'Backlog', ready: 'Ready', active: 'Active', review: 'Review', closed: 'Completed' };
  return labels[phase];
}

function DetailSkeleton() {
  return <div className="space-y-4" aria-busy><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-52 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>;
}

function dateInputValue(timestamp: number | undefined): string {
  if (timestamp === undefined) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dueAtFromInput(value: string): number | null {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null;
}

const TASK_CHAT_PANEL_STORAGE_KEY = 'xopc.taskDetail.chatPanelPercent';
const DEFAULT_TASK_CHAT_PANEL_PERCENT = 42;

function clampTaskChatPanelPercent(percent: number, containerWidth: number): number {
  const minimum = Math.max(30, (352 / Math.max(containerWidth, 1)) * 100);
  const maximum = Math.min(60, ((containerWidth - 480) / Math.max(containerWidth, 1)) * 100);
  if (maximum < minimum) return DEFAULT_TASK_CHAT_PANEL_PERCENT;
  return Math.min(maximum, Math.max(minimum, percent));
}

function readTaskChatPanelPercent(): number {
  try {
    const stored = Number(window.localStorage.getItem(TASK_CHAT_PANEL_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 30 && stored <= 60
      ? stored
      : DEFAULT_TASK_CHAT_PANEL_PERCENT;
  } catch {
    return DEFAULT_TASK_CHAT_PANEL_PERCENT;
  }
}

type DetailStatusKey = 'captured' | 'ready' | 'queued' | 'running' | 'verifying' | 'waiting' | 'blocked' | 'needsUser' | 'review' | 'completed' | 'ended' | 'paused';
type VerificationStatus = 'passed' | 'failed' | 'unverified';
type TaskEditConflict = 'title' | 'description' | null;

function detailStatusKey(detail: TaskDetail): DetailStatusKey {
  if (detail.task.phase === 'closed') return detail.task.resolution === 'done' ? 'completed' : 'ended';
  if (detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required')) return 'needsUser';
  if (detail.operationalState !== 'idle') return detail.operationalState;
  if (detail.task.phase === 'backlog') return 'captured';
  if (detail.task.phase === 'ready') return 'ready';
  if (detail.task.phase === 'review') return 'review';
  return 'paused';
}

function TextList({ items, empty, verificationByCriterion }: {
  items: string[];
  empty: string;
  verificationByCriterion?: ReadonlyMap<string, VerificationStatus>;
}) {
  if (items.length === 0) return <p className="text-sm leading-6 text-fg-muted">{empty}</p>;
  return <ul className="space-y-2">{items.map((item) => {
    const verification = verificationByCriterion?.get(item) ?? 'unverified';
    const Icon = verification === 'passed' ? CircleCheck : verification === 'failed' ? CircleX : Circle;
    const iconClass = verification === 'passed'
      ? 'mt-1 size-4 shrink-0 text-success'
      : verification === 'failed'
        ? 'mt-1 size-4 shrink-0 text-danger'
        : 'mt-1 size-4 shrink-0 text-fg-subtle';
    return <li key={item} className="flex gap-2 text-sm leading-6 text-fg"><Icon className={iconClass} /><span>{item}</span></li>;
  })}</ul>;
}

function TaskDetailView({ taskId, presentation, backgroundPath }: {
  taskId: string;
  presentation: 'page' | 'modal';
  backgroundPath?: string;
}) {
  const [searchParams] = useSearchParams();
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.token);
  const copy = useMemo(() => taskCopy(language), [language]);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data: detail, error: loadError, mutate: mutateDetail, lastChange } = useTaskDetail(taskId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dependencyCandidates, setDependencyCandidates] = useState<DependencyCandidate[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [agents, setAgents] = useState<ChatAgentOption[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [chatPanelPercent, setChatPanelPercent] = useState(readTaskChatPanelPercent);
  const [resizingPanels, setResizingPanels] = useState(false);
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const skipTitleSaveRef = useRef(false);
  const skipDescriptionSaveRef = useRef(false);
  const initialDescriptionDraftRef = useRef('');
  const titleEditBaseRef = useRef<TaskEditBase | null>(null);
  const descriptionEditBaseRef = useRef<TaskEditBase | null>(null);
  const projectNameProjectIdRef = useRef<string | null>(null);
  const [editConflict, setEditConflict] = useState<TaskEditConflict>(null);
  const [recentChange, setRecentChange] = useState<TaskChangedEvent | null>(null);
  const dependencySignature = detail?.dependencies
    .map((dependency) => `${dependency.id}:${dependency.title}`)
    .join('\u0000') ?? '';
  const returnPath = useMemo(() => safeInternalReturnPath(
    searchParams.get('returnTo'),
    '/',
    ['/projects', '/chat', '/notes', '/tasks'],
  ), [searchParams]);

  useEffect(() => {
    setError(null);
    setEditConflict(null);
    setEditingTitle(false);
    setEditingDescription(false);
    setRecentChange(null);
  }, [taskId]);

  useEffect(() => {
    let active = true;
    void fetchChatAgents().then((payload) => { if (active) setAgents(payload.items); }).catch(() => undefined);
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!lastChange || lastChange.source === 'user') return;
    setRecentChange(lastChange);
    const timer = window.setTimeout(() => setRecentChange(null), 3_500);
    return () => window.clearTimeout(timer);
  }, [lastChange]);

  useEffect(() => {
    const projectId = detail?.task.projectId;
    const currentDependencies = detail?.dependencies ?? [];
    if (!projectId) {
      projectNameProjectIdRef.current = null;
      setProjectName(null);
      setDependencyCandidates(currentDependencies);
      return;
    }
    if (projectNameProjectIdRef.current !== projectId) {
      projectNameProjectIdRef.current = projectId;
      setProjectName(null);
    }
    let active = true;
    void fetchProjectOperatingView(projectId).then((view) => {
      if (!active) return;
      setProjectName(view.project.name);
      const candidates = new Map<string, DependencyCandidate>();
      for (const task of [...view.tasks, ...currentDependencies]) {
        if (task.id !== taskId) candidates.set(task.id, { id: task.id, title: task.title });
      }
      setDependencyCandidates([...candidates.values()]);
    }).catch(() => {
      if (active) {
        setDependencyCandidates(currentDependencies);
      }
    });
    return () => { active = false; };
  }, [dependencySignature, detail?.task.projectId, taskId]);

  const execute = async (command: TaskCommand) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await mutateDetail(await commandTask(taskId, command, detail.task.version), { revalidate: false });
    } catch {
      setError(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const savePatch = async (patch: Omit<TaskPatchRequest, 'expectedVersion'>): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true);
    setError(null);
    try {
      const request = updateTask(taskId, patch, detail.task.version);
      await mutateDetail(request, {
        optimisticData: optimisticallyPatchTask(detail, patch),
        populateCache: true,
        revalidate: false,
        rollbackOnError: true,
      });
      return true;
    } catch {
      setError(copy.actionFailed);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveTitleOnBlur = async () => {
    if (!detail) return;
    if (skipTitleSaveRef.current) {
      skipTitleSaveRef.current = false;
      return;
    }
    const title = titleDraft.trim();
    const editBase = titleEditBaseRef.current;
    if (hasTaskEditConflict(editBase, detail.task.version, detail.task.title, title)) {
      setEditConflict('title');
      return;
    }
    if (!title || title === detail.task.title) {
      setTitleDraft(detail.task.title);
      setEditingTitle(false);
      return;
    }
    if (await savePatch({ title })) {
      setEditConflict(null);
      setEditingTitle(false);
    }
  };

  const saveDescriptionOnBlur = async () => {
    if (!detail) return;
    if (skipDescriptionSaveRef.current) {
      skipDescriptionSaveRef.current = false;
      return;
    }
    const body = descriptionDraft.trim();
    const editBase = descriptionEditBaseRef.current;
    if (hasTaskEditConflict(
      editBase,
      detail.task.version,
      detail.task.body ?? '',
      body,
    )) {
      setEditConflict('description');
      return;
    }
    if (descriptionDraft === initialDescriptionDraftRef.current || body === (detail.task.body ?? '').trim()) {
      setEditingDescription(false);
      return;
    }
    if (await savePatch({ body: body || null })) {
      setEditConflict(null);
      setEditingDescription(false);
    }
  };

  const changePhase = async (phase: TaskPhase) => {
    if (!detail || phase === detail.task.phase) return;
    if (detail.task.phase === 'closed') {
      await execute({ type: 'reopen', phase: phase === 'closed' ? 'ready' : phase });
      return;
    }
    if (phase === 'closed') {
      await execute({ type: 'close', resolution: 'done' });
      return;
    }
    await execute({ type: 'move', phase });
  };

  const commitChatPanelPercent = useCallback((percent: number) => {
    setChatPanelPercent(percent);
    try {
      window.localStorage.setItem(TASK_CHAT_PANEL_STORAGE_KEY, String(percent));
    } catch {
      /* Resizing still works when storage is unavailable. */
    }
  }, []);

  const resizePanelsWithKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
    event.preventDefault();
    const width = splitPaneRef.current?.clientWidth ?? 0;
    const next = event.key === 'Home'
      ? DEFAULT_TASK_CHAT_PANEL_PERCENT
      : chatPanelPercent + (event.key === 'ArrowLeft' ? 2 : -2);
    commitChatPanelPercent(clampTaskChatPanelPercent(next, width));
  }, [chatPanelPercent, commitChatPanelPercent]);

  const beginPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia('(min-width: 1024px)').matches) return;
    const container = splitPaneRef.current;
    if (!container) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    setResizingPanels(true);
    let nextPercent = chatPanelPercent;
    let rafId = 0;
    const apply = () => {
      rafId = 0;
      container.style.setProperty('--task-chat-panel-width', `${nextPercent}%`);
    };
    const onMove = (moveEvent: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      nextPercent = clampTaskChatPanelPercent(((bounds.right - moveEvent.clientX) / bounds.width) * 100, bounds.width);
      if (rafId === 0) rafId = window.requestAnimationFrame(apply);
    };
    const onDone = () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        apply();
      }
      try { handle.releasePointerCapture(pointerId); } catch { /* ignore */ }
      setResizingPanels(false);
      commitChatPanelPercent(nextPercent);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onDone);
      window.removeEventListener('pointercancel', onDone);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onDone);
    window.addEventListener('pointercancel', onDone);
  }, [chatPanelPercent, commitChatPanelPercent]);

  const saveDependencies = async (dependsOnTaskIds: string[]) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await mutateDetail(
        await updateTaskDependencies(taskId, dependsOnTaskIds, detail.task.version),
        { revalidate: false },
      );
    } catch {
      setError(copy.dependencyUpdateFailed);
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    if (presentation === 'modal') return;
    setPageHeader({
      startExtra: <Link to={returnPath} className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover" aria-label={copy.backToWork}><ArrowLeft className="size-4" /></Link>,
      main: detail ? <div className="min-w-0"><p className="truncate text-sm font-semibold text-fg">{projectName ? `${projectName} / ${copy.taskLabel}` : copy.taskLabel}</p><p className="text-xs text-fg-muted">{copy.detailStatuses[detailStatusKey(detail)]}</p></div> : null,
      end: null,
    });
    return clearPageHeader;
  }, [clearPageHeader, copy.backToWork, copy.detailStatuses, copy.taskLabel, detail, presentation, projectName, returnPath, setPageHeader]);

  if (loadError && !detail) return <div className={presentation === 'modal' ? 'p-5 text-sm text-danger' : 'mx-auto max-w-3xl p-6 text-sm text-danger'}>{copy.taskNotFound}</div>;
  if (!detail) return <div className={presentation === 'modal' ? 'p-5' : 'mx-auto max-w-4xl p-4 sm:p-6'}><DetailSkeleton /></div>;

  const activeWait = detail.waits[0];
  const pausedWait = activeWait?.kind === 'paused' ? activeWait : undefined;
  const latestReceipt = detail.receipts[0];
  const statusLabel = copy.detailStatuses[detailStatusKey(detail)];
  const statusDescription = copy.detailStatusDescriptions[detailStatusKey(detail)];
  const objective = detail.task.body?.trim() || detail.task.contract?.objective.trim();
  const verificationByCriterion = new Map(latestReceipt?.verification.checks.map((check) => [check.criterion, check.status]));
  const canSchedule = detail.allowedCommands.includes('mark_ready');
  const canStart = detail.allowedCommands.includes('start');
  const canPause = detail.allowedCommands.includes('add_wait');
  const canApprove = detail.task.phase === 'review' && detail.allowedCommands.includes('close');
  const canReopen = detail.allowedCommands.includes('reopen');
  const conversationSessionKey = detail.runs.find((run) => run.sessionKey)?.sessionKey
    ?? detail.context.find((item) => item.targetKind === 'session')?.targetId;
  const runAgentId = detail.runs.find((run) => typeof run.executorRef.agentId === 'string')?.executorRef.agentId;
  const conversationAgentId = detail.task.delegateAgentId
    ?? (typeof runAgentId === 'string' ? runAgentId : undefined)
    ?? detail.task.ownerId;
  const conversationAgent = agents.find((agent) => agent.id === conversationAgentId);
  const needsUserAttention = detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');
  const acceptanceCriteria = detail.task.contract?.acceptanceCriteria ?? [];
  const verifiedCriteriaCount = acceptanceCriteria.filter((criterion) => verificationByCriterion.get(criterion) === 'passed').length;
  const expectedOutputs = detail.task.contract?.expectedOutputs ?? [];
  const constraints = detail.task.contract?.constraints ?? [];
  const approvalRequired = detail.task.contract?.approvalRequired ?? [];
  const assumptions = detail.task.contract?.assumptions ?? [];
  const risks = detail.task.contract?.risks ?? [];
  const recentlyChanged = (...fields: TaskChangedEvent['changedFields']): boolean => Boolean(
    recentChange?.changedFields.some((field) => fields.includes(field)),
  );
  const taskHref = (relatedTaskId: string) => presentation === 'modal' && backgroundPath
    ? taskDetailModalHref(backgroundPath, relatedTaskId)
    : withReturnTo(`/tasks/${relatedTaskId}`, returnPath);

  const canMovePhase = detail.allowedCommands.includes('move');
  const phaseDisabled = (phase: TaskPhase) => phase !== detail.task.phase && (
    phase === 'closed' ? !canApprove : detail.task.phase === 'closed' ? !canReopen : !canMovePhase
  );
  const taskActions = (
    <div className="flex flex-wrap gap-2">
      {canSchedule ? <Button variant="primary" disabled={busy} onClick={() => void execute({ type: 'mark_ready' })}><Play className="size-4" />{copy.scheduleTask}</Button> : null}
      {pausedWait ? <Button variant="primary" disabled={busy} onClick={() => void execute({ type: 'resolve_wait', waitId: pausedWait.id })}><Play className="size-4" />{copy.resumeTask}</Button> : null}
      {!activeWait && canStart ? <Button variant="primary" disabled={busy} onClick={() => void execute({ type: 'start', executor: { kind: 'agent', agentId: detail.task.delegateAgentId ?? 'main' } })}><Play className="size-4" />{copy.runTask}</Button> : null}
      {canApprove ? <Button variant="primary" disabled={busy} onClick={() => void execute({ type: 'close', resolution: 'done' })}><CircleCheck className="size-4" />{copy.approveTask}</Button> : null}
      {canReopen ? <Button variant="primary" disabled={busy} onClick={() => void execute({ type: 'reopen', phase: 'ready' })}><Play className="size-4" />{copy.reopenTask}</Button> : null}
      {!activeWait && canPause ? <Button variant="secondary" className="border-0 bg-surface-hover shadow-none" disabled={busy} onClick={() => void execute({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}><Pause className="size-4" />{copy.pauseTask}</Button> : null}
      {detail.task.phase !== 'closed' ? <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className="size-9 p-0" disabled={busy} aria-label={copy.moreActions}><MoreHorizontal className="size-4" aria-hidden /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-[100] min-w-40 rounded-lg bg-surface-elevated p-1 shadow-lg"><DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => void execute({ type: 'close', resolution: 'cancelled' })}>{copy.cancelTask}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root> : null}
    </div>
  );

  return (
    <div
      ref={splitPaneRef}
      className={`${presentation === 'modal' ? 'flex h-full min-h-0 flex-col lg:flex-row' : 'flex min-h-[calc(100dvh-8rem)] flex-col overflow-hidden lg:flex-row'} ${resizingPanels ? 'lg:cursor-col-resize lg:select-none' : ''}`}
      style={{ '--task-chat-panel-width': `${chatPanelPercent}%` } as CSSProperties}
    >
      <section className="task-detail-scroll min-w-0 flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
      <header className={cn('px-4 pb-5', recentlyChanged('title') && 'task-detail-live-update')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              {projectName ? <span className="inline-flex items-center gap-1.5"><FolderKanban className="size-3.5" aria-hidden />{projectName}</span> : null}
              <span>/</span><span>{copy.taskLabel}</span>
              {recentChange ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg" role="status">
                  {recentChange.source === 'agent'
                    ? (language === 'zh' ? 'Agent 刚刚更新' : 'Updated by Agent')
                    : (language === 'zh' ? '执行结果已同步' : 'Execution result synced')}
                </span>
              ) : null}
            </div>
            {editingTitle ? (
              <input
                autoFocus
                data-task-inline-editor
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitleOnBlur()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    skipTitleSaveRef.current = true;
                    setTitleDraft(detail.task.title);
                    setEditingTitle(false);
                    queueMicrotask(() => { skipTitleSaveRef.current = false; });
                  }
                }}
                className="mt-3 w-full max-w-3xl rounded-lg bg-surface-hover px-3 py-2 text-2xl font-semibold leading-8 text-fg outline-none ring-2 ring-accent/30 focus:ring-accent/60"
              />
            ) : (
              <button type="button" className="mt-3 block max-w-3xl rounded-lg text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover" onClick={() => { titleEditBaseRef.current = { value: detail.task.title, version: detail.task.version }; setEditConflict(null); setTitleDraft(detail.task.title); setEditingTitle(true); }}>
                <h1 className="text-2xl font-semibold leading-8 text-fg">{detail.task.title}</h1>
              </button>
            )}
            {editConflict === 'title' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning" role="alert">
                <span>{language === 'zh' ? 'Agent 在你编辑期间更新了标题。' : 'The Agent updated the title while you were editing.'}</span>
                <button type="button" className="rounded-md bg-surface-hover px-2 py-1 text-fg" onClick={() => { setTitleDraft(detail.task.title); setEditConflict(null); setEditingTitle(false); }}>{language === 'zh' ? '使用 Agent 版本' : 'Use Agent version'}</button>
                <button type="button" className="rounded-md bg-accent-soft px-2 py-1 text-accent-fg" onClick={() => void savePatch({ title: titleDraft.trim() }).then((saved) => { if (saved) { setEditConflict(null); setEditingTitle(false); } })}>{language === 'zh' ? '保留我的修改' : 'Keep my changes'}</button>
              </div>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </header>

      <div className="mt-5 flex flex-col gap-5">
        <main className="order-2 min-w-0 space-y-5">
          <section className={cn('rounded-xl bg-surface-panel p-4', recentlyChanged('body') && 'task-detail-live-update')}>
            <h2 className="font-medium text-fg">{copy.taskDescription}</h2>
            {editingDescription ? (
              <textarea
                autoFocus
                data-task-inline-editor
                rows={6}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={() => void saveDescriptionOnBlur()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    skipDescriptionSaveRef.current = true;
                    setDescriptionDraft(detail.task.body ?? detail.task.contract?.objective ?? '');
                    setEditingDescription(false);
                    queueMicrotask(() => { skipDescriptionSaveRef.current = false; });
                  }
                }}
                className="mt-3 w-full resize-y rounded-lg bg-surface-hover px-3 py-2 text-sm leading-6 text-fg outline-none ring-2 ring-accent/20 focus:ring-accent/50"
              />
            ) : (
              <button type="button" className="-mx-1 mt-2 block w-[calc(100%+0.5rem)] rounded-lg px-1 py-1 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover" onClick={() => { const draft = detail.task.body ?? detail.task.contract?.objective ?? ''; initialDescriptionDraftRef.current = draft; descriptionEditBaseRef.current = { value: detail.task.body ?? '', version: detail.task.version }; setEditConflict(null); setDescriptionDraft(draft); setEditingDescription(true); }}>
                <span className="whitespace-pre-wrap text-sm leading-6 text-fg-muted">{objective && objective !== detail.task.title ? objective : copy.noTaskDescription}</span>
              </button>
            )}
            {editConflict === 'description' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning" role="alert">
                <span>{language === 'zh' ? 'Agent 在你编辑期间更新了描述。' : 'The Agent updated the description while you were editing.'}</span>
                <button type="button" className="rounded-md bg-surface-hover px-2 py-1 text-fg" onClick={() => { setDescriptionDraft(detail.task.body ?? ''); setEditConflict(null); setEditingDescription(false); }}>{language === 'zh' ? '使用 Agent 版本' : 'Use Agent version'}</button>
                <button type="button" className="rounded-md bg-accent-soft px-2 py-1 text-accent-fg" onClick={() => void savePatch({ body: descriptionDraft.trim() || null }).then((saved) => { if (saved) { setEditConflict(null); setEditingDescription(false); } })}>{language === 'zh' ? '保留我的修改' : 'Keep my changes'}</button>
              </div>
            ) : null}
          </section>

          {detail.attention.length > 0 ? <section className={cn('rounded-xl bg-warning/10 p-4', recentlyChanged('attention') && 'task-detail-live-update')}><h3 className="font-medium text-fg">{needsUserAttention ? copy.needsAttention : copy.waitingStatus}</h3><ul className="mt-3 space-y-2 text-sm text-fg-muted">{detail.attention.map((item, index) => <li key={`${item.kind}-${index}`}>{item.summary}</li>)}</ul></section> : null}

          <section className={cn('rounded-xl bg-surface-panel p-4', recentlyChanged('contract') && 'task-detail-live-update')}>
            <h2 className="font-medium text-fg">{copy.taskDefinition}</h2>
            <div className="mt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-fg">{copy.successDefinition}</h3>{acceptanceCriteria.length > 0 ? <span className="text-xs text-fg-subtle">{copy.criteriaProgress.replace('{{verified}}', String(verifiedCriteriaCount)).replace('{{total}}', String(acceptanceCriteria.length))}</span> : null}</div><div className="mt-3"><TextList items={acceptanceCriteria} empty={copy.noDefinition} verificationByCriterion={verificationByCriterion} /></div></div>
            {expectedOutputs.length > 0 ? <div className="mt-5 rounded-lg bg-surface-hover p-4"><h3 className="text-sm font-medium text-fg">{copy.expectedOutputs}</h3><div className="mt-3"><TextList items={expectedOutputs} empty={copy.noDefinition} /></div></div> : null}
            {constraints.length > 0 ? <details className="mt-4 rounded-lg bg-surface-hover p-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.constraints}</summary><div className="mt-3"><TextList items={constraints} empty={copy.noDefinition} /></div></details> : null}
            {approvalRequired.length > 0 ? <details className="mt-4 rounded-lg bg-surface-hover p-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.approvalRequired}</summary><div className="mt-3"><TextList items={approvalRequired} empty={copy.noDefinition} /></div></details> : null}
            {assumptions.length > 0 ? <details className="mt-4 rounded-lg bg-surface-hover p-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.contextAssumptions}</summary><div className="mt-3"><TextList items={assumptions} empty={copy.noDefinition} /></div></details> : null}
            {risks.length > 0 ? <details className="mt-4 rounded-lg bg-surface-hover p-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.contextRisks}</summary><div className="mt-3"><TextList items={risks} empty={copy.noDefinition} /></div></details> : null}
          </section>

          {latestReceipt ? <section className={cn('rounded-xl bg-surface-panel p-4', recentlyChanged('runs', 'receipts') && 'task-detail-live-update')}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium text-fg">{copy.latestResult}</h2><p className="mt-2 text-sm leading-6 text-fg">{latestReceipt.summary}</p></div><span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs text-fg-muted">{copy.receiptStatuses[latestReceipt.status]} · {copy.verificationStatuses[latestReceipt.verification.status]}</span></div>{latestReceipt.remainingWork.length > 0 ? <div className="mt-4"><h3 className="text-xs font-medium text-fg-muted">{copy.remainingWork}</h3><div className="mt-2"><TextList items={latestReceipt.remainingWork} empty={copy.noRemainingWork} /></div></div> : null}{latestReceipt.nextAction ? <div className="mt-4 rounded-lg bg-surface-hover p-3"><p className="text-xs font-medium text-fg-muted">{copy.nextAction}</p><p className="mt-1 text-sm text-fg">{latestReceipt.nextAction}</p></div> : null}<div className="mt-4 flex flex-wrap items-center gap-2"><Button className="border-0 bg-surface-hover px-2 py-1 text-xs shadow-none" variant="secondary" onClick={() => void submitTaskFeedback(latestReceipt.runId, 'helpful')}>{copy.doneWell}</Button><Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => void submitTaskFeedback(latestReceipt.runId, 'not_helpful')}>{copy.needsFix}</Button>{latestReceipt.evidence.filter((evidence) => evidence.uri).map((evidence) => <a key={`${evidence.title}-${evidence.uri}`} className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline" href={evidence.uri}><ExternalLink className="size-3" />{evidence.title}</a>)}</div>{detail.receipts.length > 1 ? <details className="mt-4 rounded-lg bg-surface-hover p-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted">{copy.executionHistory.replace('{{count}}', String(detail.receipts.length - 1))}</summary><div className="mt-3 space-y-3">{detail.receipts.slice(1).map((receipt) => <article key={receipt.runId} className="rounded-lg bg-surface-active p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm text-fg">{receipt.summary}</p><span className="shrink-0 text-xs text-fg-subtle">{copy.receiptStatuses[receipt.status]}</span></div></article>)}</div></details> : null}</section> : null}

          {detail.context.length > 0 ? <section className={cn('rounded-xl bg-surface-panel p-4', recentlyChanged('context') && 'task-detail-live-update')}><h2 className="font-medium text-fg">{copy.contextUsed}</h2><ul className="mt-4 grid gap-2 sm:grid-cols-2">{detail.context.map((item) => <li key={item.id} className="min-w-0 rounded-lg bg-surface-hover p-2.5"><span className="text-[11px] text-fg-subtle">{copy.contextRoleLabels[item.role]} · {copy.contextKindLabels[item.targetKind]}</span>{item.targetKind === 'url' && /^https?:\/\//.test(item.targetId) ? <a className="mt-1 block break-all text-sm text-accent hover:underline" href={item.targetId} target="_blank" rel="noreferrer">{item.title ?? item.targetId}</a> : <p className="mt-1 break-words text-sm text-fg">{item.title ?? item.targetId}</p>}</li>)}</ul></section> : null}
        </main>

        <aside className="order-1 min-w-0 space-y-4">
          <section className={cn('rounded-xl bg-surface-subtle p-4', recentlyChanged('phase', 'resolution', 'priority', 'dueAt', 'delegateAgentId') && 'task-detail-live-update')}>
            <h2 className="font-medium text-fg">{copy.taskProperties}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs text-fg-muted"><span>{copy.taskPhase}</span><Select triggerClassName="border-0 bg-surface-hover shadow-none focus-visible:ring-2 focus-visible:ring-accent/30" contentClassName="border-0" value={detail.task.phase} disabled={busy} onChange={(event) => void changePhase(event.target.value as TaskPhase)}>{(['backlog', 'ready', 'active', 'review', 'closed'] as TaskPhase[]).map((phase) => <SelectOption key={phase} value={phase} disabled={phaseDisabled(phase)}>{phaseLabel(phase, language)}</SelectOption>)}</Select></label>
              <label className="grid gap-1.5 text-xs text-fg-muted"><span>{copy.priority}</span><Select triggerClassName="border-0 bg-surface-hover shadow-none focus-visible:ring-2 focus-visible:ring-accent/30" contentClassName="border-0" value={detail.task.priority} disabled={busy} onChange={(event) => void savePatch({ priority: event.target.value as TaskPriority })}>{(['low', 'normal', 'high', 'critical'] as TaskPriority[]).map((priority) => <SelectOption key={priority} value={priority}>{copy.priorityLabels[priority]}</SelectOption>)}</Select></label>
              <label className="grid gap-1.5 text-xs text-fg-muted"><span>{copy.dueDate}</span><input type="date" disabled={busy} value={dateInputValue(detail.task.dueAt)} onChange={(event) => void savePatch({ dueAt: dueAtFromInput(event.target.value) })} className="h-10 rounded-lg bg-surface-hover px-3 text-sm text-fg outline-none focus:ring-2 focus:ring-accent/30" /></label>
              <label className="grid gap-1.5 text-xs text-fg-muted"><span>{copy.executorLabel}</span><Select triggerClassName="border-0 bg-surface-hover shadow-none focus-visible:ring-2 focus-visible:ring-accent/30" contentClassName="border-0" value={detail.task.delegateAgentId ?? ''} disabled={busy} onChange={(event) => void savePatch({ delegateAgentId: event.target.value || null })}><SelectOption value="">{copy.unassigned}</SelectOption>{agents.map((agent) => <SelectOption key={agent.id} value={agent.id}>{agent.name || agent.id}</SelectOption>)}</Select></label>
              {projectName ? <div className="grid gap-1 text-xs text-fg-muted"><span>{copy.projectLabel}</span><span className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-2 text-sm text-fg"><FolderKanban className="size-3.5" />{projectName}</span></div> : null}
            </div>
            <div className="mt-4 rounded-lg bg-surface-hover p-3 text-xs leading-5 text-fg-subtle"><p>{statusLabel}</p><p>{statusDescription}</p><p className="mt-2">{copy.updatedAt.replace('{{date}}', formatMediumDateTime(detail.task.updatedAt, language))}</p></div>
          </section>

          <section className={cn('rounded-xl bg-surface-panel p-4', recentlyChanged('dependencies') && 'task-detail-live-update')}>
            <h2 className="font-medium text-fg">{copy.taskRelations}</h2>
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-xs text-fg-muted">{copy.dependencies}</p>
                <DependencyPicker borderless candidates={dependencyCandidates} selectedIds={detail.dependencies.map((task) => task.id)} disabled={busy} onChange={(dependsOnTaskIds) => void saveDependencies(dependsOnTaskIds)} labels={{ link: copy.linkDependencies, linked: copy.linkedDependencies, searchPlaceholder: copy.dependencySearchPlaceholder, noMatches: copy.noDependencyMatches, noCandidates: copy.noDependencyCandidates, remove: copy.removeDependency }} />
              </div>
              <div><p className="mb-2 text-xs text-fg-muted">{copy.dependents}</p>{detail.dependents.length > 0 ? <div className="space-y-1.5">{detail.dependents.map((task) => <Link key={task.id} to={taskHref(task.id)} className="block rounded-lg bg-surface-hover p-2.5 text-sm text-accent hover:underline">{task.title}</Link>)}</div> : <p className="text-sm text-fg-subtle">{copy.noDependents}</p>}</div>
            </div>
          </section>
        </aside>
      </div>
      </section>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={language === 'zh' ? '调整任务信息和 Agent 对话的宽度' : 'Resize task details and Agent chat'}
        aria-valuemin={30}
        aria-valuemax={60}
        aria-valuenow={Math.round(chatPanelPercent)}
        tabIndex={0}
        onPointerDown={beginPanelResize}
        onKeyDown={resizePanelsWithKeyboard}
        onDoubleClick={() => commitChatPanelPercent(DEFAULT_TASK_CHAT_PANEL_PERCENT)}
        className={`group hidden w-2 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-surface-panel outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover lg:flex ${resizingPanels ? 'bg-surface-hover' : ''}`}
      >
        <div className="my-3 w-px rounded-full bg-edge-strong/70 transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>

      <aside className="flex min-h-[34rem] min-w-0 flex-col bg-surface-panel lg:min-h-0 lg:w-[var(--task-chat-panel-width)] lg:shrink-0">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 bg-surface-subtle px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <AgentAvatarDisplay agentId={conversationAgentId ?? 'main'} avatar={conversationAgent?.avatar} size={28} className="shrink-0" />
              <div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{language === 'zh' ? 'Agent 执行与对话' : 'Agent execution and chat'}</p><p className="mt-0.5 truncate text-xs text-fg-muted">{conversationAgent?.name ?? conversationAgentId ?? copy.unassigned} · {statusLabel}</p></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">{taskActions}{conversationSessionKey ? <Button asChild variant="ghost" className="h-8 shrink-0 px-2 text-xs"><Link to={`/chat/${encodeURIComponent(conversationSessionKey)}`}><ExternalLink className="size-3.5" />{language === 'zh' ? '全屏' : 'Full screen'}</Link></Button> : null}</div>
        </div>
        {conversationSessionKey ? (
          <div className="min-h-0 flex-1"><ChatPage embedded sessionKey={conversationSessionKey} /></div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-xs"><MessageSquare className="mx-auto size-8 text-fg-subtle" /><p className="mt-3 text-sm font-medium text-fg">{language === 'zh' ? '等待任务会话' : 'Waiting for a task conversation'}</p><p className="mt-2 text-xs leading-5 text-fg-muted">{language === 'zh' ? '安排或开始任务后，Agent 的执行过程和持续对话会显示在这里。' : 'Schedule or start the task to see the agent run and continue the conversation here.'}</p></div>
          </div>
        )}
      </aside>
    </div>
  );
}

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
  return <TaskDetailView taskId={taskId} presentation="page" />;
}

export function TaskDetailModal({ taskId, backgroundPath, onClose }: {
  taskId: string;
  backgroundPath: string;
  onClose: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const workspacePanelOpen = useWorkspacePanelStore((state) => state.open);
  const workspacePanelWidth = useWorkspacePanelStore((state) => state.widthPx);
  const workspaceSessionKey = useWorkspacePanelStore((state) => state.sessionKeyOverride);
  const previewPath = useWorkspacePreviewStore((state) => state.path);
  const setPreviewPath = useWorkspacePreviewStore((state) => state.setPath);
  const workspacePanelOffset = workspacePanelOpen ? workspacePanelWidth : 0;

  return (
    <Dialog.Root
      modal={false}
      open
      onOpenChange={(open) => {
        if (open) return;
        setPreviewPath(null);
        onClose();
      }}
    >
      <Dialog.Portal>
        <button
          type="button"
          tabIndex={-1}
          data-task-modal-backdrop
          className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[1px]"
          aria-label={language === 'zh' ? '关闭任务详情' : 'Close task details'}
          onClick={() => {
            setPreviewPath(null);
            onClose();
          }}
        />
        <Dialog.Content
          className="task-detail-modal-content fixed top-1/2 z-[90] flex h-[min(54rem,calc(100dvh-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-surface-base shadow-float focus:outline-none"
          data-workspace-panel-open={workspacePanelOpen ? 'true' : 'false'}
          style={{
            '--task-detail-workspace-offset': `${workspacePanelOffset / 2}px`,
            '--task-detail-workspace-width': `${workspacePanelOffset}px`,
          } as CSSProperties}
          onEscapeKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('[data-task-inline-editor]')) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target;
            if (
              target instanceof Element
              && target.closest('#app-workspace-panel, [data-task-modal-backdrop]')
            ) event.preventDefault();
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 bg-surface-panel px-5 py-3.5">
            <Dialog.Title className="font-medium text-fg">{language === 'zh' ? '任务详情' : 'Task details'}</Dialog.Title>
            <Dialog.Description className="sr-only">{language === 'zh' ? '查看并操作任务详情' : 'View and manage task details'}</Dialog.Description>
            <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={language === 'zh' ? '关闭任务详情' : 'Close task details'}><X className="size-4" aria-hidden /></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            {previewPath ? (
              <WorkspacePreviewPane
                allowOutsideChat
                sessionKey={workspaceSessionKey ?? undefined}
              />
            ) : (
              <TaskDetailView taskId={taskId} presentation="modal" backgroundPath={backgroundPath} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
