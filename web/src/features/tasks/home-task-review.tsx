import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { commandTask, fetchTask, reviewTaskCriterion, type TaskDetail } from './home-api';
import { summarizeTaskCriteria } from './task-detail-summary';
import { TaskExpandableContent } from './task-expandable-content';

export function HomeTaskReview({ taskId, language, onComplete }: {
  taskId: string;
  language: 'zh' | 'en';
  onComplete: () => void;
}) {
  const zh = language === 'zh';
  const [detail, setDetail] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError(undefined);
    setDetail(undefined);
    void fetchTask(taskId).then((value) => { if (active) setDetail(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [taskId, reload]);

  const criteria = detail ? summarizeTaskCriteria(detail) : [];
  const canAccept = detail?.task.phase === 'review' && detail.allowedCommands.includes('close')
    && detail.waits.length === 0 && criteria.length > 0 && criteria.every((criterion) => criterion.status === 'passed');
  async function operate(operation: () => Promise<TaskDetail>, complete = false) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setDetail(await operation());
      if (complete) onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const receipt = detail?.receipts[0];
  return <section className="mt-4 space-y-4 rounded-xl border border-edge bg-surface-panel p-4" aria-label={zh ? '任务验收' : 'Task review'}>
    {error ? <div role="alert" className="flex items-center justify-between gap-3 text-sm text-danger">
      <span>{error}</span><Button variant="ghost" disabled={busy} onClick={() => setReload((value) => value + 1)}>{zh ? '刷新' : 'Refresh'}</Button>
    </div> : null}
    {!detail && !error ? <div className="space-y-3" aria-busy><Skeleton className="h-5 w-1/3" /><Skeleton className="h-24 w-full" /></div> : null}
    {detail ? <>
      <h3 className="text-sm font-semibold text-fg">{zh ? '执行结果' : 'Result'}</h3>
      {receipt ? <>
        <TaskExpandableContent content={receipt.summary} contentKey={`home:${taskId}:result`} language={language} previewHeight={180} />
        {receipt.remainingWork.length > 0 ? <p className="whitespace-pre-wrap text-sm text-fg-muted">{zh ? '尚待完成：' : 'Remaining work: '}{receipt.remainingWork.join('\n')}</p> : null}
        {receipt.evidence.map((item, index) => <div key={index} className="text-sm text-fg-muted">
          {item.uri && /^https?:\/\//.test(item.uri)
            ? <a href={item.uri} target="_blank" rel="noreferrer" className="text-accent-fg hover:underline">{item.title}</a>
            : <span>{item.title}</span>}
          {item.summary ? <p className="mt-1 whitespace-pre-wrap break-words">{item.summary}</p> : null}
        </div>)}
      </> : <p className="text-sm text-fg-muted">{zh ? '暂无执行结果，请查看任务详情。' : 'No result yet. View the task details.'}</p>}
      <h3 className="text-sm font-semibold text-fg">{zh ? '验收条件' : 'Acceptance criteria'}</h3>
      {criteria.map((criterion, index) => <div key={index} className="flex flex-wrap items-start justify-between gap-2 border-t border-edge-subtle pt-3">
        <div className="min-w-0 flex-1 text-sm text-fg"><p className="break-words">{criterion.text}</p><p className="mt-1 text-xs text-fg-muted">{zh
          ? { passed: '已通过', failed: '未通过', unverified: '待判定' }[criterion.status]
          : { passed: 'Passed', failed: 'Failed', unverified: 'Not reviewed' }[criterion.status]}</p></div>
        {detail.task.phase !== 'closed' && detail.task.contract?.acceptancePolicy !== 'verified_auto' ? <div className="flex gap-2">
          {(['passed', 'failed'] as const).map((status) => <Button key={status} variant="secondary" disabled={busy || criterion.status === status} onClick={() => void operate(() => reviewTaskCriterion(taskId, index, status, detail.task.version, detail.task.latestContractVersion))}>
            {zh ? (status === 'passed' ? '确认通过' : '未通过') : (status === 'passed' ? 'Mark passed' : 'Mark failed')}
          </Button>)}
        </div> : null}
      </div>)}
      {!canAccept ? <p className="text-xs text-fg-muted">{zh ? '所有验收条件通过且任务无等待事项后，可完成验收。' : 'Accept once all criteria pass and the task has no pending waits.'}</p> : null}
      <Button variant="primary" disabled={busy || !canAccept} onClick={() => void operate(() => commandTask(taskId, { type: 'close', resolution: 'done' }, detail.task.version), true)}>{zh ? '验收完成' : 'Accept task'}</Button>
    </> : null}
  </section>;
}
