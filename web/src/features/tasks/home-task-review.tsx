import * as Dialog from '@radix-ui/react-dialog';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { commandTask, fetchTask, reviewTaskCriterion, type TaskDetail } from './home-api';
import { homeTaskExecutor } from './home-task-actions';
import { taskDetailModalHref } from './task-detail-route';
import { summarizeTaskCriteria } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';
import { TaskInputCard } from './task-input-card';
import { TaskResultEvidence } from './task-result-evidence';

const WorkspaceFilePreviewPanel = lazy(() => import('@/features/workspace/workspace-file-preview-dialog')
  .then((module) => ({ default: module.WorkspaceFilePreviewPanel })));

export function HomeTaskReview({ taskId, language, onComplete, onUpdated }: {
  taskId: string;
  language: 'zh' | 'en';
  onComplete: () => void;
  onUpdated?: (detail: TaskDetail) => void;
}) {
  const zh = language === 'zh';
  const location = useLocation();
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
  const canAccept = detail?.task.phase === 'review' && detail.allowedCommands.includes('close')
    && detail.waits.length === 0 && criteria.length > 0 && criteria.every((criterion) => criterion.status === 'passed');
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
      updated(await operation());
      setNotice(message);
      if (complete) onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const receipt = detail?.receipts.filter((item) => detail.runs.some((run) => run.id === item.runId
    && run.contractVersion === detail.task.latestContractVersion)).sort((a, b) => b.finalizedAt - a.finalizedAt)[0];
  const passed = criteria.filter((criterion) => criterion.status === 'passed').length;
  const failed = criteria.filter((criterion) => criterion.status === 'failed').length;
  const unverified = criteria.length - passed - failed;
  const automatic = detail?.task.contract?.acceptancePolicy === 'verified_auto';
  const taskHref = taskDetailModalHref(backgroundPath, taskId);
  return <section className="mt-4 space-y-4 rounded-xl border border-edge bg-surface-panel p-4" aria-label={zh ? '任务结果与处理' : 'Task result and actions'} aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-fg">{zh ? '执行结果' : 'Result'}</h3>
      <div className="flex items-center gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => setReload((value) => value + 1)}>{zh ? '刷新状态' : 'Refresh status'}</Button>
        <Link to={taskHref} className="inline-flex min-h-9 items-center text-xs font-medium text-accent-fg hover:underline">{zh ? '查看任务详情' : 'Task details'}</Link>
      </div>
    </div>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {busy ? <p role="status" className="text-xs text-fg-muted">{zh ? '正在处理…' : 'Processing…'}</p> : null}
    {notice ? <p role="status" className="text-sm text-success">{notice}</p> : null}
    {!detail && !error ? <div className="space-y-3" aria-busy><Skeleton className="h-5 w-1/3" /><Skeleton className="h-24 w-full" /></div> : null}
    {detail ? <>
      {receipt ? <>
        <p className="text-xs text-fg-muted">{receipt.completionVerdict === 'achieved'
          ? (zh ? '执行报告已达成目标，请结合依据逐项验收。' : 'The run reports the goal achieved. Review the evidence before accepting.')
          : (zh ? '当前为阶段性结果，尚有工作需要推进。' : 'This is a partial result. More work is needed.')}</p>
        <TaskExpandableContent content={receipt.summary} contentKey={`home:${taskId}:result:${receipt.runId}`} language={language} previewHeight={180} />
        {receipt.remainingWork.length > 0 ? <div className="text-sm text-fg-muted"><p className="font-medium text-fg">{zh ? '尚待完成' : 'Remaining work'}</p><ul className="mt-1 list-disc space-y-1 pl-5">{receipt.remainingWork.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
        {receipt.nextAction ? <p className="whitespace-pre-wrap text-sm text-fg-muted"><span className="font-medium text-fg">{zh ? '下一步：' : 'Next step: '}</span>{receipt.nextAction}</p> : null}
        {receipt.judgment ? <div className="space-y-1 text-sm text-fg-muted">
          <p className="font-medium text-fg">{zh ? '判断依据' : 'Assessment'}</p>
          <p>{receipt.judgment.recommendation}</p>
          <ul className="list-disc space-y-1 pl-5">{receipt.judgment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          {receipt.judgment.uncertainty ? <p>{zh ? '待确认：' : 'Uncertainty: '}{receipt.judgment.uncertainty}</p> : null}
        </div> : null}
        <TaskResultEvidence evidence={receipt.evidence} projectId={detail.task.projectId} conversationId={detail.conversation?.activeConversationId} language={language} onOpenFile={setPreviewPath} />
      </> : <p className="text-sm text-fg-muted">{zh ? '当前任务版本暂无执行结果，可先处理等待事项或查看执行进度。' : 'No result for the current task version. Resolve pending items or view progress.'}</p>}
      {criteria.length > 0 ? <>
        <h3 className="text-sm font-semibold text-fg">{zh ? '验收条件' : 'Acceptance criteria'} <span className="font-normal text-fg-muted">{passed}/{criteria.length}</span></h3>
        {criteria.map((criterion, index) => <div key={index} className="space-y-2 border-t border-edge-subtle pt-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 text-sm text-fg"><p className="break-words">{criterion.text}</p><p className="mt-1 text-xs text-fg-muted">{zh
              ? { passed: '已通过', failed: '未通过', unverified: '待判定' }[criterion.status]
              : { passed: 'Passed', failed: 'Failed', unverified: 'Not reviewed' }[criterion.status]}</p></div>
            {detail.task.phase === 'review' && !automatic ? <div className="flex gap-2">
              {(['passed', 'failed'] as const).map((status) => <Button key={status} variant="secondary" disabled={busy || criterion.status === status} onClick={() => void operate(() => reviewTaskCriterion(taskId, index, status, detail.task.version, detail.task.latestContractVersion), zh ? '判定已保存。' : 'Review saved.')}>
                {zh ? (status === 'passed' ? '确认通过' : '未通过') : (status === 'passed' ? 'Mark passed' : 'Mark failed')}
              </Button>)}
            </div> : null}
          </div>
          {criterion.note ? <p className="whitespace-pre-wrap text-xs leading-5 text-fg-muted">{criterion.note}</p> : null}
          {criterion.review?.note ? <p className="text-xs text-fg-muted">{criterion.review.note}</p> : null}
          <TaskResultEvidence evidence={criterion.evidence} projectId={detail.task.projectId} conversationId={detail.conversation?.activeConversationId} language={language} onOpenFile={setPreviewPath} />
        </div>)}
      </> : null}
      {detail.waits.length > 0 ? <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">{zh ? '等待处理' : 'Pending items'}</h3>
        {detail.waits.map((wait) => <div key={wait.id}>
          {detail.allowedCommands.includes('resolve_wait') && (wait.kind === 'user_input' || (wait.kind === 'approval' && typeof wait.condition.capability === 'string')) && wait.condition.type !== 'connection'
            ? <TaskInputCard wait={wait} detail={detail} zh={zh} onUpdated={updated} />
            : <div className="rounded-lg bg-surface-hover p-3 text-sm text-fg-muted"><p>{wait.reason}</p>
              {wait.kind === 'paused' && detail.allowedCommands.includes('resolve_wait') ? <Button className="mt-2" disabled={busy} onClick={() => void operate(() => commandTask(taskId, { type: 'resolve_wait', waitId: wait.id }, detail.task.version), zh ? '已解除暂停，任务状态已更新。' : 'Pause resolved. Task status updated.')}>{zh ? '恢复任务' : 'Resume task'}</Button>
                : <Link to={typeof wait.condition.dependsOnTaskId === 'string' ? taskDetailModalHref(backgroundPath, wait.condition.dependsOnTaskId) : taskHref} className="mt-2 inline-flex min-h-9 items-center text-accent-fg hover:underline">{zh ? '查看并处理' : 'View and resolve'}</Link>}
            </div>}
        </div>)}
      </div> : null}
      {detail.task.phase === 'review' && !canAccept ? <p className="text-xs leading-5 text-fg-muted">{zh
        ? `尚有 ${unverified} 项待判定、${failed} 项未通过、${detail.waits.length} 项等待处理。${automatic ? '此任务需要执行验证；请继续执行以补齐依据和未完成项。' : '查看依据后逐项判定；未通过时可继续执行修正。'}`
        : `${unverified} unreviewed, ${failed} failed, ${detail.waits.length} pending items. ${automatic ? 'This task requires execution verification. Continue execution to supply missing evidence.' : 'Review the evidence and mark each criterion; continue execution to fix failures.'}`}</p> : null}
      <div className="flex flex-wrap gap-2">
        {detail.task.phase === 'review' ? <Button variant="primary" disabled={busy || !canAccept} onClick={() => void operate(() => commandTask(taskId, { type: 'close', resolution: 'done' }, detail.task.version), zh ? '任务已验收完成。' : 'Task accepted.', true)}>{zh ? '验收完成' : 'Accept task'}</Button> : null}
        {canContinue ? <Button variant={canAccept ? 'secondary' : 'primary'} disabled={busy} onClick={() => void operate(() => commandTask(taskId, { type: 'start', executor }, detail.task.version), zh ? '已开始执行，结果将自动更新。' : 'Execution started. Results will update automatically.')}>
          {zh ? (receipt ? '继续执行并验证' : '开始执行') : (receipt ? 'Continue and verify' : 'Start execution')}
        </Button> : null}
      </div>
    </> : null}
    {detail && previewPath ? <Dialog.Root open onOpenChange={(open) => { if (!open) setPreviewPath(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim" />
        <Dialog.Content className="app-main-surface fixed left-1/2 top-1/2 z-[90] flex h-[min(54rem,calc(100dvh-2rem))] w-[min(72rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel outline-none" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{zh ? '交付物预览' : 'Artifact preview'} · {previewPath}</Dialog.Title>
          <Suspense fallback={<div className="flex-1 space-y-3 p-4" aria-busy><Skeleton className="h-9 w-full" /><Skeleton className="h-64 w-full" /></div>}>
            <WorkspaceFilePreviewPanel filePath={previewPath} projectId={detail.task.projectId} conversationId={detail.conversation?.activeConversationId} onClose={() => setPreviewPath(null)} />
          </Suspense>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root> : null}
  </section>;
}
