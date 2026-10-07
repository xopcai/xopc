import { TaskInputCard } from '@/features/tasks/task-input-card';
import type { TaskChangedEvent, TaskCommand, TaskPatchRequest, TaskPhase, TaskPriority } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, CalendarClock, Circle, CircleCheck, CircleX, ExternalLink, FolderKanban, FolderOpen, MessageSquare, MoreHorizontal, Play, Pause, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { automationApi } from '@/features/automations/automation-api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchChatAgents, type ChatAgentOption } from '@/features/chat/agent-selection/chat-agents-api';
import { ChatPage } from '@/features/chat/chat-page';
import { fetchProjectOperatingView } from '@/features/projects/api';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';
import { DependencyPicker, type DependencyCandidate } from '@/features/tasks/dependency-picker';
import { taskChatHref, taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { cancelTaskRun, commandTask, deleteTask, handoffTask, reviewTaskCriterion, submitTaskFeedback, updateTask, updateTaskDependencies, type TaskDetail } from '@/features/tasks/home-api';
import { TaskResultEvidence } from '@/features/tasks/task-result-evidence';
import { TaskCollaborationPanel } from '@/features/tasks/task-collaboration-panel';
import { taskCopy } from '@/features/tasks/task-copy';
import { summarizeTaskCriteria } from '@/features/tasks/task-detail-summary';
import { hasTaskEditConflict, optimisticallyPatchTask, type TaskEditBase } from '@/features/tasks/task-detail-sync';
import { useTaskDetail } from '@/features/tasks/use-task-detail';
import { WorkspacePreviewPane } from '@/features/workspace/workspace-preview-pane';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { cn } from '@/lib/cn';
import { safeInternalReturnPath, withReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { useSideChatStore } from '@/stores/side-chat-store';
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

const TASK_PHASES: TaskPhase[] = ['backlog', 'ready', 'active', 'review', 'closed'];
const TASK_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'critical'];

const TaskPhaseField = memo(function TaskPhaseField({
  value,
  disabled,
  canMove,
  canApprove,
  canReopen,
  language,
  label,
  onChange,
}: {
  value: TaskPhase;
  disabled: boolean;
  canMove: boolean;
  canApprove: boolean;
  canReopen: boolean;
  language: 'en' | 'zh';
  label: string;
  onChange: (phase: TaskPhase) => void;
}) {
  const optionDisabled = (phase: TaskPhase) => phase !== value && (
    phase === 'closed' ? !canApprove : value === 'closed' ? !canReopen : !canMove
  );
  return <label className="grid gap-1.5 text-xs text-fg-muted"><span>{label}</span><Select triggerClassName="border-0 bg-surface-hover shadow-none focus-visible:ring-2 focus-visible:ring-accent/30" contentClassName="border-0" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as TaskPhase)}>{TASK_PHASES.map((phase) => <SelectOption key={phase} value={phase} disabled={optionDisabled(phase)}>{phaseLabel(phase, language)}</SelectOption>)}</Select></label>;
});

const TaskPriorityField = memo(function TaskPriorityField({
  value,
  disabled,
  label,
  labels,
  onChange,
}: {
  value: TaskPriority;
  disabled: boolean;
  label: string;
  labels: Record<TaskPriority, string>;
  onChange: (priority: TaskPriority) => void;
}) {
  return <label className="grid gap-1.5 text-xs text-fg-muted"><span>{label}</span><Select triggerClassName="border-0 bg-surface-hover shadow-none focus-visible:ring-2 focus-visible:ring-accent/30" contentClassName="border-0" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as TaskPriority)}>{TASK_PRIORITIES.map((priority) => <SelectOption key={priority} value={priority}>{labels[priority]}</SelectOption>)}</Select></label>;
});

const TaskDueDateField = memo(function TaskDueDateField({
  value,
  disabled,
  label,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  return <label className="grid gap-1.5 text-xs text-fg-muted"><span>{label}</span><DatePicker disabled={disabled} value={value} onChange={onChange} ariaLabel={label} /></label>;
});

const TaskExecutorField = memo(function TaskExecutorField({
  value,
  disabled,
  label,
  unassignedLabel,
  agents,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  unassignedLabel: string;
  agents: ChatAgentOption[];
  onChange: (agentId: string) => void;
}) {
  return <label className="grid gap-1.5 text-xs text-fg-muted"><span>{label}</span><Select triggerClassName="border-0 bg-surface-hover shadow-none focus-visible:ring-2 focus-visible:ring-accent/30" contentClassName="border-0" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><SelectOption value="" disabled>{unassignedLabel}</SelectOption>{agents.map((agent) => <SelectOption key={agent.id} value={agent.id}>{agent.name || agent.id}</SelectOption>)}</Select></label>;
});

const TaskDependenciesField = memo(function TaskDependenciesField({
  candidates,
  selected,
  disabled,
  labels,
  getTaskHref,
  onChange,
}: {
  candidates: DependencyCandidate[];
  selected: TaskDetail['dependencies'];
  disabled: boolean;
  labels: {
    link: string;
    linked: string;
    searchPlaceholder: string;
    noMatches: string;
    noCandidates: string;
    remove: string;
  };
  getTaskHref: (taskId: string) => string;
  onChange: (taskIds: string[]) => void;
}) {
  return <DependencyPicker borderless candidates={candidates} selectedIds={selected.map((task) => task.id)} disabled={disabled} getTaskHref={getTaskHref} onChange={onChange} labels={labels} />;
}, (previous, next) => (
  previous.disabled === next.disabled
  && previous.labels === next.labels
  && previous.getTaskHref === next.getTaskHref
  && previous.onChange === next.onChange
  && previous.candidates.length === next.candidates.length
  && previous.candidates.every((candidate, index) => candidate.id === next.candidates[index]?.id && candidate.title === next.candidates[index]?.title)
  && previous.selected.length === next.selected.length
  && previous.selected.every((task, index) => task.id === next.selected[index]?.id && task.title === next.selected[index]?.title)
));

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
type TaskEditConflict = 'title' | 'description' | null;
type TaskPendingOperation = 'command' | 'phase' | 'priority' | 'dueAt' | 'delegateAgentId' | 'dependencies' | 'acceptance' | 'delete' | 'title';

function detailStatusKey(detail: TaskDetail): DetailStatusKey {
  if (detail.task.phase === 'closed') return detail.task.resolution === 'done' ? 'completed' : 'ended';
  if (detail.waits.some((wait) => wait.kind === 'paused')) return 'paused';
  if (detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required')) return 'needsUser';
  if (detail.operationalState !== 'idle') return detail.operationalState;
  if (detail.task.phase === 'backlog') return 'captured';
  if (detail.task.phase === 'ready') return 'ready';
  if (detail.task.phase === 'review') return 'review';
  return 'ready';
}

function detailStatusTone(status: DetailStatusKey): string {
  if (status === 'needsUser' || status === 'blocked') return 'bg-warning/10 text-warning';
  if (status === 'completed') return 'bg-success-soft text-success';
  if (status === 'running' || status === 'verifying' || status === 'review') return 'bg-accent-soft text-accent-fg';
  return 'bg-surface-hover text-fg-muted';
}

function TextList({ items, empty }: {
  items: string[];
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm leading-6 text-fg-muted">{empty}</p>;
  return <ul className="space-y-2">{items.map((item) => {
    return <li key={item} className="flex gap-2 text-sm leading-6 text-fg"><Circle className="mt-1 size-4 shrink-0 text-fg-subtle" /><span>{item}</span></li>;
  })}</ul>;
}

function TaskDetailView({ taskId, presentation, backgroundPath, onDeleted }: {
  taskId: string;
  presentation: 'page' | 'modal';
  backgroundPath?: string;
  onDeleted?: () => void;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.conversationId);
  const copy = useMemo(() => taskCopy(language), [language]);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const workspacePanelOpen = useWorkspacePanelStore((state) => state.open);
  const workspacePanelConversationId = useWorkspacePanelStore((state) => state.conversationIdOverride);
  const openWorkspacePanelForSession = useWorkspacePanelStore((state) => state.openForSession);
  const setSideChatOpen = useSideChatStore((state) => state.setOpen);
  const {
    data: detail,
    error: loadError,
    mutate: mutateDetail,
    lastChange,
    conversationLoading,
    conversationError,
  } = useTaskDetail(taskId);
  const { data: automationList } = useSWR(taskId ? 'task-detail-automations' : null, () => automationApi.list());
  const [error, setError] = useState<string | null>(null);
  const [pendingOperations, setPendingOperations] = useState<ReadonlySet<TaskPendingOperation>>(() => new Set());
  const [dependencyCandidates, setDependencyCandidates] = useState<DependencyCandidate[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [agents, setAgents] = useState<ChatAgentOption[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [objectiveExpanded, setObjectiveExpanded] = useState(false);
  const [chatPanelPercent, setChatPanelPercent] = useState(readTaskChatPanelPercent);
  const [resizingPanels, setResizingPanels] = useState(false);
  const splitPaneRef = useRef<HTMLDivElement>(null);
  const skipTitleSaveRef = useRef(false);
  const skipDescriptionSaveRef = useRef(false);
  const initialDescriptionDraftRef = useRef('');
  const titleEditBaseRef = useRef<TaskEditBase | null>(null);
  const descriptionEditBaseRef = useRef<TaskEditBase | null>(null);
  const projectNameProjectIdRef = useRef<string | null>(null);
  const detailRef = useRef<TaskDetail | undefined>(detail);
  const [editConflict, setEditConflict] = useState<TaskEditConflict>(null);
  const [recentChange, setRecentChange] = useState<TaskChangedEvent | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const dependencyPickerLabels = useMemo(() => ({
    link: copy.linkDependencies,
    linked: copy.linkedDependencies,
    searchPlaceholder: copy.dependencySearchPlaceholder,
    noMatches: copy.noDependencyMatches,
    noCandidates: copy.noDependencyCandidates,
    remove: copy.removeDependency,
  }), [copy.dependencySearchPlaceholder, copy.linkDependencies, copy.linkedDependencies, copy.noDependencyCandidates, copy.noDependencyMatches, copy.removeDependency]);
  const dependencySignature = detail?.dependencies
    .map((dependency) => `${dependency.id}:${dependency.title}`)
    .join('\u0000') ?? '';
  const returnPath = useMemo(() => safeInternalReturnPath(
    searchParams.get('returnTo'),
    '/',
    ['/projects', '/chat', '/notes', '/tasks'],
  ), [searchParams]);
  const taskHref = useCallback((relatedTaskId: string) => presentation === 'modal' && backgroundPath
    ? taskDetailModalHref(backgroundPath, relatedTaskId)
    : withReturnTo(`/tasks/${encodeURIComponent(relatedTaskId)}`, returnPath), [backgroundPath, presentation, returnPath]);
  detailRef.current = detail;

  const setOperationPending = useCallback((operation: TaskPendingOperation, pending: boolean) => {
    setPendingOperations((current) => {
      const next = new Set(current);
      if (pending) next.add(operation);
      else next.delete(operation);
      return next;
    });
  }, []);

  useEffect(() => {
    setError(null);
    setEditConflict(null);
    setEditingTitle(false);
    titleEditBaseRef.current = null;
    setEditingDescription(false);
    setObjectiveExpanded(false);
    setRecentChange(null);
    setDeleteDialogOpen(false);
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

  const execute = useCallback(async (command: TaskCommand, operation: TaskPendingOperation = 'command') => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return;
    setOperationPending(operation, true);
    setError(null);
    try {
      await mutateDetail(await commandTask(taskId, command, currentDetail.task.version), { revalidate: false });
    } catch {
      setError(copy.actionFailed);
    } finally {
      setOperationPending(operation, false);
    }
  }, [copy.actionFailed, mutateDetail, setOperationPending, taskId]);

  const savePatch = useCallback(async (
    patch: Omit<TaskPatchRequest, 'expectedVersion'>,
    operation?: TaskPendingOperation,
  ): Promise<boolean> => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return false;
    if (operation) setOperationPending(operation, true);
    setError(null);
    try {
      const request = updateTask(taskId, patch, currentDetail.task.version);
      await mutateDetail(request, {
        optimisticData: optimisticallyPatchTask(currentDetail, patch),
        populateCache: true,
        revalidate: false,
        rollbackOnError: true,
      });
      return true;
    } catch {
      setError(copy.actionFailed);
      return false;
    } finally {
      if (operation) setOperationPending(operation, false);
    }
  }, [copy.actionFailed, mutateDetail, setOperationPending, taskId]);

  const beginTitleEdit = () => {
    if (!detail) return;
    titleEditBaseRef.current = { value: detail.task.title, version: detail.task.version };
    setEditConflict(null);
    setTitleDraft(detail.task.title);
    setEditingTitle(true);
  };

  const cancelTitleEdit = () => {
    skipTitleSaveRef.current = true;
    setTitleDraft(detailRef.current?.task.title ?? '');
    titleEditBaseRef.current = null;
    setEditConflict(null);
    setEditingTitle(false);
    queueMicrotask(() => { skipTitleSaveRef.current = false; });
  };

  const saveTitle = async (keepMyChanges = false) => {
    if (skipTitleSaveRef.current) {
      skipTitleSaveRef.current = false;
      return;
    }
    const currentDetail = detailRef.current;
    if (!currentDetail || pendingOperations.has('title')) return;
    const title = titleDraft.trim();
    if (!title) {
      cancelTitleEdit();
      return;
    }
    const editBase = titleEditBaseRef.current;
    if (!keepMyChanges && hasTaskEditConflict(editBase, currentDetail.task.version, currentDetail.task.title, title)) {
      setEditConflict('title');
      return;
    }
    if (title === currentDetail.task.title) {
      cancelTitleEdit();
      return;
    }
    if (await savePatch({ title }, 'title')) {
      titleEditBaseRef.current = null;
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

  const changePhase = useCallback(async (phase: TaskPhase) => {
    const currentDetail = detailRef.current;
    if (!currentDetail || phase === currentDetail.task.phase) return;
    if (currentDetail.task.phase === 'closed') {
      await execute({ type: 'reopen', phase: phase === 'closed' ? 'ready' : phase }, 'phase');
      return;
    }
    if (phase === 'closed') {
      await execute({ type: 'close', resolution: 'done' }, 'phase');
      return;
    }
    await execute({ type: 'move', phase }, 'phase');
  }, [execute]);

  const changePriority = useCallback((priority: TaskPriority) => {
    void savePatch({ priority }, 'priority');
  }, [savePatch]);

  const changeDueDate = useCallback((value: string) => {
    void savePatch({ dueAt: dueAtFromInput(value) }, 'dueAt');
  }, [savePatch]);

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

  const saveDependencies = useCallback(async (dependsOnTaskIds: string[]) => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return;
    setOperationPending('dependencies', true);
    setError(null);
    try {
      await mutateDetail(
        await updateTaskDependencies(taskId, dependsOnTaskIds, currentDetail.task.version),
        { revalidate: false },
      );
    } catch {
      setError(copy.dependencyUpdateFailed);
    } finally {
      setOperationPending('dependencies', false);
    }
  }, [copy.dependencyUpdateFailed, mutateDetail, setOperationPending, taskId]);

  const switchExecutor = useCallback(async (toAgentId: string) => {
    const currentDetail = detailRef.current;
    if (!currentDetail || !toAgentId || toAgentId === currentDetail.conversation.currentExecutorAgentId) return;
    setOperationPending('delegateAgentId', true);
    setError(null);
    try {
      await mutateDetail(await handoffTask(taskId, toAgentId, currentDetail.task.version), { revalidate: false });
    } catch {
      setError(copy.actionFailed);
    } finally {
      setOperationPending('delegateAgentId', false);
    }
  }, [copy.actionFailed, mutateDetail, setOperationPending, taskId]);

  const removeTask = useCallback(async () => {
    setOperationPending('delete', true);
    setError(null);
    try {
      await deleteTask(taskId);
      if (onDeleted) onDeleted();
      else navigate(returnPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.actionFailed);
    } finally {
      setOperationPending('delete', false);
    }
  }, [copy.actionFailed, navigate, onDeleted, returnPath, setOperationPending, taskId]);

  const reviewCriterion = useCallback(async (criterionIndex: number, status: 'passed' | 'failed') => {
    const currentDetail = detailRef.current;
    if (!currentDetail) return;
    setOperationPending('acceptance', true);
    setError(null);
    try {
      await mutateDetail(await reviewTaskCriterion(taskId, criterionIndex, status,
        currentDetail.task.version, currentDetail.task.latestContractVersion), { revalidate: false });
    } catch {
      setError(copy.actionFailed);
      await mutateDetail();
    } finally {
      setOperationPending('acceptance', false);
    }
  }, [copy.actionFailed, mutateDetail, setOperationPending, taskId]);

  useLayoutEffect(() => {
    if (presentation === 'modal') return;
    setPageHeader({
      startExtra: <Link to={returnPath} className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover" aria-label={copy.backToWork}><ArrowLeft className="size-4" /></Link>,
      main: detail ? <p className="truncate text-sm font-semibold text-fg">{projectName ? `${projectName} / ${copy.taskLabel}` : copy.taskLabel}</p> : null,
      end: null,
    });
    return clearPageHeader;
  }, [clearPageHeader, copy.backToWork, copy.taskLabel, detail, presentation, projectName, returnPath, setPageHeader]);

  if (loadError && !detail) return <div className={presentation === 'modal' ? 'p-5 text-sm text-danger' : 'mx-auto max-w-3xl p-6 text-sm text-danger'}>{copy.taskNotFound}</div>;
  if (!detail) return <div className={presentation === 'modal' ? 'p-5' : 'mx-auto max-w-4xl p-4 sm:p-6'}><DetailSkeleton /></div>;

  const activeWait = detail.waits[0];
  const criterionSummaries = summarizeTaskCriteria(detail);
  const allCriteriaPassed = criterionSummaries.length > 0 && criterionSummaries.every((criterion) => criterion.status === 'passed');
  const pausedWait = detail.waits.find((wait) => wait.kind === 'paused');
  const latestReceipt = detail.receipts[0];
  const statusKey = detailStatusKey(detail);
  const statusLabel = copy.detailStatuses[statusKey];
  const objective = detail.task.body?.trim() || detail.task.contract?.objective.trim();
  const canSchedule = detail.allowedCommands.includes('mark_ready');
  const canStart = detail.allowedCommands.includes('start');
  const canPause = detail.allowedCommands.includes('add_wait');
  const canApprove = !activeWait && allCriteriaPassed && detail.task.phase === 'review' && detail.allowedCommands.includes('close');
  const canReopen = detail.allowedCommands.includes('reopen');
  const conversationConversationId = detail.conversation.activeConversationId;
  const conversationAgentId = detail.conversation.currentExecutorAgentId
    ?? detail.task.delegateAgentId
    ?? detail.task.ownerId;
  const conversationAgent = agents.find((agent) => agent.id === conversationAgentId);
  const taskWorkspaceOpen = Boolean(
    conversationConversationId
    && workspacePanelOpen
    && workspacePanelConversationId === conversationConversationId,
  );
  const needsUserAttention = detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');
  const verifiedCriteriaCount = criterionSummaries.filter((criterion) => criterion.status === 'passed').length;
  const deliverables = detail.context.filter((item) => item.role === 'deliverable');
  const currentRunIds = new Set(detail.runs.filter((run) => run.contractVersion === detail.task.latestContractVersion).map((run) => run.id));
  const artifactEvidence = [...new Map(detail.receipts.filter((receipt) => currentRunIds.has(receipt.runId))
    .flatMap((receipt) => receipt.evidence.filter((item) => item.kind === 'artifact'))
    .map((item) => [item.uri ?? item.title, item])).values()];
  const referenceContext = detail.context.filter((item) => item.role !== 'deliverable');
  const workflowRuns = detail.runs.filter((run) => run.executorKind === 'workflow' && !run.parentRunId);
  const workflowIds = [...new Set(workflowRuns.map((run) => run.executorRef.workflowId).filter((id): id is string => typeof id === 'string'))];
  const linkedAutomations = automationList?.automations.filter((automation) => automation.action.kind === 'task_command' && automation.action.taskId === taskId) ?? [];
  const linkedSessions = detail.sessions.filter((session, index, sessions) => sessions.findIndex((entry) => entry.conversationId === session.conversationId) === index);
  const expectedOutputs = detail.task.contract?.expectedOutputs ?? [];
  const constraints = detail.task.contract?.constraints ?? [];
  const approvalRequired = detail.task.contract?.approvalRequired ?? [];
  const assumptions = detail.task.contract?.assumptions ?? [];
  const risks = detail.task.contract?.risks ?? [];
  const hasSupportingContext = constraints.length > 0 || approvalRequired.length > 0 || assumptions.length > 0 || risks.length > 0;
  const recentlyChanged = (...fields: TaskChangedEvent['changedFields']): boolean => Boolean(
    recentChange?.changedFields.some((field) => fields.includes(field)),
  );
  const canMovePhase = detail.allowedCommands.includes('move');
  const commandPending = pendingOperations.has('command');
  const deletePending = pendingOperations.has('delete');
  const activeRun = detail.runs.find((run) => !run.parentRunId && ['queued', 'running', 'waiting', 'verifying'].includes(run.status));
  const deleteBlocked = activeRun !== undefined;
  const automationHref = `/automations?action=create&taskId=${encodeURIComponent(detail.task.id)}${detail.task.projectId ? `&projectId=${encodeURIComponent(detail.task.projectId)}` : ''}`;
  const taskActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canSchedule ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'mark_ready' })}><Play className="size-4" />{copy.scheduleTask}</Button> : null}
      {pausedWait && detail.allowedCommands.includes('resolve_wait') ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'resolve_wait', waitId: pausedWait.id })}><Play className="size-4" />{copy.resumeTask}</Button> : null}
      {!activeWait && canStart && conversationAgentId ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'start', executor: { kind: 'agent', agentId: conversationAgentId } })}><Play className="size-4" />{copy.runTask}</Button> : null}
      {canApprove ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'close', resolution: 'done' })}><CircleCheck className="size-4" />{copy.approveTask}</Button> : null}
      {canReopen ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'reopen', phase: 'ready' })}><Play className="size-4" />{copy.reopenTask}</Button> : null}
      {!pausedWait && canPause ? <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" disabled={commandPending} onClick={() => void execute({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}><Pause className="size-4" />{copy.pauseTask}</Button> : null}
      {detail.task.phase !== 'closed' ? <Button asChild variant="ghost" className="min-h-9 px-3 py-1.5 text-xs"><Link to={automationHref}><CalendarClock className="size-4" />{copy.scheduleRecurringTask}</Link></Button> : null}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="ghost" className="size-9 p-0" disabled={commandPending || deletePending} aria-label={copy.moreActions}><MoreHorizontal className="size-4" aria-hidden /></Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-[100] min-w-44 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
            {activeRun ? (
              <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => {
                setOperationPending('command', true);
                setError(null);
                void mutateDetail(cancelTaskRun(taskId, activeRun.id, activeRun.version), { revalidate: false })
                  .catch(() => setError(copy.actionFailed))
                  .finally(() => setOperationPending('command', false));
              }}>{copy.cancelActiveRun}</DropdownMenu.Item>
            ) : null}
            {activeRun ? <DropdownMenu.Separator className="my-1 h-px bg-edge" /> : null}
            {detail.task.phase !== 'closed' ? (
              <>
                <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => void execute({ type: 'close', resolution: 'cancelled' })}>{copy.cancelTask}</DropdownMenu.Item>
                <DropdownMenu.Separator className="my-1 h-px bg-edge" />
              </>
            ) : null}
            <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => {
              if (deleteBlocked) {
                setError(copy.deleteActiveTaskBlocked);
                return;
              }
              setDeleteDialogOpen(true);
            }}>{copy.deleteTask}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );

  return (
    <div
      ref={splitPaneRef}
      className={`flex h-full min-h-0 flex-col overflow-hidden ${resizingPanels ? 'lg:cursor-col-resize lg:select-none' : ''}`}
      style={{ '--task-chat-panel-width': `${chatPanelPercent}%` } as CSSProperties}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <div className="task-detail-scroll flex min-w-0 shrink-0 flex-col lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto lg:overscroll-contain">
      <header className={cn('shrink-0 border-b border-edge-subtle bg-surface-panel px-5 py-4 sm:px-6', recentlyChanged('title') && 'task-detail-live-update')}>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              {projectName ? <span className="inline-flex items-center gap-1.5"><FolderKanban className="size-3.5" aria-hidden />{projectName}</span> : null}
              {projectName ? <span aria-hidden="true">/</span> : null}<span>{copy.taskLabel}</span>
              {recentChange ? (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-fg" role="status">
                  {recentChange.source === 'agent'
                    ? (language === 'zh' ? 'Agent 刚刚更新' : 'Updated by Agent')
                    : (language === 'zh' ? '执行结果已同步' : 'Execution result synced')}
                </span>
              ) : null}
            </div>
            {editingTitle ? (
              <textarea
                autoFocus
                data-task-inline-editor
                aria-label={language === 'zh' ? '任务标题' : 'Task title'}
                rows={2}
                value={titleDraft}
                onFocus={(event) => {
                  if (titleEditBaseRef.current?.value === titleDraft) {
                    event.currentTarget.setSelectionRange(0, 0);
                    event.currentTarget.scrollTop = 0;
                  }
                }}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelTitleEdit();
                  } else if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                className="mt-2 block max-h-56 min-h-14 w-full max-w-3xl resize-none overflow-y-auto bg-transparent p-0 text-xl font-semibold leading-7 text-fg outline-none [field-sizing:content]"
              />
            ) : (
              <h1 className="mt-2 max-w-3xl break-words text-xl font-semibold leading-7 text-fg">
                <button type="button" className="line-clamp-2 max-w-full rounded-sm text-left outline-none hover:bg-surface-hover/60 focus-visible:ring-2 focus-visible:ring-accent/40" title={detail.task.title} onClick={beginTitleEdit}>{detail.task.title}</button>
              </h1>
            )}
            {editConflict === 'title' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning" role="alert">
                <span>{language === 'zh' ? 'Agent 在你编辑期间更新了标题。' : 'The Agent updated the title while you were editing.'}</span>
                <button type="button" className="rounded-md bg-surface-hover px-2 py-1 text-fg" onClick={cancelTitleEdit}>{language === 'zh' ? '使用 Agent 版本' : 'Use Agent version'}</button>
                <button type="button" className="rounded-md bg-accent-soft px-2 py-1 text-accent-fg" disabled={pendingOperations.has('title')} onClick={() => void saveTitle(true)}>{language === 'zh' ? '保留我的修改' : 'Keep my changes'}</button>
              </div>
            ) : null}
          </div>
          <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', detailStatusTone(statusKey))}>{statusLabel}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
          <span className="inline-flex min-w-0 items-center gap-2">
            {conversationAgentId ? <AgentAvatarDisplay agentId={conversationAgentId} avatar={conversationAgent?.avatar} size={20} className="shrink-0" /> : null}
            <span className="truncate">{copy.executorLabel} · {conversationAgent?.name ?? conversationAgentId ?? copy.unassigned}</span>
          </span>
          <span className="text-fg-subtle">{copy.updatedAt.replace('{{date}}', formatMediumDateTime(detail.task.updatedAt, language))}</span>
        </div>
        <div className="mt-4 border-t border-edge-subtle pt-3">{taskActions}</div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </header>

      <section className="min-w-0 p-5 sm:p-6">

      <section className="mb-4 overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel shadow-surface">
        <div className="border-b border-edge-subtle p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">{language === 'zh' ? '目标与验收' : 'Goal and acceptance'}</h2>
            {criterionSummaries.length > 0 ? <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs text-fg-muted">{copy.criteriaProgress.replace('{{verified}}', String(verifiedCriteriaCount)).replace('{{total}}', String(criterionSummaries.length))}</span> : null}
          </div>
          <p className={cn('mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-fg', !objectiveExpanded && (detail.task.contract?.objective || detail.task.title).length > 280 && 'line-clamp-3')}>{detail.task.contract?.objective || detail.task.title}</p>
          {(detail.task.contract?.objective || detail.task.title).length > 280 ? <button type="button" className="mt-2 text-xs font-medium text-accent hover:underline" aria-expanded={objectiveExpanded} onClick={() => setObjectiveExpanded((current) => !current)}>{language === 'zh' ? (objectiveExpanded ? '收起目标' : '展开完整目标') : (objectiveExpanded ? 'Show less' : 'Show full goal')}</button> : null}
        </div>
        <div className="p-5">
          <h3 className="text-xs font-medium text-fg-muted">{copy.successDefinition}</h3>
          {criterionSummaries.length > 0 ? <ul className="mt-3 space-y-3">{criterionSummaries.map((criterion, index) => {
            const Icon = criterion.status === 'passed' ? CircleCheck : criterion.status === 'failed' ? CircleX : Circle;
            const tone = criterion.status === 'passed' ? 'text-success' : criterion.status === 'failed' ? 'text-danger' : 'text-fg-subtle';
            return <li key={`${index}-${criterion.text}`} className="flex items-start gap-2.5 text-sm leading-5 text-fg">
              <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p>{criterion.text}</p>
                {criterion.evidence.length > 0 ? <div className="mt-1 flex flex-wrap gap-x-2 text-xs leading-5 text-fg-muted"><span>{language === 'zh' ? '依据：' : 'Evidence:'}</span>{criterion.evidence.map((item) => item.uri && /^https?:\/\//.test(item.uri) ? <a key={item.title} className="text-accent hover:underline" href={item.uri} target="_blank" rel="noreferrer">{item.title}</a> : <span key={item.title}>{item.title}</span>)}</div> : null}
                {criterion.review ? <p className="mt-1 text-xs text-fg-muted">{language === 'zh' ? '人工判定' : 'Reviewed by user'} · {formatMediumDateTime(criterion.review.reviewedAt, language)}</p> : null}
              </div>
              {detail.task.phase !== 'closed' && detail.task.contract?.acceptancePolicy !== 'verified_auto' ? <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={pendingOperations.has('acceptance')}>{language === 'zh' ? '判定' : 'Review'}</Button></DropdownMenu.Trigger>
                <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} className="z-[100] min-w-32 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
                  <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => void reviewCriterion(index, 'passed')}>{language === 'zh' ? '确认通过' : 'Mark passed'}</DropdownMenu.Item>
                  <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => void reviewCriterion(index, 'failed')}>{language === 'zh' ? '标记未通过' : 'Mark failed'}</DropdownMenu.Item>
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root> : null}
            </li>;
          })}</ul> : <p className="mt-3 text-sm text-fg-muted">{copy.noDefinition}</p>}
        </div>
      </section>

      {detail.attention.length > 0 ? <section className={cn('mb-4 rounded-xl border border-warning/20 bg-warning/10 p-4', recentlyChanged('attention') && 'task-detail-live-update')}><h2 className="text-sm font-semibold text-fg">{needsUserAttention ? copy.needsAttention : copy.waitingStatus}</h2><ul className="mt-2 space-y-1.5 text-sm leading-6 text-fg-muted">{detail.attention.map((item, index) => <li key={`${item.kind}-${index}`} className="flex flex-wrap items-start justify-between gap-2"><span className="min-w-0 flex-1">{item.summary}</span>{item.kind === 'input_required' || item.kind === 'approval_required' ? <Link className="inline-flex min-h-11 items-center rounded-lg bg-surface-panel px-3 text-sm font-medium text-accent" to={taskChatHref(taskId)}>{language === 'zh' ? (item.kind === 'approval_required' ? '查看并决定' : '补充信息') : (item.kind === 'approval_required' ? 'Review decision' : 'Provide information')}</Link> : null}</li>)}</ul></section> : null}

      {detail.task.phase !== 'closed' && !pausedWait && detail.waits.filter(wait => (wait.kind === 'user_input' || (wait.kind === 'approval' && typeof wait.condition.capability === 'string')) && wait.condition.type !== 'connection').map(wait => <TaskInputCard key={wait.id} wait={wait} detail={detail} zh={language === 'zh'} onUpdated={updated => { void mutateDetail(updated, { revalidate: false }); }} />)}

      <div className="mb-4"><TaskCollaborationPanel key={taskId} taskId={taskId} /></div>

      {(deliverables.length > 0 || artifactEvidence.length > 0 || expectedOutputs.length > 0) ? <section className="mb-4 rounded-xl border border-edge-subtle bg-surface-panel p-5 shadow-surface">
        <h2 className="text-sm font-semibold text-fg">{language === 'zh' ? '交付物' : 'Deliverables'}</h2>
        {(deliverables.length > 0 || artifactEvidence.length > 0) ? <ul className="mt-3 space-y-2">{deliverables.map((item) => <li key={item.id} className="rounded-lg bg-surface-hover p-3 text-sm">
          <span className="block text-xs text-fg-muted">{copy.contextKindLabels[item.targetKind]}</span>
          {item.targetKind === 'url' && /^https?:\/\//.test(item.targetId) ? <a className="mt-1 block break-all text-accent hover:underline" href={item.targetId} target="_blank" rel="noreferrer">{item.title ?? item.targetId}</a> : <span className="mt-1 block break-words text-fg">{item.title ?? item.targetId}</span>}
        </li>)}{artifactEvidence.map((item) => <li key={item.uri ?? item.title} className="rounded-lg bg-surface-hover p-3 text-sm"><span className="block text-xs text-fg-muted">{language === 'zh' ? '执行产物' : 'Run artifact'}</span>{item.uri && /^https?:\/\//.test(item.uri) ? <a className="mt-1 block break-all text-accent hover:underline" href={item.uri} target="_blank" rel="noreferrer">{item.title}</a> : <span className="mt-1 block break-words text-fg">{item.title}</span>}</li>)}</ul> : <p className="mt-2 text-sm text-fg-muted">{language === 'zh' ? '尚未关联交付物' : 'No deliverables linked yet'}</p>}
        {expectedOutputs.length > 0 ? <div className="mt-4 border-t border-edge-subtle pt-3"><h3 className="text-xs font-medium text-fg-muted">{copy.expectedOutputs}</h3><div className="mt-2"><TextList items={expectedOutputs} empty={copy.noDefinition} /></div></div> : null}
      </section> : null}

      <section className="mb-4 rounded-xl border border-edge-subtle bg-surface-panel p-5 shadow-surface">
        <h2 className="text-sm font-semibold text-fg">{language === 'zh' ? '关联内容' : 'Related work'}</h2>
        {(linkedSessions.length > 0 || detail.runs.length > 0 || linkedAutomations.length > 0 || detail.dependencies.length > 0 || detail.dependents.length > 0) ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {linkedSessions.length > 0 ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{language === 'zh' ? `对话 · ${linkedSessions.length}` : `Conversations · ${linkedSessions.length}`}</h3><ul className="mt-2 space-y-1.5">{linkedSessions.slice(0, 3).map((session) => <li key={session.id}><Link className="block truncate text-sm text-accent hover:underline" to={session.conversationId === conversationConversationId ? taskChatHref(taskId) : `/chat/${encodeURIComponent(session.conversationId)}`}>{session.conversationId === conversationConversationId ? (language === 'zh' ? '当前执行对话' : 'Current execution chat') : session.role === 'discussion' ? (language === 'zh' ? '关联讨论' : 'Linked discussion') : (language === 'zh' ? '历史执行对话' : 'Earlier execution chat')}</Link></li>)}</ul></div> : null}
          {detail.runs.length > 0 ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{language === 'zh' ? `执行 · ${detail.runs.length}` : `Runs · ${detail.runs.length}`}</h3><p className="mt-2 text-sm text-fg">{language === 'zh' ? '最近执行：' : 'Latest run: '}{latestReceipt ? copy.receiptStatuses[latestReceipt.status] : statusLabel}</p>{workflowRuns.length > 0 ? <p className="mt-1 text-xs text-fg-muted">{language === 'zh' ? `含 ${workflowRuns.length} 次工作流执行` : `${workflowRuns.length} workflow runs`}</p> : null}{workflowIds.map((id) => <Link key={id} className="mt-1 block truncate text-xs text-accent hover:underline" to={`/workflows/${encodeURIComponent(id)}`}>{language === 'zh' ? '工作流：' : 'Workflow: '}{id}</Link>)}</div> : null}
          {linkedAutomations.length > 0 ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{language === 'zh' ? `自动化 · ${linkedAutomations.length}` : `Automations · ${linkedAutomations.length}`}</h3><ul className="mt-2 space-y-1.5">{linkedAutomations.slice(0, 3).map((automation) => <li key={automation.id}><Link className="block truncate text-sm text-accent hover:underline" to={`/automations?automation=${encodeURIComponent(automation.id)}`}>{automation.name}</Link></li>)}</ul></div> : null}
          {(detail.dependencies.length > 0 || detail.dependents.length > 0) ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{copy.taskRelations}</h3><p className="mt-2 text-sm text-fg">{language === 'zh' ? `${detail.dependencies.length} 个前置任务 · ${detail.dependents.length} 个后续任务` : `${detail.dependencies.length} prerequisites · ${detail.dependents.length} dependents`}</p></div> : null}
        </div> : <p className="mt-2 text-sm text-fg-muted">{language === 'zh' ? '还没有关联内容' : 'No related work yet'}</p>}
        <div className="mt-4 border-t border-edge-subtle pt-3"><PageContextCaptureButton resource={{ kind: 'task', id: detail.task.id, revision: String(detail.task.version) }} disabled={editingTitle || editingDescription || pendingOperations.size > 0} /></div>
      </section>

      <div className="flex flex-col gap-4">
        <main className="min-w-0 overflow-hidden rounded-xl bg-surface-panel shadow-surface divide-y divide-edge-subtle">
          <section className={cn('p-5', recentlyChanged('body') && 'task-detail-live-update')}>
            <h2 className="text-sm font-semibold text-fg">{copy.taskDescription}</h2>
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
              <div className="mt-2">
                {objective && objective !== detail.task.title
                  ? <MarkdownView content={objective} compact className="break-words text-sm leading-6 text-fg-muted" />
                  : <p className="text-sm leading-6 text-fg-muted">{copy.noTaskDescription}</p>}
                <button type="button" className="mt-2 rounded-md px-2 py-1 text-xs text-accent hover:bg-surface-hover focus-visible:bg-surface-hover" onClick={() => { const draft = detail.task.body ?? detail.task.contract?.objective ?? ''; initialDescriptionDraftRef.current = draft; descriptionEditBaseRef.current = { value: detail.task.body ?? '', version: detail.task.version }; setEditConflict(null); setDescriptionDraft(draft); setEditingDescription(true); }}>{language === 'zh' ? '编辑说明' : 'Edit description'}</button>
              </div>
            )}
            {editConflict === 'description' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning" role="alert">
                <span>{language === 'zh' ? 'Agent 在你编辑期间更新了描述。' : 'The Agent updated the description while you were editing.'}</span>
                <button type="button" className="rounded-md bg-surface-hover px-2 py-1 text-fg" onClick={() => { setDescriptionDraft(detail.task.body ?? ''); setEditConflict(null); setEditingDescription(false); }}>{language === 'zh' ? '使用 Agent 版本' : 'Use Agent version'}</button>
                <button type="button" className="rounded-md bg-accent-soft px-2 py-1 text-accent-fg" onClick={() => void savePatch({ body: descriptionDraft.trim() || null }).then((saved) => { if (saved) { setEditConflict(null); setEditingDescription(false); } })}>{language === 'zh' ? '保留我的修改' : 'Keep my changes'}</button>
              </div>
            ) : null}
          </section>

          {hasSupportingContext ? <section className={cn('p-5', recentlyChanged('contract') && 'task-detail-live-update')}>
            <h2 className="text-sm font-semibold text-fg">{copy.taskDefinition}</h2>
            <p className="mt-2 text-xs leading-5 text-fg-muted">{language === 'zh' ? '执行边界及补充背景' : 'Execution boundaries and supporting context'}</p>
            {constraints.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.constraints}</summary><div className="mt-3"><TextList items={constraints} empty={copy.noDefinition} /></div></details> : null}
            {approvalRequired.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.approvalRequired}</summary><div className="mt-3"><TextList items={approvalRequired} empty={copy.noDefinition} /></div></details> : null}
            {assumptions.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.contextAssumptions}</summary><div className="mt-3"><TextList items={assumptions} empty={copy.noDefinition} /></div></details> : null}
            {risks.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.contextRisks}</summary><div className="mt-3"><TextList items={risks} empty={copy.noDefinition} /></div></details> : null}
          </section> : null}

          {latestReceipt ? <section className={cn('p-5', recentlyChanged('runs', 'receipts') && 'task-detail-live-update')}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-fg">{copy.latestResult}</h2><p className="mt-1 text-xs text-fg-muted">{language === 'zh' ? (latestReceipt.completionVerdict === 'achieved' ? '本次执行报告目标已达成，请结合下方验证依据验收。' : '这是阶段性结果，尚不能代表任务全部完成。') : (latestReceipt.completionVerdict === 'achieved' ? 'The run reports the goal achieved. Review the evidence below.' : 'This is a partial result; the task is not yet fully complete.')}</p><MarkdownView content={latestReceipt.summary} compact className="mt-2 text-sm leading-6 text-fg" /></div><span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs text-fg-muted">{copy.receiptStatuses[latestReceipt.status]} · {copy.verificationStatuses[latestReceipt.verification.status]}</span></div>{latestReceipt.remainingWork.length > 0 ? <div className="mt-4"><h3 className="text-xs font-medium text-fg-muted">{copy.remainingWork}</h3><div className="mt-2"><TextList items={latestReceipt.remainingWork} empty={copy.noRemainingWork} /></div></div> : null}{latestReceipt.nextAction ? <div className="mt-4 rounded-lg bg-surface-hover p-3"><p className="text-xs font-medium text-fg-muted">{copy.nextAction}</p><p className="mt-1 text-sm text-fg">{latestReceipt.nextAction}</p></div> : null}<div className="mt-4 flex flex-wrap items-center gap-2"><Button className="border-0 bg-surface-hover px-2 py-1 text-xs shadow-none" variant="secondary" onClick={() => void submitTaskFeedback(latestReceipt.runId, 'helpful')}>{copy.doneWell}</Button><Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => void submitTaskFeedback(latestReceipt.runId, 'not_helpful')}>{copy.needsFix}</Button></div><TaskResultEvidence evidence={latestReceipt.evidence} projectId={detail.task.projectId} conversationId={conversationConversationId ?? undefined} language={language} />{detail.receipts.length > 1 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.executionHistory.replace('{{count}}', String(detail.receipts.length - 1))}</summary><div className="mt-3 space-y-3">{detail.receipts.slice(1).map((receipt) => <article key={receipt.runId} className="rounded-lg bg-surface-hover p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm text-fg">{receipt.summary}</p><span className="shrink-0 text-xs text-fg-subtle">{copy.receiptStatuses[receipt.status]}</span></div></article>)}</div></details> : null}</section> : null}

          {referenceContext.length > 0 ? <section className={cn('p-5', recentlyChanged('context') && 'task-detail-live-update')}><h2 className="text-sm font-semibold text-fg">{copy.contextUsed}</h2><ul className="mt-4 grid gap-2 sm:grid-cols-2">{referenceContext.map((item) => <li key={item.id} className="min-w-0 rounded-lg bg-surface-hover p-2.5"><span className="text-[11px] text-fg-subtle">{copy.contextRoleLabels[item.role]} · {copy.contextKindLabels[item.targetKind]}</span>{item.targetKind === 'url' && /^https?:\/\//.test(item.targetId) ? <a className="mt-1 block break-all text-sm text-accent hover:underline" href={item.targetId} target="_blank" rel="noreferrer">{item.title ?? item.targetId}</a> : <p className="mt-1 break-words text-sm text-fg">{item.title ?? item.targetId}</p>}</li>)}</ul></section> : null}
        </main>

        <aside className="min-w-0 overflow-hidden rounded-xl bg-surface-panel shadow-surface divide-y divide-edge-subtle">
          <section className={cn('p-5', recentlyChanged('phase', 'resolution', 'priority', 'dueAt', 'delegateAgentId') && 'task-detail-live-update')}>
            <h2 className="text-sm font-semibold text-fg">{copy.taskProperties}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <TaskPhaseField value={detail.task.phase} disabled={pendingOperations.has('phase')} canMove={canMovePhase} canApprove={canApprove} canReopen={canReopen} language={language} label={copy.taskPhase} onChange={changePhase} />
              <TaskPriorityField value={detail.task.priority} disabled={pendingOperations.has('priority')} label={copy.priority} labels={copy.priorityLabels} onChange={changePriority} />
              <TaskDueDateField value={dateInputValue(detail.task.dueAt)} disabled={pendingOperations.has('dueAt')} label={copy.dueDate} onChange={changeDueDate} />
              <TaskExecutorField value={detail.conversation.currentExecutorAgentId ?? ''} disabled={pendingOperations.has('delegateAgentId')} label={copy.executorLabel} unassignedLabel={copy.unassigned} agents={agents} onChange={switchExecutor} />
            </div>
          </section>

          <section className={cn('p-5', recentlyChanged('dependencies') && 'task-detail-live-update')}>
            <h2 className="text-sm font-semibold text-fg">{copy.taskRelations}</h2>
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-xs text-fg-muted">{copy.dependencies}</p>
                <TaskDependenciesField candidates={dependencyCandidates} selected={detail.dependencies} disabled={pendingOperations.has('dependencies')} labels={dependencyPickerLabels} getTaskHref={taskHref} onChange={saveDependencies} />
              </div>
              <div><p className="mb-2 text-xs text-fg-muted">{copy.dependents}</p>{detail.dependents.length > 0 ? <div className="space-y-1.5">{detail.dependents.map((task) => <Link key={task.id} to={taskHref(task.id)} className="block rounded-lg bg-surface-hover p-2.5 text-sm text-fg-muted transition-colors hover:text-fg">{task.title}</Link>)}</div> : <p className="text-sm text-fg-subtle">{copy.noDependents}</p>}</div>
            </div>
          </section>
        </aside>
      </div>
      </section>
      </div>

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
        <div className="w-px bg-edge-strong/70 transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>

      <aside className="flex min-h-[34rem] min-w-0 shrink-0 flex-col border-t border-edge-subtle bg-surface-panel lg:min-h-0 lg:w-[var(--task-chat-panel-width)] lg:border-t-0">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge-subtle px-4 py-3">
          <h2 className="text-sm font-medium text-fg-muted">{language === 'zh' ? '执行对话' : 'Execution chat'}</h2>
          <div className="flex items-center gap-1">
          {linkedSessions.length > 1 ? <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className="h-8 px-2 text-xs">{language === 'zh' ? `${linkedSessions.length} 段对话` : `${linkedSessions.length} conversations`}</Button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-[100] min-w-52 rounded-lg border border-edge bg-surface-panel p-1 shadow-popover">
              {linkedSessions.map((session) => <DropdownMenu.Item key={session.id} asChild><Link className="block rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover" to={session.conversationId === conversationConversationId ? taskChatHref(taskId) : `/chat/${encodeURIComponent(session.conversationId)}`}>{session.conversationId === conversationConversationId ? (language === 'zh' ? '当前执行对话' : 'Current execution chat') : session.role === 'discussion' ? (language === 'zh' ? '关联讨论' : 'Linked discussion') : (language === 'zh' ? '历史执行对话' : 'Earlier execution chat')}</Link></DropdownMenu.Item>)}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root> : null}
          {conversationConversationId ? <>
            <Button type="button" variant="ghost" className={cn('size-8 p-0', taskWorkspaceOpen && 'bg-surface-hover text-fg')} aria-label={language === 'zh' ? '项目文件' : 'Project files'} aria-pressed={taskWorkspaceOpen} onClick={() => { setSideChatOpen(conversationConversationId, false); openWorkspacePanelForSession(conversationConversationId); }}><FolderOpen className="size-4" aria-hidden /></Button>
            <Button asChild variant="ghost" className="size-8 p-0"><Link to={taskChatHref(taskId)} aria-label={language === 'zh' ? '全屏打开对话' : 'Open chat full screen'}><ExternalLink className="size-4" aria-hidden /></Link></Button>
          </> : null}
          </div>
        </div>
        {conversationConversationId ? (
          <div className="min-h-0 flex-1"><ChatPage embedded conversationId={conversationConversationId} taskId={taskId} /></div>
        ) : conversationLoading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-xs"><MessageSquare className="mx-auto size-8 animate-pulse text-fg-subtle" /><p className="mt-3 text-sm font-medium text-fg">{language === 'zh' ? '正在创建任务会话' : 'Creating task conversation'}</p></div>
          </div>
        ) : conversationError ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-xs"><MessageSquare className="mx-auto size-8 text-danger" /><p className="mt-3 text-sm font-medium text-fg">{language === 'zh' ? '任务会话创建失败' : 'Could not create task conversation'}</p><p className="mt-2 text-xs leading-5 text-fg-muted">{conversationError instanceof Error ? conversationError.message : String(conversationError)}</p></div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-xs"><MessageSquare className="mx-auto size-8 text-fg-subtle" /><p className="mt-3 text-sm font-medium text-fg">{language === 'zh' ? '等待任务会话' : 'Waiting for a task conversation'}</p><p className="mt-2 text-xs leading-5 text-fg-muted">{language === 'zh' ? '安排或开始任务后，Agent 的执行过程和持续对话会显示在这里。' : 'Schedule or start the task to see the agent run and continue the conversation here.'}</p></div>
          </div>
        )}
      </aside>
      </div>
      <ConfirmDialog
        open={deleteDialogOpen}
        title={copy.deleteTaskTitle}
        description={copy.deleteTaskDescription.replace('{{title}}', detail.task.title)}
        confirmLabel={copy.confirmDeleteTask}
        cancelLabel={copy.keepTask}
        destructive
        onConfirm={() => {
          setDeleteDialogOpen(false);
          void removeTask();
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
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
  const workspaceConversationId = useWorkspacePanelStore((state) => state.conversationIdOverride);
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
          className="xopc-dialog-content task-detail-modal-content fixed top-1/2 z-[90] flex h-[min(54rem,calc(100dvh-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay focus:outline-none"
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
            <div className="flex shrink-0 items-center gap-1">
              <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={language === 'zh' ? '关闭任务详情' : 'Close task details'}><X className="size-4" aria-hidden /></Dialog.Close>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TaskDetailView taskId={taskId} presentation="modal" backgroundPath={backgroundPath} onDeleted={() => {
              setPreviewPath(null);
              onClose();
            }} />
          </div>
        </Dialog.Content>
        {previewPath ? (
          <div
            className="fixed inset-y-0 left-0 z-[100] flex min-h-0 min-w-0 overflow-hidden bg-surface-panel transition-[right] duration-200 ease-out motion-reduce:transition-none"
            style={{ right: workspacePanelOpen ? workspacePanelWidth : 0 }}
          >
            <WorkspacePreviewPane
              allowOutsideChat
              conversationId={workspaceConversationId ?? undefined}
            />
          </div>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
