import type { TaskCommand, TaskPhase } from '@xopcai/gateway-contract';
import { ArrowLeft, CircleCheck, ExternalLink, Pencil, Play, Pause, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchProjectOperatingView } from '@/features/projects/api';
import { DependencyPicker, type DependencyCandidate } from '@/features/tasks/dependency-picker';
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

function TextList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm leading-6 text-fg-muted">{empty}</p>;
  return <ul className="space-y-2">{items.map((item) => <li key={item} className="flex gap-2 text-sm leading-6 text-fg"><CircleCheck className="mt-1 size-4 shrink-0 text-success" /><span>{item}</span></li>)}</ul>;
}

export function TaskDetailPage() {
  const { taskId = '' } = useParams();
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
      setDependencyCandidates(currentDependencies);
      return;
    }
    let active = true;
    void fetchProjectOperatingView(projectId).then((view) => {
      if (!active) return;
      const candidates = new Map<string, DependencyCandidate>();
      for (const task of [...view.tasks, ...currentDependencies]) {
        if (task.id !== taskId) candidates.set(task.id, { id: task.id, title: task.title });
      }
      setDependencyCandidates([...candidates.values()]);
    }).catch(() => {
      if (active) setDependencyCandidates(currentDependencies);
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
    setPageHeader({
      startExtra: <Link to={returnPath} className="flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover" aria-label={copy.backToWork}><ArrowLeft className="size-4" /></Link>,
      main: detail ? <div className="min-w-0"><h1 className="truncate text-base font-semibold text-fg">{detail.task.title}</h1><p className="text-xs text-fg-muted">{phaseLabel(detail.task.phase, language)} · {detail.operationalState}</p></div> : null,
      end: null,
    });
    return clearPageHeader;
  }, [clearPageHeader, copy.backToWork, detail, language, returnPath, setPageHeader]);

  if (error && !detail) return <div className="mx-auto max-w-3xl p-6 text-sm text-danger">{error}</div>;
  if (!detail) return <div className="mx-auto max-w-4xl p-4 sm:p-6"><DetailSkeleton /></div>;

  const activeWait = detail.waits[0];
  const latestReceipt = detail.receipts[0];
  const canStart = detail.allowedCommands.includes('start');
  const canPause = detail.allowedCommands.includes('add_wait');
  const needsUserAttention = detail.attention.some((item) => item.kind === 'input_required' || item.kind === 'approval_required');

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 pb-16 sm:p-6">
      <section className="rounded-2xl border border-edge bg-surface-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><p className="text-xs font-medium text-accent">{phaseLabel(detail.task.phase, language)} · {detail.operationalState}</p><h2 className="mt-2 text-xl font-semibold text-fg">{detail.task.title}</h2>{detail.task.body ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-muted">{detail.task.body}</p> : null}</div>
          {detail.task.phase !== 'closed' ? <div className="flex flex-wrap gap-2">
            {activeWait ? <Button disabled={busy} onClick={() => void execute({ type: 'resolve_wait', waitId: activeWait.id })}><Play className="size-4" />{copy.resumeTask}</Button> : null}
            {!activeWait && canStart ? <Button disabled={busy} onClick={() => void execute({ type: 'start', executor: { kind: 'agent', agentId: detail.task.delegateAgentId ?? 'main' } })}><Play className="size-4" />{copy.runTask}</Button> : null}
            {!activeWait && canPause ? <Button variant="secondary" disabled={busy} onClick={() => void execute({ type: 'add_wait', wait: { kind: 'paused', reason: 'Paused by user', condition: {} } })}><Pause className="size-4" />{copy.pauseTask}</Button> : null}
            <Button variant="ghost" disabled={busy} onClick={() => void execute({ type: 'close', resolution: 'cancelled' })}><X className="size-4" />{copy.cancelTask}</Button>
          </div> : null}
        </div>
        {detail.task.dueAt ? <p className="mt-4 text-xs text-fg-muted">{formatMediumDateTime(detail.task.dueAt)}</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      {detail.attention.length > 0 ? <section className="rounded-2xl border border-warning/40 bg-warning/5 p-5"><h3 className="font-medium text-fg">{needsUserAttention ? copy.needsAttention : copy.waitingStatus}</h3><ul className="mt-3 space-y-2 text-sm text-fg-muted">{detail.attention.map((item, index) => <li key={`${item.kind}-${index}`}>{item.summary}</li>)}</ul></section> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-edge bg-surface-panel p-5"><h3 className="font-medium text-fg">{copy.successDefinition}</h3><div className="mt-4"><TextList items={detail.task.contract?.acceptanceCriteria ?? []} empty={copy.noDefinition} /></div></section>
        <section className="rounded-2xl border border-edge bg-surface-panel p-5"><h3 className="font-medium text-fg">{copy.expectedOutputs}</h3><div className="mt-4"><TextList items={detail.task.contract?.expectedOutputs ?? []} empty={copy.noDefinition} /></div></section>
      </div>

      <section className="rounded-2xl border border-edge bg-surface-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium text-fg">{copy.taskRelations}</h3>
          {!editingDependencies ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 rounded-lg px-2.5 text-xs"
              onClick={() => {
                setDependencyDraft(detail.dependencies.map((task) => task.id));
                setEditingDependencies(true);
              }}
            >
              <Pencil className="size-3.5" aria-hidden />
              {copy.editDependencies}
            </Button>
          ) : null}
        </div>
        {editingDependencies ? (
          <div className="mt-4 grid gap-3">
            <p className="text-xs leading-5 text-fg-muted">{copy.dependenciesDescription}</p>
            <DependencyPicker
              candidates={dependencyCandidates}
              selectedIds={dependencyDraft}
              disabled={busy}
              onChange={setDependencyDraft}
              labels={{
                link: copy.linkDependencies,
                linked: copy.linkedDependencies,
                searchPlaceholder: copy.dependencySearchPlaceholder,
                noMatches: copy.noDependencyMatches,
                noCandidates: copy.noDependencyCandidates,
                remove: copy.removeDependency,
              }}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditingDependencies(false)}>{copy.cancelDependencyEdit}</Button>
              <Button type="button" variant="primary" disabled={busy} onClick={() => void saveDependencies()}>{copy.saveDependencies}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-fg-muted">{copy.dependencies}</p>
              {detail.dependencies.length > 0
                ? detail.dependencies.map((task) => <Link key={task.id} to={withReturnTo(`/tasks/${task.id}`, returnPath)} className="block text-sm text-accent hover:underline">{task.title} · {phaseLabel(task.phase, language)}</Link>)
                : <p className="text-sm text-fg-subtle">{copy.noDependencies}</p>}
            </div>
            <div>
              <p className="mb-2 text-xs text-fg-muted">{copy.dependents}</p>
              {detail.dependents.length > 0
                ? detail.dependents.map((task) => <Link key={task.id} to={withReturnTo(`/tasks/${task.id}`, returnPath)} className="block text-sm text-accent hover:underline">{task.title} · {phaseLabel(task.phase, language)}</Link>)
                : <p className="text-sm text-fg-subtle">{copy.noDependents}</p>}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-edge bg-surface-panel p-5"><h3 className="font-medium text-fg">{copy.executionReceipts}</h3>{detail.receipts.length === 0 ? <p className="mt-4 text-sm text-fg-muted">{copy.noReceipts}</p> : <div className="mt-4 space-y-4">{detail.receipts.map((receipt) => <article key={receipt.runId} className="border-t border-edge pt-4 first:border-0 first:pt-0"><div className="flex items-center justify-between gap-3"><p className="font-medium text-fg">{receipt.summary}</p><span className="text-xs text-fg-muted">{receipt.status} · {receipt.verification.status}</span></div>{receipt.nextAction ? <p className="mt-2 text-sm text-fg-muted">{receipt.nextAction}</p> : null}<div className="mt-3 flex gap-2"><Button className="px-2 py-1 text-xs" variant="secondary" onClick={() => void submitTaskFeedback(receipt.runId, 'helpful')}>{copy.doneWell}</Button><Button className="px-2 py-1 text-xs" variant="ghost" onClick={() => void submitTaskFeedback(receipt.runId, 'not_helpful')}>{copy.needsFix}</Button>{receipt.evidence[0]?.uri ? <a className="ml-auto inline-flex items-center gap-1 text-xs text-accent" href={receipt.evidence[0].uri}><ExternalLink className="size-3" />{copy.evidenceDetails}</a> : null}</div></article>)}</div>}</section>
      {latestReceipt?.needsUser ? <p className="text-sm text-warning">{latestReceipt.nextAction ?? copy.noDecisionNeeded}</p> : null}
    </main>
  );
}
