import * as Dialog from '@radix-ui/react-dialog';
import type { TaskAction, TaskPriority, ProjectTaskCard, ProjectTaskLane } from '@xopcai/gateway-contract';
import { CalendarClock, Check, CheckCircle2, CircleDot, ListChecks, Plus, UserRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { withReturnTo } from '@/lib/navigation-return';

import {
  groupProjectTasks,
  taskActionForLane,
  primaryTaskAction,
  PROJECT_TASK_LANES,
} from './task-board-model';

type BoardCopy = {
  title: string;
  description: string;
  empty: string;
  acceptanceCriteria: string;
  actionFailed: string;
  create: string;
  createTitle: string;
  createDescription: string;
  objective: string;
  objectivePlaceholder: string;
  priority: string;
  priorityOptions: Record<TaskPriority, string>;
  dueDate: string;
  dependencies: string;
  dependenciesDescription: string;
  noDependencyCandidates: string;
  optional: string;
  cancel: string;
  creating: string;
  createFailed: string;
  actions: Record<'run' | 'resume' | 'pause' | 'verify', string>;
  verification: Record<'passed' | 'failed' | 'unverified', string>;
  lanes: Record<ProjectTaskLane, string>;
};

export type CreateProjectTaskInput = {
  requestId: string;
  objective: string;
  priority: TaskPriority;
  dueAt?: number;
  dependsOnTaskIds: string[];
};

const LANE_ICONS = {
  ready: CircleDot,
  moving: ListChecks,
  needs_user: UserRound,
  done: CheckCircle2,
} satisfies Record<ProjectTaskLane, typeof CircleDot>;

const LANE_TONES: Record<ProjectTaskLane, string> = {
  ready: 'text-fg-muted',
  moving: 'text-accent-fg',
  needs_user: 'text-amber-700 dark:text-amber-300',
  done: 'text-emerald-700 dark:text-emerald-300',
};

function TaskCard({ task, returnTo, copy, busy, onAction, onDragStart }: {
  task: ProjectTaskCard;
  returnTo: string;
  copy: BoardCopy;
  busy: boolean;
  onAction: (task: ProjectTaskCard, action: TaskAction) => void;
  onDragStart: (taskId: string) => void;
}) {
  const primaryAction = primaryTaskAction(task);
  return (
    <article
      draggable={Boolean(primaryAction)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart(task.id);
      }}
      onDragEnd={() => onDragStart('')}
      className="rounded-lg border border-edge-subtle bg-surface-panel transition-colors hover:border-edge hover:bg-surface-hover"
    >
      <Link
        to={withReturnTo(`/tasks/${encodeURIComponent(task.id)}`, returnTo)}
        className="block p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-5 text-fg">{task.title}</h3>
          {task.priority === 'critical' || task.priority === 'high' ? (
            <span className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
              task.priority === 'critical'
                ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
            )}>
              {copy.priorityOptions[task.priority]}
            </span>
          ) : null}
        </div>
        {task.blockedReason || task.nextAction ? (
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-fg-muted">
            {task.blockedReason || task.nextAction}
          </p>
        ) : null}
        {task.progress ? (
          <div className="mt-3" aria-label={`${task.progress.completed}/${task.progress.total}`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-base">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round((task.progress.completed / task.progress.total) * 100)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
              <span className="line-clamp-1">{task.progress.currentStep}</span>
              <span className="shrink-0 tabular-nums">{task.progress.completed}/{task.progress.total}</span>
            </div>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
          {task.latestVerification ? (
            <span className={cn(
              'font-medium',
              task.latestVerification === 'passed'
                ? 'text-emerald-700 dark:text-emerald-300'
                : task.latestVerification === 'failed'
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-fg-subtle',
            )}>
              {copy.verification[task.latestVerification]}
            </span>
          ) : null}
          {task.acceptanceCriteriaCount > 0 ? (
            <span>{copy.acceptanceCriteria.replace('{{count}}', String(task.acceptanceCriteriaCount))}</span>
          ) : null}
          {task.dueAt ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden />
              {formatMediumDateTime(new Date(task.dueAt))}
            </span>
          ) : null}
          {task.nextCheckAt ? (
            <span className="inline-flex items-center gap-1 text-accent-fg">
              <CalendarClock className="size-3" aria-hidden />
              {formatMediumDateTime(new Date(task.nextCheckAt))}
            </span>
          ) : null}
        </div>
      </Link>
      {primaryAction && primaryAction !== 'cancel' ? (
        <div className="flex items-center gap-3 border-t border-edge-subtle px-3 py-2">
          <button type="button" disabled={busy} onClick={() => onAction(task, primaryAction)} className="text-xs font-medium text-accent-fg hover:underline disabled:cursor-wait disabled:opacity-50">
            {copy.actions[primaryAction]}
          </button>
          {primaryAction !== 'verify' && task.allowedActions.includes('verify') ? (
            <button type="button" disabled={busy} onClick={() => onAction(task, 'verify')} className="text-xs font-medium text-fg-muted hover:text-fg hover:underline disabled:cursor-wait disabled:opacity-50">
              {copy.actions.verify}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ProjectTaskBoard({ tasks, returnTo, copy, onAction, onCreate, actionBusyId }: {
  tasks: ProjectTaskCard[];
  returnTo: string;
  copy: BoardCopy;
  onAction: (task: ProjectTaskCard, action: TaskAction) => Promise<void>;
  onCreate: (input: CreateProjectTaskInput) => Promise<void>;
  actionBusyId?: string | null;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createRequestId, setCreateRequestId] = useState(() => crypto.randomUUID());
  const [objective, setObjective] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const grouped = groupProjectTasks(tasks);
  const performAction = (task: ProjectTaskCard, action: TaskAction) => {
    void onAction(task, action);
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const dueAt = dueDate ? new Date(`${dueDate}T23:59:59.999`).getTime() : undefined;
      await onCreate({ requestId: createRequestId, objective: trimmed, priority, dependsOnTaskIds, ...(dueAt === undefined ? {} : { dueAt }) });
      setObjective('');
      setPriority('normal');
      setDueDate('');
      setDependsOnTaskIds([]);
      setCreateRequestId(crypto.randomUUID());
      setCreateOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section id="project-panel-board" role="tabpanel" aria-labelledby="project-primary-tab-board" className="min-h-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">{copy.title}</h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{copy.description}</p>
        </div>
        <Button type="button" variant="primary" className="h-9 rounded-lg" onClick={() => { setCreateRequestId(crypto.randomUUID()); setCreateError(null); setCreateOpen(true); }}>
          <Plus className="size-4" aria-hidden />
          {copy.create}
        </Button>
      </div>
      <div className="grid min-w-[64rem] grid-cols-4 gap-3">
        {PROJECT_TASK_LANES.map((lane) => {
          const Icon = LANE_ICONS[lane];
          const items = grouped[lane];
          return (
            <section
              key={lane}
              onDragOver={(event) => {
                const task = tasks.find((item) => item.id === draggedId);
                if (task && taskActionForLane(task, lane)) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const task = tasks.find((item) => item.id === draggedId);
                const action = task ? taskActionForLane(task, lane) : undefined;
                setDraggedId(null);
                if (task && action) performAction(task, action);
              }}
              className="min-w-0 rounded-xl bg-surface-muted/60 p-2.5"
            >
              <header className="mb-2.5 flex items-center justify-between gap-2 px-1">
                <div className={cn('flex items-center gap-2', LANE_TONES[lane])}>
                  <Icon className="size-4" aria-hidden />
                  <h3 className="text-sm font-semibold">{copy.lanes[lane]}</h3>
                </div>
                <span className="rounded-full bg-surface-panel px-2 py-0.5 text-xs text-fg-subtle">{items.length}</span>
              </header>
              <div className="grid gap-2">
                {items.length ? items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    returnTo={returnTo}
                    copy={copy}
                    busy={actionBusyId === task.id}
                    onAction={performAction}
                    onDragStart={setDraggedId}
                  />
                )) : (
                  <p className="rounded-lg border border-dashed border-edge px-3 py-5 text-center text-xs text-fg-subtle">
                    {copy.empty}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog.Root open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(34rem,calc(100vh-2rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-float focus:outline-none">
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-base font-semibold text-fg">{copy.createTitle}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-fg-muted">{copy.createDescription}</Dialog.Description>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void submitCreate(event)}>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-fg-muted">{copy.objective}</span>
                  <textarea
                    autoFocus
                    className="min-h-32 resize-y rounded-md border border-edge bg-surface-base px-3 py-2 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
                    value={objective}
                    onChange={(event) => { setObjective(event.target.value); setCreateError(null); }}
                    placeholder={copy.objectivePlaceholder}
                    maxLength={12_000}
                    disabled={creating}
                  />
                </label>
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
                    <input
                      type="date"
                      className="min-h-10 rounded-md border border-edge bg-surface-base px-3 text-sm text-fg outline-none focus:border-accent"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      disabled={creating}
                    />
                  </label>
                </div>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium text-fg-muted">{copy.dependencies}</legend>
                  <p className="text-xs leading-5 text-fg-subtle">{copy.dependenciesDescription}</p>
                  {tasks.filter((task) => task.status !== 'cancelled').length > 0 ? (
                    <div className="grid max-h-36 gap-1 overflow-y-auto rounded-lg border border-edge p-1.5">
                      {tasks.filter((task) => task.status !== 'cancelled').map((task) => {
                        const selected = dependsOnTaskIds.includes(task.id);
                        return (
                          <button
                            key={task.id}
                            type="button"
                            aria-pressed={selected}
                            disabled={creating}
                            onClick={() => setDependsOnTaskIds((current) => selected
                              ? current.filter((id) => id !== task.id)
                              : [...current, task.id])}
                            className={cn(
                              'flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                              selected ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-surface-hover',
                            )}
                          >
                            <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', selected ? 'border-accent bg-accent text-white' : 'border-edge')}>
                              {selected ? <Check className="size-3" aria-hidden /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <p className="text-sm text-fg-subtle">{copy.noDependencyCandidates}</p>}
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
    </section>
  );
}
