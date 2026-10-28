import { TaskAcceptancePanel } from '@/features/tasks/task-acceptance-panel';
import { TaskDeliverySummary } from '@/features/tasks/task-delivery-summary';
import { TaskDetailDisclosure, setTaskPanelOpen } from '@/features/tasks/task-detail-disclosure';
import { TaskExecutionReport } from '@/features/tasks/task-execution-report';
import { taskDescriptionForDisplay, preserveTaskExecutionInstructions } from '@xopcai/gateway-contract';
import { TaskPhaseHistory } from '@/features/tasks/task-phase-history';
import { TaskSchedulePanel } from '@/features/tasks/task-schedule-panel';
import { TaskScheduleDialog } from '@/features/tasks/task-schedule-dialog';
import { TaskCurrentAction } from '@/features/tasks/task-current-action';
import type { TaskChangedEvent, TaskCommand, TaskPatchRequest, TaskPhase, TaskPriority } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, CalendarClock, Circle, ExternalLink, FolderKanban, FolderOpen, MessageSquare, MoreHorizontal, Play, Pause, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { TaskExpandableContent } from '@/features/tasks/task-expandable-content';
import { TaskExpandableList } from '@/features/tasks/task-expandable-list';
import { automationApi, type Automation } from '@/features/automations/automation-api';
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
import { cancelTaskRun, commandTask, deleteTask, handoffTask, reviewTaskCriterion, updateTask, updateTaskDependencies, type TaskDetail } from '@/features/tasks/home-api';
import { TaskCollaborationPanel } from '@/features/tasks/task-collaboration-panel';
import { taskCopy } from '@/features/tasks/task-copy';
import { currentTaskReceipt, detailStatusKey, detailStatusTone, summarizeTaskCriteria } from '@/features/tasks/task-detail-summary';
import { hasTaskEditConflict, optimisticallyPatchTask, type TaskEditBase } from '@/features/tasks/task-detail-sync';
import { useTaskDetail } from '@/features/tasks/use-task-detail';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { cn } from '@/lib/cn';
import { safeInternalReturnPath, withReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

function phaseLabel(phase: TaskPhase, language: 'en' | 'zh'): string {
  const labels = language === 'zh'
    ? { backlog: '待规划', ready: '就绪', active: '进行中', review: '待验收', closed: '已关闭' }
    : { backlog: 'Backlog', ready: 'Ready', active: 'Active', review: 'Review', closed: 'Closed' };
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
    !canMove && !(phase === 'closed' ? canApprove : value === 'closed' && canReopen)
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


type TaskEditConflict = 'title' | 'description' | null;
type TaskPendingOperation = 'command' | 'phase' | 'priority' | 'dueAt' | 'delegateAgentId' | 'dependencies' | 'acceptance' | 'delete' | 'title';

function TextList({ items, empty, contentKey }: {
  items: string[];
  empty: string;
  contentKey: string;
}) {
  const language = useLocaleStore((state) => state.language);
  if (items.length === 0) return <p className="text-sm leading-6 text-fg-muted">{empty}</p>;
  return <TaskExpandableContent content={items.join('\n')} contentKey={contentKey} language={language} previewHeight={144}><ul className="space-y-2">{items.map((item) => {
    return <li key={item} className="flex gap-2 text-sm leading-6 text-fg"><Circle className="mt-1 size-4 shrink-0 text-fg-subtle" /><span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item}</span></li>;
  })}</ul></TaskExpandableContent>;
}

function TaskDetailView({ taskId, presentation, backgroundPath, onDeleted }: {
  taskId: string;
  presentation: 'page' | 'modal';
  backgroundPath?: string;
  onDeleted?: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const token = useGatewayStore((state) => state.conversationId);
  const copy = useMemo(() => taskCopy(language), [language]);
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const workspacePanes = useRightWorkspaceStore((state) => state.panes);
  const openWorkspacePanelForSession = useWorkspacePanelStore((state) => state.openForSession);
  const {
    data: detail,
    error: loadError,
    mutate: mutateDetail,
    lastChange,
    conversationLoading,
    conversationError,
  } = useTaskDetail(taskId);
  const { data: automationList, error: automationListError, mutate: mutateAutomations } = useSWR(taskId ? ['task-detail-automations', token] : null, () => automationApi.list(), { refreshInterval: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [acceptanceError, setAcceptanceError] = useState<string | null>(null);
  const [pendingOperations, setPendingOperations] = useState<ReadonlySet<TaskPendingOperation>>(() => new Set());
  const [dependencyCandidates, setDependencyCandidates] = useState<DependencyCandidate[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [agents, setAgents] = useState<ChatAgentOption[]>([]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [chatPanelPercent, setChatPanelPercent] = useState(readTaskChatPanelPercent);
  const [resizingPanels, setResizingPanels] = useState(false);
  const acceptanceRef = useRef<HTMLDetailsElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
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
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Automation | null>(null);
  const schedulePanelRef = useRef<HTMLDetailsElement>(null);
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
    setAcceptanceError(null);
    setEditConflict(null);
    setEditingTitle(false);
    titleEditBaseRef.current = null;
    setEditingDescription(false);
    setRecentChange(null);
    setDeleteDialogOpen(false);
    setScheduleDialogOpen(false);
    setEditingSchedule(null);
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
    if (command.type === 'close' && command.resolution === 'done') setAcceptanceError(null);
    try {
      await mutateDetail(await commandTask(taskId, command, currentDetail.task.version), { revalidate: false });
    } catch {
      setError(copy.actionFailed);
      if (command.type === 'close' && command.resolution === 'done') setAcceptanceError(copy.actionFailed);
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
    if (await savePatch({ body: preserveTaskExecutionInstructions(detail.task.body ?? '', body) || null })) {
      setEditConflict(null);
      setEditingDescription(false);
    }
  };

  const changePhase = useCallback(async (phase: TaskPhase) => {
    const currentDetail = detailRef.current;
    if (!currentDetail || phase === currentDetail.task.phase) return;
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
    if (!currentDetail) return false;
    setOperationPending('acceptance', true);
    setAcceptanceError(null);
    setError(null);
    try {
      await mutateDetail(await reviewTaskCriterion(taskId, criterionIndex, status,
        currentDetail.task.version, currentDetail.task.latestContractVersion), { revalidate: false });
      return true;
    } catch {
      setAcceptanceError(copy.actionFailed);
      setError(copy.actionFailed);
      void mutateDetail().catch(() => undefined);
      return false;
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
  const activeRun = detail.runs.find((run) => !run.parentRunId && ['queued', 'running', 'waiting', 'verifying'].includes(run.status));
  const criterionSummaries = summarizeTaskCriteria(detail);
  const allCriteriaPassed = criterionSummaries.length > 0 && criterionSummaries.every((criterion) => criterion.status === 'passed');
  const pausedWait = detail.waits.find((wait) => wait.kind === 'paused');
  const latestReceipt = currentTaskReceipt(detail);
  const statusKey = detailStatusKey(detail);
  const statusLabel = copy.detailStatuses[statusKey];
  const objective = taskDescriptionForDisplay(detail.task.body?.trim() || detail.task.contract?.objective.trim() || '');
  const canSchedule = detail.allowedCommands.includes('mark_ready');
  const canStart = detail.allowedCommands.includes('start');
  const canPause = detail.allowedCommands.includes('add_wait');
  const canApprove = !activeWait && !activeRun && allCriteriaPassed && detail.task.phase === 'review' && detail.allowedCommands.includes('close');
  const canReopen = detail.allowedCommands.includes('reopen');
  const conversationConversationId = detail.conversation.activeConversationId;
  const conversationAgentId = detail.conversation.currentExecutorAgentId
    ?? detail.task.delegateAgentId
    ?? detail.task.ownerId;
  const conversationAgent = agents.find((agent) => agent.id === conversationAgentId);
  const taskWorkspaceOpen = Boolean(
    conversationConversationId
    && workspacePanes[conversationConversationId]?.open,
  );
  const referenceContext = detail.context.filter((item) => item.role !== 'deliverable');
  const linkedAutomations = automationList?.automations.filter((automation) => automation.action.kind === 'task_command' && automation.action.taskId === taskId) ?? [];
  const taskSchedules = linkedAutomations.filter((automation) => automation.trigger.kind === 'schedule' && automation.action.kind === 'task_command' && automation.action.command.type === 'start');
  const nextScheduledRun = taskSchedules.filter((item) => item.enabled && item.state.nextRunAtMs !== undefined)
    .map((item) => item.state.nextRunAtMs!)
    .sort((left, right) => left - right)[0];
  const saveScheduledAutomation = (automation: Automation) => {
    void mutateAutomations((current) => ({ automations: [automation, ...(current?.automations ?? []).filter((item) => item.id !== automation.id)] }), { revalidate: false });
  };
  const editSchedule = (automation: Automation) => {
    setEditingSchedule(automation);
    setScheduleDialogOpen(true);
  };
  const openSchedule = () => {
    if (!automationList) return;
    if (taskSchedules.length === 1) editSchedule(taskSchedules[0]);
    else if (taskSchedules.length > 1) {
      if (schedulePanelRef.current) schedulePanelRef.current.open = true;
      setSearchParams((current) => setTaskPanelOpen(current, 'schedule', true), { preventScrollReset: true });
      schedulePanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      schedulePanelRef.current?.focus({ preventScroll: true });
    } else {
      setEditingSchedule(null);
      setScheduleDialogOpen(true);
    }
  };
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
  const deleteBlocked = activeRun !== undefined;

  const openAcceptance = () => {
    const panel = acceptanceRef.current;
    if (!panel) return;
    panel.open = true;
    setSearchParams((current) => setTaskPanelOpen(current, 'acceptance', true), { preventScrollReset: true });
    panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    panel.focus({ preventScroll: true });
  };
  const taskActions = (
    <div className="flex flex-wrap items-center gap-2">
      {canSchedule && !canStart && !activeWait && detail.task.phase !== 'review' ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'mark_ready' })}><Play className="size-4" />{copy.scheduleTask}</Button> : null}
      {pausedWait && detail.allowedCommands.includes('resolve_wait') ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'resolve_wait', waitId: pausedWait.id })}><Play className="size-4" />{copy.resumeTask}</Button> : null}
      {!activeWait && canStart && detail.task.phase !== 'review' && conversationAgentId ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="primary" disabled={commandPending} onClick={() => void execute({ type: 'start', executor: { kind: 'agent', agentId: conversationAgentId } })}><Play className="size-4" />{copy.runTask}</Button> : null}
      {canReopen ? <Button className="min-h-9 px-3 py-1.5 text-xs" variant="ghost" disabled={commandPending} onClick={() => void execute({ type: 'reopen', phase: 'ready' })}><Play className="size-4" />{copy.reopenTask}</Button> : null}
      {detail.task.phase !== 'review' && !pausedWait && canPause ? <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" disabled={commandPending} onClick={() => void execute({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}><Pause className="size-4" />{copy.pauseTask}</Button> : null}
      {detail.task.phase === 'closed' ? <Button variant="primary" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => { resultsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); resultsRef.current?.focus({ preventScroll: true }); }}>{language === 'zh' ? '查看结果' : 'View results'}</Button> : null}
      {!activeWait && !activeRun && detail.task.phase !== 'closed' && detail.task.phase !== 'review' ? <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" disabled={!automationList} onClick={openSchedule}><CalendarClock className="size-4" />{taskSchedules.length > 0 ? (language === 'zh' ? '管理执行时间' : 'Manage schedule') : (language === 'zh' ? '设置执行时间' : 'Set execution time')}</Button> : null}
      {detail.task.phase === 'review' ? <Button variant="primary" className="min-h-9 px-3 py-1.5 text-xs" onClick={openAcceptance}>{language === 'zh' ? '去验收' : 'Review results'}</Button> : null}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button type="button" variant="ghost" className="size-9 p-0" disabled={commandPending || deletePending} aria-label={copy.moreActions}><MoreHorizontal className="size-4" aria-hidden /></Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-[100] min-w-44 rounded-lg border border-edge bg-surface-overlay p-1 shadow-popover">
            {detail.task.phase === 'review' && !pausedWait && canPause ? <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover" onSelect={() => void execute({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}>{copy.pauseTask}</DropdownMenu.Item> : null}
            {detail.task.phase === 'review' && !activeWait && !activeRun ? <DropdownMenu.Item disabled={!automationList} className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover data-[disabled]:opacity-50" onSelect={openSchedule}>{taskSchedules.length > 0 ? (language === 'zh' ? '管理执行时间' : 'Manage schedule') : (language === 'zh' ? '设置执行时间' : 'Set execution time')}</DropdownMenu.Item> : null}
            {detail.task.phase === 'review' && !activeWait && canStart && conversationAgentId ? <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover" onSelect={() => void execute({ type: 'start', executor: { kind: 'agent', agentId: conversationAgentId } })}>{copy.runTask}</DropdownMenu.Item> : null}
            {canSchedule && (canStart || activeWait || detail.task.phase === 'review') ? <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg outline-none focus:bg-surface-hover" onSelect={() => void execute({ type: 'mark_ready' })}>{copy.scheduleTask}</DropdownMenu.Item> : null}
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
              <TaskExpandableContent content={detail.task.title} contentKey={`${taskId}:title`} language={language} previewHeight={56} className="mt-2 max-w-3xl">
                <h1 className="break-words text-xl font-semibold leading-7 text-fg">
                  <button type="button" className="max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-sm text-left outline-none hover:bg-surface-hover/60 focus-visible:ring-2 focus-visible:ring-accent/40" title={detail.task.title} onClick={beginTitleEdit}>{detail.task.title}</button>
                </h1>
              </TaskExpandableContent>
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
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{copy.executorLabel} · {conversationAgent?.name ?? conversationAgentId ?? copy.unassigned}</span>
          </span>
          <span className="text-fg-subtle">{copy.updatedAt.replace('{{date}}', formatMediumDateTime(detail.task.updatedAt, language))}</span>
        </div>

      </header>
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge-subtle bg-surface-panel px-4 py-2 sm:px-5" aria-label={language === 'zh' ? '任务操作' : 'Task actions'}>
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{detail.task.title} · {statusLabel}</span>
        {taskActions}
        {error ? <p role="alert" className="basis-full text-sm text-danger">{error}</p> : null}
      </div>

      <section className="min-w-0 space-y-4 p-4 sm:p-5">
        {detail.task.phase !== 'review' ? <TaskCurrentAction detail={detail} language={language} onUpdated={(updated) => { void mutateDetail(updated, { revalidate: false }); }} /> : null}
        <section ref={resultsRef} tabIndex={-1} aria-labelledby="task-results-heading" className="scroll-mt-24 space-y-4">
          <TaskDeliverySummary detail={detail} language={language} />
          {detail.task.phase === 'review' && (detail.waits.length > 0 || detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required')) ? <TaskCurrentAction detail={detail} language={language} onUpdated={(updated) => { void mutateDetail(updated, { revalidate: false }); }} /> : null}
          <TaskDetailDisclosure panelId="acceptance" defaultOpen={detail.task.phase === 'review' || Boolean(latestReceipt)} ref={acceptanceRef} tabIndex={-1} aria-label={copy.successDefinition} className="scroll-mt-24 overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel" summaryClassName="cursor-pointer p-4 text-sm font-medium text-fg" title={<>{language === 'zh' ? '验收' : 'Acceptance'} · {criterionSummaries.filter((criterion) => criterion.status === 'passed').length}/{criterionSummaries.length}</>}>
            <div className="px-4 pb-4">
              <TaskAcceptancePanel key={`${taskId}:${detail.task.latestContractVersion}`} criteria={criterionSummaries} language={language} closed={detail.task.phase === 'closed'} pending={pendingOperations.has('acceptance')} completionPending={commandPending} canComplete={canApprove} error={acceptanceError}
                blockedReason={activeWait ? (language === 'zh' ? '请先处理待办事项' : 'Resolve the pending request first')
                  : activeRun ? (language === 'zh' ? '请等待当前执行结束' : 'Wait for the current run to finish')
                  : !allCriteriaPassed ? (criterionSummaries.length === 0 ? (language === 'zh' ? '请先定义验收标准' : 'Define acceptance criteria first') : (language === 'zh' ? `还有 ${criterionSummaries.filter((item) => item.status !== 'passed').length} 项待验收` : `${criterionSummaries.filter((item) => item.status !== 'passed').length} criteria need review`))
                  : (language === 'zh' ? '任务尚未进入可完成状态' : 'The task is not ready for completion')}
                onReview={reviewCriterion} onComplete={() => void execute({ type: 'close', resolution: 'done' })} projectId={detail.task.projectId} conversationId={conversationConversationId ?? undefined} />
            </div>
          </TaskDetailDisclosure>
        </section>

        <TaskDetailDisclosure panelId="report" className="rounded-xl border border-edge-subtle bg-surface-panel p-4" summaryClassName="cursor-pointer text-sm font-medium text-fg" title={language === 'zh' ? '完整执行报告' : 'Full execution report'}>
          <TaskExecutionReport key={latestReceipt?.runId ?? taskId} detail={detail} language={language} />
        </TaskDetailDisclosure>
        {!automationList && !automationListError ? <Skeleton className="h-9 rounded-lg" /> : null}
        {automationListError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger"><span>{language === 'zh' ? '无法读取执行计划，请重试后再设置时间。' : 'Could not load schedules. Retry before setting a time.'}</span><Button variant="ghost" onClick={() => void mutateAutomations()}>{language === 'zh' ? '重试' : 'Retry'}</Button></div> : null}
        {taskSchedules.length > 0 ? <TaskDetailDisclosure panelId="schedule" ref={schedulePanelRef} tabIndex={-1} className="scroll-mt-24 rounded-xl border border-edge-subtle bg-surface-panel p-4" summaryClassName="cursor-pointer text-sm text-fg-muted" title={<>{language === 'zh' ? '执行时间' : 'Execution schedule'} · {taskSchedules.length}{nextScheduledRun !== undefined ? ` · ${language === 'zh' ? '下次执行：' : 'Next run: '}${formatMediumDateTime(nextScheduledRun, language)}` : ''}</>}>
          <div className="mt-3"><TaskSchedulePanel schedules={taskSchedules} language={language} onEdit={editSchedule} onUpdated={saveScheduledAutomation} /></div>
        </TaskDetailDisclosure> : null}

        <TaskDetailDisclosure panelId="goal" className="rounded-xl border border-edge-subtle bg-surface-panel p-4" summaryClassName="cursor-pointer text-sm font-medium text-fg" title={language === 'zh' ? '任务目标与说明' : 'Task goal and description'}>
          <div className="mt-3">
        <section className="overflow-hidden rounded-xl border border-edge-subtle bg-surface-panel divide-y divide-edge-subtle">
        <div className="border-b border-edge-subtle p-5">
<h2 className="text-sm font-semibold text-fg">{language === 'zh' ? '任务目标' : 'Task goal'}</h2>
          <TaskExpandableContent content={detail.task.contract?.objective || detail.task.title} contentKey={`${taskId}:goal`} language={language} markdown={false} previewHeight={72} className="mt-3 text-sm leading-6 text-fg" />
          <Button variant="ghost" className="mt-2 min-h-9 px-2 text-xs" onClick={openAcceptance}>{copy.successDefinition} · {criterionSummaries.length}</Button>
        </div>
        {expectedOutputs.length > 0 ? <div className="p-5"><h3 className="text-xs font-medium text-fg-muted">{copy.expectedOutputs}</h3><div className="mt-2"><TextList contentKey={`${taskId}:expectedOutputs`} items={expectedOutputs} empty={copy.noDefinition} /></div></div> : null}
          <details className={cn('p-5', recentlyChanged('body') && 'task-detail-live-update')}>
            <summary className="cursor-pointer text-sm font-semibold text-fg">{copy.taskDescription}</summary>
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
                    setDescriptionDraft(taskDescriptionForDisplay(detail.task.body ?? detail.task.contract?.objective ?? ''));
                    setEditingDescription(false);
                    queueMicrotask(() => { skipDescriptionSaveRef.current = false; });
                  }
                }}
                className="mt-3 w-full resize-y rounded-lg bg-surface-hover px-3 py-2 text-sm leading-6 text-fg outline-none ring-2 ring-accent/20 focus:ring-accent/50"
              />
            ) : (
              <div className="mt-2">
                {objective && objective !== detail.task.title
                  ? <TaskExpandableContent content={objective} contentKey={`${taskId}:description`} language={language} />
                  : <p className="text-sm leading-6 text-fg-muted">{copy.noTaskDescription}</p>}
                <button type="button" className="mt-2 rounded-md px-2 py-1 text-xs text-accent hover:bg-surface-hover focus-visible:bg-surface-hover" onClick={() => { const draft = taskDescriptionForDisplay(detail.task.body ?? detail.task.contract?.objective ?? ''); initialDescriptionDraftRef.current = draft; descriptionEditBaseRef.current = { value: detail.task.body ?? '', version: detail.task.version }; setEditConflict(null); setDescriptionDraft(draft); setEditingDescription(true); }}>{language === 'zh' ? '编辑说明' : 'Edit description'}</button>
              </div>
            )}
            {editConflict === 'description' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warning" role="alert">
                <span>{language === 'zh' ? 'Agent 在你编辑期间更新了描述。' : 'The Agent updated the description while you were editing.'}</span>
                <button type="button" className="rounded-md bg-surface-hover px-2 py-1 text-fg" onClick={() => { setDescriptionDraft(taskDescriptionForDisplay(detail.task.body ?? '')); setEditConflict(null); setEditingDescription(false); }}>{language === 'zh' ? '使用 Agent 版本' : 'Use Agent version'}</button>
                <button type="button" className="rounded-md bg-accent-soft px-2 py-1 text-accent-fg" onClick={() => void savePatch({ body: preserveTaskExecutionInstructions(detail.task.body ?? '', descriptionDraft.trim()) || null }).then((saved) => { if (saved) { setEditConflict(null); setEditingDescription(false); } })}>{language === 'zh' ? '保留我的修改' : 'Keep my changes'}</button>
              </div>
            ) : null}
          </details>

          {hasSupportingContext ? <section className={cn('p-5', recentlyChanged('contract') && 'task-detail-live-update')}>
            <h2 className="text-sm font-semibold text-fg">{copy.taskDefinition}</h2>
            <p className="mt-2 text-xs leading-5 text-fg-muted">{language === 'zh' ? '执行边界及补充背景' : 'Execution boundaries and supporting context'}</p>
            {constraints.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.constraints}</summary><div className="mt-3"><TextList contentKey={`${taskId}:constraints`} items={constraints} empty={copy.noDefinition} /></div></details> : null}
            {approvalRequired.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.approvalRequired}</summary><div className="mt-3"><TextList contentKey={`${taskId}:approvalRequired`} items={approvalRequired} empty={copy.noDefinition} /></div></details> : null}
            {assumptions.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.contextAssumptions}</summary><div className="mt-3"><TextList contentKey={`${taskId}:assumptions`} items={assumptions} empty={copy.noDefinition} /></div></details> : null}
            {risks.length > 0 ? <details className="mt-4 border-t border-edge-subtle pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted hover:text-fg">{copy.contextRisks}</summary><div className="mt-3"><TextList contentKey={`${taskId}:risks`} items={risks} empty={copy.noDefinition} /></div></details> : null}
          </section> : null}

        </section>

          </div>
        </TaskDetailDisclosure>

        <TaskDetailDisclosure panelId="management" aria-label={language === 'zh' ? '任务管理' : 'Task management'} className="rounded-xl border border-edge-subtle bg-surface-panel p-4" summaryClassName="cursor-pointer text-sm font-medium text-fg" title={language === 'zh' ? '任务管理' : 'Task management'}>
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

          <details className={cn('p-5', recentlyChanged('dependencies') && 'task-detail-live-update')}>
            <summary className="cursor-pointer text-sm font-semibold text-fg">{copy.taskRelations} · {detail.dependencies.length} / {detail.dependents.length}</summary>
            <div className="mt-4 space-y-4">
              <div>
                <p className="mb-2 text-xs text-fg-muted">{copy.dependencies}</p>
                <TaskDependenciesField candidates={dependencyCandidates} selected={detail.dependencies} disabled={pendingOperations.has('dependencies')} labels={dependencyPickerLabels} getTaskHref={taskHref} onChange={saveDependencies} />
              </div>
              <div><p className="mb-2 text-xs text-fg-muted">{copy.dependents}</p>{detail.dependents.length > 0 ? <div className="space-y-1.5">{detail.dependents.map((task) => <TaskExpandableContent key={task.id} content={task.title} contentKey={`${taskId}:dependent:${task.id}`} language={language} previewHeight={72} className="rounded-lg bg-surface-hover p-2.5"><Link to={taskHref(task.id)} className="block break-words [overflow-wrap:anywhere] text-sm text-fg-muted transition-colors hover:text-fg">{task.title}</Link></TaskExpandableContent>)}</div> : <p className="text-sm text-fg-subtle">{copy.noDependents}</p>}</div>
            </div>
          </details>
        </aside>
          {detail.task.phase !== 'closed' ? <Button variant="ghost" className="my-3" disabled={!automationList} onClick={openSchedule}><CalendarClock className="size-4" />{taskSchedules.length > 0 ? (language === 'zh' ? '管理执行时间' : 'Manage schedule') : copy.scheduleRecurringTask}</Button> : null}
      <details className="mb-4 rounded-xl border border-edge-subtle bg-surface-panel p-5 shadow-surface">
        <summary className="cursor-pointer text-sm font-semibold text-fg">{language === 'zh' ? '关联内容' : 'Related work'}</summary>
        {(linkedSessions.length > 0 || detail.runs.length > 0 || linkedAutomations.length > 0 || detail.dependencies.length > 0 || detail.dependents.length > 0) ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {linkedSessions.length > 0 ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{language === 'zh' ? `对话 · ${linkedSessions.length}` : `Conversations · ${linkedSessions.length}`}</h3><TaskExpandableList contentKey={`${taskId}:sessions`} language={language} className="mt-2">{linkedSessions.map((session) => <li key={session.id}><Link className="block break-words [overflow-wrap:anywhere] text-sm text-accent hover:underline" to={session.conversationId === conversationConversationId ? taskChatHref(taskId) : `/chat/${encodeURIComponent(session.conversationId)}`}>{session.conversationId === conversationConversationId ? (language === 'zh' ? '当前执行对话' : 'Current execution chat') : session.role === 'discussion' ? (language === 'zh' ? '关联讨论' : 'Linked discussion') : (language === 'zh' ? '历史执行对话' : 'Earlier execution chat')}</Link></li>)}</TaskExpandableList></div> : null}
          {linkedAutomations.length > 0 ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{language === 'zh' ? `自动化 · ${linkedAutomations.length}` : `Automations · ${linkedAutomations.length}`}</h3><TaskExpandableList contentKey={`${taskId}:automations`} language={language} className="mt-2">{linkedAutomations.map((automation) => <li key={automation.id}><Link className="block break-words [overflow-wrap:anywhere] text-sm text-accent hover:underline" to={`/automations?automation=${encodeURIComponent(automation.id)}`}>{automation.name}</Link></li>)}</TaskExpandableList></div> : null}
          {(detail.dependencies.length > 0 || detail.dependents.length > 0) ? <div className="rounded-lg bg-surface-hover p-3"><h3 className="text-xs font-medium text-fg-muted">{copy.taskRelations}</h3><p className="mt-2 text-sm text-fg">{language === 'zh' ? `${detail.dependencies.length} 个前置任务 · ${detail.dependents.length} 个后续任务` : `${detail.dependencies.length} prerequisites · ${detail.dependents.length} dependents`}</p></div> : null}
        </div> : <p className="mt-2 text-sm text-fg-muted">{language === 'zh' ? '还没有关联内容' : 'No related work yet'}</p>}
        <div className="mt-4 border-t border-edge-subtle pt-3"><PageContextCaptureButton resource={{ kind: 'task', id: detail.task.id, revision: String(detail.task.version) }} disabled={editingTitle || editingDescription || pendingOperations.size > 0} /></div>
      </details>
          {referenceContext.length > 0 ? <section className={cn('p-5', recentlyChanged('context') && 'task-detail-live-update')}><h2 className="text-sm font-semibold text-fg">{copy.contextUsed}</h2><ul className="mt-4 grid gap-2 sm:grid-cols-2">{referenceContext.map((item) => <li key={item.id} className="min-w-0 rounded-lg bg-surface-hover p-2.5"><span className="text-[11px] text-fg-subtle">{copy.contextRoleLabels[item.role]} · {copy.contextKindLabels[item.targetKind]}</span>{item.targetKind === 'url' && /^https?:\/\//.test(item.targetId) ? <a className="mt-1 block break-all text-sm text-accent hover:underline" href={item.targetId} target="_blank" rel="noreferrer">{item.title ?? item.targetId}</a> : <p className="mt-1 break-words text-sm text-fg">{item.title ?? item.targetId}</p>}</li>)}</ul></section> : null}
        </TaskDetailDisclosure>

        <details className="rounded-xl border border-edge-subtle bg-surface-panel p-4">
          <summary className="cursor-pointer text-sm font-semibold text-fg">{language === 'zh' ? '活动记录与留言' : 'Activity and updates'}</summary>
          <div className="mt-3 space-y-4"><TaskCollaborationPanel key={taskId} taskId={taskId} /><TaskPhaseHistory changes={detail.phaseChanges} language={language} /></div>
        </details>
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
            <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-[100] min-w-52 rounded-lg border border-edge bg-surface-overlay p-1 shadow-popover">
              {linkedSessions.map((session) => <DropdownMenu.Item key={session.id} asChild><Link className="block rounded-md px-3 py-2 text-sm text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover" to={session.conversationId === conversationConversationId ? taskChatHref(taskId) : `/chat/${encodeURIComponent(session.conversationId)}`}>{session.conversationId === conversationConversationId ? (language === 'zh' ? '当前执行对话' : 'Current execution chat') : session.role === 'discussion' ? (language === 'zh' ? '关联讨论' : 'Linked discussion') : (language === 'zh' ? '历史执行对话' : 'Earlier execution chat')}</Link></DropdownMenu.Item>)}
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root> : null}
          {conversationConversationId ? <>
            <Button type="button" variant="ghost" className={cn('size-8 p-0', taskWorkspaceOpen && 'bg-surface-hover text-fg')} aria-label={language === 'zh' ? '项目文件' : 'Project files'} aria-pressed={taskWorkspaceOpen} onClick={() => { useRightWorkspaceStore.getState().openFiles(conversationConversationId); openWorkspacePanelForSession(conversationConversationId); }}><FolderOpen className="size-4" aria-hidden /></Button>
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
      {scheduleDialogOpen ? <TaskScheduleDialog key={`${taskId}:${editingSchedule?.id ?? 'new'}`} automation={editingSchedule ?? undefined} taskId={taskId} taskTitle={detail.task.title} projectId={detail.task.projectId} executorAgentId={conversationAgentId} language={language} onClose={() => setScheduleDialogOpen(false)} onCreated={saveScheduledAutomation} /> : null}
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

export function TaskDetailModal({ taskId, backgroundPath, workspacePanelWidth = 0, onClose }: {
  taskId: string;
  backgroundPath: string;
  workspacePanelWidth?: number;
  onClose: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const setPreviewPath = useWorkspacePreviewStore((state) => state.setPath);
  const workspacePanelOpen = workspacePanelWidth > 0;

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
          className="fixed inset-0 z-[80] bg-black/45"
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
            '--task-detail-workspace-offset': `${workspacePanelWidth / 2}px`,
            '--task-detail-workspace-width': `${workspacePanelWidth}px`,
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

      </Dialog.Portal>
    </Dialog.Root>
  );
}
