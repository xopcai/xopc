import * as Dialog from '@radix-ui/react-dialog';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { commandTask, fetchTask, reviewTaskCriterion, type TaskDetail } from './home-api';
import { homeTaskExecutor } from './home-task-actions';
import { taskDetailModalHref, TASK_DETAIL_MODAL_PARAM } from './task-detail-route';
import { currentTaskReceipt, summarizeTaskCriteria } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskInputCard } from './task-input-card';
import { TaskResultEvidence } from './task-result-evidence';
import { presentTaskRunResult, taskTextForDisplay } from './task-result-presentation';
import { TaskRunIssueNotice } from './task-run-issue-notice';
import { WorkbenchDialog } from './workbench-dialog';

const WorkspaceFilePreviewPanel = lazy(() => import('@/features/workspace/workspace-file-preview-dialog')
  .then((module) => ({ default: module.WorkspaceFilePreviewPanel })));

export function HomeTaskReview({ taskId, taskTitle, language, onClose, onComplete, onUpdated, restoreFocus }: {
  taskId: string;
  taskTitle?: string;
  language: 'zh' | 'en';
  onClose: () => void;
  onComplete?: () => void;
  restoreFocus?: () => void;
  onUpdated?: (detail: TaskDetail) => void;
}) {
  const zh = language === 'zh';
  const location = useLocation();
  const taskDetailOpen = new URLSearchParams(location.search).has(TASK_DETAIL_MODAL_PARAM);
  const backgroundPath = `${location.pathname}${location.search}`;
  const [detail, setDetail] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const requestVersion = useRef(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    setDetail(undefined);
    setNotice(undefined);
  }, [taskId]);
  useEffect(() => {
    let active = true;
    const version = ++requestVersion.current;
    setError(undefined);
    void fetchTask(taskId).then((value) => { if (active && version === requestVersion.current && !pending.current) setDetail(value); })
      .catch((cause) => { if (active && version === requestVersion.current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [taskId, reload]);
  useEffect(() => {
    const refresh = () => { if (!pending.current) setReload((value) => value + 1); };
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ taskId?: string }>).detail?.taskId === taskId) refresh();
    };
    window.addEventListener('task-changed-v2', onChange);
    window.addEventListener('focus', refresh);
    window.addEventListener('realtime-gap', refresh);
    window.addEventListener('gateway-realtime-connected', refresh);
    return () => {
      window.removeEventListener('task-changed-v2', onChange);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('realtime-gap', refresh);
      window.removeEventListener('gateway-realtime-connected', refresh);
    };
  }, [taskId]);

  const criteria = detail ? summarizeTaskCriteria(detail) : [];
  const acceptanceTarget = detail?.acceptanceTarget;
  const canAccept = acceptanceTarget?.canSignOff === true;
  const executor = detail ? homeTaskExecutor(detail) : undefined;
  const canContinue = detail?.allowedCommands.includes('start') && detail.waits.length === 0 && executor;
  const updated = (value: TaskDetail) => { requestVersion.current++; setDetail(value); onUpdated?.(value); };
  async function operate(operation: () => Promise<TaskDetail>, message: string, complete = false) {
    if (pending.current) return;
    pending.current = true;
    requestVersion.current++;
    setBusy(true);
    setError(undefined);
    try {
      const next = await operation();
      updated(next);
      const completed = complete || (detail?.task.phase !== 'closed' && next.task.phase === 'closed' && next.task.resolution === 'done');
      setNotice(completed ? (zh ? '任务已验收完成。' : 'Task accepted.') : message);
      if (completed) {
        onClose();
        onComplete?.();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const receipt = detail && currentTaskReceipt(detail);
  const result = receipt && presentTaskRunResult(receipt, language, detail?.runs.find((run) => run.id === receipt.runId)?.terminalMessage);
  const judgment = receipt?.judgment;
  const passed = criteria.filter((criterion) => criterion.status === 'passed').length;
  const failed = criteria.filter((criterion) => criterion.status === 'failed').length;
  const unverified = criteria.length - passed - failed;
  const criteriaProgress = [
    passed ? (zh ? `${passed} 项通过` : `${passed} passed`) : '',
    failed ? (zh ? `${failed} 项未通过` : `${failed} failed`) : '',
    unverified ? (zh ? `${unverified} 项待核验` : `${unverified} to verify`) : '',
  ].filter(Boolean).join(' · ');
  const automatic = detail?.task.contract?.acceptancePolicy === 'verified_auto';
  const taskHref = taskDetailModalHref(backgroundPath, taskId);
  return <WorkbenchDialog
    title={zh ? '执行结果' : 'Result'}
    subtitle={detail?.task.title ?? taskTitle}
    open={!taskDetailOpen}
    onOpenChange={(open) => { if (!open) onClose(); }}
    restoreFocus={taskDetailOpen ? false : restoreFocus}
    busy={busy}
    size="wide"
    footer={<div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="ghost" disabled={busy} onClick={() => setReload((value) => value + 1)}>{zh ? '刷新状态' : 'Refresh status'}</Button>
      <Button asChild variant="secondary"><Link to={taskHref}>{zh ? '查看任务详情' : 'Task details'}</Link></Button>
    </div>}
  >
    <div className="space-y-4">
      {error ? <p role="alert" className="text-sm text-danger">{taskTextForDisplay(error, language)}</p> : null}
      {busy ? <p role="status" className="text-xs text-fg-muted">{zh ? '正在处理…' : 'Processing…'}</p> : null}
      {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
      {!detail && !error ? <div className="space-y-3" aria-busy><Skeleton className="h-5 w-1/3" /><Skeleton className="h-24 w-full" /></div> : null}
      {detail ? <>
        {receipt && result ? <>
          {result.issue ? <TaskRunIssueNotice issue={result.issue} /> : <p className="text-sm text-fg-muted">{result.status}</p>}
          {result.summary ? <TaskExpandableContent content={result.summary} contentKey={`home:${taskId}:result:${receipt.runId}`} language={language} previewHeight={180} /> : null}
          {result.remainingWork.length > 0 ? <section className="space-y-2 text-sm leading-6 text-fg-muted">
            <h3 className="font-medium text-fg">{zh ? '尚待完成' : 'Remaining work'}</h3>
            <ul className="list-disc space-y-1 pl-5">{result.remainingWork.map((item) => <li key={item} className="break-words">{item}</li>)}</ul>
          </section> : null}
          {result.nextAction ? <section className="space-y-1 text-sm leading-6">
            <h3 className="font-medium text-fg">{zh ? '下一步' : 'Next step'}</h3>
            <p className="whitespace-pre-wrap break-words text-fg-muted">{result.nextAction}</p>
          </section> : null}
          {judgment ? <div className="space-y-1 text-sm text-fg-muted">
            <h3 className="font-medium text-fg">{zh ? '判断依据' : 'Assessment'}</h3>
            <p>{taskTextForDisplay(judgment.recommendation, language)}</p>
            <ul className="list-disc space-y-1 pl-5">{judgment.reasons.map((reason, index) => <li key={index}>{taskTextForDisplay(reason, language)}</li>)}</ul>
            {judgment.uncertainty ? <p>{zh ? '仍需确认 · ' : 'Still to confirm · '}{taskTextForDisplay(judgment.uncertainty, language)}</p> : null}
          </div> : null}
          <TaskResultEvidence evidence={receipt.evidence} projectId={detail.task.projectId} conversationId={detail.conversation?.activeConversationId} language={language} onOpenFile={setPreviewPath} />
        </> : <p className="text-sm text-fg-muted">{zh ? '当前任务版本暂无执行结果，可先处理等待事项或查看执行进度。' : 'No result for the current task version. Resolve pending items or view progress.'}</p>}
        {criteria.length > 0 ? <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-fg">{zh ? '验收条件' : 'Acceptance criteria'}</h3>
            <span className="text-xs text-fg-muted">{criteriaProgress}</span>
          </div>
          {criteria.map((criterion, index) => <div key={index} className="space-y-2 border-t border-edge-subtle pt-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1 text-sm text-fg"><p className="break-words">{criterion.text}</p><p className="mt-1 text-xs text-fg-muted">{zh
                ? { passed: '已通过', failed: '未通过', unverified: '待核验' }[criterion.status]
                : { passed: 'Passed', failed: 'Failed', unverified: 'To verify' }[criterion.status]}</p></div>
              {detail.task.phase === 'review' && !automatic ? <div className="flex gap-2">
                {(['passed', 'failed'] as const).map((status) => <Button key={status} variant="secondary" disabled={busy || !acceptanceTarget || criterion.status === status} onClick={() => {
                  if (acceptanceTarget) void operate(() => reviewTaskCriterion(taskId, criterion.id, status, detail.task.version, detail.task.latestContractVersion, acceptanceTarget.id), zh ? '判定已保存。' : 'Review saved.');
                }}>
                  {zh ? (status === 'passed' ? '确认通过' : '未通过') : (status === 'passed' ? 'Mark passed' : 'Mark failed')}
                </Button>)}
              </div> : null}
            </div>
            {criterion.note ? <p className="whitespace-pre-wrap text-xs leading-5 text-fg-muted">{taskTextForDisplay(criterion.note, language)}</p> : null}
            {criterion.review?.note ? <p className="text-xs text-fg-muted">{taskTextForDisplay(criterion.review.note, language)}</p> : null}
            <TaskResultEvidence evidence={criterion.evidence} projectId={detail.task.projectId} conversationId={detail.conversation?.activeConversationId} language={language} onOpenFile={setPreviewPath} />
          </div>)}
        </> : null}
        {detail.waits.length > 0 ? <div className="space-y-3">
          <h3 className="text-sm font-semibold text-fg">{zh ? '等待处理' : 'Pending items'}</h3>
          {detail.waits.map((wait) => <div key={wait.id}>
            {detail.allowedCommands.includes('resolve_wait') && (wait.kind === 'user_input' || (wait.kind === 'approval' && typeof wait.condition.capability === 'string')) && wait.condition.type !== 'connection'
              ? <TaskInputCard wait={wait} detail={detail} zh={zh} onUpdated={updated} />
              : <div className="rounded-lg bg-surface-hover p-3 text-sm text-fg-muted"><p>{taskTextForDisplay(wait.reason, language)}</p>
                {wait.kind === 'paused' && detail.allowedCommands.includes('resolve_wait') ? <Button className="mt-2" disabled={busy} onClick={() => void operate(() => commandTask(taskId, { type: 'resolve_wait', waitId: wait.id }, detail.task.version), zh ? '已解除暂停，任务状态已更新。' : 'Pause resolved. Task status updated.')}>{zh ? '恢复任务' : 'Resume task'}</Button>
                  : <Link to={typeof wait.condition.dependsOnTaskId === 'string' ? taskDetailModalHref(backgroundPath, wait.condition.dependsOnTaskId) : taskHref} className="mt-2 inline-flex min-h-9 items-center text-accent-fg hover:underline">{zh ? '查看并处理' : 'View and resolve'}</Link>}
              </div>}
          </div>)}
        </div> : null}
        {detail.task.phase === 'review' && !canAccept ? <p className="text-xs leading-5 text-fg-muted">{zh
          ? `尚有 ${unverified} 项待判定、${failed} 项未通过、${detail.waits.length} 项等待处理。${automatic ? '此任务需要执行验证；请继续执行以补齐依据和未完成项。' : '查看依据后逐项判定；未通过时可继续执行修正。'}`
          : `${unverified} unreviewed, ${failed} failed, ${detail.waits.length} pending items. ${automatic ? 'This task requires execution verification. Continue execution to supply missing evidence.' : 'Review the evidence and mark each criterion; continue execution to fix failures.'}`}</p> : null}
        <div className="flex flex-wrap gap-2">
          {detail.task.phase === 'review' ? <Button variant="primary" disabled={busy || !canAccept} onClick={() => {
            if (acceptanceTarget) void operate(() => commandTask(taskId, { type: 'signoff', resultId: acceptanceTarget.id }, detail.task.version), zh ? '任务已验收完成。' : 'Task accepted.', true);
          }}>{zh ? '确认验收' : 'Accept task'}</Button> : null}
          {canContinue ? <Button variant={canAccept ? 'secondary' : 'primary'} disabled={busy} onClick={() => void operate(() => commandTask(taskId, { type: 'start', executor }, detail.task.version), zh ? '已开始执行，结果将自动更新。' : 'Execution started. Results will update automatically.')}>
            {receipt?.status === 'failed' && !result?.summary ? (zh ? '重试任务' : 'Retry task')
              : receipt ? (zh ? '继续执行并验证' : 'Continue and verify') : (zh ? '开始执行' : 'Start execution')}
          </Button> : null}
        </div>
      </> : null}
      {detail && previewPath ? <Dialog.Root open onOpenChange={(open) => { if (!open) setPreviewPath(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[100] bg-scrim" />
          <Dialog.Content className="app-main-surface fixed left-1/2 top-1/2 z-[105] flex h-[min(54rem,calc(100dvh-2rem))] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel outline-none" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">{zh ? '交付物预览' : 'Artifact preview'} · {previewPath}</Dialog.Title>
            <Suspense fallback={<div className="flex-1 space-y-3 p-4" aria-busy><Skeleton className="h-9 w-full" /><Skeleton className="h-64 w-full" /></div>}>
              <WorkspaceFilePreviewPanel filePath={previewPath} projectId={detail.task.projectId} conversationId={detail.conversation?.activeConversationId} onClose={() => setPreviewPath(null)} />
            </Suspense>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root> : null}
    </div>
  </WorkbenchDialog>;
}
