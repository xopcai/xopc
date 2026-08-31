import * as Dialog from '@radix-ui/react-dialog';
import type { TaskPriority, ProjectMonitoringPolicy, ProjectMonitoringUpdate, ProjectTaskCard, ProjectTaskDependencyEdge, TaskPhase } from '@xopcai/gateway-contract';
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, Circle, CircleCheck, CircleDot, GitBranch, Hourglass, LayoutGrid, ListChecks, Paperclip, UserRound } from 'lucide-react';
import { type FormEvent, type PointerEvent, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { ComposerAttachmentChips } from '@/features/chat/composer/composer-attachment-chips';
import { useComposerAttachments } from '@/features/chat/composer/use-composer-attachments';
import { DependencyPicker } from '@/features/tasks/dependency-picker';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { useLocaleStore } from '@/stores/locale-store';

import {
  groupProjectTasks,
  taskActionForPhase,
  primaryTaskAction,
  PROJECT_TASK_PHASES,
  type TaskBoardAction,
} from './task-board-model';
import { TaskDependencyGraph, type TaskDependencyGraphCopy } from './task-dependency-graph';
import { ProjectMonitoringControl, type ProjectMonitoringCopy } from './project-monitoring-control';

type BoardCopy = {
  title: string;
  description: string;
  empty: string;
  acceptanceCriteria: string;
  blockedBy: string;
  actionFailed: string;
  moved: string;
  undo: string;
  create: string;
  createTitle: string;
  createDescription: string;
  objective: string;
  objectivePlaceholder: string;
  priority: string;
  priorityOptions: Record<TaskPriority, string>;
  dueDate: string;
  addFiles: string;
  attachmentsDescription: string;
  dependencies: string;
  dependenciesDescription: string;
  linkDependencies: string;
  linkedDependencies: string;
  dependencySearchPlaceholder: string;
  noDependencyMatches: string;
  removeDependency: string;
  noDependencyCandidates: string;
  optional: string;
  cancel: string;
  creating: string;
  createFailed: string;
  actions: Record<Exclude<TaskBoardAction, `${'move' | 'reopen'}_${string}`>, string>;
  verification: Record<'passed' | 'failed' | 'unverified', string>;
  phases: Record<TaskPhase, string>;
  operationalStates: Record<ProjectTaskCard['operationalState'], string>;
  views: { board: string; graph: string };
  graph: Omit<TaskDependencyGraphCopy, 'phases'>;
  monitoring: ProjectMonitoringCopy;
};

export type CreateProjectTaskInput = {
  requestId: string;
  objective: string;
  priority: TaskPriority;
  dueAt?: number;
  dependsOnTaskIds: string[];
  attachments: Array<{ name?: string; uri?: string; mimeType?: string; size?: number; data?: string }>;
};

export type ProjectTaskBoardHandle = {
  openCreate: () => void;
};

type BoardPanState = {
  pointerId: number;
  startX: number;
  scrollLeft: number;
  active: boolean;
};

function shouldIgnoreBoardPan(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest('a,button,input,select,textarea,[contenteditable="true"],[draggable="true"],[data-board-pan-skip="true"]'));
}

const LANE_ICONS = {
  backlog: CircleDot,
  ready: CircleDot,
  active: ListChecks,
  review: UserRound,
  closed: CheckCircle2,
} satisfies Record<TaskPhase, typeof CircleDot>;

const LANE_TONES: Record<TaskPhase, string> = {
  backlog: 'bg-surface-hover text-fg-muted',
  ready: 'bg-surface-panel text-fg-muted',
  active: 'bg-accent-soft text-accent-fg',
  review: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  closed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function operationalStateTone(state: ProjectTaskCard['operationalState']): string {
  if (state === 'running' || state === 'queued') return 'border-accent/20 bg-accent-soft text-accent-fg';
  if (state === 'verifying') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (state === 'waiting') return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (state === 'blocked') return 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300';
  return 'border-edge-subtle bg-surface-hover text-fg-muted';
}

function verificationTone(status: NonNullable<ProjectTaskCard['latestVerification']>): string {
  if (status === 'passed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300';
  return 'border-edge-subtle bg-surface-hover text-fg-muted';
}

function TaskCard({ task, returnTo, copy, busy, onAction, onDragStart, onDropBefore }: {
  task: ProjectTaskCard;
  returnTo: string;
  copy: BoardCopy;
  busy: boolean;
  onAction: (task: ProjectTaskCard, action: TaskBoardAction) => void;
  onDragStart: (taskId: string) => void;
  onDropBefore: (beforeTaskId: string) => void;
}) {
  const primaryAction = primaryTaskAction(task);
  const secondaryAction = primaryAction !== 'review' && task.allowedCommands.includes('request_review') ? 'review' : undefined;
  const isClosed = task.phase === 'closed';
  const overdue = Boolean(task.dueAt && task.dueAt < Date.now() && !isClosed);
  const TaskStatusIcon = isClosed ? CircleCheck : Circle;
  const showPriority = task.priority !== 'normal';
  const showMetadata = showPriority
    || task.operationalState !== 'idle'
    || Boolean(task.latestVerification)
    || task.acceptanceCriteriaCount > 0
    || Boolean(task.dueAt)
    || Boolean(task.nextCheckAt);
  return (
    <article
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart(task.id);
      }}
      onDragEnd={() => onDragStart('')}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDropBefore(task.id);
      }}
      className="group relative min-h-max min-w-0 shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-base shadow-surface transition-[border-color,box-shadow] hover:border-edge focus-within:border-accent/40"
    >
      <Link
        to={taskDetailModalHref(returnTo, task.id)}
        className={cn(
          'block min-w-0 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          secondaryAction ? 'pr-19' : primaryAction && 'pr-11',
        )}
      >
        <div className="flex items-start gap-2.5">
          <TaskStatusIcon className={cn('mt-0.5 size-4 shrink-0', isClosed ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg-subtle')} aria-hidden />
          <h3 className={cn('min-w-0 break-words text-sm font-semibold leading-5', isClosed ? 'text-fg-subtle' : 'text-fg')}>{task.title}</h3>
        </div>
        {task.operationalState === 'blocked' && task.blockedBy.length > 0 ? (
          <div className="ml-6.5 mt-2.5 rounded-lg bg-violet-500/8 px-2.5 py-2 text-xs text-violet-700 dark:text-violet-300">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Hourglass className="size-3.5" aria-hidden />
              {copy.blockedBy.replace('{{count}}', String(task.blockedBy.length))}
            </span>
            <p className="mt-1 line-clamp-2 leading-5 text-fg-muted">
              {task.blockedBy.map((dependency) => dependency.title).join('、')}
            </p>
          </div>
        ) : task.attention[0] ? (
          <p className="ml-6.5 mt-2.5 flex items-start gap-1.5 text-xs leading-5 text-fg-muted">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="line-clamp-2">{task.attention[0].summary}</span>
          </p>
        ) : null}
        {showMetadata ? <div className="ml-6.5 mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {showPriority ? (
            <span className={cn(
              'inline-flex min-h-6 items-center rounded-md border px-2 font-medium',
              task.priority === 'critical'
                ? 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
                : task.priority === 'high'
                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-edge-subtle bg-surface-hover text-fg-muted',
            )}>
              {copy.priorityOptions[task.priority]}
            </span>
          ) : null}
          {task.operationalState !== 'idle' ? (
            <span className={cn('inline-flex min-h-6 items-center rounded-md border px-2 font-medium', operationalStateTone(task.operationalState))}>
              {copy.operationalStates[task.operationalState]}
            </span>
          ) : null}
          {task.latestVerification ? (
            <span className={cn('inline-flex min-h-6 items-center rounded-md border px-2 font-medium', verificationTone(task.latestVerification))}>
              {copy.verification[task.latestVerification]}
            </span>
          ) : null}
          {task.acceptanceCriteriaCount > 0 ? (
            <span className="inline-flex min-h-6 items-center gap-1 rounded-md border border-edge-subtle bg-surface-hover px-2 text-fg-muted">
              <ListChecks className="size-3" aria-hidden />
              {copy.acceptanceCriteria.replace('{{count}}', String(task.acceptanceCriteriaCount))}
            </span>
          ) : null}
          {task.dueAt ? (
            <span className={cn(
              'inline-flex min-h-6 items-center gap-1 rounded-md border px-2',
              overdue
                ? 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-edge-subtle bg-surface-hover text-fg-muted',
            )}>
              <CalendarClock className="size-3" aria-hidden />
              {formatMediumDateTime(new Date(task.dueAt))}
            </span>
          ) : null}
          {task.nextCheckAt ? (
            <span className="inline-flex min-h-6 items-center gap-1 rounded-md border border-accent/20 bg-accent-soft px-2 text-accent-fg">
              <CalendarClock className="size-3" aria-hidden />
              {formatMediumDateTime(new Date(task.nextCheckAt))}
            </span>
          ) : null}
        </div> : null}
      </Link>
      {primaryAction ? (
        <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {secondaryAction ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(task, secondaryAction)}
              className="inline-flex size-7 items-center justify-center rounded-md bg-surface-hover text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50"
              aria-label={copy.actions[secondaryAction]}
              title={copy.actions[secondaryAction]}
            >
              <UserRound className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(task, primaryAction)}
            className="inline-flex size-7 items-center justify-center rounded-md bg-accent-soft text-accent-fg hover:bg-accent-soft/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-50"
            aria-label={copy.actions[primaryAction]}
            title={copy.actions[primaryAction]}
          >
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ProjectTaskBoard({ tasks, dependencyEdges, monitoring, returnTo, copy, onAction, onReorder, onUndoMove, onDependenciesChange, onMonitoringChange, onCreate, actionBusyId, ref }: {
  tasks: ProjectTaskCard[];
  dependencyEdges: ProjectTaskDependencyEdge[];
  monitoring: ProjectMonitoringPolicy;
  returnTo: string;
  copy: BoardCopy;
  onAction: (task: ProjectTaskCard, action: TaskBoardAction) => Promise<boolean>;
  onReorder: (taskId: string, beforeTaskId: string | null) => Promise<boolean>;
  onUndoMove: (taskId: string, phase: TaskPhase, beforeTaskId: string | null) => Promise<boolean>;
  onDependenciesChange: (taskId: string, dependencyTaskIds: string[]) => Promise<void>;
  onMonitoringChange: (update: ProjectMonitoringUpdate) => Promise<void>;
  onCreate: (input: CreateProjectTaskInput) => Promise<void>;
  actionBusyId?: string | null;
  ref?: Ref<ProjectTaskBoardHandle>;
}) {
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);
  const boardPanRef = useRef<BoardPanState | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isPanningBoard, setIsPanningBoard] = useState(false);
  const [undoMove, setUndoMove] = useState<{ taskId: string; phase: TaskPhase; beforeTaskId: string | null } | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'graph'>('board');
  const [createOpen, setCreateOpen] = useState(false);
  const [createRequestId, setCreateRequestId] = useState(() => crypto.randomUUID());
  const [objective, setObjective] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const language = useLocaleStore((state) => state.language);
  const attachmentState = useComposerAttachments({ chat: messages(language).chat });
  const grouped = groupProjectTasks(tasks);
  const dependencyCandidates = tasks.filter((task) => task.phase !== 'closed');
  const performAction = (task: ProjectTaskCard, action: TaskBoardAction) => void onAction(task, action);
  const dropTask = async (targetPhase: TaskPhase, beforeTaskId: string | null) => {
    const task = tasks.find((item) => item.id === draggedId);
    setDraggedId(null);
    if (!task || task.id === beforeTaskId) return;
    const currentItems = grouped[task.phase];
    const currentIndex = currentItems.findIndex((item) => item.id === task.id);
    const previousBeforeTaskId = currentIndex >= 0 ? currentItems[currentIndex + 1]?.id ?? null : null;
    if (task.phase === targetPhase && previousBeforeTaskId === beforeTaskId) return;
    const action = taskActionForPhase(task, targetPhase);
    if (task.phase !== targetPhase && !action) return;
    if (action && !await onAction(task, action)) return;
    if (!await onReorder(task.id, beforeTaskId)) return;
    setUndoMove({ taskId: task.id, phase: task.phase, beforeTaskId: previousBeforeTaskId });
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const dueAt = dueDate ? new Date(`${dueDate}T23:59:59.999`).getTime() : undefined;
      await onCreate({
        requestId: createRequestId,
        objective: trimmed,
        priority,
        dependsOnTaskIds,
        attachments: attachmentState.wireAttachmentsPayload(),
        ...(dueAt === undefined ? {} : { dueAt }),
      });
      setObjective('');
      setPriority('normal');
      setDueDate('');
      setDependsOnTaskIds([]);
      attachmentState.clearAttachments();
      setCreateRequestId(crypto.randomUUID());
      setCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    setCreateRequestId(crypto.randomUUID());
    setObjective('');
    setPriority('normal');
    setDueDate('');
    setDependsOnTaskIds([]);
    attachmentState.clearAttachments();
    setCreateError(null);
    setCreateOpen(true);
  };

  useImperativeHandle(ref, () => ({ openCreate }));

  useEffect(() => {
    if (!undoMove) return undefined;
    const timer = window.setTimeout(() => setUndoMove(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [undoMove]);

  const endBoardPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = boardPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    boardPanRef.current = null;
    setIsPanningBoard(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleBoardPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || shouldIgnoreBoardPan(event.target)) return;
    const scroller = boardScrollerRef.current;
    if (!scroller) return;
    boardPanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: scroller.scrollLeft,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleBoardPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const pan = boardPanRef.current;
    const scroller = boardScrollerRef.current;
    if (!pan || !scroller || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.startX;
    if (!pan.active && Math.abs(deltaX) < 5) return;
    if (!pan.active) {
      pan.active = true;
      setIsPanningBoard(true);
    }
    event.preventDefault();
    scroller.scrollLeft = pan.scrollLeft - deltaX;
  }, []);

  return (
    <section id="project-panel-board" role="tabpanel" aria-labelledby="project-primary-tab-board" className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{copy.title}</h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{copy.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ProjectMonitoringControl policy={monitoring} copy={copy.monitoring} onSave={onMonitoringChange} />
          <div className="flex rounded-lg border border-edge bg-surface-panel p-0.5">
          <button type="button" aria-pressed={viewMode === 'board'} onClick={() => setViewMode('board')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', viewMode === 'board' ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg')}>
            <LayoutGrid className="size-3.5" aria-hidden />
            {copy.views.board}
          </button>
          <button type="button" aria-pressed={viewMode === 'graph'} onClick={() => setViewMode('graph')} className={cn('inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium', viewMode === 'graph' ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:text-fg')}>
            <GitBranch className="size-3.5" aria-hidden />
            {copy.views.graph}
          </button>
          </div>
        </div>
      </div>
      {viewMode === 'board' ? <div
        ref={boardScrollerRef}
        className={cn(
          'min-h-0 w-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 [scrollbar-width:thin]',
          isPanningBoard ? 'cursor-grabbing select-none' : 'cursor-grab',
        )}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={endBoardPan}
        onPointerCancel={endBoardPan}
        onLostPointerCapture={(event) => {
          if (boardPanRef.current?.pointerId === event.pointerId) {
            boardPanRef.current = null;
            setIsPanningBoard(false);
          }
        }}
      >
        <div className="grid h-full min-h-0 min-w-[103rem] grid-cols-5 gap-3">
          {PROJECT_TASK_PHASES.map((phase) => {
            const Icon = LANE_ICONS[phase];
            const items = grouped[phase];
            return (
              <section
                key={phase}
                onDragOver={(event) => {
                  const task = tasks.find((item) => item.id === draggedId);
                  if (task && (task.phase === phase || taskActionForPhase(task, phase))) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  void dropTask(phase, null);
                }}
                className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-edge-subtle bg-surface-muted/70 p-2.5"
              >
                <header className="mb-2.5 flex shrink-0 items-center gap-2 px-0.5">
                  <div className={cn('flex items-center gap-1.5 rounded-md px-2 py-1', LANE_TONES[phase])}>
                    <Icon className="size-3.5" aria-hidden />
                    <h3 className="text-sm font-semibold">{copy.phases[phase]}</h3>
                  </div>
                  <span className="text-xs text-fg-subtle">{items.length}</span>
                </header>
                <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]">
                  <div className="flex flex-col gap-2">
                    {items.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        returnTo={returnTo}
                        copy={copy}
                        busy={actionBusyId === task.id}
                        onAction={performAction}
                        onDragStart={setDraggedId}
                        onDropBefore={(beforeTaskId) => void dropTask(phase, beforeTaskId)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div> : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <TaskDependencyGraph
            tasks={tasks}
            dependencyEdges={dependencyEdges}
            returnTo={returnTo}
            copy={{ ...copy.graph, phases: copy.phases }}
            onDependenciesChange={onDependenciesChange}
          />
        </div>
      )}

      <Dialog.Root open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(40rem,calc(100vh-2rem))] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{copy.createTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{copy.createDescription}</Dialog.Description>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submitCreate(event)}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="grid gap-2 text-sm">
                  <label htmlFor="project-task-objective" className="font-medium text-fg-muted">{copy.objective}</label>
                  <div
                    className={cn(
                      'overflow-hidden rounded-lg border border-edge bg-surface-base transition-colors focus-within:border-accent',
                      attachmentState.isDragging && 'border-accent bg-accent-soft/30',
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (!creating) attachmentState.setIsDragging(true);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        attachmentState.setIsDragging(false);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      attachmentState.setIsDragging(false);
                      if (!creating) void attachmentState.processFiles(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <textarea
                      id="project-task-objective"
                      autoFocus
                      className="min-h-28 w-full resize-y bg-transparent px-3 py-3 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle"
                      value={objective}
                      onChange={(event) => { setObjective(event.target.value); setCreateError(null); }}
                      placeholder={copy.objectivePlaceholder}
                      maxLength={12_000}
                      disabled={creating}
                    />
                    <ComposerAttachmentChips
                      attachments={attachmentState.attachments}
                      topPadded={false}
                      onRemove={(index) => { if (!creating) attachmentState.removeAttachment(index); }}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle px-2.5 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 rounded-lg px-2.5 text-xs"
                        disabled={creating}
                        onClick={() => attachmentState.fileInputRef.current?.click()}
                      >
                        <Paperclip className="size-3.5" aria-hidden />
                        {copy.addFiles}
                      </Button>
                      <span className="text-xs text-fg-subtle">{copy.attachmentsDescription}</span>
                      <input
                        ref={attachmentState.fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          void attachmentState.processFiles(Array.from(event.target.files ?? []));
                          event.currentTarget.value = '';
                        }}
                      />
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-fg-muted">{copy.priority}</span>
                    <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} disabled={creating}>
                      {(['low', 'normal', 'high', 'critical'] as const).map((value) => (
                        <SelectOption key={value} value={value}>{copy.priorityOptions[value]}</SelectOption>
                      ))}
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm">
                    <span className="font-medium text-fg-muted">{copy.dueDate} <span className="font-normal text-fg-subtle">{copy.optional}</span></span>
                    <DatePicker
                      className="min-h-10 bg-surface-base"
                      value={dueDate}
                      onChange={setDueDate}
                      disabled={creating}
                      ariaLabel={copy.dueDate}
                    />
                  </label>
                </div>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium text-fg-muted">
                    {copy.dependencies} <span className="font-normal text-fg-subtle">{copy.optional}</span>
                  </legend>
                  <p className="text-xs leading-5 text-fg-subtle">{copy.dependenciesDescription}</p>
                  <DependencyPicker
                    candidates={dependencyCandidates}
                    selectedIds={dependsOnTaskIds}
                    disabled={creating}
                    onChange={setDependsOnTaskIds}
                    labels={{
                      link: copy.linkDependencies,
                      linked: copy.linkedDependencies,
                      searchPlaceholder: copy.dependencySearchPlaceholder,
                      noMatches: copy.noDependencyMatches,
                      noCandidates: copy.noDependencyCandidates,
                      remove: copy.removeDependency,
                    }}
                  />
                </fieldset>
                {createError ? <p className="text-sm text-red-600 dark:text-red-400">{createError}</p> : null}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" className="rounded-lg" disabled={creating}>{copy.cancel}</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" className="rounded-lg" disabled={creating || !objective.trim()}>
                  {creating ? copy.creating : copy.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {undoMove ? (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-edge bg-surface-panel px-4 py-3 text-sm text-fg shadow-float">
          <span>{copy.moved}</span>
          <button
            type="button"
            className="font-medium text-accent-fg hover:underline"
            onClick={() => {
              const pending = undoMove;
              setUndoMove(null);
              void onUndoMove(pending.taskId, pending.phase, pending.beforeTaskId).then((ok) => {
                if (!ok) setUndoMove(pending);
              });
            }}
          >
            {copy.undo}
          </button>
        </div>
      ) : null}
    </section>
  );
}
