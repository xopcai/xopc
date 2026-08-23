import type { TaskCommand, TaskPhase } from '@xopcai/gateway-contract';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowLeft, Bot, CalendarClock, Circle, CircleCheck, CircleX, ExternalLink, Flag, FolderKanban, MoreHorizontal, Pencil, Play, Pause, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchProjectOperatingView } from '@/features/projects/api';
import { DependencyPicker, type DependencyCandidate } from '@/features/tasks/dependency-picker';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { commandTask, fetchTask, submitTaskFeedback, updateTaskDependencies, type TaskDetail } from '@/features/tasks/home-api';
import { taskCopy } from '@/features/tasks/task-copy';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { safeInternalReturnPath, withReturnTo } from '@/lib/navigation-return';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

function phaseLabel(phase: TaskPhase, language: 'en' | 'zh'): string {
  const labels = language === 'zh'
    ? { backlog: '收集箱', ready: '就绪', active: '进行中', review: '待验收', closed: '已关闭' }
    : { backlog: 'Backlog', ready: 'Ready', active: 'Active', review: 'Review', closed: 'Closed' };
  return labels[phase];
}

function DetailSkeleton() {
  return <div className="space-y-4" aria-busy><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-52 rounded-2xl" /><Skeleton className="h-40 rounded-2xl" /></div>;
}

type DetailStatusKey = 'captured' | 'ready' | 'queued' | 'running' | 'verifying' | 'waiting' | 'blocked' | 'needsUser' | 'review' | 'completed' | 'ended' | 'paused';
type VerificationStatus = 'passed' | 'failed' | 'unverified';

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
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dependencyCandidates, setDependencyCandidates] = useState<DependencyCandidate[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [editingDependencies, setEditingDependencies] = useState(false);
  const [dependencyDraft, setDependencyDraft] = useState<string[]>([]);
  const returnPath = useMemo(() => safeInternalReturnPath(
    searchParams.get('returnTo'),
    '/',
    ['/projects', '/chat', '/notes', '/tasks'],
  ), [searchParams]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    void fetchTask(taskId).then((value) => { if (active) setDetail(value); }).catch(() => { if (active) setError(copy.taskNotFound); });
    return () => { active = false; };
  }, [copy.taskNotFound, taskId, token]);

  useEffect(() => {
    const projectId = detail?.task.projectId;
    const currentDependencies = detail?.dependencies ?? [];
    if (!projectId) {
      setProjectName(null);
      setDependencyCandidates(currentDependencies);
      return;
    }
    setProjectName(null);
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
        setProjectName(null);
        setDependencyCandidates(currentDependencies);
      }
    });
    return () => { active = false; };
  }, [detail?.dependencies, detail?.task.projectId, taskId]);

  const execute = async (command: TaskCommand) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await commandTask(taskId, command, detail.task.version));
    } catch {
      setError(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const saveDependencies = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      setDetail(await updateTaskDependencies(taskId, dependencyDraft, detail.task.version));
      setEditingDependencies(false);
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

  if (error && !detail) return <div className={presentation === 'modal' ? 'p-5 text-sm text-danger' : 'mx-auto max-w-3xl p-6 text-sm text-danger'}>{error}</div>;
  if (!detail) return <div className={presentation === 'modal' ? 'p-5' : 'mx-auto max-w-4xl p-4 sm:p-6'}><DetailSkeleton /></div>;

  const activeWait = detail.waits[0];
  const pausedWait = activeWait?.kind === 'paused' ? activeWait : undefined;
  const latestReceipt = detail.receipts[0];
  const statusLabel = copy.detailStatuses[detailStatusKey(detail)];
  const statusDescription = copy.detailStatusDescriptions[detailStatusKey(detail)];
  const objective = detail.task.body?.trim() || detail.task.contract?.objective.trim();
  const executor = detail.task.delegateAgentId ?? detail.task.ownerId;
  const verificationByCriterion = new Map(latestReceipt?.verification.checks.map((check) => [check.criterion, check.status]));
  const canSchedule = detail.allowedCommands.includes('mark_ready');
  const canStart = detail.allowedCommands.includes('start');
  const canPause = detail.allowedCommands.includes('add_wait');
  const canApprove = detail.task.phase === 'review' && detail.allowedCommands.includes('close');
  const canReopen = detail.allowedCommands.includes('reopen');
  const needsUserAttention = detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');
  const acceptanceCriteria = detail.task.contract?.acceptanceCriteria ?? [];
  const verifiedCriteriaCount = acceptanceCriteria.filter((criterion) => verificationByCriterion.get(criterion) === 'passed').length;
  const expectedOutputs = detail.task.contract?.expectedOutputs ?? [];
  const constraints = detail.task.contract?.constraints ?? [];
  const approvalRequired = detail.task.contract?.approvalRequired ?? [];
  const assumptions = detail.task.contract?.assumptions ?? [];
  const risks = detail.task.contract?.risks ?? [];
  const taskHref = (relatedTaskId: string) => presentation === 'modal' && backgroundPath
    ? taskDetailModalHref(backgroundPath, relatedTaskId)
    : withReturnTo(`/tasks/${relatedTaskId}`, returnPath);

  return (
    <div className={presentation === 'modal' ? 'space-y-4 p-5' : 'mx-auto max-w-4xl space-y-4 p-4 pb-16 sm:p-6'}>
      <section className="rounded-2xl border border-edge bg-surface-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span className="inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-fg">{statusLabel}</span>
            <h1 className="mt-3 text-xl font-semibold leading-7 text-fg">{detail.task.title}</h1>
            {objective && objective !== detail.task.title ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{objective}</p> : null}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg-muted">
              {projectName ? <span className="inline-flex items-center gap-1.5"><FolderKanban className="size-3.5" aria-hidden />{projectName}</span> : null}
              <span className="inline-flex items-center gap-1.5"><Flag className="size-3.5" aria-hidden />{copy.priorityLabels[detail.task.priority]}</span>
              <span className="inline-flex items-center gap-1.5"><Bot className="size-3.5" aria-hidden />{executor ?? copy.unassigned}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" aria-hidden />{detail.task.dueAt ? formatMediumDateTime(detail.task.dueAt, language) : copy.noDueDate}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSchedule ? <Button disabled={busy} onClick={() => void execute({ type: 'mark_ready' })}><Play className="size-4" />{copy.scheduleTask}</Button> : null}
            {pausedWait ? <Button disabled={busy} onClick={() => void execute({ type: 'resolve_wait', waitId: pausedWait.id })}><Play className="size-4" />{copy.resumeTask}</Button> : null}
            {!activeWait && canStart ? <Button disabled={busy} onClick={() => void execute({ type: 'start', executor: { kind: 'agent', agentId: detail.task.delegateAgentId ?? 'main' } })}><Play className="size-4" />{copy.runTask}</Button> : null}
            {canApprove ? <Button disabled={busy} onClick={() => void execute({ type: 'close', resolution: 'done' })}><CircleCheck className="size-4" />{copy.approveTask}</Button> : null}
            {canReopen ? <Button disabled={busy} onClick={() => void execute({ type: 'reopen', phase: 'ready' })}><Play className="size-4" />{copy.reopenTask}</Button> : null}
            {!activeWait && canPause ? <Button variant="secondary" disabled={busy} onClick={() => void execute({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}><Pause className="size-4" />{copy.pauseTask}</Button> : null}
            {detail.task.phase !== 'closed' ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className="size-9 p-0" disabled={busy} aria-label={copy.moreActions}><MoreHorizontal className="size-4" aria-hidden /></Button></DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={6} className="z-[100] min-w-40 rounded-lg border border-edge bg-surface-panel p-1 shadow-lg">
                    <DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-danger outline-none hover:bg-surface-hover focus:bg-surface-hover" onSelect={() => void execute({ type: 'close', resolution: 'cancelled' })}>{copy.cancelTask}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-accent/20 bg-accent-soft/40 p-5">
        <h2 className="font-medium text-fg">{copy.statusSummary}</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">{statusDescription}</p>
        <p className="mt-2 text-xs text-fg-subtle">{copy.updatedAt.replace('{{date}}', formatMediumDateTime(detail.task.updatedAt, language))}</p>
      </section>

      {detail.attention.length > 0 ? <section className="rounded-2xl border border-warning/40 bg-warning/5 p-5"><h3 className="font-medium text-fg">{needsUserAttention ? copy.needsAttention : copy.waitingStatus}</h3><ul className="mt-3 space-y-2 text-sm text-fg-muted">{detail.attention.map((item, index) => <li key={`${item.kind}-${index}`}>{item.summary}</li>)}</ul></section> : null}

      {latestReceipt ? (
        <section className="rounded-2xl border border-edge bg-surface-panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-medium text-fg">{copy.latestResult}</h2>
              <p className="mt-2 text-sm leading-6 text-fg">{latestReceipt.summary}</p>
            </div>
            <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs text-fg-muted">{copy.receiptStatuses[latestReceipt.status]} · {copy.verificationStatuses[latestReceipt.verification.status]}</span>
          </div>
          {latestReceipt.remainingWork.length > 0 ? <div className="mt-4"><h3 className="text-xs font-medium text-fg-muted">{copy.remainingWork}</h3><div className="mt-2"><TextList items={latestReceipt.remainingWork} empty={copy.noRemainingWork} /></div></div> : null}
          {latestReceipt.nextAction ? <div className="mt-4 rounded-lg bg-surface-hover p-3"><p className="text-xs font-medium text-fg-muted">{copy.nextAction}</p><p className="mt-1 text-sm text-fg">{latestReceipt.nextAction}</p></div> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button className="px-2 py-1 text-xs" variant="secondary" onClick={() => void submitTaskFeedback(latestReceipt.runId, 'helpful')}>{copy.doneWell}</Button>
            <Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => void submitTaskFeedback(latestReceipt.runId, 'not_helpful')}>{copy.needsFix}</Button>
            {latestReceipt.evidence.filter((evidence) => evidence.uri).map((evidence) => <a key={`${evidence.title}-${evidence.uri}`} className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline" href={evidence.uri}><ExternalLink className="size-3" />{evidence.title}</a>)}
          </div>
          {detail.receipts.length > 1 ? <details className="mt-4 border-t border-edge pt-4"><summary className="cursor-pointer text-sm font-medium text-fg-muted">{copy.executionHistory.replace('{{count}}', String(detail.receipts.length - 1))}</summary><div className="mt-3 space-y-3">{detail.receipts.slice(1).map((receipt) => <article key={receipt.runId} className="rounded-lg bg-surface-hover p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm text-fg">{receipt.summary}</p><span className="shrink-0 text-xs text-fg-subtle">{copy.receiptStatuses[receipt.status]}</span></div></article>)}</div></details> : null}
        </section>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <section className="rounded-2xl border border-edge bg-surface-panel p-5">
          <h2 className="font-medium text-fg">{copy.taskDefinition}</h2>
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-fg">{copy.successDefinition}</h3>{acceptanceCriteria.length > 0 ? <span className="text-xs text-fg-subtle">{copy.criteriaProgress.replace('{{verified}}', String(verifiedCriteriaCount)).replace('{{total}}', String(acceptanceCriteria.length))}</span> : null}</div>
            <div className="mt-3"><TextList items={acceptanceCriteria} empty={copy.noDefinition} verificationByCriterion={verificationByCriterion} /></div>
          </div>
          {expectedOutputs.length > 0 ? <div className="mt-5 border-t border-edge pt-5"><h3 className="text-sm font-medium text-fg">{copy.expectedOutputs}</h3><div className="mt-3"><TextList items={expectedOutputs} empty={copy.noDefinition} /></div></div> : null}
          {constraints.length > 0 ? <details className="mt-5 border-t border-edge pt-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.constraints}</summary><div className="mt-3"><TextList items={constraints} empty={copy.noDefinition} /></div></details> : null}
          {approvalRequired.length > 0 ? <details className="mt-4 border-t border-edge pt-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.approvalRequired}</summary><div className="mt-3"><TextList items={approvalRequired} empty={copy.noDefinition} /></div></details> : null}
          {assumptions.length > 0 ? <details className="mt-4 border-t border-edge pt-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.contextAssumptions}</summary><div className="mt-3"><TextList items={assumptions} empty={copy.noDefinition} /></div></details> : null}
          {risks.length > 0 ? <details className="mt-4 border-t border-edge pt-4"><summary className="cursor-pointer text-sm font-medium text-fg">{copy.contextRisks}</summary><div className="mt-3"><TextList items={risks} empty={copy.noDefinition} /></div></details> : null}
        </section>

        <div className="grid min-w-0 gap-4">
          <section className="min-w-0 rounded-2xl border border-edge bg-surface-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-fg">{copy.taskRelations}</h2>
              {!editingDependencies ? <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => { setDependencyDraft(detail.dependencies.map((task) => task.id)); setEditingDependencies(true); }}><Pencil className="size-3.5" aria-hidden />{copy.editDependencies}</Button> : null}
            </div>
            {editingDependencies ? (
              <div className="mt-4 grid gap-3">
                <p className="text-xs leading-5 text-fg-muted">{copy.dependenciesDescription}</p>
                <DependencyPicker candidates={dependencyCandidates} selectedIds={dependencyDraft} disabled={busy} onChange={setDependencyDraft} labels={{ link: copy.linkDependencies, linked: copy.linkedDependencies, searchPlaceholder: copy.dependencySearchPlaceholder, noMatches: copy.noDependencyMatches, noCandidates: copy.noDependencyCandidates, remove: copy.removeDependency }} />
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setEditingDependencies(false)}>{copy.cancelDependencyEdit}</Button><Button type="button" variant="primary" disabled={busy} onClick={() => void saveDependencies()}>{copy.saveDependencies}</Button></div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div><p className="mb-2 text-xs text-fg-muted">{copy.dependencies}</p>{detail.dependencies.length > 0 ? <div className="space-y-2">{detail.dependencies.map((task) => <Link key={task.id} to={taskHref(task.id)} className="block rounded-lg bg-surface-hover p-2.5 text-sm text-accent hover:underline"><span className="break-words">{task.title}</span><span className="mt-1 block text-xs text-fg-subtle">{phaseLabel(task.phase, language)}</span></Link>)}</div> : <p className="text-sm text-fg-subtle">{copy.noDependencies}</p>}</div>
                <div className="rounded-lg border border-accent/25 bg-accent-soft/40 p-3"><p className="text-xs font-medium text-accent">{copy.currentTask}</p><p className="mt-1 break-words text-sm text-fg">{detail.task.title}</p></div>
                <div><p className="mb-2 text-xs text-fg-muted">{copy.dependents}</p>{detail.dependents.length > 0 ? <div className="space-y-2">{detail.dependents.map((task) => <Link key={task.id} to={taskHref(task.id)} className="block rounded-lg bg-surface-hover p-2.5 text-sm text-accent hover:underline"><span className="break-words">{task.title}</span><span className="mt-1 block text-xs text-fg-subtle">{phaseLabel(task.phase, language)}</span></Link>)}</div> : <p className="text-sm text-fg-subtle">{copy.noDependents}</p>}</div>
              </div>
            )}
          </section>

          {detail.context.length > 0 ? <section className="min-w-0 rounded-2xl border border-edge bg-surface-panel p-5"><h2 className="font-medium text-fg">{copy.contextUsed}</h2><ul className="mt-4 space-y-2">{detail.context.map((item) => <li key={item.id} className="min-w-0 rounded-lg bg-surface-hover p-2.5"><span className="text-[11px] text-fg-subtle">{copy.contextRoleLabels[item.role]} · {copy.contextKindLabels[item.targetKind]}</span>{item.targetKind === 'url' && /^https?:\/\//.test(item.targetId) ? <a className="mt-1 block break-all text-sm text-accent hover:underline" href={item.targetId} target="_blank" rel="noreferrer">{item.title ?? item.targetId}</a> : <p className="mt-1 break-words text-sm text-fg">{item.title ?? item.targetId}</p>}</li>)}</ul></section> : null}
        </div>
      </div>
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
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(52rem,calc(100dvh-2rem))] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-base shadow-float focus:outline-none">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-3.5">
            <Dialog.Title className="font-medium text-fg">{language === 'zh' ? '任务详情' : 'Task details'}</Dialog.Title>
            <Dialog.Description className="sr-only">{language === 'zh' ? '查看并操作任务详情' : 'View and manage task details'}</Dialog.Description>
            <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={language === 'zh' ? '关闭任务详情' : 'Close task details'}><X className="size-4" aria-hidden /></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <TaskDetailView taskId={taskId} presentation="modal" backgroundPath={backgroundPath} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
